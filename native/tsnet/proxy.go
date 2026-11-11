package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"

	"tailscale.com/client/tailscale/apitype"
	"tailscale.com/tailcfg"
)

// Headers the proxy sets on every request it forwards to the local Aula
// server. Any client-supplied copies are removed first so a tailnet peer
// cannot spoof another identity or guess its way past the proxy key.
const (
	HeaderProxyKey    = "X-Aula-Proxy-Key"
	HeaderTailnetUser = "X-Aula-Tailnet-User"
	HeaderTailnetNode = "X-Aula-Tailnet-Node"
	HeaderTailnetAddr = "X-Aula-Tailnet-Addr"
	HeaderVia         = "X-Aula-Via"
)

var aulaHeaders = []string{HeaderProxyKey, HeaderTailnetUser, HeaderTailnetNode, HeaderTailnetAddr, HeaderVia}

// WhoIsFunc resolves the tailnet identity behind a connection's remote
// address ("ip:port"). In production it is (*local.Client).WhoIs.
type WhoIsFunc func(ctx context.Context, remoteAddr string) (*apitype.WhoIsResponse, error)

// AllowFunc decides whether an identified peer may reach Aula at all; when it
// may not, it returns a short reason (for the log and the status event).
type AllowFunc func(who *apitype.WhoIsResponse) (bool, string)

// peerIdentity is what the proxy learned about the caller.
type peerIdentity struct {
	User string // login name, e.g. "alice@example.com"
	Node string // MagicDNS name of the peer node, without trailing dot
	Addr string // peer tailnet IP (no port)
}

type identityKey struct{}

// Reasons ownerGate gives for refusing a peer.
const (
	refuseNotConnected = "this node is not connected yet"
	refuseUnknownPeer  = "unknown peer"
	refuseTagged       = "tagged devices are not allowed"
	refuseOtherUser    = "peer belongs to another Tailscale user"
)

// ownerGate lets through only peers owned by the same Tailscale user as this
// node: the person's own iPhone, signed in to Tailscale with the same account
// as the Mac. Other people in a shared or company tailnet, nodes shared in
// from another tailnet and tagged devices (servers, CI) are refused before
// they reach Aula. The monitor fills the owner in while the node is running
// and clears it otherwise, so the gate fails closed.
type ownerGate struct {
	mu    sync.Mutex
	id    tailcfg.UserID
	login string
}

func (g *ownerGate) set(id tailcfg.UserID, login string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.id, g.login = id, login
}

func (g *ownerGate) get() (tailcfg.UserID, string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.id, g.login
}

func (g *ownerGate) allows(who *apitype.WhoIsResponse) (bool, string) {
	owner, _ := g.get()
	if owner == 0 {
		return false, refuseNotConnected
	}
	if who == nil || who.UserProfile == nil || who.Node == nil {
		return false, refuseUnknownPeer
	}
	if who.Node.IsTagged() {
		return false, refuseTagged
	}
	if who.UserProfile.ID != owner {
		return false, refuseOtherUser
	}
	return true, ""
}

// refusalReporter turns refused peers into "peer_refused" status events, at
// most once per peer and reason every refusalEvery, so Aula can tell the
// person why a device that does reach the Mac is turned away (typically an
// iPhone signed in to Tailscale with another account). Refusals while the node
// is not connected yet are transient and not reported.
type refusalReporter struct {
	mu   sync.Mutex
	last map[string]time.Time
	emit func(Event)
	now  func() time.Time
}

const refusalEvery = time.Minute

func (r *refusalReporter) note(who *apitype.WhoIsResponse, why string) {
	if r == nil || r.emit == nil || why == refuseNotConnected {
		return
	}
	id := identityFromWhoIs("", who)
	now := time.Now
	if r.now != nil {
		now = r.now
	}
	key := id.User + "|" + id.Node + "|" + why
	r.mu.Lock()
	if r.last == nil {
		r.last = map[string]time.Time{}
	}
	t := now()
	if prev, ok := r.last[key]; ok && t.Sub(prev) < refusalEvery {
		r.mu.Unlock()
		return
	}
	r.last[key] = t
	r.mu.Unlock()
	r.emit(Event{Type: "peer_refused", User: id.User, Node: id.Node, Message: why})
}

// parseTarget accepts "127.0.0.1:8787" or "http://127.0.0.1:8787".
func parseTarget(s string) (*url.URL, error) {
	if s == "" {
		return nil, errors.New("empty target")
	}
	if !strings.Contains(s, "://") {
		s = "http://" + s
	}
	u, err := url.Parse(s)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("unsupported scheme %q", u.Scheme)
	}
	if u.Host == "" || u.Port() == "" {
		return nil, fmt.Errorf("target %q must be host:port", s)
	}
	if u.Path == "/" {
		u.Path = ""
	}
	return u, nil
}

// stripAulaHeaders removes every header that could be confused with one of
// ours. Header.Del is case-insensitive; we additionally treat '_' as '-'
// because some server stacks normalise X_Aula_Tailnet_User to the same key.
func stripAulaHeaders(h http.Header) {
	for k := range h {
		norm := strings.ToLower(strings.ReplaceAll(k, "_", "-"))
		for _, f := range aulaHeaders {
			if norm == strings.ToLower(f) {
				delete(h, k)
				break
			}
		}
	}
}

// identityFromWhoIs converts a WhoIs response into header values.
func identityFromWhoIs(remoteAddr string, who *apitype.WhoIsResponse) peerIdentity {
	id := peerIdentity{}
	if ap, err := netip.ParseAddrPort(remoteAddr); err == nil {
		id.Addr = ap.Addr().Unmap().String()
	} else if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		id.Addr = host
	} else {
		id.Addr = remoteAddr
	}
	if who == nil {
		return id
	}
	if who.UserProfile != nil {
		id.User = who.UserProfile.LoginName
	}
	if n := who.Node; n != nil {
		switch {
		case n.Name != "":
			id.Node = strings.TrimSuffix(n.Name, ".")
		case n.ComputedName != "":
			id.Node = n.ComputedName
		case n.Hostinfo.Valid():
			id.Node = n.Hostinfo.Hostname()
		}
	}
	return id
}

// sanitizeHeaderValue drops characters that are not allowed in an HTTP
// header value so a weird login/node name can never break the request.
func sanitizeHeaderValue(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\r' || r == '\n' || r == 0 || (r < 0x20 && r != '\t') || r == 0x7f {
			return -1
		}
		return r
	}, s)
}

// jsonError answers like the Aula server does ({"error": "..."}), so the
// iPhone app shows the sidecar's own refusals in plain words too.
func jsonError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// refusalText is what the phone shows for each refusal reason.
func refusalText(why string) string {
	switch why {
	case refuseOtherUser:
		return "Este dispositivo usa otra cuenta de Tailscale. Inicia sesión en Tailscale con la misma cuenta que en la Mac."
	case refuseTagged:
		return "Los dispositivos con etiqueta de Tailscale no pueden conectarse a Aula."
	case refuseNotConnected:
		return "Aula todavía se está conectando a tu red privada. Prueba de nuevo en un momento."
	default:
		return "No se pudo identificar este dispositivo en tu red privada."
	}
}

// newProxyHandler returns the HTTP handler that serves tailnet requests: it
// identifies the caller with whois, refuses peers that allow rejects, then
// reverse-proxies to target with the X-Aula-* headers set, including the
// proxy key that tells the Aula server the request really came through this
// sidecar. WebSocket upgrades and streaming responses (SSE, chunked) are
// passed through (FlushInterval -1). `transport` is how the local server is
// reached (nil: Go's default); in production it is newVerifyingTransport, so
// nothing is forwarded to a process that grabbed Aula's port.
func newProxyHandler(target *url.URL, proxyKey string, whois WhoIsFunc, allow AllowFunc, logf func(string, ...any), transport http.RoundTripper) http.Handler {
	if logf == nil {
		logf = func(string, ...any) {}
	}
	rp := &httputil.ReverseProxy{
		Transport: transport,
		// Rewrite (rather than Director) also strips inbound Forwarded /
		// X-Forwarded-* headers and hop-by-hop headers before we run.
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.SetXForwarded()
			stripAulaHeaders(pr.Out.Header)
			id, _ := pr.In.Context().Value(identityKey{}).(peerIdentity)
			pr.Out.Header.Set(HeaderProxyKey, proxyKey)
			pr.Out.Header.Set(HeaderTailnetUser, sanitizeHeaderValue(id.User))
			pr.Out.Header.Set(HeaderTailnetNode, sanitizeHeaderValue(id.Node))
			pr.Out.Header.Set(HeaderTailnetAddr, sanitizeHeaderValue(id.Addr))
			pr.Out.Header.Set(HeaderVia, "tailscale")
		},
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			if errors.Is(err, context.Canceled) {
				return // the client went away
			}
			logf("proxy: %s %s: %v", r.Method, r.URL.Path, err)
			jsonError(w, http.StatusBadGateway, "Aula no responde en la Mac.")
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		who, err := whois(r.Context(), r.RemoteAddr)
		if err != nil {
			// Fail closed: never forward a request we could not attribute.
			logf("whois %s: %v", r.RemoteAddr, err)
			jsonError(w, http.StatusForbidden, refusalText(refuseUnknownPeer))
			return
		}
		if allow != nil {
			if ok, why := allow(who); !ok {
				logf("refused %s: %s", r.RemoteAddr, why)
				jsonError(w, http.StatusForbidden, refusalText(why))
				return
			}
		}
		id := identityFromWhoIs(r.RemoteAddr, who)
		// Scrub the inbound request too so nothing downstream of this handler
		// (e.g. logging) sees spoofed values.
		stripAulaHeaders(r.Header)
		rp.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), identityKey{}, id)))
	})
}
