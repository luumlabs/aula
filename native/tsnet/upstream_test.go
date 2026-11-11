package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// aulaBackend answers /health challenges like the Aula server (with `key`)
// and records every other request's proxy key and Authorization header.
func aulaBackend(t *testing.T, key string, seen *[]string, mu *sync.Mutex) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/health" {
			out := map[string]any{"ok": true, "name": "Aula"}
			if n := r.URL.Query().Get("challenge"); n != "" && key != "" {
				out["proof"] = map[string]string{"proxy": healthProof(key, n)}
			}
			json.NewEncoder(w).Encode(out)
			return
		}
		mu.Lock()
		*seen = append(*seen, r.Header.Get(HeaderProxyKey)+"|"+r.Header.Get("Authorization"))
		mu.Unlock()
		json.NewEncoder(w).Encode(map[string]string{"path": r.URL.Path})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func verifiedFront(t *testing.T, backendURL string) *httptest.Server {
	t.Helper()
	target, err := parseTarget(strings.TrimPrefix(backendURL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	who := &fakeWhoIs{login: "luna@example.com", node: "aula-iphone.tail1234.ts.net.", uid: 1}
	front := httptest.NewServer(newProxyHandler(target, testProxyKey, who.WhoIs, nil, t.Logf, newVerifyingTransport(target, testProxyKey, t.Logf)))
	t.Cleanup(front.Close)
	return front
}

func getWithToken(t *testing.T, url string) int {
	t.Helper()
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer phone-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

func TestVerifiedUpstreamForwardsToAula(t *testing.T) {
	var mu sync.Mutex
	var seen []string
	front := verifiedFront(t, aulaBackend(t, testProxyKey, &seen, &mu).URL)
	for i := 0; i < 3; i++ { // the verified connection is reused
		if code := getWithToken(t, front.URL+"/api/state"); code != 200 {
			t.Fatalf("status = %d, want 200", code)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if len(seen) != 3 || seen[0] != testProxyKey+"|Bearer phone-token" {
		t.Errorf("backend saw %q", seen)
	}
}

func TestVerifiedUpstreamRefusesAProcessThatTookThePort(t *testing.T) {
	for name, key := range map[string]string{"no proof": "", "wrong key": "another-key-0123456789abcdefghijklmnopqrstu"} {
		var mu sync.Mutex
		var seen []string
		front := verifiedFront(t, aulaBackend(t, key, &seen, &mu).URL)
		if code := getWithToken(t, front.URL+"/api/state"); code != http.StatusBadGateway {
			t.Errorf("%s: status = %d, want 502", name, code)
		}
		mu.Lock()
		if len(seen) != 0 {
			t.Errorf("%s: the impostor received %d requests (proxy key / token)", name, len(seen))
		}
		mu.Unlock()
	}
}

func TestRotatingLog(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tailnet.log")
	r, err := openRotating(path, 100)
	if err != nil {
		t.Fatal(err)
	}
	line := []byte(strings.Repeat("x", 39) + "\n")
	for i := 0; i < 5; i++ {
		r.Write(line)
	}
	r.Close()
	cur, _ := os.ReadFile(path)
	old, _ := os.ReadFile(path + ".1")
	if len(cur) > 100 || len(old) == 0 || len(old) > 100 {
		t.Errorf("sizes: current %d, previous %d", len(cur), len(old))
	}
	if st, _ := os.Stat(path); st.Mode().Perm() != 0o600 {
		t.Errorf("log mode = %v, want 0600", st.Mode().Perm())
	}
}

func TestLogPathPrefersTheAppsLogsFolder(t *testing.T) {
	data := t.TempDir()
	state := filepath.Join(data, "tailscale")
	os.MkdirAll(state, 0o700)
	none := func(string) string { return "" }
	if got := logPath(state, none); got != filepath.Join(state, "aula-tsnet.log") {
		t.Errorf("without a logs folder: %s", got)
	}
	os.MkdirAll(filepath.Join(data, "logs"), 0o700)
	if got := logPath(state, none); got != filepath.Join(data, "logs", "tailnet.log") {
		t.Errorf("with the app's logs folder: %s", got)
	}
	if got := logPath(state, func(string) string { return "/x/y.log" }); got != "/x/y.log" {
		t.Errorf("override: %s", got)
	}
}

func TestFatalReasonIsLogged(t *testing.T) {
	data := t.TempDir()
	os.MkdirAll(filepath.Join(data, "logs"), 0o700)
	var out strings.Builder
	code := run([]string{"--state-dir", filepath.Join(data, "tailscale"), "--target", "127.0.0.1:9"}, &out, strings.NewReader(`{"proxyKey":"short"}`+"\n"))
	if code == 0 {
		t.Fatal("run succeeded without a usable proxy key")
	}
	b, _ := os.ReadFile(filepath.Join(data, "logs", "tailnet.log"))
	if !strings.Contains(string(b), "fatal: missing or short proxy key") {
		t.Errorf("log = %q", b)
	}
}

// The phone's live socket goes through the same verified transport.
func TestVerifiedUpstreamCarriesWebSockets(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			json.NewEncoder(w).Encode(map[string]any{"proof": map[string]string{"proxy": healthProof(testProxyKey, r.URL.Query().Get("challenge"))}})
			return
		}
		conn, brw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		brw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		brw.Flush()
		io.Copy(conn, brw)
	}))
	defer backend.Close()
	front := verifiedFront(t, backend.URL)
	u, _ := url.Parse(front.URL)
	c, err := net.Dial("tcp", u.Host)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(5 * time.Second))
	fmt.Fprintf(c, "GET /api/events HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n", u.Host)
	br := bufio.NewReader(c)
	resp, err := http.ReadResponse(br, nil)
	if err != nil || resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("upgrade: %v %v", resp, err)
	}
	c.Write([]byte("ping"))
	buf := make([]byte, 4)
	if _, err := io.ReadFull(br, buf); err != nil || string(buf) != "ping" {
		t.Fatalf("echo %q %v", buf, err)
	}
}
