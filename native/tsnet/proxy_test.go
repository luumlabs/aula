package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"tailscale.com/client/tailscale/apitype"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tailcfg"
)

// fakeWhoIs returns a fixed identity and records the remote addrs it saw.
type fakeWhoIs struct {
	mu     sync.Mutex
	seen   []string
	err    error
	login  string
	node   string
	uid    tailcfg.UserID
	tagged bool
}

func (f *fakeWhoIs) WhoIs(ctx context.Context, remoteAddr string) (*apitype.WhoIsResponse, error) {
	f.mu.Lock()
	f.seen = append(f.seen, remoteAddr)
	f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	n := &tailcfg.Node{Name: f.node}
	if f.tagged {
		n.Tags = []string{"tag:server"}
	}
	return &apitype.WhoIsResponse{
		Node:        n,
		UserProfile: &tailcfg.UserProfile{ID: f.uid, LoginName: f.login},
	}, nil
}

// echoBackend returns the headers it received as JSON.
func echoBackend(t *testing.T, hits *int) *httptest.Server {
	t.Helper()
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		if hits != nil {
			*hits++
		}
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"header": r.Header, "host": r.Host, "path": r.URL.RequestURI()})
	}))
	t.Cleanup(srv.Close)
	return srv
}

const testProxyKey = "test-proxy-key-0123456789abcdefghijklmnop"

func newFront(t *testing.T, backendURL string, w WhoIsFunc) *httptest.Server {
	return newGatedFront(t, backendURL, w, nil)
}

func newGatedFront(t *testing.T, backendURL string, w WhoIsFunc, allow AllowFunc) *httptest.Server {
	t.Helper()
	target, err := parseTarget(strings.TrimPrefix(backendURL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(newProxyHandler(target, testProxyKey, w, allow, t.Logf, nil))
	t.Cleanup(front.Close)
	return front
}

func TestProxySetsIdentityAndStripsSpoofedHeaders(t *testing.T) {
	backend := echoBackend(t, nil)
	who := &fakeWhoIs{login: "alice@example.com", node: "aula-iphone.tail1234.ts.net."}
	front := newFront(t, backend.URL, who.WhoIs)

	req, _ := http.NewRequest("GET", front.URL+"/api/things?x=1", nil)
	// Every spelling a client might use to spoof identity.
	req.Header.Add("X-Aula-Tailnet-User", "mallory@evil.com")
	req.Header.Add("X-Aula-Tailnet-User", "second@evil.com")
	req.Header["x-aula-tailnet-node"] = []string{"evil-node"} // non-canonical key
	req.Header["X_Aula_Tailnet_Addr"] = []string{"1.2.3.4"}   // underscore variant
	req.Header.Set("X-Aula-Via", "lan")
	req.Header.Set("X-Aula-Proxy-Key", "guessed")
	req.Header["X_Aula_Proxy_Key"] = []string{"guessed-too"}
	req.Header.Set("X-Forwarded-For", "6.6.6.6")
	req.Header.Set("X-Keep-Me", "yes")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var got struct {
		Header http.Header
		Host   string
		Path   string
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}

	want := map[string]string{
		"X-Aula-Tailnet-User": "alice@example.com",
		"X-Aula-Tailnet-Node": "aula-iphone.tail1234.ts.net",
		"X-Aula-Tailnet-Addr": "127.0.0.1",
		"X-Aula-Via":          "tailscale",
		"X-Aula-Proxy-Key":    testProxyKey,
		"X-Keep-Me":           "yes",
		"X-Forwarded-For":     "127.0.0.1",
	}
	for k, v := range want {
		if vals := got.Header.Values(k); len(vals) != 1 || vals[0] != v {
			t.Errorf("%s = %q, want [%q]", k, vals, v)
		}
	}
	for k := range got.Header {
		lk := strings.ToLower(strings.ReplaceAll(k, "_", "-"))
		if strings.HasPrefix(lk, "x-aula-") {
			if _, ok := want[http.CanonicalHeaderKey(lk)]; !ok || k != http.CanonicalHeaderKey(lk) {
				t.Errorf("unexpected leftover header %q = %q", k, got.Header[k])
			}
		}
	}
	if got.Path != "/api/things?x=1" {
		t.Errorf("path = %q", got.Path)
	}
	u, _ := url.Parse(backend.URL)
	if got.Host != u.Host {
		t.Errorf("host = %q, want %q", got.Host, u.Host)
	}
	if len(who.seen) != 1 {
		t.Fatalf("whois calls = %d", len(who.seen))
	}
	if _, err := netip.ParseAddrPort(who.seen[0]); err != nil {
		t.Errorf("whois got remoteAddr %q, want ip:port", who.seen[0])
	}
}

func TestProxyWhoIsFailureIsForbidden(t *testing.T) {
	hits := 0
	backend := echoBackend(t, &hits)
	who := &fakeWhoIs{err: errors.New("no such peer")}
	front := newFront(t, backend.URL, who.WhoIs)

	resp, err := http.Get(front.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	var body struct{ Error string }
	json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", resp.StatusCode)
	}
	if body.Error == "" || resp.Header.Get("Content-Type") != "application/json; charset=utf-8" {
		t.Errorf("refusal is not the JSON error the app reads: %q (%s)", body.Error, resp.Header.Get("Content-Type"))
	}
	if hits != 0 {
		t.Errorf("backend was hit %d times; must fail closed", hits)
	}
}

func TestProxyUpstreamDownIs502(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close() // nothing listening now
	who := &fakeWhoIs{login: "a@b", node: "n."}
	front := newFront(t, "http://"+addr, who.WhoIs)
	resp, err := http.Get(front.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	var body struct{ Error string }
	json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", resp.StatusCode)
	}
	if body.Error == "" {
		t.Error("502 without a JSON error for the app")
	}
}

func TestProxyStreamsWithoutBuffering(t *testing.T) {
	release := make(chan struct{})
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: first\n\n")
		w.(http.Flusher).Flush()
		<-release
		fmt.Fprint(w, "data: second\n\n")
	}))
	defer backend.Close()
	defer close(release)
	who := &fakeWhoIs{login: "a@b", node: "n."}
	front := newFront(t, backend.URL, who.WhoIs)

	resp, err := http.Get(front.URL + "/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	lineCh := make(chan string, 1)
	go func() {
		line, _ := bufio.NewReader(resp.Body).ReadString('\n')
		lineCh <- line
	}()
	select {
	case line := <-lineCh:
		if line != "data: first\n" {
			t.Errorf("got %q", line)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("first event not flushed through the proxy")
	}
}

func TestProxyWebSocketUpgrade(t *testing.T) {
	var gotUser, gotVia, gotKey string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			http.Error(w, "expected upgrade", 400)
			return
		}
		gotUser = r.Header.Get(HeaderTailnetUser)
		gotVia = r.Header.Get(HeaderVia)
		gotKey = r.Header.Get(HeaderProxyKey)
		conn, brw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		brw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		brw.Flush()
		// Echo until the client half-closes.
		io.Copy(conn, brw)
	}))
	defer backend.Close()
	who := &fakeWhoIs{login: "alice@example.com", node: "phone."}
	front := newFront(t, backend.URL, who.WhoIs)

	u, _ := url.Parse(front.URL)
	c, err := net.Dial("tcp", u.Host)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(5 * time.Second))
	fmt.Fprintf(c, "GET /ws HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nX-Aula-Tailnet-User: mallory\r\nX-Aula-Proxy-Key: guessed\r\n\r\n", u.Host)
	br := bufio.NewReader(c)
	resp, err := http.ReadResponse(br, nil)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	payload := []byte("hello over the tunnel")
	if _, err := c.Write(payload); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, len(payload))
	if _, err := io.ReadFull(br, buf); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buf, payload) {
		t.Errorf("echo = %q", buf)
	}
	if gotUser != "alice@example.com" || gotVia != "tailscale" || gotKey != testProxyKey {
		t.Errorf("upgrade request identity = %q via %q, key %q", gotUser, gotVia, gotKey)
	}
}

func TestParseTarget(t *testing.T) {
	for _, tc := range []struct {
		in, want string
		ok       bool
	}{
		{"127.0.0.1:8787", "http://127.0.0.1:8787", true},
		{"http://127.0.0.1:8787/", "http://127.0.0.1:8787", true},
		{"localhost:3000", "http://localhost:3000", true},
		{"127.0.0.1", "", false},
		{"", "", false},
		{"ftp://127.0.0.1:21", "", false},
	} {
		u, err := parseTarget(tc.in)
		if (err == nil) != tc.ok {
			t.Errorf("parseTarget(%q) err = %v", tc.in, err)
			continue
		}
		if tc.ok && u.String() != tc.want {
			t.Errorf("parseTarget(%q) = %q, want %q", tc.in, u, tc.want)
		}
	}
}

func TestParseFlags(t *testing.T) {
	env := func(k string) string {
		if k == "TS_AUTHKEY" {
			return "tskey-from-env"
		}
		return ""
	}
	o, err := parseFlags([]string{"--state-dir", "/tmp/x", "--target", "127.0.0.1:1234"}, env)
	if err != nil {
		t.Fatal(err)
	}
	if o.hostname != "aula-mac" || o.listenPort != 80 || o.authKey != "tskey-from-env" || !o.watchStdin {
		t.Errorf("defaults wrong: %+v", o)
	}
	o, err = parseFlags([]string{"--state-dir=/tmp/x", "--target=127.0.0.1:1", "--authkey=flagkey", "--hostname=h", "--listen-port=8080"}, env)
	if err != nil || o.authKey != "flagkey" || o.hostname != "h" || o.listenPort != 8080 {
		t.Errorf("got %+v, %v", o, err)
	}
	if _, err := parseFlags([]string{"--target", "127.0.0.1:1"}, env); err == nil {
		t.Error("missing --state-dir accepted")
	}
	if _, err := parseFlags([]string{"--state-dir", "/tmp/x"}, env); err == nil {
		t.Error("missing --target accepted")
	}
	for _, bad := range []string{"10.0.0.5:80", "example.com:80", "0.0.0.0:80"} {
		if _, err := parseFlags([]string{"--state-dir", "/tmp/x", "--target", bad}, env); err == nil {
			t.Errorf("non-loopback target %q accepted", bad)
		}
	}
	if _, err := parseFlags([]string{"--state-dir", "/tmp/x", "--target", "[::1]:9"}, env); err != nil {
		t.Errorf("IPv6 loopback refused: %v", err)
	}
}

// --- monitor ---

type fakeStatus struct {
	mu     sync.Mutex
	st     ipnstate.Status
	kicked int
}

func (f *fakeStatus) StatusWithoutPeers(ctx context.Context) (*ipnstate.Status, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	st := f.st
	return &st, nil
}
func (f *fakeStatus) StartLoginInteractive(ctx context.Context) error {
	f.mu.Lock()
	f.kicked++
	f.mu.Unlock()
	return nil
}

func TestMonitorEvents(t *testing.T) {
	fs := &fakeStatus{}
	var events []Event
	owner := &ownerGate{}
	m := &monitor{lc: fs, emit: func(e Event) { events = append(events, e) }, logf: t.Logf, hostname: "aula-mac", port: 80, owner: owner}
	ctx := context.Background()

	fs.st = ipnstate.Status{BackendState: "NoState"}
	m.refresh(ctx)
	fs.st = ipnstate.Status{BackendState: "NeedsLogin", AuthURL: "https://login.tailscale.com/a/abc"}
	m.refresh(ctx)
	m.refresh(ctx) // duplicate: no new event
	m.onAuthURL("https://login.tailscale.com/a/abc")

	self := &ipnstate.PeerStatus{DNSName: "aula-mac.tail1234.ts.net.", HostName: "aula-mac", UserID: 42}
	fs.st = ipnstate.Status{BackendState: "Running", Self: self,
		User:         map[tailcfg.UserID]tailcfg.UserProfile{42: {ID: 42, LoginName: "alice@example.com"}},
		TailscaleIPs: []netip.Addr{netip.MustParseAddr("100.64.0.1"), netip.MustParseAddr("fd7a:115c:a1e0::1")}}
	m.refresh(ctx)
	if id, login := owner.get(); id != 42 || login != "alice@example.com" {
		t.Errorf("owner = %v %q, want 42 alice@example.com", id, login)
	}
	m.refresh(ctx) // unchanged: no new event
	fs.st.TailscaleIPs = []netip.Addr{netip.MustParseAddr("100.64.0.2")}
	m.refresh(ctx) // IP change: re-emit

	want := []Event{
		{Type: "needs_login", AuthURL: "https://login.tailscale.com/a/abc"},
		{Type: "running", Hostname: "aula-mac", DNSName: "aula-mac.tail1234.ts.net", IPs: []string{"100.64.0.1", "fd7a:115c:a1e0::1"}, Port: 80, User: "alice@example.com"},
		{Type: "running", Hostname: "aula-mac", DNSName: "aula-mac.tail1234.ts.net", IPs: []string{"100.64.0.2"}, Port: 80, User: "alice@example.com"},
	}
	gotJSON, _ := json.Marshal(events)
	wantJSON, _ := json.Marshal(want)
	if !bytes.Equal(gotJSON, wantJSON) {
		t.Errorf("events:\n got %s\nwant %s", gotJSON, wantJSON)
	}

	// Logged out later without an auth URL: monitor kicks interactive login.
	fs.st = ipnstate.Status{BackendState: "NeedsLogin"}
	m.refresh(ctx)
	if id, _ := owner.get(); id != 0 {
		t.Errorf("owner still set after logout: %v", id)
	}
	m.needsLoginSince = time.Now().Add(-kickAfter - time.Second)
	m.refresh(ctx)
	if fs.kicked != 1 {
		t.Errorf("StartLoginInteractive calls = %d, want 1", fs.kicked)
	}
}

func TestEmitterOneJSONObjectPerLine(t *testing.T) {
	var buf bytes.Buffer
	em := &Emitter{w: &buf}
	em.Emit(Event{Type: "starting"})
	em.Emit(Event{Type: "running", Hostname: "aula-mac", DNSName: "aula-mac.x.ts.net", IPs: []string{"100.1.2.3"}, Port: 80})
	em.Emit(Event{Type: "stopped"})
	want := `{"type":"starting"}
{"type":"running","hostname":"aula-mac","dnsName":"aula-mac.x.ts.net","ips":["100.1.2.3"],"port":80}
{"type":"stopped"}
`
	if buf.String() != want {
		t.Errorf("got:\n%s\nwant:\n%s", buf.String(), want)
	}
}

func TestProxyOnlyLetsTheOwnerIn(t *testing.T) {
	hits := 0
	backend := echoBackend(t, &hits)
	owner := &ownerGate{}
	who := &fakeWhoIs{login: "alice@example.com", node: "aula-iphone.tail1234.ts.net.", uid: 42}
	front := newGatedFront(t, backend.URL, who.WhoIs, owner.allows)
	get := func() int {
		resp, err := http.Get(front.URL + "/")
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	if c := get(); c != http.StatusForbidden {
		t.Errorf("before running: status = %d, want 403", c)
	}
	owner.set(42, "alice@example.com")
	if c := get(); c != http.StatusOK {
		t.Errorf("owner: status = %d, want 200", c)
	}
	who.uid = 7
	if c := get(); c != http.StatusForbidden {
		t.Errorf("other user: status = %d, want 403", c)
	}
	who.uid, who.tagged = 42, true
	if c := get(); c != http.StatusForbidden {
		t.Errorf("tagged node: status = %d, want 403", c)
	}
	if hits != 1 {
		t.Errorf("backend hits = %d, want 1", hits)
	}
}

func TestReadConfig(t *testing.T) {
	c, err := readConfig(bufio.NewReader(strings.NewReader(`{"proxyKey":"abc"}`+"\n"+`{"cmd":"logout"}`+"\n")), time.Second)
	if err != nil || c.ProxyKey != "abc" {
		t.Errorf("got %+v, %v", c, err)
	}
	if _, err := readConfig(bufio.NewReader(strings.NewReader("not json\n")), time.Second); err == nil {
		t.Error("non-JSON config accepted")
	}
	pr, pw := io.Pipe()
	defer pw.Close()
	if _, err := readConfig(bufio.NewReader(pr), 50*time.Millisecond); err == nil {
		t.Error("missing config did not time out")
	}
}

func TestRunRefusesWithoutProxyKey(t *testing.T) {
	var out bytes.Buffer
	code := run([]string{"--state-dir", t.TempDir(), "--target", "127.0.0.1:9"}, &out, strings.NewReader(`{"proxyKey":"short"}`+"\n"))
	if code == 0 {
		t.Fatal("run succeeded without a usable proxy key")
	}
	if !strings.Contains(out.String(), `"type":"error"`) || !strings.Contains(out.String(), `"type":"stopped"`) {
		t.Errorf("status output = %q", out.String())
	}
}

// --- Aula additions ---

func TestOwnerGateRefusesIncompletePeers(t *testing.T) {
	g := &ownerGate{}
	g.set(42, "alice@example.com")
	for name, who := range map[string]*apitype.WhoIsResponse{
		"nil":          nil,
		"no profile":   {Node: &tailcfg.Node{Name: "n."}},
		"no node":      {UserProfile: &tailcfg.UserProfile{ID: 42}},
		"zero user id": {Node: &tailcfg.Node{Name: "n."}, UserProfile: &tailcfg.UserProfile{}},
	} {
		if ok, why := g.allows(who); ok || why == "" {
			t.Errorf("%s: allowed (%q)", name, why)
		}
	}
	// The person's own iPhone: same Tailscale user as the Mac node.
	if ok, why := g.allows(&apitype.WhoIsResponse{Node: &tailcfg.Node{Name: "aula-iphone.tail1234.ts.net."}, UserProfile: &tailcfg.UserProfile{ID: 42, LoginName: "alice@example.com"}}); !ok {
		t.Errorf("own iPhone refused: %s", why)
	}
}

func TestProxyRefusalTellsThePhoneWhy(t *testing.T) {
	backend := echoBackend(t, nil)
	owner := &ownerGate{}
	owner.set(42, "alice@example.com")
	who := &fakeWhoIs{login: "bob@example.com", node: "bobs-phone.tail1234.ts.net.", uid: 7}
	front := newGatedFront(t, backend.URL, who.WhoIs, owner.allows)
	resp, err := http.Get(front.URL + "/api/state")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body struct{ Error string }
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusForbidden || !strings.Contains(body.Error, "otra cuenta de Tailscale") {
		t.Errorf("status %d, error %q", resp.StatusCode, body.Error)
	}
}

func TestRefusalReporterDeduplicates(t *testing.T) {
	var events []Event
	clock := time.Unix(1_700_000_000, 0)
	r := &refusalReporter{emit: func(e Event) { events = append(events, e) }, now: func() time.Time { return clock }}
	bob := &apitype.WhoIsResponse{Node: &tailcfg.Node{Name: "bobs-phone.tail1234.ts.net."}, UserProfile: &tailcfg.UserProfile{ID: 7, LoginName: "bob@example.com"}}
	r.note(bob, refuseNotConnected) // transient: not reported
	r.note(bob, refuseOtherUser)
	r.note(bob, refuseOtherUser) // same peer, same reason, within a minute
	clock = clock.Add(refusalEvery + time.Second)
	r.note(bob, refuseOtherUser)
	want := Event{Type: "peer_refused", User: "bob@example.com", Node: "bobs-phone.tail1234.ts.net", Message: refuseOtherUser}
	gotJSON, _ := json.Marshal(events)
	wantJSON, _ := json.Marshal([]Event{want, want})
	if !bytes.Equal(gotJSON, wantJSON) {
		t.Errorf("events:\n got %s\nwant %s", gotJSON, wantJSON)
	}
	var nilReporter *refusalReporter
	nilReporter.note(bob, refuseOtherUser) // must not panic
}

type fakeLogout struct {
	calls, logins int
	err           error
}

func (f *fakeLogout) Logout(ctx context.Context) error {
	f.calls++
	return f.err
}

func (f *fakeLogout) StartLoginInteractive(ctx context.Context) error {
	f.logins++
	return nil
}

func TestReadCommandsLogoutAndEOF(t *testing.T) {
	var out bytes.Buffer
	em := &Emitter{w: &out}
	owner := &ownerGate{}
	owner.set(42, "alice@example.com")
	lc := &fakeLogout{}
	eof := make(chan struct{})
	in := strings.NewReader(`{"cmd":"logout"}` + "\n" + `not json` + "\n" + `{"cmd":"bogus"}` + "\n")
	go readCommands(context.Background(), bufio.NewReader(in), lc, em, owner, t.Logf, func() { close(eof) })
	select {
	case <-eof:
	case <-time.After(3 * time.Second):
		t.Fatal("stdin EOF did not stop the command reader")
	}
	if lc.calls != 1 || lc.logins != 1 {
		t.Errorf("Logout calls = %d, login requests = %d, want 1 and 1", lc.calls, lc.logins)
	}
	if id, _ := owner.get(); id != 0 {
		t.Errorf("owner still set after logout: %v", id)
	}
	if out.String() != `{"type":"logged_out"}`+"\n" {
		t.Errorf("status output = %q", out.String())
	}

	out.Reset()
	lc = &fakeLogout{err: errors.New("control unreachable")}
	done := make(chan struct{})
	go readCommands(context.Background(), bufio.NewReader(strings.NewReader(`{"cmd":"logout"}`)), lc, em, owner, t.Logf, func() { close(done) })
	<-done
	if lc.calls != 1 || lc.logins != 0 || !strings.Contains(out.String(), `"type":"error"`) || strings.Contains(out.String(), "logged_out") {
		t.Errorf("failed logout: calls %d, output %q", lc.calls, out.String())
	}
}

func TestRunConfigErrors(t *testing.T) {
	for name, tc := range map[string]struct {
		args  []string
		stdin string
	}{
		"not JSON":     {[]string{"--target", "127.0.0.1:9"}, "proxyKey=abc\n"},
		"empty stdin":  {[]string{"--target", "127.0.0.1:9"}, ""},
		"no key":       {[]string{"--target", "127.0.0.1:9"}, `{}` + "\n"},
		"non-loopback": {[]string{"--target", "192.168.1.10:9"}, `{"proxyKey":"` + testProxyKey + `"}` + "\n"},
		"key in argv":  {[]string{"--target", "127.0.0.1:9", "--proxy-key", testProxyKey}, ""},
	} {
		var out bytes.Buffer
		args := append([]string{"--state-dir", t.TempDir()}, tc.args...)
		if code := run(args, &out, strings.NewReader(tc.stdin)); code == 0 {
			t.Errorf("%s: run succeeded", name)
		}
		if !strings.HasSuffix(out.String(), `{"type":"stopped"}`+"\n") || !strings.Contains(out.String(), `"type":"error"`) {
			t.Errorf("%s: status output = %q", name, out.String())
		}
		if strings.Contains(out.String(), testProxyKey) {
			t.Errorf("%s: the proxy key leaked into the status output", name)
		}
	}
}

func TestRunningEventCarriesOwner(t *testing.T) {
	var buf bytes.Buffer
	em := &Emitter{w: &buf}
	em.Emit(Event{Type: "running", Hostname: "aula-mac", DNSName: "aula-mac.x.ts.net", IPs: []string{"100.1.2.3"}, Port: 80, User: "alice@example.com"})
	em.Emit(Event{Type: "peer_refused", User: "bob@example.com", Node: "bobs-phone.x.ts.net", Message: refuseOtherUser})
	em.Emit(Event{Type: "logged_out"})
	want := `{"type":"running","hostname":"aula-mac","dnsName":"aula-mac.x.ts.net","ips":["100.1.2.3"],"port":80,"user":"alice@example.com"}
{"type":"peer_refused","user":"bob@example.com","node":"bobs-phone.x.ts.net","message":"peer belongs to another Tailscale user"}
{"type":"logged_out"}
`
	if buf.String() != want {
		t.Errorf("got:\n%s\nwant:\n%s", buf.String(), want)
	}
}
