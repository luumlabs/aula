// Arranca en este Mac el mismo nodo de Tailscale que lleva la app de iPhone/iPad (TailnetController + TailscaleKit +
// libtailscale con los registros apagados) y comprueba que llega a pedir el inicio de sesión (o a conectarse, si la
// carpeta de estado ya tiene sesión). Lo compila y lanza ../verify.sh; el estado va a AULA_TAILSCALE_DIR.
import Foundation

setvbuf(stdout, nil, _IONBF, 0)
TailnetEvents.shared.set { event in
    if case .status(let s) = event { print("estado: \(s.state.rawValue)\(s.authURL != nil ? " (con dirección para iniciar sesión)" : "")") }
}
let controller = TailnetController.shared
do {
    let snap = try await controller.start(StartOptions(hostname: "aula-verify", authKey: nil, controlURL: nil, verbose: false))
    switch snap.state {
    case .needsLogin:
        guard let url = snap.authURL, url.hasPrefix("https://login.tailscale.com/") else { print("FAIL  pide iniciar sesión pero sin dirección de Tailscale"); exit(1) }
        print("PASS  el nodo arranca y pide iniciar sesión en login.tailscale.com")
    case .running:
        print("PASS  el nodo arranca y se conecta (\(snap.hostname ?? "?")); Mac de Aula: \(snap.macHost ?? "no encontrado")\(snap.macOnline ? " (en línea)" : "")")
        // el túnel local: con la cookie llega hasta Aula en el Mac y responde su /health
        if let mac = snap.macHost, snap.macOnline {
            let ep = try await controller.connect(host: mac, port: 80)
            var req = URLRequest(url: URL(string: "http://127.0.0.1:\(ep.port)/health")!)
            req.setValue("\(TunnelGate.cookie)=\(ep.secret)", forHTTPHeaderField: "Cookie")
            req.timeoutInterval = 20
            let (data, _) = try await URLSession(configuration: .ephemeral).data(for: req)
            let ok = String(decoding: data, as: UTF8.self).contains("\"app\":\"aula\"")
            print("\(ok ? "PASS" : "FAIL")  /health de Aula por el túnel: \(String(decoding: data.prefix(120), as: UTF8.self))")
            if !ok { exit(1) }
        }
    default:
        print("FAIL  estado inesperado: \(snap.state.rawValue) \(snap.message ?? "")")
        exit(1)
    }
} catch {
    print("FAIL  \(error.localizedDescription)")
    exit(1)
}
await controller.stop()
print("PASS  el nodo se para limpio")
exit(0)
