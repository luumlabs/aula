// Prueba la regla que decide qué equipos de la red son una Aula de esta persona (Aula/Tailnet/AulaHosts.swift): los
// mismos casos que native/tsnet/client/main_test.go, porque la app de Android sigue la misma regla. Lo compila y lanza
// ../verify.sh.
import Foundation

setvbuf(stdout, nil, _IONBF, 0)
var failures = 0
@MainActor func check(_ ok: Bool, _ what: String) {
    print("\(ok ? "PASS" : "FAIL")  \(what)")
    if !ok { failures += 1 }
}

// MARK: Los nombres
let long = "aula-" + String(repeating: "a", count: 58) // 63 caracteres: el máximo de una etiqueta DNS
let names: [String: Bool] = [
    "aula-mac": true, "aula-mac-1": true, "aula-server": true, "aula-casa": true, "AULA-NAS": true, "aula-a": true,
    "aula-a--b": true, "aula-0": true, long: true,
    "aula-mac.tail1.ts.net.": true, "AULA-Server.tail1.ts.net": true, // la primera etiqueta del nombre MagicDNS
    "aula-ipad": false, "aula-iphone-2": false, "aula-android": false, "aula-device": false, "AULA-IPAD-12": false,
    "aula-ipad-": false, "aula-ipad-x": true, // solo «-<cifras>» detrás del nombre de un dispositivo
    "aula": false, "aula-": false, "mac": false, "aula_server": false, "aula--x": false, "aula-x-": false,
    "aula-mac x": false, " aula-mac": false, "": false, ".aula-mac": false, long + "a": false,
    "aula-m\u{e1}c": false, "aula-mac\u{212a}": false, "AULA-\u{212a}": false, // solo ASCII (el signo de Kelvin no es una «k»)
    "aula-mac\u{301}": false, "aula-mac.\u{301}x": true, // un acento suelto no se pega al punto: se corta por bytes
    "aula-ipad.aula-mac": false,
]
for (name, want) in names.sorted(by: { $0.key < $1.key }) {
    check(isAulaHost(name) == want, "isAulaHost(\(name.debugDescription)) = \(want)")
}
for (name, want) in ["Aula-Mac.tail1.ts.net.": "aula-mac", "aula-server": "aula-server", "": "", ".x": "",
                     "aula-m\u{e1}c.ts.net": "", "AULA-\u{212a}": ""] {
    check(hostLabel(name) == want, "hostLabel(\(name.debugDescription)) = \(want.debugDescription)")
}

// MARK: De quién es cada equipo
typealias Peer = IPNStatus.PeerStatus
let ana: Int64 = 7, bea: Int64 = 8
let me = Peer(DNSName: "aula-ipad.tail1.ts.net.", UserID: ana)
let peers: [String: Peer] = [
    "1": Peer(DNSName: "aula-server.tail1.ts.net.", Online: false, TailscaleIPs: ["100.64.0.2"], UserID: ana),
    "2": Peer(DNSName: "aula-mac.tail1.ts.net.", Online: true, TailscaleIPs: ["100.64.0.1", "fd7a:115c:a1e0::1"], UserID: ana),
    "3": Peer(DNSName: "aula-iphone.tail1.ts.net.", Online: true, TailscaleIPs: ["100.64.0.3"], UserID: ana),
    "4": Peer(DNSName: "laptop.tail1.ts.net.", Online: true, TailscaleIPs: ["100.64.0.4"], UserID: ana),
    "5": Peer(HostName: "aula-casa", Online: true, TailscaleIPs: ["100.64.0.5"], UserID: ana),
    "6": Peer(DNSName: "aula-nada.tail1.ts.net.", UserID: ana), // sin direcciones: no sirve
    // de otra persona de la misma red, con etiquetas, compartidos desde otra red o hacia ella: nunca son suyos
    "7": Peer(DNSName: "aula-bea.tail1.ts.net.", Online: true, TailscaleIPs: ["100.64.0.6"], UserID: bea),
    "8": Peer(DNSName: "aula-etiquetada.tail1.ts.net.", Online: true, TailscaleIPs: ["100.64.0.7"], UserID: ana, Tags: ["tag:server"]),
    "9": Peer(DNSName: "aula-compartida.otra.ts.net.", Online: true, TailscaleIPs: ["100.64.0.8"], UserID: ana, AltSharerUserID: bea),
    "10": Peer(DNSName: "aula-invitada.tail1.ts.net.", Online: true, TailscaleIPs: ["100.64.0.9"], UserID: ana, ShareeNode: true),
    // dos equipos con el mismo nombre: ninguno (no se adivina cuál es)
    "11": Peer(DNSName: "aula-doble.tail1.ts.net.", Online: true, TailscaleIPs: ["100.64.0.10"], UserID: ana),
    "12": Peer(HostName: "aula-doble", Online: false, TailscaleIPs: ["100.64.0.11"], UserID: ana),
    "13": Peer(DNSName: "aula-m\u{e1}c.tail1.ts.net.", Online: true, TailscaleIPs: ["100.64.0.12"], UserID: ana),
]
let want = [AulaPeer(host: "aula-casa", online: true), AulaPeer(host: "aula-mac", online: true), AulaPeer(host: "aula-server", online: false)]
let found = findAulas(peers, me: me)
check(found.aulas == want, "solo las Aulas de su dueño, sin etiquetas ni compartidas: \(found.aulas.map(\.host))")
check(found.addrs == ["aula-mac": "100.64.0.1", "aula-server": "100.64.0.2", "aula-casa": "100.64.0.5"], "la dirección de cada una: \(found.addrs)")
check(findAulas(peers, me: nil).aulas.isEmpty && findAulas(peers, me: Peer(DNSName: "aula-ipad.tail1.ts.net.")).aulas.isEmpty,
      "sin saber de quién es este dispositivo, ninguna")
check(findAulas(peers, me: Peer(UserID: bea)).aulas == [AulaPeer(host: "aula-bea", online: true)], "vista desde otra persona de la red: solo la suya")
check(findAulas(nil, me: me).aulas.isEmpty, "sin equipos, ninguna")

// MARK: El JSON del nodo (ipnstate.Status)
let json = """
{"BackendState":"Running","TailscaleIPs":["100.64.0.20"],
 "Self":{"DNSName":"aula-ipad.tail1.ts.net.","HostName":"iPad","UserID":123456789012,"Online":true},
 "Peer":{
  "nodekey:a":{"DNSName":"aula-mac.tail1.ts.net.","HostName":"Mac","UserID":123456789012,"TailscaleIPs":["100.64.0.1"],"Online":true,"Tags":null},
  "nodekey:b":{"DNSName":"aula-server.tail1.ts.net.","UserID":123456789012,"TailscaleIPs":["100.64.0.2"],"Online":true,"Tags":["tag:server"]},
  "nodekey:c":{"DNSName":"aula-otra.tail1.ts.net.","UserID":5,"TailscaleIPs":["100.64.0.3"],"Online":true},
  "nodekey:d":{"DNSName":"aula-rara.tail1.ts.net.","UserID":"id:1","TailscaleIPs":["100.64.0.4"],"Online":true},
  "nodekey:e":{"DNSName":"aula-tags.tail1.ts.net.","UserID":123456789012,"TailscaleIPs":["100.64.0.5"],"Online":true,"Tags":"tag:x"},
  "nodekey:f":{"DNSName":"aula-casa.tail1.ts.net.","UserID":123456789012,"AltSharerUserID":0,"TailscaleIPs":["100.64.0.6"],"Online":false,"ShareeNode":false}
 }}
"""
if let st = try? JSONDecoder().decode(IPNStatus.self, from: Data(json.utf8)) {
    let got = findAulas(st.Peer, me: st.Self)
    check(got.aulas == [AulaPeer(host: "aula-mac", online: true), AulaPeer(host: "aula-casa", online: false)],
          "del JSON del nodo: solo las suyas, y un campo raro no rompe el resto: \(got.aulas.map(\.host))")
} else {
    check(false, "el JSON del nodo se lee")
}

if failures > 0 {
    print("\(failures) FALLOS")
    exit(1)
}
