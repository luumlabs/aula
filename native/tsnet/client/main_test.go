package main

import (
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"slices"
	"strings"
	"testing"

	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tailcfg"
	"tailscale.com/types/views"
)

func TestIsAulaHost(t *testing.T) {
	long := "aula-" + strings.Repeat("a", 58) // 63 caracteres: el máximo de una etiqueta DNS
	for name, want := range map[string]bool{
		"aula-mac": true, "aula-mac-1": true, "aula-server": true, "aula-casa": true, "AULA-NAS": true, "aula-a": true,
		"aula-a--b": true, "aula-0": true, long: true,
		"aula-mac.tail1.ts.net.": true, "AULA-Server.tail1.ts.net": true, // la primera etiqueta del nombre MagicDNS
		"aula-ipad": false, "aula-iphone-2": false, "aula-android": false, "aula-device": false, "AULA-IPAD-12": false,
		"aula-ipad-": false, "aula-ipad-x": true, // solo «-<cifras>» detrás del nombre de un dispositivo
		"aula": false, "aula-": false, "mac": false, "aula_server": false, "aula--x": false, "aula-x-": false,
		"aula-mac x": false, " aula-mac": false, "": false, ".aula-mac": false, long + "a": false,
		"aula-m\u00e1c": false, "aula-mac\u212a": false, "AULA-\u212a": false, // solo ASCII (el signo de Kelvin no es una «k»)
		"aula-mac\u0301": false, "aula-mac.\u0301x": true, // se corta por bytes, como en la app del iPhone
		"aula-ipad.aula-mac": false,
	} {
		if got := IsAulaHost(name); got != want {
			t.Errorf("IsAulaHost(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestHostLabel(t *testing.T) {
	for name, want := range map[string]string{
		"Aula-Mac.tail1.ts.net.": "aula-mac", "aula-server": "aula-server", "": "", ".x": "", "aula-m\u00e1c.ts.net": "",
		"AULA-\u212a": "",
	} {
		if got := HostLabel(name); got != want {
			t.Errorf("HostLabel(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestFindAulas(t *testing.T) {
	ip := func(s string) []netip.Addr { return []netip.Addr{netip.MustParseAddr(s)} }
	tags := func(t ...string) *views.Slice[string] { v := views.SliceOf(t); return &v }
	const ana, bea tailcfg.UserID = 7, 8
	self := &ipnstate.PeerStatus{DNSName: "aula-android.tail1.ts.net.", UserID: ana}
	peers := []*ipnstate.PeerStatus{
		{DNSName: "aula-server.tail1.ts.net.", TailscaleIPs: ip("100.64.0.2"), Online: false, UserID: ana},
		{DNSName: "aula-mac.tail1.ts.net.", TailscaleIPs: ip("100.64.0.1"), Online: true, UserID: ana},
		{DNSName: "aula-ipad.tail1.ts.net.", TailscaleIPs: ip("100.64.0.3"), Online: true, UserID: ana},
		{DNSName: "laptop.tail1.ts.net.", TailscaleIPs: ip("100.64.0.4"), Online: true, UserID: ana},
		{HostName: "aula-casa", TailscaleIPs: ip("100.64.0.5"), Online: true, UserID: ana},
		{DNSName: "aula-nada.tail1.ts.net.", UserID: ana}, // sin direcciones: no sirve
		// de otra persona de la misma red, con etiquetas, compartidos desde otra red o hacia ella: nunca son suyos
		{DNSName: "aula-bea.tail1.ts.net.", TailscaleIPs: ip("100.64.0.6"), Online: true, UserID: bea},
		{DNSName: "aula-etiquetada.tail1.ts.net.", TailscaleIPs: ip("100.64.0.7"), Online: true, UserID: ana, Tags: tags("tag:server")},
		{DNSName: "aula-compartida.otra.ts.net.", TailscaleIPs: ip("100.64.0.8"), Online: true, UserID: ana, AltSharerUserID: bea},
		{DNSName: "aula-invitada.tail1.ts.net.", TailscaleIPs: ip("100.64.0.9"), Online: true, UserID: ana, ShareeNode: true},
		// dos equipos con el mismo nombre: ninguno (marcar a uno u otro no puede depender del orden de un mapa)
		{DNSName: "aula-doble.tail1.ts.net.", TailscaleIPs: ip("100.64.0.10"), Online: true, UserID: ana},
		{HostName: "aula-doble", TailscaleIPs: ip("100.64.0.11"), Online: false, UserID: ana},
		{DNSName: "aula-m\u00e1c.tail1.ts.net.", TailscaleIPs: ip("100.64.0.12"), Online: true, UserID: ana},
	}
	aulas, addrs := FindAulas(self, peers)
	want := []Aula{{"aula-casa", true}, {"aula-mac", true}, {"aula-server", false}}
	if !slices.Equal(aulas, want) {
		t.Fatalf("aulas = %v, want %v", aulas, want)
	}
	if len(addrs) != 3 || addrs["aula-mac"].String() != "100.64.0.1" || addrs["aula-server"].String() != "100.64.0.2" || addrs["aula-casa"].String() != "100.64.0.5" {
		t.Fatalf("addrs = %v", addrs)
	}
	// el mismo resultado en cualquier orden
	for i := 0; i < 20; i++ {
		shuffled := slices.Clone(peers)
		rand.Shuffle(len(shuffled), func(a, b int) { shuffled[a], shuffled[b] = shuffled[b], shuffled[a] })
		if got, _ := FindAulas(self, shuffled); !slices.Equal(got, want) {
			t.Fatalf("shuffled: aulas = %v, want %v", got, want)
		}
	}
	// sin saber de quién es este dispositivo, ninguna (como la Aula, se falla cerrado)
	for _, s := range []*ipnstate.PeerStatus{nil, {DNSName: "aula-android.tail1.ts.net."}} {
		if got, addrs := FindAulas(s, peers); len(got) != 0 || len(addrs) != 0 {
			t.Fatalf("self %v: aulas = %v, addrs = %v", s, got, addrs)
		}
	}
	// vista desde otra persona de la red: solo la suya
	if got, _ := FindAulas(&ipnstate.PeerStatus{UserID: bea}, peers); !slices.Equal(got, []Aula{{"aula-bea", true}}) {
		t.Fatalf("bea: aulas = %v", got)
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
