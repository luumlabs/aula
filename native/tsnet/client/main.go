// Command aula-tsnet-client is the Tailscale side of Aula's Android app
// (native/android). The app runs it as a child process (packed as
// lib/<abi>/libaulatsnet.so so Android installs it executable) and talks to it
// over stdin/stdout, like the Mac app talks to aula-tsnet.
//
// It joins the person's own tailnet as its own node ("aula-android"; no
// Tailscale app or VPN needed), finds the Aulas on it (a Mac or a server: any
// machine called "aula-…" that is not a device, as the iPhone app does) and,
// when asked, opens a loopback HTTP proxy (127.0.0.1:<random port>) to one of
// them. The WebView loads Aula through that proxy.
//
// The proxy only serves requests that carry its per-launch secret (the
// "aula_gate" cookie the app sets for the WebView, or the "X-Aula-Gate" header
// for the app's own requests): another app on the phone can reach 127.0.0.1
// too, but never gets through to Aula. The gate cookie is removed before the
// request leaves the phone.
//
// tailscale.com/feature/androidbin makes a static Linux binary work as an
// Android app's process: network interfaces (Android denies netlink to apps),
// DNS without /etc/resolv.conf and Android's certificate store.
//
// # stdin (one JSON command per line; EOF = the app died: exit)
//
//	{"cmd":"connect","host":"aula-server"}   open (or move) the proxy to that Aula
//	{"cmd":"refresh"}                         emit the current state again
//	{"cmd":"logout"}                          sign this phone out of Tailscale
//
// # stdout (one JSON event per line; logs go to stderr)
//
//	{"type":"starting"}
//	{"type":"needs_login","authURL":"https://login.tailscale.com/a/…"}
//	{"type":"needs_machine_auth"}
//	{"type":"running","hostname":"aula-android","user":"ana@example.com","aulas":[{"host":"aula-server","online":true}]}
//	{"type":"forwarding","host":"aula-server","port":41234,"secret":"…"}
//	{"type":"error","message":"…"}
//	{"type":"stopped"}
package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
	"tailscale.com/client/local"
	"tailscale.com/envknob"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/logtail"
	"tailscale.com/net/netns"
	"tailscale.com/tsnet"
)

// GateCookie and GateHeader carry the proxy's per-launch secret.
const (
	GateCookie = "aula_gate"
	GateHeader = "X-Aula-Gate"
)

// Event is one line on stdout.
type Event struct {
	Type     string `json:"type"`
	AuthURL  string `json:"authURL,omitempty"`
	Hostname string `json:"hostname,omitempty"`
	User     string `json:"user,omitempty"`
	Aulas    []Aula `json:"aulas,omitempty"`
	Host     string `json:"host,omitempty"`
	Port     int    `json:"port,omitempty"`
	Secret   string `json:"secret,omitempty"`
	Message  string `json:"message,omitempty"`
}

// Aula is a machine with Aula on the tailnet.
type Aula struct {
	Host   string `json:"host"`
	Online bool   `json:"online"`
}

type emitter struct {
	mu  sync.Mutex
	out io.Writer
}

func (e *emitter) emit(ev Event) {
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.out.Write(append(b, '\n'))
}

var deviceNames = regexp.MustCompile(`^aula-(ipad|iphone|android|device)(-[0-9]+)?$`)
var aulaName = regexp.MustCompile(`^aula-[a-z0-9-]+$`)

// IsAulaHost: an Aula's machine name starts with "aula-" and is not a device's
// (src/main/services/remote/server-mode.ts has the same rule).
func IsAulaHost(name string) bool {
	n := strings.ToLower(name)
	return aulaName.MatchString(n) && !deviceNames.MatchString(n)
}

// machineName is the first label of the MagicDNS name (the name the tailnet
// gave the machine, e.g. aula-mac-1), or its host name.
func machineName(p *ipnstate.PeerStatus) string {
	if first, _, _ := strings.Cut(strings.TrimSuffix(p.DNSName, "."), "."); first != "" {
		return strings.ToLower(first)
	}
	return strings.ToLower(p.HostName)
}

// FindAulas lists the Aulas among the peers (online first, then by name) and
// where to reach each one.
func FindAulas(peers []*ipnstate.PeerStatus) ([]Aula, map[string]netip.Addr) {
	addrs := map[string]netip.Addr{}
	online := map[string]bool{}
	for _, p := range peers {
		if p == nil || len(p.TailscaleIPs) == 0 {
			continue
		}
		name := machineName(p)
		if !IsAulaHost(name) {
			continue
		}
		if _, seen := addrs[name]; seen && online[name] {
			continue
		}
		addrs[name] = p.TailscaleIPs[0]
		online[name] = p.Online
	}
	out := make([]Aula, 0, len(addrs))
	for name := range addrs {
		out = append(out, Aula{Host: name, Online: online[name]})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Online != out[j].Online {
			return out[i].Online
		}
		return out[i].Host < out[j].Host
	})
	return out, addrs
}

// NewGate returns a fresh secret.
func NewGate() string {
	b := make([]byte, 24)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// GateHandler serves only requests that carry the secret, removes the gate
// cookie before passing them on, and answers anything else with 403.
func GateHandler(secret string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := r.Header.Get(GateHeader)
		if got == "" {
			if c, err := r.Cookie(GateCookie); err == nil {
				got = c.Value
			}
		}
		if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(secret)) != 1 {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		r.Header.Del(GateHeader)
		var kept []string
		for _, c := range r.Cookies() {
			if c.Name != GateCookie {
				kept = append(kept, c.Name+"="+c.Value)
			}
		}
		r.Header.Del("Cookie")
		if len(kept) > 0 {
			r.Header.Set("Cookie", strings.Join(kept, "; "))
		}
		next.ServeHTTP(w, r)
	})
}

// forwarder is the loopback proxy to one Aula.
type forwarder struct {
	host   string
	port   int
	secret string
	srv    *http.Server
}

type client struct {
	ts   *tsnet.Server
	lc   *local.Client
	em   *emitter
	logf func(string, ...any)

	mu       sync.Mutex
	addrs    map[string]netip.Addr
	fwd      *forwarder
	lastKey  string
	lastURL  string
	kicked   bool
	loginAt  time.Time
	hostname string
}

func (c *client) proxyFor(host string) http.Handler {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			c.mu.Lock()
			addr, ok := c.addrs[host]
			c.mu.Unlock()
			if !ok {
				return nil, fmt.Errorf("%s is not on the tailnet", host)
			}
			return c.ts.Dial(ctx, "tcp", netip.AddrPortFrom(addr, 80).String())
		},
		MaxIdleConns:          20,
		IdleConnTimeout:       90 * time.Second,
		ResponseHeaderTimeout: 0, // /events never ends
	}
	return &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL.Scheme = "http"
			pr.Out.URL.Host = host
			// the Host stays 127.0.0.1:<port>: the Aula at the other end trusts its own Tailscale node, not the name
			pr.Out.Host = pr.In.Host
		},
		Transport:     transport,
		FlushInterval: -1, // events stream line by line
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			c.logf("proxy %s: %v", r.URL.Path, err)
			http.Error(w, "Aula is not answering", http.StatusBadGateway)
		},
	}
}

// connect opens (or moves) the loopback proxy to host.
func (c *client) connect(host string) {
	if !IsAulaHost(host) {
		c.em.emit(Event{Type: "error", Message: "not an Aula: " + host})
		return
	}
	c.mu.Lock()
	old := c.fwd
	c.fwd = nil
	c.mu.Unlock()
	if old != nil {
		old.srv.Close()
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		c.em.emit(Event{Type: "error", Message: "loopback: " + err.Error()})
		return
	}
	secret := NewGate()
	f := &forwarder{host: host, port: ln.Addr().(*net.TCPAddr).Port, secret: secret}
	f.srv = &http.Server{
		Handler:           GateHandler(secret, c.proxyFor(host)),
		ReadHeaderTimeout: 30 * time.Second,
		IdleTimeout:       2 * time.Minute,
		ErrorLog:          log.New(os.Stderr, "aula-tsnet-client: http: ", log.LstdFlags),
	}
	go f.srv.Serve(ln)
	c.mu.Lock()
	c.fwd = f
	c.mu.Unlock()
	c.em.emit(Event{Type: "forwarding", Host: host, Port: f.port, Secret: secret})
}

// refresh reads the node's state and emits what changed (or everything, with force).
func (c *client) refresh(ctx context.Context, force bool) {
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	st, err := c.lc.Status(cctx)
	if err != nil {
		if ctx.Err() == nil {
			c.logf("status: %v", err)
		}
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	switch st.BackendState {
	case ipn.Running.String():
		c.loginAt, c.kicked, c.lastURL = time.Time{}, false, ""
		if len(st.TailscaleIPs) == 0 {
			return
		}
		peers := make([]*ipnstate.PeerStatus, 0, len(st.Peer))
		for _, p := range st.Peer {
			peers = append(peers, p)
		}
		aulas, addrs := FindAulas(peers)
		c.addrs = addrs
		hostname, user := c.hostname, ""
		if st.Self != nil {
			if n := machineName(st.Self); n != "" {
				hostname = n
			}
			if up, ok := st.User[st.Self.UserID]; ok {
				user = up.LoginName
			}
		}
		b, _ := json.Marshal(aulas)
		key := "running|" + hostname + "|" + user + "|" + string(b)
		if force || key != c.lastKey {
			c.lastKey = key
			c.em.emit(Event{Type: "running", Hostname: hostname, User: user, Aulas: aulas})
		}
	case ipn.NeedsLogin.String():
		c.lastKey = ""
		if st.AuthURL != "" {
			if force || st.AuthURL != c.lastURL {
				c.lastURL = st.AuthURL
				c.em.emit(Event{Type: "needs_login", AuthURL: st.AuthURL})
			}
			return
		}
		if c.loginAt.IsZero() {
			c.loginAt = time.Now()
		} else if !c.kicked && time.Since(c.loginAt) > 4*time.Second {
			c.kicked = true
			if err := c.lc.StartLoginInteractive(cctx); err != nil {
				c.logf("StartLoginInteractive: %v", err)
			}
		}
	case ipn.NeedsMachineAuth.String():
		if force || c.lastKey != "machine_auth" {
			c.lastKey = "machine_auth"
			c.em.emit(Event{Type: "needs_machine_auth"})
		}
	}
}

func (c *client) commands(ctx context.Context, r *bufio.Reader, done func()) {
	for {
		line, err := r.ReadBytes('\n')
		if len(line) > 0 {
			var cmd struct{ Cmd, Host string }
			if json.Unmarshal(line, &cmd) == nil {
				switch cmd.Cmd {
				case "connect":
					c.connect(strings.ToLower(strings.TrimSpace(cmd.Host)))
				case "refresh":
					c.refresh(ctx, true)
				case "logout":
					lctx, cancel := context.WithTimeout(ctx, 10*time.Second)
					if err := c.lc.Logout(lctx); err != nil {
						c.em.emit(Event{Type: "error", Message: "logout: " + err.Error()})
					}
					cancel()
					c.mu.Lock()
					c.lastKey, c.lastURL = "", ""
					c.mu.Unlock()
				}
			}
		}
		if err != nil {
			done()
			return
		}
	}
}

func main() {
	// stdout carries only events: everything else (a stray print in a dependency) goes to stderr
	fd, err := unix.Dup(1)
	if err == nil {
		unix.CloseOnExec(fd)
		err = unix.Dup2(2, 1)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "aula-tsnet-client: stdout: %v\n", err)
		os.Exit(1)
	}
	em := &emitter{out: os.NewFile(uintptr(fd), "events")}

	fs := flag.NewFlagSet("aula-tsnet-client", flag.ExitOnError)
	stateDir := fs.String("state-dir", "", "where the node keeps its identity (required)")
	hostname := fs.String("hostname", "aula-android", "this phone's name on the tailnet")
	verbose := fs.Bool("verbose", false, "log tsnet's backend to stderr")
	diagnose := fs.Bool("diagnose", false, "check name resolution and HTTPS to Tailscale's control server, then exit")
	fs.Parse(os.Args[1:])
	if *diagnose {
		os.Exit(runDiagnose(em))
	}
	if *stateDir == "" {
		em.emit(Event{Type: "error", Message: "--state-dir is required"})
		os.Exit(2)
	}
	logger := log.New(os.Stderr, "aula-tsnet-client: ", log.LstdFlags)
	logf := logger.Printf

	// nothing leaves the phone but Tailscale's own control and data traffic
	envknob.SetNoLogsNoSupport()
	logtail.Disable()
	// No socket binding: on Linux, Tailscale ties its own connections to the default route's interface (SO_BINDTODEVICE)
	// so they never loop through its TUN device. An Android app cannot read the routes, so it would tie them to "lo"
	// and nothing would ever leave the phone. This node has no TUN device (it is userspace tsnet), so there is no loop.
	netns.SetEnabled(false)
	if err := os.MkdirAll(*stateDir, 0o700); err != nil {
		em.emit(Event{Type: "error", Message: err.Error()})
		os.Exit(1)
	}
	os.Setenv("XDG_DATA_HOME", filepath.Join(*stateDir, "data"))
	os.Setenv("HOME", *stateDir)

	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	sigc := make(chan os.Signal, 1)
	signal.Notify(sigc, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	go func() {
		select {
		case s := <-sigc:
			cancel(fmt.Errorf("signal %v", s))
		case <-ctx.Done():
		}
	}()

	em.emit(Event{Type: "starting"})
	ts := &tsnet.Server{
		Dir:      *stateDir,
		Hostname: *hostname,
		UserLogf: func(format string, a ...any) { logger.Printf("tsnet: "+format, a...) },
	}
	if *verbose {
		ts.Logf = func(format string, a ...any) { logger.Printf("tsnet[backend]: "+format, a...) }
	}
	if err := ts.Start(); err != nil {
		em.emit(Event{Type: "error", Message: "tsnet start: " + err.Error()})
		em.emit(Event{Type: "stopped"})
		os.Exit(1)
	}
	lc, err := ts.LocalClient()
	if err != nil {
		em.emit(Event{Type: "error", Message: "tsnet local client: " + err.Error()})
		ts.Close()
		os.Exit(1)
	}
	c := &client{ts: ts, lc: lc, em: em, logf: logf, hostname: *hostname, addrs: map[string]netip.Addr{}}
	go c.commands(ctx, bufio.NewReader(os.Stdin), func() { cancel(errors.New("stdin closed")) })

	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	c.refresh(ctx, true)
	for running := true; running; {
		select {
		case <-ctx.Done():
			running = false
		case <-tick.C:
			c.refresh(ctx, false)
		}
	}
	logf("shutting down: %v", context.Cause(ctx))
	c.mu.Lock()
	if c.fwd != nil {
		c.fwd.srv.Close()
	}
	c.mu.Unlock()
	done := make(chan struct{})
	go func() { ts.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(8 * time.Second):
	}
	em.emit(Event{Type: "stopped"})
}

// runDiagnose checks, from inside the phone, what the node needs before it can
// sign in: resolving Tailscale's control server and reaching it over HTTPS
// (Android's certificates). One "diagnose" event per check.
func runDiagnose(em *emitter) int {
	failed := 0
	check := func(name string, f func(context.Context) (string, error)) {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		start := time.Now()
		got, err := f(ctx)
		msg := fmt.Sprintf("%s: %s (%v)", name, got, time.Since(start).Round(time.Millisecond))
		if err != nil {
			failed++
			msg = fmt.Sprintf("%s: FAILED %v (%v)", name, err, time.Since(start).Round(time.Millisecond))
		}
		em.emit(Event{Type: "diagnose", Message: msg})
	}
	check("dns controlplane.tailscale.com", func(ctx context.Context) (string, error) {
		addrs, err := net.DefaultResolver.LookupHost(ctx, "controlplane.tailscale.com")
		return strings.Join(addrs, " "), err
	})
	check("https controlplane.tailscale.com/key", func(ctx context.Context) (string, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://controlplane.tailscale.com/key?v=71", nil)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return "", err
		}
		res.Body.Close()
		return res.Status, nil
	})
	if failed > 0 {
		return 1
	}
	return 0
}
