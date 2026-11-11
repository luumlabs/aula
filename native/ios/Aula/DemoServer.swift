// La demostración: Aula sin un Mac. La app lleva dentro un archivo grabado desde la app real con el curso de ejemplo
// (scripts/dev/ios-demo.mjs → Demo.aulademo): la interfaz, sus archivos y lo que el Mac contestó a cada llamada durante
// un recorrido por las pantallas. Este servidor lo sirve en 127.0.0.1 con las mismas rutas que el Mac (`/`, `/rpc`,
// `/events`…), así que la vista web no nota la diferencia. Nada se guarda y nada sale del dispositivo.
// Solo Foundation y Network: se prueba en macOS (native/ios/_verify/DemoTest).
import Foundation
import Network

/// El archivo grabado: «AULADEMO1\n» · longitud del índice (uint32 BE) · índice JSON · datos.
struct DemoArchive: @unchecked Sendable {
    struct File: Decodable {
        let offset: Int
        let length: Int
        let type: String

        init(from decoder: Decoder) throws {
            var c = try decoder.unkeyedContainer()
            offset = try c.decode(Int.self)
            length = try c.decode(Int.self)
            type = try c.decode(String.self)
        }
    }

    struct Event: Decodable {
        /// Milisegundos después de la llamada que lo provocó.
        let after: Int
        let line: String
    }

    struct Index: Decodable {
        /// El día de la grabación (AAAA-MM-DD, hora local de quien grabó).
        let day: String
        let csp: String
        let files: [String: File]
        /// Cuerpo de la llamada (tal como lo manda la interfaz) → [desde, largo] de la respuesta.
        let rpc: [String: [Int]]
        /// Método → el cuerpo de su última llamada grabada: lo que se contesta a una llamada que no se grabó tal cual.
        let fallback: [String: String]
        /// Cuerpo de la llamada → los eventos que el Mac mandó después (el chat).
        let events: [String: [Event]]
    }

    static let magic = Data("AULADEMO1\n".utf8)
    let index: Index
    private let data: Data
    private let base: Int

    init?(url: URL) {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe), data.count > Self.magic.count + 4, data.prefix(Self.magic.count) == Self.magic else { return nil }
        let at = Self.magic.count
        let length = data[at ..< at + 4].reduce(0) { ($0 << 8) | Int($1) }
        guard length > 0, at + 4 + length <= data.count, let index = try? JSONDecoder().decode(Index.self, from: data.subdata(in: at + 4 ..< at + 4 + length)) else { return nil }
        self.data = data
        self.index = index
        base = at + 4 + length
    }

    func bytes(_ offset: Int, _ length: Int) -> Data? {
        guard offset >= 0, length >= 0, base + offset + length <= data.count else { return nil }
        return data.subdata(in: base + offset ..< base + offset + length)
    }

    func text(_ range: [Int]) -> String? {
        guard range.count == 2, let d = bytes(range[0], range[1]) else { return nil }
        return String(decoding: d, as: UTF8.self)
    }
}

/// Las fechas del ejemplo se desplazan al día de hoy: lo grabado un martes con un examen «dentro de 20 días» sigue
/// teniéndolo dentro de 20 días cuando se abre meses después.
enum DemoDates {
    private static let pattern = try! NSRegularExpression(pattern: "(?<![0-9])(20[0-9]{2})-([0-9]{2})-([0-9]{2})(?![0-9])")
    private static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    /// Días enteros entre el día grabado («AAAA-MM-DD») y hoy, en el calendario local.
    static func days(since recorded: String, now: Date = Date(), calendar: Calendar = .current) -> Int {
        let parts = recorded.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let then = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return 0 }
        return calendar.dateComponents([.day], from: calendar.startOfDay(for: then), to: calendar.startOfDay(for: now)).day ?? 0
    }

    /// Mueve `days` días cada fecha «AAAA-MM-DD» del texto (las de las horas ISO incluidas).
    static func shift(_ text: String, by days: Int) -> String {
        guard days != 0 else { return text }
        let ns = text as NSString
        let matches = pattern.matches(in: text, range: NSRange(location: 0, length: ns.length))
        guard !matches.isEmpty else { return text }
        let out = NSMutableString(capacity: ns.length)
        var last = 0
        for m in matches {
            out.append(ns.substring(with: NSRange(location: last, length: m.range.location - last)))
            last = m.range.location + m.range.length
            let y = Int(ns.substring(with: m.range(at: 1))) ?? 0
            let mo = Int(ns.substring(with: m.range(at: 2))) ?? 0
            let d = Int(ns.substring(with: m.range(at: 3))) ?? 0
            guard (1 ... 12).contains(mo), (1 ... 31).contains(d),
                  let date = utc.date(from: DateComponents(year: y, month: mo, day: d)),
                  let moved = utc.date(byAdding: .day, value: days, to: date) else {
                out.append(ns.substring(with: m.range))
                continue
            }
            let c = utc.dateComponents([.year, .month, .day], from: moved)
            out.append(String(format: "%04d-%02d-%02d", c.year ?? y, c.month ?? mo, c.day ?? d))
        }
        out.append(ns.substring(from: last))
        return out as String
    }
}

final class DemoServer: @unchecked Sendable {
    enum Failure: Error { case noPort }

    private let archive: DemoArchive
    /// Lo que se contesta a algo que la demostración no trae.
    private let unavailable: String
    /// Lo que dice Aula en el chat a una pregunta que no es la grabada (antes de enseñar su cuestionario de ejemplo).
    private let chatReply: String
    private let days: Int
    private let queue = DispatchQueue(label: "aula.demo.server", qos: .userInitiated)
    private var listener: NWListener?
    /// Las conexiones de eventos abiertas (una por vista web).
    private var streams: [ObjectIdentifier: NWConnection] = [:]
    private var beat: DispatchSourceTimer?

    static let maxRequest = 1 << 20

    init(archive: DemoArchive, unavailable: String, chatReply: String, now: Date = Date()) {
        self.archive = archive
        self.unavailable = unavailable
        self.chatReply = chatReply
        days = DemoDates.days(since: archive.index.day, now: now)
    }

    /// Empieza a escuchar en 127.0.0.1 (un puerto libre) y devuelve el puerto.
    func start() async throws -> UInt16 {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        let listener = try NWListener(using: params)
        return try await withCheckedThrowingContinuation { (done: CheckedContinuation<UInt16, Error>) in
            let once = Once()
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    guard once.take() else { return }
                    if let port = listener.port?.rawValue { done.resume(returning: port) } else { done.resume(throwing: Failure.noPort) }
                case .failed(let error):
                    self?.stop()
                    if once.take() { done.resume(throwing: error) }
                case .cancelled:
                    if once.take() { done.resume(throwing: Failure.noPort) }
                default:
                    break
                }
            }
            listener.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
            self.queue.async { [weak self] in
                guard let self else { return }
                self.listener = listener
                // una línea vacía cada poco mantiene abiertas las conexiones de eventos
                let beat = DispatchSource.makeTimerSource(queue: self.queue)
                beat.schedule(deadline: .now() + 20, repeating: 20)
                beat.setEventHandler { [weak self] in self?.broadcast("") }
                beat.resume()
                self.beat = beat
            }
            listener.start(queue: self.queue)
        }
    }

    func stop() {
        queue.async {
            self.beat?.cancel()
            self.beat = nil
            self.listener?.cancel()
            self.listener = nil
            for c in self.streams.values { c.cancel() }
            self.streams.removeAll()
        }
    }

    // MARK: Conexiones

    private func accept(_ conn: NWConnection) {
        conn.start(queue: queue)
        read(conn, Data())
    }

    private func read(_ conn: NWConnection, _ buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] chunk, _, finished, error in
            guard let self else { return conn.cancel() }
            var buffer = buffer
            if let chunk { buffer.append(chunk) }
            if let request = Request(buffer) {
                self.route(request, conn)
            } else if error != nil || finished || buffer.count > Self.maxRequest {
                conn.cancel()
            } else {
                self.read(conn, buffer)
            }
        }
    }

    /// Una petición HTTP entera (cabeceras y cuerpo); nil mientras falte algo por llegar.
    struct Request {
        let method: String
        let path: String
        let body: Data

        init?(_ data: Data) {
            guard let end = data.range(of: Data("\r\n\r\n".utf8)) else { return nil }
            let lines = String(decoding: data[data.startIndex ..< end.lowerBound], as: UTF8.self).split(whereSeparator: \.isNewline)
            guard let first = lines.first else { return nil }
            let parts = first.split(separator: " ")
            guard parts.count >= 2 else { return nil }
            var length = 0
            for line in lines.dropFirst() {
                let pair = line.split(separator: ":", maxSplits: 1)
                if pair.count == 2, pair[0].lowercased() == "content-length" { length = Int(pair[1].trimmingCharacters(in: .whitespaces)) ?? 0 }
            }
            guard length >= 0, data.distance(from: end.upperBound, to: data.endIndex) >= length else { return nil }
            method = String(parts[0])
            // sin la consulta («/?demo=1» es la misma página)
            path = String(parts[1].split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first ?? "/")
            body = data.subdata(in: end.upperBound ..< data.index(end.upperBound, offsetBy: length))
        }
    }

    // MARK: Rutas (las del servidor del Mac: src/main/electron/remote/server.ts)

    private func route(_ r: Request, _ conn: NWConnection) {
        switch (r.method, r.path) {
        case ("POST", "/rpc"):
            respond(conn, json: answer(String(decoding: r.body, as: UTF8.self)))
        case ("GET", "/events"):
            let head = "HTTP/1.1 200 OK\r\ncontent-type: application/x-ndjson; charset=utf-8\r\ncache-control: no-store\r\nconnection: close\r\n\r\n\n"
            let id = ObjectIdentifier(conn)
            streams[id] = conn
            conn.stateUpdateHandler = { [weak self] state in
                switch state {
                case .failed, .cancelled: self?.forget(id)
                default: break
                }
            }
            conn.send(content: Data(head.utf8), completion: .contentProcessed { [weak self] error in
                if error != nil { self?.streams[id] = nil; conn.cancel() }
            })
            // si la vista web cierra (cambia de página), la conexión se suelta
            watch(conn, id)
        case ("GET", "/health"):
            respond(conn, json: #"{"ok":true,"app":"aula","demo":true}"#)
        case ("PUT", _) where r.path.hasPrefix("/upload/"):
            respond(conn, json: #"{"ok":true}"#)
        case ("GET", _), ("HEAD", _):
            let path = r.path == "/index.html" ? "/" : r.path
            guard let file = archive.index.files[path], let data = archive.bytes(file.offset, file.length) else {
                return respond(conn, status: "404 Not Found", type: "application/json; charset=utf-8", body: Data(#"{"ok":false,"error":{"message":"not_found","code":"not_found"}}"#.utf8))
            }
            var extra = ["x-content-type-options: nosniff"]
            if path == "/", !archive.index.csp.isEmpty { extra.append("content-security-policy: \(archive.index.csp)") }
            extra.append(path.hasPrefix("/assets/") ? "cache-control: public, max-age=31536000, immutable" : "cache-control: no-store")
            respond(conn, status: "200 OK", type: file.type, body: r.method == "HEAD" ? Data() : data, length: data.count, extra: extra)
        default:
            respond(conn, status: "405 Method Not Allowed", type: "application/json; charset=utf-8", body: Data(#"{"ok":false,"error":{"message":"invalid_args","code":"invalid_args"}}"#.utf8))
        }
    }

    private func watch(_ conn: NWConnection, _ id: ObjectIdentifier) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1024) { [weak self] _, _, finished, error in
            guard let self else { return }
            if finished || error != nil {
                self.streams[id] = nil
                conn.cancel()
            } else {
                self.watch(conn, id)
            }
        }
    }

    private func respond(_ conn: NWConnection, json: String) {
        respond(conn, status: "200 OK", type: "application/json; charset=utf-8", body: Data(json.utf8), extra: ["cache-control: no-store"])
    }

    private func respond(_ conn: NWConnection, status: String, type: String, body: Data, length: Int? = nil, extra: [String] = []) {
        var head = "HTTP/1.1 \(status)\r\ncontent-type: \(type)\r\ncontent-length: \(length ?? body.count)\r\nconnection: close\r\n"
        for line in extra { head += line + "\r\n" }
        head += "\r\n"
        var out = Data(head.utf8)
        out.append(body)
        conn.send(content: out, isComplete: true, completion: .contentProcessed { _ in conn.cancel() })
    }

    // MARK: Lo que contestaría el Mac

    /// La respuesta grabada a esta llamada; si no se grabó tal cual, la última de ese método; si tampoco, un «no está».
    func answer(_ body: String) -> String {
        let key = DemoDates.shift(body, by: -days)
        var source = key
        var range = archive.index.rpc[key]
        if range == nil, let method = Self.call(body)?.method, let recorded = archive.index.fallback[method] {
            source = recorded
            range = archive.index.rpc[recorded]
        }
        guard let range, let recorded = archive.text(range) else {
            let message = (try? JSONSerialization.data(withJSONObject: [unavailable], options: [])).map { String(decoding: $0, as: UTF8.self).dropFirst().dropLast() } ?? "\"\""
            return #"{"ok":false,"error":{"message":"# + message + #","code":"demo"}}"#
        }
        // una llamada parecida a la grabada: lo que el estudiante mandó (su texto, el id de su mensaje) sustituye a lo grabado
        let swaps = source == key ? [] : Self.swaps(recorded: source, actual: key)
        let fit: (String) -> String = { text in
            DemoDates.shift(swaps.reduce(text) { $0.replacingOccurrences(of: $1.0, with: $1.1) }, by: self.days)
        }
        // una pregunta nueva en el chat: la respuesta grabada llega como un mensaje nuevo, y dice que esto es la demostración
        let fresh = source != key && Self.call(body)?.method == "chat.send" ? "demo-" + UUID().uuidString.prefix(8).lowercased() : nil
        for event in archive.index.events[source] ?? [] {
            let fitted = fit(event.line)
            let line = fresh.map { Self.asNewReply(fitted, id: $0, text: chatReply) } ?? fitted
            queue.asyncAfter(deadline: .now() + .milliseconds(max(0, event.after))) { [weak self] in self?.broadcast(line) }
        }
        return fit(recorded)
    }

    /// Un evento del chat grabado, como respuesta a otra pregunta: el mensaje de Aula con otro id (la interfaz lo añade en
    /// vez de tomarlo por el que ya tiene) y con el texto de la demostración. Lo demás (su tarjeta de ejemplo) se queda.
    static func asNewReply(_ line: String, id: String, text: String) -> String {
        guard var event = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
              var payload = event["payload"] as? [String: Any], var message = payload["message"] as? [String: Any],
              message["role"] as? String == "assistant" else { return line }
        message["id"] = id
        if let was = message["text"] as? String, !was.isEmpty { message["text"] = text }
        payload["message"] = message
        event["payload"] = payload
        guard let data = try? JSONSerialization.data(withJSONObject: event, options: [.withoutEscapingSlashes]) else { return line }
        return String(decoding: data, as: UTF8.self)
    }

    private static func call(_ body: String) -> (method: String, args: [String: Any])? {
        guard let o = try? JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any], let method = o["method"] as? String else { return nil }
        return (method, o["args"] as? [String: Any] ?? [:])
    }

    /// Los textos de la llamada grabada que en la de ahora son otros, como literales JSON (sin comillas): (grabado, de ahora).
    /// Solo los largos: un texto corto podría coincidir con otra cosa.
    static func swaps(recorded: String, actual: String) -> [(String, String)] {
        guard let then = call(recorded), let now = call(actual), then.method == now.method else { return [] }
        var out: [(String, String)] = []
        for (name, value) in then.args {
            guard let was = value as? String, let isNow = now.args[name] as? String, was != isNow, was.count >= 8, !isNow.isEmpty else { continue }
            guard let a = literal(was), let b = literal(isNow) else { continue }
            out.append((a, b))
        }
        // primero los más largos: un id que contiene a otro no se rompe a medias
        return out.sorted { $0.0.count > $1.0.count }
    }

    private static func literal(_ s: String) -> String? {
        guard let d = try? JSONSerialization.data(withJSONObject: [s], options: []) else { return nil }
        let text = String(decoding: d, as: UTF8.self)
        // [" … "] → lo de dentro de las comillas
        return String(text.dropFirst(2).dropLast(2))
    }

    private func broadcast(_ line: String) {
        let data = Data((line + "\n").utf8)
        for (id, conn) in streams {
            conn.send(content: data, completion: .contentProcessed { [weak self] error in
                if error != nil { self?.forget(id) }
            })
        }
    }

    /// Una conexión de eventos que se cerró (los avisos de Network ya llegan en la cola del servidor).
    private func forget(_ id: ObjectIdentifier) {
        streams[id] = nil
    }
}

/// «Solo una vez», entre hilos (la continuación de `start` no se puede reanudar dos veces).
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var used = false

    func take() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if used { return false }
        used = true
        return true
    }
}
