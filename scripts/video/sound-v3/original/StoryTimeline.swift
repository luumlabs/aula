// Extraído TAL CUAL de scripts/video/engine/Story.swift (y el typealias de Util.swift) del commit dfcb4e1 (el v3 del 13-10)
// del repositorio de la app Swift: solo Beat y Timeline, lo que usa Audio.swift. Sirve para la prueba de fidelidad.
import Foundation

typealias D = Double

enum Beat {
    static let bpm: D = 100
    static let beat: D = 60 / bpm            // 0,6
    static let bar: D = beat * 4             // 2,4
}

enum Timeline {
    static let duration: D = 154
    static func bar(_ n: D) -> D { n * Beat.bar }

    struct Chapter { let n: Int; let title: String; let sub: [String]; let bar: Int; let dark: Bool; let textAt: D }
    static let chapters: [Chapter] = [
        Chapter(n: 1, title: "Plan", sub: ["From an exam on your calendar", "to a finished course."], bar: 4, dark: false, textAt: 0.3),
        Chapter(n: 2, title: "Learn", sub: ["Lessons, practice and review", "that adapt to you."], bar: 11, dark: true, textAt: 0.3),
        Chapter(n: 3, title: "See it", sub: ["Visuals you can touch,", "for every subject."], bar: 18, dark: false, textAt: 1.45),
        Chapter(n: 4, title: "Ask", sub: ["Just talk to Aula."], bar: 33, dark: true, textAt: 0.85),
        Chapter(n: 5, title: "Always on", sub: ["Like a tutor who never leaves."], bar: 41, dark: false, textAt: 1.0),
        Chapter(n: 6, title: "Documents", sub: ["Real PDFs out.", "Your PDFs, explained."], bar: 48, dark: true, textAt: 0.75),
        Chapter(n: 7, title: "Everywhere", sub: ["Your platform, your Mac,", "your language."], bar: 53, dark: false, textAt: 0.85),
    ]

    enum Style { case edgeDown, sunrise, arch, horizon, diagonal }
    struct Change { let t0: D; let t1: D; let style: Style; let toDark: Bool }
    static let changes: [Change] = [
        Change(t0: 22.0, t1: 23.2, style: .edgeDown, toDark: true),
        Change(t0: 44.0, t1: 44.9, style: .sunrise, toDark: false),
        Change(t0: 79.3, t1: 80.4, style: .arch, toDark: true),
        Change(t0: 98.5, t1: 99.8, style: .horizon, toDark: false),
        Change(t0: 115.3, t1: 116.3, style: .diagonal, toDark: true),
        Change(t0: 127.3, t1: 128.4, style: .arch, toDark: false),
    ]
    static func dark(at t: D) -> Bool { var d = false; for c in changes where t >= c.t1 { d = c.toDark }; return d }

    static let meet: D = 7.2, logo: D = 144.0
    static let langStart: D = 139.8, langStep: D = Beat.beat / 2
    static let langOrder = ["es", "fr", "de", "it", "pt-BR", "ru", "ar", "hi", "zh-Hans", "ja", "ko", "en"]
    static let langNames = ["es": "Español", "fr": "Français", "de": "Deutsch", "it": "Italiano", "pt-BR": "Português", "ru": "Русский", "ar": "العربية",
                            "hi": "हिन्दी", "zh-Hans": "简体中文", "ja": "日本語", "ko": "한국어", "en": "English"]
    static let chatBeats: [D] = [82.2, 82.8, 83.4, 84.0, 84.6, 85.2]

    // Para la música
    enum BarKind { case intro, meet, card, day, night, dusk, outro }
    static func barKind(_ b: Int) -> BarKind {
        if b < 3 { return .intro }
        if b == 3 { return .meet }
        if chapters.contains(where: { $0.bar == b }) { return .card }
        if b >= 60 { return .outro }
        if b == 9 { return .dusk }
        if (10...17).contains(b) || (34...40).contains(b) || (49...52).contains(b) { return .night }
        return .day
    }
    /// Golpes que la música subraya (clics, mensajes, etiquetas…).
    static let accents: [D] = [1.2, 1.8, 2.4, 3.0, 4.8, 7.8, 16.2, 82.2, 82.8, 83.4, 84.0, 84.6, 85.2, 91.8, 97.4, 104.1, 106.7, 125.0, 134.4, 135.0, 135.6]
    static let cuts: [D] = [16.8, 19.2, 21.6, 24.0, 33.6, 38.4, 50.4, 55.2, 57.6, 60.0, 62.4, 64.8, 67.2, 69.6, 72.0, 74.4, 86.4, 88.8, 93.6, 96.0, 103.2, 108.0, 110.4, 122.4, 132.0, 136.8, 139.2]

    /// Teaser de ~1 min para la web: tramos del máster (en compases enteros, para que la música siga a tempo).
    static let teaser: [(D, D)] = [(0.0, 9.6), (12.0, 16.8), (21.6, 26.4), (33.6, 36.0), (45.6, 48.0), (55.2, 57.6), (60.0, 62.4),
                                   (81.6, 86.4), (103.2, 108.0), (117.6, 120.0), (139.2, 144.0), (144.0, 153.6)]
}
