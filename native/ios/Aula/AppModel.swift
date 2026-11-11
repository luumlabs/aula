// Lo que la app sabe en cada momento: en qué punto está la conexión con la Aula del Mac y qué enseñar.
import Foundation
import Observation
import WebKit
#if canImport(UIKit)
import UIKit
#endif

/// Por dónde va la conexión. Cada caso es una pantalla.
enum Stage: Equatable {
    /// Arrancando la red privada.
    case starting
    /// Falta iniciar sesión en Tailscale (una vez): la dirección la da el propio nodo.
    case signIn(URL)
    /// La red del estudiante exige aprobar este dispositivo en su panel.
    case waitingApproval
    /// Conectado a la red, pero no hay ningún Mac con Aula en ella.
    case lookingForMac
    /// El Mac está en la red pero Aula no responde (Mac dormido, Aula cerrada o el acceso apagado en Ajustes).
    case macUnreachable
    /// Todo listo: la interfaz de Aula, por el túnel local.
    case ready(URL)
    case failed(String)
}

@MainActor
@Observable
final class AppModel {
    private(set) var stage: Stage = .starting
    /// El Mac encontrado en la red («aula-mac»), para decirlo en pantalla.
    private(set) var macName: String?
    /// Se está preguntando si cerrar la sesión de Tailscale.
    var askingSignOut = false
    /// Se está enseñando dónde descargar Aula para Mac.
    var showingMacInfo = false
    /// La demostración está abierta (la interfaz la sirve la propia app, sin Mac).
    private(set) var inDemo = false
    private var demo: DemoServer?

    /// ¿Esta copia de la app trae la demostración? (scripts/dev/ios-demo.mjs la graba antes de archivar).
    let demoArchive: DemoArchive? = Bundle.main.url(forResource: "Demo", withExtension: "aulademo").flatMap { DemoArchive(url: $0) }

    private let controller = TailnetController.shared
    private var started = false
    private var opening = false
    private var retry: Task<Void, Never>?
    private var last = TailnetSnapshot.stopped

    /// Nombre de este dispositivo en la red privada.
    private var hostname: String {
        #if canImport(UIKit)
        return UIDevice.current.userInterfaceIdiom == .pad ? "aula-ipad" : "aula-iphone"
        #else
        return "aula-device"
        #endif
    }

    func start() async {
        guard !started else { return }
        started = true
        TailnetEvents.shared.set { [weak self] event in
            Task { @MainActor in self?.handle(event) }
        }
        await startNode()
    }

    private func startNode() async {
        stage = .starting
        do {
            let snap = try await controller.start(StartOptions(hostname: hostname, authKey: nil, controlURL: nil, verbose: false))
            await apply(snap)
        } catch let error as AulaTailscaleError {
            // sin respuesta a tiempo el nodo sigue intentándolo: los cambios de estado llegarán solos
            if case .timeout = error { return }
            stage = .failed(error.localizedDescription)
        } catch {
            stage = .failed(error.localizedDescription)
        }
    }

    private func handle(_ event: ControllerEvent) {
        switch event {
        case .status(let snap):
            Task { await apply(snap) }
        case .forwarderClosed:
            // el túnel local se quedó sin puerto: se pide otro (y la interfaz se recarga en él)
            Task { await openMac(force: true) }
        }
    }

    private func apply(_ snap: TailnetSnapshot) async {
        last = snap
        macName = snap.macHost
        // con la demostración abierta, la red privada sigue a lo suyo sin cambiar de pantalla
        if inDemo { return }
        switch snap.state {
        case .stopped, .starting:
            if case .ready = stage { return }
            stage = .starting
        case .needsLogin:
            if let text = snap.authURL, let url = URL(string: text), url.scheme == "https", url.host == "login.tailscale.com" {
                stage = .signIn(url)
            }
        case .needsMachineAuth:
            stage = .waitingApproval
        case .error:
            stage = .failed(snap.message ?? "Tailscale")
        case .running:
            if case .ready = stage { return }
            await openMac(force: false)
        }
    }

    /// Busca la Aula del Mac y, si responde, abre su interfaz por el túnel local.
    private func openMac(force: Bool) async {
        guard !inDemo, !opening, last.state == .running else { return }
        if !force, case .ready = stage { return }
        guard let mac = last.macHost else {
            stage = .lookingForMac
            return
        }
        opening = true
        defer { opening = false }
        do {
            let endpoint = try await controller.connect(host: mac, port: 80)
            guard await Self.isAula(port: endpoint.port, secret: endpoint.secret) else {
                stage = .macUnreachable
                scheduleRetry()
                return
            }
            await Self.setGateCookie(endpoint.secret)
            retry?.cancel()
            stage = .ready(URL(string: "http://127.0.0.1:\(endpoint.port)")!)
        } catch {
            stage = .macUnreachable
            scheduleRetry()
        }
    }

    /// Mientras el Mac no responda se vuelve a probar cada pocos segundos (se despierta, el estudiante abre Aula…).
    private func scheduleRetry() {
        retry?.cancel()
        retry = Task { [weak self] in
            try? await Task.sleep(for: .seconds(6))
            guard !Task.isCancelled, let self else { return }
            if self.stage == .macUnreachable { await self.openMac(force: false) }
        }
    }

    /// «Reintentar» de las pantallas de espera.
    func tryAgain() async {
        switch stage {
        case .failed:
            await controller.stop()
            await startNode()
        default:
            await openMac(force: true)
        }
    }

    /// La interfaz no cargó (el Mac se durmió, se cerró Aula): se vuelve a buscar.
    func webFailed() async {
        if inDemo { return await startDemo() }
        stage = .macUnreachable
        await openMac(force: true)
    }

    /// Al volver a la app: iOS pudo quitarle el puerto mientras estaba suspendida, así que se pide el túnel otra vez
    /// (si cambió de puerto, la interfaz se recarga en el nuevo, en la misma pantalla).
    func cameToForeground() async {
        guard started else { return }
        // iOS pudo quitarle el puerto a la demostración mientras la app estaba suspendida: se abre en otro
        if inDemo { await startDemo() }
        await controller.applicationWillEnterForeground()
        if case .ready = stage { await openMac(force: true) }
    }

    /// Cierra la sesión de Tailscale de este dispositivo y borra lo que la interfaz guardó aquí.
    func signOut() async {
        retry?.cancel()
        stage = .starting
        await controller.logout()
        let store = WKWebsiteDataStore.default()
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
        await startNode()
    }

    // MARK: La demostración

    /// Abre la demostración: el curso de ejemplo, servido por la propia app.
    func startDemo() async {
        guard let demoArchive else { return }
        demo?.stop()
        let server = DemoServer(archive: demoArchive, unavailable: Texts.demoUnavailable, chatReply: Texts.demoChatReply)
        do {
            let port = try await server.start()
            demo = server
            inDemo = true
            retry?.cancel()
            // «demo=1»: la interfaz usa sus datos de ejemplo donde el Mac daría los del estudiante
            stage = .ready(URL(string: "http://127.0.0.1:\(port)/?demo=1")!)
        } catch {
            server.stop()
            demo = nil
            inDemo = false
            stage = .failed(error.localizedDescription)
        }
    }

    /// Sale de la demostración y vuelve a donde estaba la conexión con el Mac.
    func exitDemo() async {
        demo?.stop()
        demo = nil
        inDemo = false
        stage = .starting
        await apply(last)
        if case .starting = stage, !started { await start() }
    }

    // MARK: El túnel local

    /// ¿Al otro lado del túnel responde Aula? (`/health` del servidor remoto del Mac).
    private static func isAula(port: UInt16, secret: String) async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/health?\(TunnelGate.parameter)=\(secret)") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        struct Health: Decodable { let app: String? }
        do {
            let (data, response) = try await URLSession(configuration: .ephemeral).data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return false }
            return (try? JSONDecoder().decode(Health.self, from: data))?.app == "aula"
        } catch {
            return false
        }
    }

    /// La llave del túnel, como cookie de 127.0.0.1: la vista web la manda sola en cada petición (páginas, datos, vídeo)
    /// y ninguna otra app del dispositivo la conoce. Solo dura lo que la sesión (cambia con cada puerto).
    private static func setGateCookie(_ secret: String) async {
        guard let cookie = HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: TunnelGate.cookie, .value: secret]) else { return }
        await WKWebsiteDataStore.default().httpCookieStore.setCookie(cookie)
    }
}
