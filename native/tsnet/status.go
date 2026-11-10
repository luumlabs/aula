package main

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"sync"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
)

// Event is one line of the stdout status protocol.
type Event struct {
	Type     string   `json:"type"`
	AuthURL  string   `json:"authURL,omitempty"`
	Hostname string   `json:"hostname,omitempty"`
	DNSName  string   `json:"dnsName,omitempty"`
	IPs      []string `json:"ips,omitempty"`
	Port     int      `json:"port,omitempty"`
	User     string   `json:"user,omitempty"` // running: this node's owner; peer_refused: the peer's user
	Node     string   `json:"node,omitempty"` // peer_refused: the peer's MagicDNS name
	Message  string   `json:"message,omitempty"`
}

// Emitter writes Events as newline-delimited JSON. It is safe for
// concurrent use; each event is a single write.
type Emitter struct {
	mu sync.Mutex
	w  io.Writer
}

func (e *Emitter) Emit(ev Event) {
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	b = append(b, '\n')
	e.mu.Lock()
	defer e.mu.Unlock()
	e.w.Write(b)
}

// statusSource is the subset of *local.Client the monitor needs.
type statusSource interface {
	StatusWithoutPeers(ctx context.Context) (*ipnstate.Status, error)
	StartLoginInteractive(ctx context.Context) error
}

// monitor turns tailscaled backend state into status events. All state is
// owned by the run goroutine.
type monitor struct {
	lc       statusSource
	emit     func(Event)
	logf     func(string, ...any)
	hostname string // requested hostname (fallback for the event)
	port     int
	owner    *ownerGate // set while running, cleared otherwise; nil in tests that do not need it

	lastState       string
	lastAuthURL     string
	lastRunningKey  string
	lastErr         string
	machineAuthSent bool
	needsLoginSince time.Time
	kickedLogin     bool
}

// kickAfter is how long we wait in NeedsLogin without an AuthURL before
// asking the backend to start an interactive login ourselves (tsnet only
// does that at startup; this covers later logouts / key expiry).
const kickAfter = 8 * time.Second

func (m *monitor) run(ctx context.Context, bus func(ctx context.Context, poke chan<- struct{}, urls chan<- string, errs chan<- string)) {
	poke := make(chan struct{}, 1)
	urls := make(chan string, 4)
	errs := make(chan string, 4)
	if bus != nil {
		go bus(ctx, poke, urls, errs)
	}
	t := time.NewTicker(1 * time.Second)
	defer t.Stop()
	m.refresh(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-poke:
		case u := <-urls:
			m.onAuthURL(u)
		case msg := <-errs:
			if msg != m.lastErr {
				m.lastErr = msg
				m.emit(Event{Type: "error", Message: msg})
			}
		case <-t.C:
		}
		m.refresh(ctx)
		// Poll quickly until we are running, then slowly (the IPN bus pokes
		// us on every state change anyway).
		if m.lastState == ipn.Running.String() {
			t.Reset(10 * time.Second)
		} else {
			t.Reset(1 * time.Second)
		}
	}
}

func (m *monitor) onAuthURL(u string) {
	if u == "" || u == m.lastAuthURL || m.lastState == ipn.Running.String() {
		return
	}
	m.lastAuthURL = u
	m.lastRunningKey = ""
	m.emit(Event{Type: "needs_login", AuthURL: u})
}

func (m *monitor) refresh(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	st, err := m.lc.StatusWithoutPeers(cctx)
	if err != nil {
		if ctx.Err() == nil {
			m.logf("status: %v", err)
		}
		return
	}
	state := st.BackendState
	if state != m.lastState {
		m.logf("backend state: %s -> %s", m.lastState, state)
	}
	prev := m.lastState
	m.lastState = state

	// Only a running node has an owner: until then (and after a logout or
	// key expiry) the proxy lets nobody through.
	if state != ipn.Running.String() && m.owner != nil {
		m.owner.set(0, "")
	}

	if state != ipn.NeedsLogin.String() {
		m.needsLoginSince = time.Time{}
		m.kickedLogin = false
	}
	if state != ipn.NeedsMachineAuth.String() {
		m.machineAuthSent = false
	}

	switch state {
	case ipn.Running.String():
		ips := make([]string, 0, len(st.TailscaleIPs))
		for _, ip := range st.TailscaleIPs {
			ips = append(ips, ip.String())
		}
		if len(ips) == 0 {
			return
		}
		dnsName := ""
		hostname := m.hostname
		if st.Self != nil {
			dnsName = strings.TrimSuffix(st.Self.DNSName, ".")
			if first, _, ok := strings.Cut(dnsName, "."); ok && first != "" {
				hostname = first // actual name on the tailnet (may be e.g. aula-mac-1)
			} else if st.Self.HostName != "" {
				hostname = st.Self.HostName
			}
		}
		user := ""
		if st.Self != nil && !st.Self.UserID.IsZero() {
			if up, ok := st.User[st.Self.UserID]; ok {
				user = up.LoginName
			}
			if m.owner != nil {
				m.owner.set(st.Self.UserID, user)
			}
		}
		key := strings.Join(ips, ",") + "|" + dnsName + "|" + hostname + "|" + user
		if key != m.lastRunningKey {
			m.lastRunningKey = key
			m.lastAuthURL = ""
			m.lastErr = ""
			m.emit(Event{Type: "running", Hostname: hostname, DNSName: dnsName, IPs: ips, Port: m.port, User: user})
		}
	case ipn.NeedsLogin.String():
		m.lastRunningKey = ""
		if st.AuthURL != "" {
			m.onAuthURL(st.AuthURL)
			return
		}
		if m.needsLoginSince.IsZero() {
			m.needsLoginSince = time.Now()
		} else if !m.kickedLogin && time.Since(m.needsLoginSince) > kickAfter {
			m.kickedLogin = true
			m.logf("no auth URL yet; requesting interactive login")
			if err := m.lc.StartLoginInteractive(cctx); err != nil {
				m.logf("StartLoginInteractive: %v", err)
			}
		}
	case ipn.NeedsMachineAuth.String():
		m.lastRunningKey = ""
		if !m.machineAuthSent {
			m.machineAuthSent = true
			m.emit(Event{Type: "needs_machine_auth", Message: "this device must be approved in the Tailscale admin console"})
		}
	default:
		// NoState, Starting, Stopped, InUseOtherUser: transient or
		// not actionable; a later running/needs_login event follows.
		_ = prev
	}
}

// watchBus forwards IPN bus notifications to the monitor. It reconnects
// if the watcher fails (e.g. during backend restarts).
func watchBus(lc *local.Client, logf func(string, ...any)) func(ctx context.Context, poke chan<- struct{}, urls chan<- string, errs chan<- string) {
	return func(ctx context.Context, poke chan<- struct{}, urls chan<- string, errs chan<- string) {
		for ctx.Err() == nil {
			w, err := lc.WatchIPNBus(ctx, ipn.NotifyInitialState)
			if err != nil {
				if ctx.Err() == nil {
					logf("WatchIPNBus: %v", err)
				}
				select {
				case <-ctx.Done():
					return
				case <-time.After(time.Second):
				}
				continue
			}
			for {
				n, err := w.Next()
				if err != nil {
					if ctx.Err() == nil {
						logf("ipn bus: %v", err)
					}
					break
				}
				if n.BrowseToURL != nil && *n.BrowseToURL != "" {
					select {
					case urls <- *n.BrowseToURL:
					case <-ctx.Done():
					}
				}
				if n.ErrMessage != nil && *n.ErrMessage != "" {
					select {
					case errs <- *n.ErrMessage:
					case <-ctx.Done():
					}
				}
				if n.State != nil || n.LoginFinished != nil || n.SelfChange != nil {
					select {
					case poke <- struct{}{}:
					default:
					}
				}
			}
			w.Close()
		}
	}
}
