// Lo que la app sabe en cada momento: en qué punto está la conexión con la Aula del estudiante (en su Mac o en su servidor)
// y qué enseñar. Si en su red hay más de una Aula, pregunta cuál abrir y lo recuerda.
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
    /// Conectado a la red, pero no hay ninguna Aula en ella.
    case lookingForMac
    /// Hay más de una Aula en la red (un Mac y un servidor, dos Macs…): el estudiante elige cuál abrir.
    case choosing([AulaPeer])
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
    /// La Aula que se abre («aula-mac», «aula-server»), para decirlo en pantalla.
    private(set) var macName: String?
    /// La Aula elegida la última vez (si hay varias en la red).
    private static let chosenKey = "aula.host"
    private var chosen: String? {
        get { UserDefaults.standard.string(forKey: Self.chosenKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.chosenKey) }
    }
    /// Se está preguntando si cerrar la sesión de Tailscale.
    var askingSignOut = false
    /// Se está enseñando dónde descargar Aula para Mac.
    var showingMacInfo = false
    /// Se están enseñando las licencias.
    var showingLicenses = false
    /// La página de inicio de sesión de Tailscale, abierta dentro de la app. Se cierra sola cuando el nodo conecta.
    var signInPage: URL?
    /// La demostración está abierta (la interfaz la sirve la propia app, sin Mac).
    private(set) var inDemo = false
    /// La interfaz enseña ella misma el aviso de la demostración (window.aulaApp.demoNotice): la franja nativa sobra.
    private(set) var pageShowsDemoNotice = false
    /// La demostración con su barra de aviso. Solo las capturas del App Store (compilación de depuración, con el
    /// argumento «-AulaStoreShots») la enseñan sin ella, como se ve Aula conectada al Mac.
    var showsDemoBar: Bool {
        #if DEBUG
        return inDemo && !pageShowsDemoNotice && !StoreShots.on
        #else
        return inDemo && !pageShowsDemoNotice
        #endif
    }
    /// El tema de Aula (Ajustes → Apariencia) cuando no es el del sistema: true oscuro, false claro, nil el del sistema.
    /// Las pantallas de espera lo siguen. Se recuerda para que la app arranque ya con él.
    private(set) var pageDark: Bool? = AppModel.savedPageDark
    /// Lo que dice la página ahora (oscura o clara); nil hasta que lo diga.
    private(set) var lookDark: Bool?
    /// Cómo se pinta lo nativo (la hora y la batería, la franja de la demostración, las pantallas de espera): con la
    /// interfaz a la vista, siempre como ella (nunca «el del sistema» a ciegas: si el sistema cambiaba con el tema de Aula
    /// impuesto, la franja quedaba con los colores del otro tema sobre la página); si no, el tema guardado de Aula.
    var chromeDark: Bool? {
        if case .ready = stage, let lookDark { return lookDark }
        return pageDark
    }
    /// El color de arriba de la página («#rrggbb»): la franja de la demostración se pinta igual.
    private(set) var pageTop: String?
    private static let themeKey = "aula.theme"
    private static var savedPageDark: Bool? {
        switch UserDefaults.standard.string(forKey: themeKey) {
        case "dark": return true
        case "light": return false
        default: return nil
        }
    }
    /// La hoja de conexión. Las capturas del App Store no la enseñan mientras se abre la demostración (solo el papel).
    var showsConnectScreen: Bool {
        #if DEBUG
        if StoreShots.on, case .starting = stage { return false }
        #endif
        return true
    }
    private var demo: DemoServer?

    /// ¿Esta copia de la app trae la demostración? (scripts/dev/ios-demo.mjs la graba antes de archivar).
    let demoArchive: DemoArchive? = AppModel.loadDemoArchive()

    nonisolated private static func loadDemoArchive() -> DemoArchive? {
        #if DEBUG
        // capturas del App Store: una grabación que no va dentro de la app (Preview-*.aulademo, en Documents)
        if let url = StoreShots.archive {
            let archive = DemoArchive(url: url)
            if archive == nil { NSLog("[Aula] -AulaDemo: no se pudo leer %@", url.path) }
            return archive
        }
        #endif
        return Bundle.main.url(forResource: "Demo", withExtension: "aulademo").flatMap { DemoArchive(url: $0) }
    }

    private let controller = TailnetController.shared
    private var started = false
    /// Cada intento de abrir una Aula lleva el número de `attempt` de cuando empezó. Cuando el estudiante cambia de rumbo
    /// (elige otra, vuelve a la lista, abre la demostración, cierra sesión) el número sube, y lo que acabe un intento viejo
    /// se descarta: no pisa la pantalla nueva ni vuelve a intentar con la Aula de antes.
    private var attempt = 0
    /// El intento que está abriendo ahora (dos a la vez del mismo no tienen sentido).
    private var openingFor: Int?
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
        #if DEBUG
        // capturas del App Store: la demostración sola y sin Tailscale (ni aviso de red local ni pantalla de conexión)
        if StoreShots.on { return await startDemo() }
        #endif
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

    /// La Aula que toca abrir: la elegida si sigue en la red; si solo hay una, esa; si hay varias sin elegir, ninguna (se
    /// pregunta).
    private func target(_ snap: TailnetSnapshot) -> String? {
        if let c = chosen, snap.aulas.contains(where: { $0.host == c }) { return c }
        return snap.aulas.count == 1 ? snap.aulas[0].host : nil
    }

    private func apply(_ snap: TailnetSnapshot) async {
        last = snap
        macName = target(snap) ?? snap.macHost
        // sesión iniciada (o a falta de que la aprueben): la página de inicio de sesión ya no hace falta
        if snap.state == .running || snap.state == .needsMachineAuth { signInPage = nil }
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
            // eligiendo: la lista se pone al día, sin decidir por el estudiante (si se queda vacía, ya no hay qué elegir)
            if case .choosing = stage {
                stage = snap.aulas.isEmpty ? .lookingForMac : .choosing(snap.aulas)
                return
            }
            await openMac(force: false)
        }
    }

    /// Busca la Aula del Mac y, si responde, abre su interfaz por el túnel local.
    private func openMac(force: Bool) async {
        guard !inDemo, openingFor != attempt, last.state == .running else { return }
        if !force, case .ready = stage { return }
        guard let mac = target(last) else {
            stage = last.aulas.count > 1 ? .choosing(last.aulas) : .lookingForMac
            return
        }
        let gen = attempt
        macName = mac
        openingFor = gen
        defer { if openingFor == gen { openingFor = nil } }
        // tras cada espera: si el estudiante cambió de rumbo mientras tanto, esto ya no vale
        do {
            let endpoint = try await controller.connect(host: mac, port: 80)
            guard gen == attempt else { return }
            let answers = await Self.isAula(port: endpoint.port, secret: endpoint.secret)
            guard gen == attempt else { return }
            guard answers else {
                stage = .macUnreachable
                scheduleRetry()
                return
            }
            await Self.setGateCookie(endpoint.secret)
            guard gen == attempt else { return }
            retry?.cancel()
            stage = .ready(URL(string: "http://127.0.0.1:\(endpoint.port)")!)
        } catch {
            guard gen == attempt else { return }
            stage = .macUnreachable
            scheduleRetry()
        }
    }

    /// El estudiante cambió de rumbo: el intento en marcha queda viejo (su resultado se descarta) y se deja de reintentar.
    private func supersede() {
        attempt += 1
        retry?.cancel()
        retry = nil
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

    /// El estudiante eligió qué Aula abrir: se recuerda para la próxima vez. Se abre esa aunque otra se estuviera abriendo.
    func choose(_ host: String) async {
        supersede()
        chosen = host
        macName = host
        stage = .starting
        await openMac(force: true)
    }

    /// «Abrir otra Aula» (desde la interfaz o desde una pantalla de espera): vuelve a la lista.
    func chooseAnother() {
        guard !inDemo, last.state == .running else { return }
        supersede()
        stage = last.aulas.isEmpty ? .lookingForMac : .choosing(last.aulas)
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
        #if DEBUG
        // capturas del App Store: la demostración no se vuelve a abrir (al arrancar se abriría dos veces, y una navegación
        // de la primera página, por el puerto viejo, acabaría en Safari)
        if StoreShots.on { return }
        #endif
        // iOS pudo quitarle el puerto a la demostración mientras la app estaba suspendida: se abre en otro
        if inDemo { await startDemo() }
        await controller.applicationWillEnterForeground()
        if case .ready = stage { await openMac(force: true) }
    }

    /// Cierra la sesión de Tailscale de este dispositivo y borra lo que la interfaz guardó aquí.
    func signOut() async {
        supersede()
        stage = .starting
        await controller.logout()
        let store = WKWebsiteDataStore.default()
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
        await startNode()
    }

    // MARK: Cómo se ve la página

    /// La página dijo cómo se ve (o el sistema cambió de claro a oscuro). Si su tema es el del sistema, la app sigue al
    /// sistema; si no, al de Aula: así la hora y la batería se leen sobre la página.
    func pageLook(_ look: PageLook, systemDark: Bool) {
        pageTop = look.top
        if lookDark != look.dark { lookDark = look.dark }
        let next: Bool? = look.dark == systemDark ? nil : look.dark
        guard next != pageDark else { return }
        pageDark = next
        UserDefaults.standard.set(next.map { $0 ? "dark" : "light" }, forKey: Self.themeKey)
    }

    /// La interfaz enseña (o deja de enseñar) su propio aviso de la demostración.
    func demoNotice(_ on: Bool) {
        pageShowsDemoNotice = inDemo && on
    }

    // MARK: La demostración

    /// Abre la demostración: el curso de ejemplo, servido por la propia app.
    func startDemo() async {
        guard let demoArchive else { return }
        demo?.stop()
        #if DEBUG
        // capturas: una pregunta que no es la grabada recibe el texto grabado (la respuesta del tutor), no el aviso
        let chatReply = StoreShots.on ? "" : Texts.demoChatReply
        let route = StoreShots.routeFragment
        #else
        let chatReply = Texts.demoChatReply
        let route: String? = nil
        #endif
        let server = DemoServer(archive: demoArchive, unavailable: Texts.demoUnavailable, chatReply: chatReply)
        do {
            let port = try await server.start()
            demo = server
            inDemo = true
            // lo que se estuviera abriendo de la red ya no pinta nada sobre la demostración
            supersede()
            // «demo=1»: la interfaz usa sus datos de ejemplo donde el Mac daría los del estudiante; el fragmento, la
            // pantalla en la que arranca (solo las capturas lo ponen)
            var address = URLComponents(string: "http://127.0.0.1:\(port)/?demo=1")!
            address.percentEncodedFragment = route
            stage = .ready(address.url!)
        } catch {
            server.stop()
            demo = nil
            inDemo = false
            stage = .failed(error.localizedDescription)
        }
    }

    /// Sale de la demostración y vuelve a donde estaba la conexión con el Mac.
    func exitDemo() async {
        guard inDemo else { return }
        pageShowsDemoNotice = false
        pageTop = nil
        lookDark = nil
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
