import Foundation

// La línea de tiempo que usa Audio.swift, con la misma forma que la de Story.swift del v3 (Beat, Timeline, BarKind,
// Chapter, Change…), pero leída de una hoja JSON (la escribe timeline.ts desde la hoja de efectos del montaje, o es
// v3.timeline.json para la película del v3). También lleva los instantes que el Audio.swift original tenía escritos a
// mano para su película: clics, campanitas del arranque, ola de iconos, notas del cierre, fundidos y tramo de nivel.

typealias D = Double

enum Beat {
    static var bpm: D = 100
    static var beat: D { 60 / bpm }
    static var bar: D { beat * 4 }
}

enum Timeline {
    static var duration: D = 0
    static func bar(_ n: D) -> D { n * Beat.bar }

    struct Chapter { let n: Int; let bar: Int; let dark: Bool; let textAt: D }
    static var chapters: [Chapter] = []

    struct Change { let t0: D; let t1: D; let toDark: Bool }
    static var changes: [Change] = []
    static func dark(at t: D) -> Bool { var d = false; for c in changes where t >= c.t1 { d = c.toDark }; return d }

    static var meet: D = 0, logo: D = 0

    enum BarKind: String { case intro, meet, card, day, night, dusk, outro }
    static var kinds: [BarKind] = []
    static func barKind(_ b: Int) -> BarKind {
        if b >= 0 && b < kinds.count { return kinds[b] }
        return b >= musicBars ? .outro : .day
    }

    /// Golpes que la música subraya (clics, mensajes, etiquetas…) y cortes de plano (aire que crece hasta el corte).
    static var accents: [D] = []
    static var cuts: [D] = []

    // ── lo que en el Audio.swift original eran números escritos a mano ──
    /// Compases de la progresión (64 en el v3) y compás del icono final (60): la música rítmica va de `meetBar` a
    /// `musicBars − 1`, que calla en su segunda mitad antes del golpe del logo.
    static var bars = 64
    static var musicBars = 60
    /// Compás de «Meet Aula» (3 en el v3).
    static var meetBar = 3
    /// Desde cuándo suenan los acentos (7,5 en el v3) y cuándo empieza a crecer el arranque (5,8 en el v3).
    static var accentsFrom: D = 7.5
    static var introSwell: D = 5.8
    /// Campanitas en las palabras del arranque: (segundo, nota MIDI).
    static var hookWords: [(D, D)] = []
    /// Clics del puntero.
    static var clicks: [D] = []
    /// Inicio de cada ola de iconos (arpegio de 14 notas).
    static var iconWaves: [D] = []
    /// Notas de marimba del cierre: (segundo, nota MIDI).
    static var outroMallets: [(D, D)] = []
    /// Tramo con ritmo donde se nivela la mezcla, y fundido final (desde, hasta).
    static var levelWindow: (D, D) = (24, 140)
    static var fadeOut: (D, D) = (150.4, 153.8)

    /// Lee la hoja (JSON). Los errores dicen qué campo falta.
    static func load(path: String) throws {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        guard let j = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw err("no es un objeto JSON") }
        func num(_ k: String) throws -> D { guard let v = j[k] as? NSNumber else { throw err("falta «\(k)» (número)") }; return v.doubleValue }
        func nums(_ k: String) throws -> [D] { guard let v = j[k] as? [NSNumber] else { throw err("falta «\(k)» (lista de números)") }; return v.map { $0.doubleValue } }
        func pairs(_ k: String) throws -> [(D, D)] {
            guard let v = j[k] as? [[NSNumber]] else { throw err("falta «\(k)» (lista de pares)") }
            return try v.map { p in guard p.count == 2 else { throw err("«\(k)»: cada elemento es [segundo, nota]") }; return (p[0].doubleValue, p[1].doubleValue) }
        }
        Beat.bpm = try num("bpm")
        duration = try num("duration")
        bars = Int(try num("bars"))
        musicBars = Int(try num("musicBars"))
        meetBar = Int(try num("meetBar"))
        meet = try num("meet")
        logo = try num("logo")
        accentsFrom = try num("accentsFrom")
        introSwell = try num("introSwell")
        guard let ks = j["kinds"] as? [String] else { throw err("falta «kinds» (un tipo por compás)") }
        kinds = try ks.map { s in guard let k = BarKind(rawValue: s) else { throw err("tipo de compás desconocido «\(s)»") }; return k }
        guard let cs = j["chapters"] as? [[String: Any]] else { throw err("falta «chapters»") }
        chapters = cs.map { c in
            Chapter(n: (c["n"] as? NSNumber)?.intValue ?? 0, bar: (c["bar"] as? NSNumber)?.intValue ?? 0, dark: (c["dark"] as? Bool) ?? false, textAt: (c["textAt"] as? NSNumber)?.doubleValue ?? 0)
        }
        guard let ch = j["changes"] as? [[String: Any]] else { throw err("falta «changes»") }
        changes = ch.map { c in Change(t0: (c["t0"] as? NSNumber)?.doubleValue ?? 0, t1: (c["t1"] as? NSNumber)?.doubleValue ?? 0, toDark: (c["toDark"] as? Bool) ?? false) }
        accents = try nums("accents")
        cuts = try nums("cuts")
        clicks = try nums("clicks")
        iconWaves = try nums("iconWaves")
        hookWords = try pairs("hookWords")
        outroMallets = try pairs("outroMallets")
        let lw = try nums("levelWindow"), fo = try nums("fadeOut")
        guard lw.count == 2, fo.count == 2 else { throw err("levelWindow y fadeOut son [desde, hasta]") }
        levelWindow = (lw[0], lw[1])
        fadeOut = (fo[0], fo[1])
        // lo que el Audio.swift original da por hecho
        guard meetBar >= 1 && meetBar <= 3 else { throw err("meetBar debe estar entre 1 y 3 (la intro tiene a lo sumo 3 acordes: Bm – G – A)") }
        guard musicBars > meetBar + 2 && musicBars <= bars else { throw err("musicBars fuera de rango") }
        guard kinds.count >= bars else { throw err("kinds necesita al menos \(bars) compases") }
        guard levelWindow.1 - levelWindow.0 >= 4, levelWindow.1 * 1 <= duration else { throw err("levelWindow debe durar ≥ 4 s y caber en el vídeo") }
    }

    private static func err(_ m: String) -> NSError { NSError(domain: "timeline", code: 1, userInfo: [NSLocalizedDescriptionKey: "línea de tiempo: \(m)"]) }
}
