// Command aula-tsnet is the Tailscale sidecar for the Aula Mac app.
//
// It joins the user's tailnet as its own node (using tailscale.com/tsnet, no
// system Tailscale install needed), listens ONLY on the tailnet at
// :<listen-port> and reverse-proxies HTTP + WebSocket traffic to the local
// Aula server (--target, always a loopback address). Nothing is exposed to
// the internet: no Funnel, no Serve, and no log uploads to Tailscale.
//
// Every proxied request carries the proxy key and the caller's tailnet
// identity:
//
//	X-Aula-Proxy-Key     secret shared with the Aula app (read from stdin, never argv/env)
//	X-Aula-Tailnet-User  login name of the peer's user (e.g. alice@example.com)
//	X-Aula-Tailnet-Node  MagicDNS name of the peer node (e.g. aula-iphone.tail1234.ts.net)
//	X-Aula-Tailnet-Addr  peer tailnet IP (e.g. 100.101.102.103)
//	X-Aula-Via           "tailscale"
//
// Client-supplied headers with those names are always removed first. The
// Aula server trusts the identity headers only on requests that carry the
// right proxy key, so a local process that connects to 127.0.0.1 directly
// cannot pass itself off as a tailnet peer. Only peers owned by the same
// Tailscale user as this node (the person's own iPhone) are let through;
// tagged devices and other users are refused with 403.
//
// # stdin
//
// The first line is a JSON config: {"proxyKey":"<secret>"} (at least 32
// characters). Later lines are commands: {"cmd":"logout"} logs this node out
// of the tailnet (the node then asks for a new login). When stdin is closed
// (the parent died) the process exits. With --watch-stdin=false the key is
// read from $AULA_TSNET_PROXY_KEY instead (manual runs only).
//
// # Status protocol
//
// stdout carries ONLY newline-delimited JSON status events (all logs go to
// stderr):
//
//	{"type":"starting"}
//	{"type":"needs_login","authURL":"https://login.tailscale.com/a/..."}
//	{"type":"needs_machine_auth","message":"..."}   (device awaits admin approval)
//	{"type":"running","hostname":"aula-mac","dnsName":"aula-mac.tail1234.ts.net","ips":["100.x.y.z","fd7a:..."],"port":80,"user":"alice@example.com"}
//	{"type":"peer_refused","user":"bob@example.com","node":"bobs-phone.tail1234.ts.net","message":"peer belongs to another Tailscale user"}
//	{"type":"logged_out"}
//	{"type":"error","message":"..."}
//	{"type":"stopped"}
//
// "running" is re-emitted whenever the IPs, name or owner change;
// "needs_login" is re-emitted whenever a new auth URL is issued;
// "peer_refused" at most once a minute per peer and reason. A fatal error is
// reported as "error" followed by "stopped" and a non-zero exit code.
//
// The process exits cleanly on SIGTERM/SIGINT/SIGHUP and when stdin is
// closed (so it dies with its Electron parent).
//
// # Logs
//
// stderr, and a file the Mac app does not have to collect: <data>/logs/tailnet.log
// next to the state dir (or $AULA_TSNET_LOG), 1 MiB plus one previous file.
// A fatal error is written there before the process exits.
//
// # Upstream
//
// Every connection to the local server first proves it is Aula (an HMAC of a
// nonce under the proxy key, see upstream.go), so a process that grabbed the
// port while Aula restarted never receives the key or a phone's token.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
	"tailscale.com/client/tailscale/apitype"
	"tailscale.com/envknob"
	"tailscale.com/logtail"
	"tailscale.com/tsnet"
)

// minProxyKeyLen: the desktop sends 32 random bytes in base64url (43 chars).
const minProxyKeyLen = 32

type options struct {
	stateDir   string
	hostname   string
	target     string
	listenPort int
	authKey    string
	controlURL string
	verbose    bool
	watchStdin bool
}

func parseFlags(args []string, getenv func(string) string) (*options, error) {
	fs := flag.NewFlagSet("aula-tsnet", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	o := &options{}
	fs.StringVar(&o.stateDir, "state-dir", "", "directory for tsnet state (required)")
	fs.StringVar(&o.hostname, "hostname", "aula-mac", "tailnet hostname for this node")
	fs.StringVar(&o.target, "target", "", "local Aula server, e.g. 127.0.0.1:8787 (required, loopback only)")
	fs.IntVar(&o.listenPort, "listen-port", 80, "port to listen on, on the tailnet")
	fs.StringVar(&o.authKey, "authkey", "", "optional Tailscale auth key (default: $TS_AUTHKEY)")
	fs.StringVar(&o.controlURL, "control-url", "", "optional control server URL (default: Tailscale's)")
	fs.BoolVar(&o.verbose, "verbose", false, "log tsnet backend logs to stderr")
	fs.BoolVar(&o.watchStdin, "watch-stdin", true, "read the config from stdin and exit when it is closed")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	if fs.NArg() > 0 {
		return nil, fmt.Errorf("unexpected arguments: %q", fs.Args())
	}
	if o.stateDir == "" {
		return nil, errors.New("--state-dir is required")
	}
	if o.target == "" {
		return nil, errors.New("--target is required")
	}
	t, err := parseTarget(o.target)
	if err != nil {
		return nil, fmt.Errorf("--target: %w", err)
	}
	if !isLoopbackHost(t.Hostname()) {
		return nil, fmt.Errorf("--target must be a loopback address, got %q", t.Hostname())
	}
	if o.listenPort < 1 || o.listenPort > 65535 {
		return nil, fmt.Errorf("--listen-port %d out of range", o.listenPort)
	}
	if o.hostname == "" {
		return nil, errors.New("--hostname must not be empty")
	}
	if o.authKey == "" {
		o.authKey = getenv("TS_AUTHKEY")
	}
	return o, nil
}

func isLoopbackHost(h string) bool {
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

// stdinConfig is the first line of stdin.
type stdinConfig struct {
	ProxyKey string `json:"proxyKey"`
}

// stdinCommand is every later line of stdin.
type stdinCommand struct {
	Cmd string `json:"cmd"`
}

// readConfig reads the first stdin line (the config) with a deadline.
func readConfig(r *bufio.Reader, timeout time.Duration) (stdinConfig, error) {
	type result struct {
		line string
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		line, err := r.ReadString('\n')
		ch <- result{line, err}
	}()
	select {
	case res := <-ch:
		if res.err != nil && res.line == "" {
			return stdinConfig{}, fmt.Errorf("reading config from stdin: %w", res.err)
		}
		var c stdinConfig
		if err := json.Unmarshal([]byte(res.line), &c); err != nil {
			return stdinConfig{}, fmt.Errorf("config line is not JSON: %w", err)
		}
		return c, nil
	case <-time.After(timeout):
		return stdinConfig{}, errors.New("no config on stdin")
	}
}

func main() {
	// Reserve the real stdout for status JSON and point fd 1 at stderr, so a
	// stray fmt.Print anywhere in a dependency can never corrupt the protocol.
	statusOut, err := reserveStdout()
	if err != nil {
		fmt.Fprintf(os.Stderr, "aula-tsnet: %v\n", err)
		os.Exit(1)
	}
	os.Exit(run(os.Args[1:], statusOut, os.Stdin))
}

func reserveStdout() (*os.File, error) {
	fd, err := syscall.Dup(1)
	if err != nil {
		return nil, fmt.Errorf("dup stdout: %w", err)
	}
	syscall.CloseOnExec(fd)
	// unix.Dup2: syscall.Dup2 does not exist on linux/arm64 (only dup3)
	if err := unix.Dup2(2, 1); err != nil {
		return nil, fmt.Errorf("redirect stdout: %w", err)
	}
	return os.NewFile(uintptr(fd), "status"), nil
}

type failingWriter struct {
	w      io.Writer
	onFail func(error)
}

func (f failingWriter) Write(p []byte) (int, error) {
	n, err := f.w.Write(p)
	if err != nil && f.onFail != nil {
		f.onFail(err)
	}
	return n, err
}

// disableLogUploads keeps everything tsnet logs on this Mac. The envknob
// marks the node as "no logs, no support" (and turns off logpolicy-based
// uploads), but tsnet runs its own logtail uploader that only the process-wide
// logtail.Disable switch stops.
func disableLogUploads() {
	envknob.SetNoLogsNoSupport()
	logtail.Disable()
}

func run(args []string, statusOut io.Writer, stdin io.Reader) int {
	logger := log.New(os.Stderr, "aula-tsnet: ", log.LstdFlags)
	logf := logger.Printf

	// Aula is private by design: nothing goes to log.tailscale.com.
	disableLogUploads()

	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)

	em := &Emitter{w: failingWriter{w: statusOut, onFail: func(err error) {
		cancel(fmt.Errorf("status pipe: %w", err))
	}}}

	fatal := func(err error) int {
		em.Emit(Event{Type: "error", Message: err.Error()})
		em.Emit(Event{Type: "stopped"})
		logf("fatal: %v", err)
		return 1
	}

	o, err := parseFlags(args, os.Getenv)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return fatal(err)
	}
	target, _ := parseTarget(o.target)

	stateDir, err := filepath.Abs(o.stateDir)
	if err != nil {
		return fatal(fmt.Errorf("state dir: %w", err))
	}
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return fatal(fmt.Errorf("state dir: %w", err))
	}
	// From here on everything logged (the fatal reason included) is also on disk.
	logOut := io.Writer(os.Stderr)
	if lf, err := openRotating(logPath(stateDir, os.Getenv), 1<<20); err != nil {
		logf("log file: %v", err)
	} else {
		defer lf.Close()
		logOut = io.MultiWriter(os.Stderr, lf)
		logger.SetOutput(logOut)
	}

	var stdinReader *bufio.Reader
	var cfg stdinConfig
	if o.watchStdin {
		stdinReader = bufio.NewReader(stdin)
		cfg, err = readConfig(stdinReader, 10*time.Second)
		if err != nil {
			return fatal(err)
		}
	} else {
		cfg.ProxyKey = os.Getenv("AULA_TSNET_PROXY_KEY")
		os.Unsetenv("AULA_TSNET_PROXY_KEY")
	}
	if len(cfg.ProxyKey) < minProxyKeyLen {
		return fatal(errors.New("missing or short proxy key"))
	}

	em.Emit(Event{Type: "starting"})
	// tailscale's logpolicy.LogsDir (used by ipnlocal for sockstat logs)
	// falls back to $XDG_DATA_HOME/tailscale, i.e. ~/.local/share/tailscale
	// on macOS. Keep that inside the state dir too.
	os.Setenv("XDG_DATA_HOME", filepath.Join(stateDir, "data"))

	// Shutdown triggers: signals here, stdin EOF in readCommands.
	sigc := make(chan os.Signal, 1)
	signal.Notify(sigc, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	go func() {
		select {
		case s := <-sigc:
			cancel(fmt.Errorf("signal %v", s))
		case <-ctx.Done():
		}
	}()

	srv := &tsnet.Server{
		Dir:        stateDir,
		Hostname:   o.hostname,
		AuthKey:    o.authKey,
		ControlURL: o.controlURL,
		Ephemeral:  false,
		UserLogf: func(format string, a ...any) {
			logger.Printf("tsnet: "+format, a...)
		},
	}
	if o.verbose {
		srv.Logf = func(format string, a ...any) {
			logger.Printf("tsnet[backend]: "+format, a...)
		}
	}

	if err := srv.Start(); err != nil {
		return fatal(fmt.Errorf("tsnet start: %w", err))
	}
	closeTS := func() {
		done := make(chan struct{})
		go func() {
			srv.Close()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(8 * time.Second):
			logf("tsnet close timed out")
		}
	}

	lc, err := srv.LocalClient()
	if err != nil {
		closeTS()
		return fatal(fmt.Errorf("tsnet local client: %w", err))
	}

	ln, err := srv.Listen("tcp", ":"+strconv.Itoa(o.listenPort))
	if err != nil {
		closeTS()
		return fatal(fmt.Errorf("tailnet listen :%d: %w", o.listenPort, err))
	}

	owner := &ownerGate{}
	refused := &refusalReporter{emit: em.Emit}
	allow := func(who *apitype.WhoIsResponse) (bool, string) {
		ok, why := owner.allows(who)
		if !ok {
			refused.note(who, why)
		}
		return ok, why
	}
	httpSrv := &http.Server{
		Handler:           newProxyHandler(target, cfg.ProxyKey, lc.WhoIs, allow, logf, newVerifyingTransport(target, cfg.ProxyKey, logf)),
		ReadHeaderTimeout: 30 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    64 << 10,
		ErrorLog:          log.New(logOut, "aula-tsnet: http: ", log.LstdFlags),
		BaseContext:       func(net.Listener) context.Context { return context.WithoutCancel(ctx) },
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- httpSrv.Serve(ln) }()

	mon := &monitor{
		lc:       lc,
		emit:     em.Emit,
		logf:     func(f string, a ...any) { logger.Printf(f, a...) },
		hostname: o.hostname,
		port:     o.listenPort,
		owner:    owner,
	}
	monCtx, monCancel := context.WithCancel(ctx)
	monDone := make(chan struct{})
	go func() {
		defer close(monDone)
		mon.run(monCtx, watchBus(lc, logf))
	}()

	if stdinReader != nil {
		go readCommands(ctx, stdinReader, lc, em, owner, logf, func() { cancel(errors.New("stdin closed")) })
	}

	exitCode := 0
	select {
	case <-ctx.Done():
		logf("shutting down: %v", context.Cause(ctx))
	case err := <-serveErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			em.Emit(Event{Type: "error", Message: fmt.Sprintf("tailnet http server: %v", err)})
			exitCode = 1
		}
	}

	monCancel()
	<-monDone
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 3*time.Second)
	httpSrv.Shutdown(shutCtx) // closes the listener; WebSockets are cut by closeTS
	shutCancel()
	closeTS()
	em.Emit(Event{Type: "stopped"})
	return exitCode
}

// logoutClient is the subset of *local.Client the logout command needs.
type logoutClient interface {
	Logout(ctx context.Context) error
	StartLoginInteractive(ctx context.Context) error
}

// readCommands handles stdin lines after the config until stdin closes, then
// calls onEOF (which shuts the sidecar down: its parent is gone).
func readCommands(ctx context.Context, r *bufio.Reader, lc logoutClient, em *Emitter, owner *ownerGate, logf func(string, ...any), onEOF func()) {
	for {
		line, err := r.ReadString('\n')
		if line != "" {
			var c stdinCommand
			if json.Unmarshal([]byte(line), &c) == nil {
				switch c.Cmd {
				case "logout":
					// Nobody gets through while the node logs out.
					owner.set(0, "")
					cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
					if err := lc.Logout(cctx); err != nil {
						logf("logout: %v", err)
						em.Emit(Event{Type: "error", Message: "logout: " + err.Error()})
					} else {
						logf("logged out")
						em.Emit(Event{Type: "logged_out"})
						// Ask for a fresh login URL now, so signing in again (maybe
						// with another account) works at once; the monitor reports
						// it as needs_login, and retries on its own if this fails.
						if err := lc.StartLoginInteractive(cctx); err != nil {
							logf("StartLoginInteractive after logout: %v", err)
						}
					}
					cancel()
				default:
					logf("unknown command %q", c.Cmd)
				}
			}
		}
		if err != nil {
			onEOF()
			return
		}
	}
}
