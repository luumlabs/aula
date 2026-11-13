package main

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"

	"tailscale.com/ipn/ipnstate"
)

func TestIsAulaHost(t *testing.T) {
	for name, want := range map[string]bool{
		"aula-mac": true, "aula-mac-1": true, "aula-server": true, "aula-casa": true, "AULA-NAS": true,
		"aula-ipad": false, "aula-iphone-2": false, "aula-android": false, "aula-device": false,
		"aula": false, "aula-": false, "mac": false, "aula_server": false,
	} {
		if got := IsAulaHost(name); got != want {
			t.Errorf("IsAulaHost(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestFindAulas(t *testing.T) {
	ip := func(s string) []netip.Addr { return []netip.Addr{netip.MustParseAddr(s)} }
	peers := []*ipnstate.PeerStatus{
		{DNSName: "aula-server.tail1.ts.net.", TailscaleIPs: ip("100.64.0.2"), Online: false},
		{DNSName: "aula-mac.tail1.ts.net.", TailscaleIPs: ip("100.64.0.1"), Online: true},
		{DNSName: "aula-ipad.tail1.ts.net.", TailscaleIPs: ip("100.64.0.3"), Online: true},
		{DNSName: "laptop.tail1.ts.net.", TailscaleIPs: ip("100.64.0.4"), Online: true},
		{HostName: "aula-casa", TailscaleIPs: ip("100.64.0.5"), Online: true},
		{DNSName: "aula-nada.tail1.ts.net."}, // sin direcciones: no sirve
	}
	aulas, addrs := FindAulas(peers)
	want := []Aula{{"aula-casa", true}, {"aula-mac", true}, {"aula-server", false}}
	if len(aulas) != len(want) {
		t.Fatalf("aulas = %v, want %v", aulas, want)
	}
	for i := range want {
		if aulas[i] != want[i] {
			t.Fatalf("aulas = %v, want %v", aulas, want)
		}
	}
	if addrs["aula-mac"].String() != "100.64.0.1" || addrs["aula-server"].String() != "100.64.0.2" {
		t.Fatalf("addrs = %v", addrs)
	}
}

func TestGateHandler(t *testing.T) {
	secret := NewGate()
	var seen *http.Request
	h := GateHandler(secret, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { seen = r; w.WriteHeader(204) }))
	do := func(set func(*http.Request)) int {
		seen = nil
		r := httptest.NewRequest("GET", "http://127.0.0.1:1234/rpc", nil)
		set(r)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	if code := do(func(*http.Request) {}); code != 403 {
		t.Fatalf("without the secret: %d", code)
	}
	if code := do(func(r *http.Request) { r.Header.Set("Cookie", GateCookie+"=otro") }); code != 403 {
		t.Fatalf("with a wrong secret: %d", code)
	}
	if code := do(func(r *http.Request) { r.Header.Set(GateHeader, secret) }); code != 204 || seen.Header.Get(GateHeader) != "" {
		t.Fatalf("with the header: %d %v", code, seen)
	}
	code := do(func(r *http.Request) { r.Header.Set("Cookie", "aula_device_ab=t0k; "+GateCookie+"="+secret+"; x=1") })
	if code != 204 || seen.Header.Get("Cookie") != "aula_device_ab=t0k; x=1" {
		t.Fatalf("with the cookie: %d, cookie passed on %q", code, seen.Header.Get("Cookie"))
	}
	if a, b := NewGate(), NewGate(); a == b || len(a) < 30 {
		t.Fatalf("gates %q %q", a, b)
	}
}
