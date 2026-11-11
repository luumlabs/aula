// Prueba del servidor de la demostración (Aula/DemoServer.swift) en macOS, contra el archivo grabado de verdad:
//   demo-test <ruta a Demo.aulademo>
import Foundation

final class Tally: @unchecked Sendable { var failures = 0 }
let tally = Tally()
func check(_ ok: Bool, _ what: String) {
    print((ok ? "PASS  " : "FAIL  ") + what)
    if !ok { tally.failures += 1 }
}

// fechas
check(DemoDates.shift(#"{"date":"2026-11-11T09:00:00.000Z","id":"x-20261111"}"#, by: 30) == #"{"date":"2026-12-11T09:00:00.000Z","id":"x-20261111"}"#, "las fechas se desplazan (y lo que no es fecha, no)")
check(DemoDates.shift("2026-12-31", by: 1) == "2027-01-01" && DemoDates.shift("2027-01-01", by: -1) == "2026-12-31", "el desplazamiento cruza de año, hacia delante y hacia atrás")
check(DemoDates.shift("2026-13-40 y 12026-01-011", by: 5) == "2026-13-40 y 12026-01-011", "lo que no es una fecha válida se deja como está")
var cal = Calendar(identifier: .gregorian)
cal.timeZone = TimeZone(identifier: "UTC")!
check(DemoDates.days(since: "2026-11-11", now: cal.date(from: DateComponents(year: 2026, month: 12, day: 1, hour: 15))!, calendar: cal) == 20, "cuenta los días desde la grabación")

guard CommandLine.arguments.count > 1, let archive = DemoArchive(url: URL(fileURLWithPath: CommandLine.arguments[1])) else {
    print("FAIL  no se pudo leer el archivo de la demostración")
    exit(1)
}
check(archive.index.files["/"] != nil && archive.index.files["/remote-bridge.js"] != nil, "el archivo trae la página y el puente (\(archive.index.files.count) archivos, \(archive.index.rpc.count) llamadas)")

// como si se abriera 40 días después de grabarlo
let later = Calendar.current.date(byAdding: .day, value: 40, to: Calendar.current.date(from: DateComponents(year: Int(archive.index.day.prefix(4)), month: Int(archive.index.day.dropFirst(5).prefix(2)), day: Int(archive.index.day.suffix(2))))!)!
let server = DemoServer(archive: archive, unavailable: "Not in the demo", chatReply: "Only a sample quiz in the demo", now: later)
let port = try await server.start()
check(port > 0, "escucha en 127.0.0.1:\(port)")
let base = "http://127.0.0.1:\(port)"
let session = URLSession(configuration: .ephemeral)

func get(_ path: String) async -> (Int, Data, HTTPURLResponse?) {
    guard let (data, res) = try? await session.data(from: URL(string: base + path)!) else { return (0, Data(), nil) }
    return ((res as? HTTPURLResponse)?.statusCode ?? 0, data, res as? HTTPURLResponse)
}
func rpc(_ body: String) async -> String {
    var req = URLRequest(url: URL(string: base + "/rpc")!)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "content-type")
    req.httpBody = Data(body.utf8)
    guard let (data, _) = try? await session.data(for: req) else { return "" }
    return String(decoding: data, as: UTF8.self)
}

let (pageStatus, page, pageRes) = await get("/?demo=1")
let html = String(decoding: page, as: UTF8.self)
check(pageStatus == 200 && html.contains("/remote-bridge.js") && html.contains("<div id=\"root\""), "sirve la página de la interfaz con el puente")
check((pageRes?.value(forHTTPHeaderField: "content-security-policy") ?? "").contains("default-src"), "con la política de seguridad del Mac")
let (bridgeStatus, bridge, _) = await get("/remote-bridge.js")
check(bridgeStatus == 200 && String(decoding: bridge, as: UTF8.self).contains("window.aula"), "sirve el puente")
let script = html.components(separatedBy: "src=\"").dropFirst().compactMap { $0.components(separatedBy: "\"").first }.first { $0.hasPrefix("/assets/") || $0.hasPrefix("./assets/") }
if let script {
    let (s, d, r) = await get(script.hasPrefix(".") ? String(script.dropFirst()) : script)
    check(s == 200 && d.count > 10_000 && (r?.value(forHTTPHeaderField: "content-type") ?? "").contains("javascript"), "sirve el programa de la interfaz (\(d.count / 1024) KB)")
} else {
    check(false, "la página nombra su programa")
}
let (missing, _, _) = await get("/assets/no-existe.js")
check(missing == 404, "lo que no está, 404")

// una llamada grabada tal cual (con las fechas de «hoy», 40 días después)
if let home = archive.index.fallback["home.summary"] {
    let answer = await rpc(DemoDates.shift(home, by: 40))
    check(answer.hasPrefix("{\"ok\":true"), "contesta a una llamada grabada")
    let recorded = archive.text(archive.index.rpc[home] ?? []) ?? ""
    check(answer == DemoDates.shift(recorded, by: 40) && (answer != recorded || !recorded.contains("20")), "con las fechas llevadas a hoy")
} else {
    check(false, "la grabación trae home.summary")
}
// una llamada del mismo método con otros argumentos: la última grabada
let other = await rpc(#"{"method":"courses.get","args":{"id":"otro-curso"}}"#)
check(other.hasPrefix("{\"ok\":true"), "a una llamada parecida le contesta la grabada de ese método")
let unknown = await rpc(#"{"method":"no.existe","args":null}"#)
check(unknown.contains("\"code\":\"demo\"") && unknown.contains("Not in the demo"), "a lo que no trae, un «no está en la demostración»")

// el chat: los eventos grabados llegan por /events, con el texto y el id del mensaje de ahora
if let sent = archive.index.fallback["chat.send"], let events = archive.index.events[sent], !events.isEmpty,
   let then = try? JSONSerialization.jsonObject(with: Data(sent.utf8)) as? [String: Any], var args = then["args"] as? [String: Any] {
    args["text"] = "¿Qué es un ángulo de referencia?"
    args["messageId"] = "mensaje-de-ahora-1234"
    let body = String(decoding: try! JSONSerialization.data(withJSONObject: ["method": "chat.send", "args": args]), as: UTF8.self)
    let (bytes, _) = try await session.bytes(from: URL(string: base + "/events")!)
    async let lines: [String] = {
        var got: [String] = []
        do {
            for try await line in bytes.lines where !line.isEmpty {
                got.append(line)
                if got.count >= events.count { break }
            }
        } catch { /* se cerró */ }
        return got
    }()
    try await Task.sleep(for: .milliseconds(300))
    let reply = await rpc(body)
    check(reply.hasPrefix("{\"ok\":true") && reply.contains("mensaje-de-ahora-1234"), "chat.send con otra pregunta: contesta, con el id del mensaje de ahora")
    let got = await lines
    let all = got.joined(separator: "\n")
    check(got.count == events.count, "llegan los \(events.count) eventos del chat")
    check(all.contains("\"event\":\"chat.message\"") && all.contains("\"role\":\"assistant\""), "y entre ellos, la respuesta de Aula")
    let recordedID = events.compactMap { e -> String? in
        guard let o = try? JSONSerialization.jsonObject(with: Data(e.line.utf8)) as? [String: Any], let m = (o["payload"] as? [String: Any])?["message"] as? [String: Any] else { return nil }
        return m["id"] as? String
    }.first ?? "?"
    check(all.contains("Only a sample quiz in the demo") && all.contains("\"id\":\"demo-") && !all.contains("\"id\":\"\(recordedID)\""), "como un mensaje nuevo que dice que es la demostración")
} else {
    check(false, "la grabación trae el chat con sus eventos")
}

server.stop()
print(tally.failures == 0 ? "ALL PASSED" : "\(tally.failures) FAILED")
exit(tally.failures == 0 ? 0 : 1)
