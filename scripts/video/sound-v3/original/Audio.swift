import Foundation

// Banda sonora ORIGINAL sintetizada aquí mismo (nada grabado ni descargado): pad cálido, marimba de FM con eco, bajo
// suave, pulso de bombo, shaker, barridos de aire en los cortes y una campana con «boom» para el icono. 96 BPM, en re mayor.
// La estructura sigue a Timeline (mismos compases que la imagen). Mezcla: reverb Freeverb, limitador con anticipación,
// techo de -1,6 dBFS (el pico real tras AAC se mide al final y debe quedar por debajo de -1 dBTP).

final class Soundtrack {
    let sr: Double = 48_000
    let n: Int
    // buses
    var padL: [Float], padR: [Float], keysL: [Float], keysR: [Float], lowL: [Float], lowR: [Float]
    var drumsL: [Float], drumsR: [Float], fxL: [Float], fxR: [Float], sendL: [Float], sendR: [Float]

    init(duration: Double) {
        n = Int(duration * 48_000) + 1
        let z = [Float](repeating: 0, count: n)
        padL = z; padR = z; keysL = z; keysR = z; lowL = z; lowR = z; drumsL = z; drumsR = z; fxL = z; fxR = z; sendL = z; sendR = z
    }

    static func hz(_ m: Double) -> Double { 440 * pow(2, (m - 69) / 12) }

    struct Chord { let pad: [Double]; let bass: Double; let arp: [Double] }
    static let chords: [String: Chord] = [
        "D": Chord(pad: [50, 57, 61, 64, 66], bass: 38, arp: [62, 66, 69, 73, 76]),
        "Bm": Chord(pad: [47, 54, 57, 61, 62], bass: 35, arp: [59, 62, 66, 69, 73]),
        "G": Chord(pad: [43, 50, 54, 57, 61], bass: 31, arp: [59, 62, 66, 67, 71]),
        "A": Chord(pad: [45, 52, 57, 59, 64], bass: 33, arp: [61, 64, 69, 71, 73]),
        "Em": Chord(pad: [40, 47, 50, 54, 55], bass: 40, arp: [59, 62, 66, 67, 71]),
        "D/F#": Chord(pad: [42, 50, 54, 57, 61], bass: 42, arp: [62, 66, 69, 73, 74]),
    ]
    /// Un acorde por compás (64 compases de 2,4 s), según lo que pasa en la imagen: intro en suspenso, re al llegar Aula, el día
    /// (re – si menor – sol – la), la noche (si menor – sol – re – la), cartelas en suspenso (sol / mi menor) y el acorde final.
    static let bars = 64
    static let progression: [String] = (0..<bars).map { b in
        switch Timeline.barKind(b) {
        case .intro: return ["Bm", "G", "A"][b]
        case .meet: return "D"
        case .outro: return "D"
        case .card:
            let next = Timeline.barKind(b + 1)
            return next == .night ? "Em" : "G"
        case .dusk: return "A"
        case .night:
            var i = 0; var k = b - 1
            while k >= 0, Timeline.barKind(k) == .night { i += 1; k -= 1 }
            return ["Bm", "G", "D", "A"][i % 4]
        case .day:
            if b == 59 { return "A" }
            var i = 0; var k = b - 1
            while k >= 0, Timeline.barKind(k) == .day { i += 1; k -= 1 }
            return ["D", "Bm", "G", "A"][i % 4]
        }
    }

    // MARK: Utilidades

    @inline(__always) func idx(_ t: Double) -> Int { Int(t * sr) }

    /// Suma una señal generada muestra a muestra en un bus estéreo con paneo (-1…1) y envío a reverb.
    func add(_ L: inout [Float], _ R: inout [Float], from t0: Double, dur: Double, pan: Double = 0, send: Double = 0, _ gen: (Double) -> Double) {
        let i0 = max(0, idx(t0)), i1 = min(n, idx(t0 + dur))
        guard i1 > i0 else { return }
        let gl = Float(cos((pan + 1) * .pi / 4)), gr = Float(sin((pan + 1) * .pi / 4))
        let s = Float(send)
        for i in i0..<i1 {
            let v = Float(gen(max(0, Double(i) / sr - t0)))
            L[i] += v * gl; R[i] += v * gr
            if s > 0 { sendL[i] += v * gl * s; sendR[i] += v * gr * s }
        }
    }

    // MARK: Instrumentos

    /// Pad: sierras con PolyBLEP algo desafinadas (las escalas de grises de un coro de cuerdas sintético).
    func pad(note: Double, t0: Double, dur: Double, attack: Double, release: Double, amp: Double, pan: Double) {
        let f = Soundtrack.hz(note)
        let det = [0.9965, 1.0, 1.0042]
        var ph = [0.13, 0.57, 0.81].map { $0 }
        let total = dur + release
        let srv = sr
        for (side, p) in [(-1.0, pan), (1.0, pan)].enumerated() {
            _ = p
            ph = side == 0 ? [0.13, 0.57, 0.81] : [0.42, 0.05, 0.66]
            let pn = side == 0 ? -0.55 : 0.55
            add(&padL, &padR, from: t0, dur: total, pan: max(-1, min(1, pan + pn)), send: 0.42) { t in
                var s = 0.0
                for k in 0..<3 {
                    let inc = f * det[(k + side) % 3] / srv
                    ph[k] += inc; if ph[k] >= 1 { ph[k] -= 1 }
                    // sierra con PolyBLEP
                    var v = 2 * ph[k] - 1
                    let tt = ph[k]
                    if tt < inc { let x = tt / inc; v -= x + x - x * x - 1 }
                    else if tt > 1 - inc { let x = (tt - 1) / inc; v -= x * x + x + x + 1 }
                    s += v
                }
                let env: Double
                if t < attack { env = sin(.pi / 2 * t / attack) }
                else if t < dur { env = 1 }
                else { env = max(0, cos(.pi / 2 * min(1, (t - dur) / release))) }
                return s / 3 * env * amp * 0.155
            }
        }
    }

    /// Marimba de FM (portadora + moduladora 4:1 con índice que cae) y un parcial de vidrio.
    func mallet(note: Double, t0: Double, vel: Double, pan: Double, send: Double = 0.38, decay: Double = 0.55, bright: Double = 1) {
        let f = Soundtrack.hz(note)
        let len = min(3.2, decay * 6)
        add(&keysL, &keysR, from: t0, dur: len, pan: pan, send: send) { t in
            let idx = (1.9 * exp(-t / 0.07) + 0.12) * bright
            let m = sin(2 * .pi * f * 4 * t)
            let c = sin(2 * .pi * f * t + idx * m)
            let g = sin(2 * .pi * f * 2.0 * t + 0.6 * m * exp(-t / 0.04)) * exp(-t / 0.16) * 0.22
            let a = t < 0.002 ? t / 0.002 : exp(-t / decay)
            return (c + g) * a * vel * 0.39
        }
    }

    /// Campana (FM inarmónica) para el icono.
    func bell(note: Double, t0: Double, vel: Double, pan: Double) {
        let f = Soundtrack.hz(note)
        add(&keysL, &keysR, from: t0, dur: 6, pan: pan, send: 0.65) { t in
            let idx = 3.2 * exp(-t / 0.9) + 0.3
            let c = sin(2 * .pi * f * t + idx * sin(2 * .pi * f * 3.5 * t))
            let a = (t < 0.003 ? t / 0.003 : 1) * exp(-t / 1.9)
            return c * a * vel * 0.32
        }
    }

    func kick(_ t0: Double, vel: Double) {
        add(&drumsL, &drumsR, from: t0, dur: 0.6, send: 0.03) { t in
            let f = 46 + 80 * exp(-t / 0.035)
            let ph = 2 * .pi * (46 * t + 80 * 0.035 * (1 - exp(-t / 0.035)))
            _ = f
            let body = sin(ph) * exp(-t / 0.26)
            return body * vel * 0.5 * (t < 0.003 ? t / 0.003 : 1)
        }
    }

    var noiseSeed: UInt64 = 0x1234_5678
    @inline(__always) func noise() -> Double {
        noiseSeed = noiseSeed &* 6364136223846793005 &+ 1442695040888963407
        return Double(Int64(bitPattern: noiseSeed >> 1) % 2_000_000) / 1_000_000 - 1
    }

    func shaker(_ t0: Double, vel: Double, pan: Double) {
        var hp = 0.0, prev = 0.0
        add(&drumsL, &drumsR, from: t0, dur: 0.12, pan: pan, send: 0.08) { t in
            let x = self.noise()
            hp = 0.86 * (hp + x - prev); prev = x                     // paso alto ~ 6 kHz
            let a = (t < 0.004 ? t / 0.004 : exp(-(t - 0.004) / 0.035))
            return hp * a * vel * 0.12
        }
    }

    /// Filtro de estado variable estable (TPT): devuelve la salida paso banda.
    struct BandPass {
        var ic1 = 0.0, ic2 = 0.0
        mutating func run(_ x: Double, fc: Double, q: Double, sr: Double) -> Double {
            let g = tan(.pi * min(fc, sr * 0.45) / sr), k = 1 / q
            let a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2
            let v3 = x - ic2
            let v1 = a1 * ic1 + a2 * v3
            let v2 = ic2 + a2 * ic1 + a3 * v3
            ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2
            return v1
        }
    }

    /// Golpe suave de «rim» (ruido en banda de ~1,8 kHz).
    func rim(_ t0: Double, vel: Double) {
        var bp = BandPass()
        let srv = sr
        add(&drumsL, &drumsR, from: t0, dur: 0.25, pan: -0.1, send: 0.25) { t in
            let y = bp.run(self.noise(), fc: 1800, q: 1.6, sr: srv)
            return y * exp(-t / 0.05) * vel * 0.3
        }
    }

    /// Aire que crece hasta un corte (ruido con filtro de banda que sube).
    func whoosh(endingAt t1: Double, dur: Double, vel: Double, send: Double = 0.45, down: Bool = false) {
        for (side, pan) in [(0, -0.6), (1, 0.6)] {
            var bp = BandPass()
            let srv = sr
            add(&fxL, &fxR, from: t1 - dur, dur: dur + 0.25, pan: pan, send: send) { t in
                let p = min(1, t / dur)
                let fcHz = 250 * pow(28, down ? 1 - p : p) * (side == 0 ? 1 : 1.12)
                let y = bp.run(self.noise(), fc: fcHz, q: 1.2, sr: srv)
                let a = down ? (t < dur ? sin(.pi * p) : 0) : (t < dur ? pow(p, 2.2) : exp(-(t - dur) / 0.05))
                return y * a * vel * 0.8
            }
        }
    }

    /// Golpe grave para el icono.
    func boom(_ t0: Double, vel: Double) {
        add(&lowL, &lowR, from: t0, dur: 3.5, send: 0.25) { t in
            let ph = 2 * .pi * (55 * t + 60 * 0.08 * (1 - exp(-t / 0.08)))
            return sin(ph) * exp(-t / 1.1) * vel * 0.55 * (t < 0.004 ? t / 0.004 : 1)
        }
    }

    // MARK: Composición

    func compose() {
        let bar = Beat.bar, beat = Beat.beat, e8 = beat / 2
        let prog = Soundtrack.progression
        let B = Soundtrack.bars
        func kind(_ b: Int) -> Timeline.BarKind { Timeline.barKind(b) }
        func isNight(_ b: Int) -> Bool { kind(b) == .night }
        // Pad: un acorde por compás (el grave lo lleva el bajo)
        for b in 0..<60 {
            let ch = Soundtrack.chords[prog[b]]!
            let t0 = Double(b) * bar
            let k = kind(b)
            let amp: Double = k == .intro ? 0.85 : (k == .card ? 1.0 : (isNight(b) ? 0.78 : 0.88))
            for (i, m0) in ch.pad.enumerated() {
                let m = m0 < 48 ? m0 + 12 : m0
                pad(note: m, t0: max(0, t0 - 0.12), dur: bar + 0.1, attack: k == .intro || k == .card ? 1.0 : 0.45, release: 1.5, amp: amp * (i == 0 ? 1.0 : 0.8), pan: Double(i - 2) * 0.12)
            }
        }
        // acorde final (re mayor con novena) desde el golpe del icono
        for (i, m) in [50.0, 57, 61, 64, 66, 69, 73].enumerated() {
            pad(note: m, t0: Timeline.logo, dur: 6.5, attack: 0.08, release: 3.4, amp: i == 0 ? 0.6 : 0.95, pan: Double(i - 3) * 0.1)
        }
        // Campanitas en las palabras del arranque
        for (i, (t, m)) in [(1.2, 76.0), (1.8, 78), (2.4, 81), (3.0, 85), (4.8, 73), (5.1, 78)].enumerated() {
            mallet(note: m, t0: t, vel: 0.7, pan: i % 2 == 0 ? -0.3 : 0.3, send: 0.6, decay: 0.9)
        }
        // Marimba en corcheas (de noche una octava abajo; en las cartelas, solo un arpegio lento)
        let pattern = [0, 2, 4, 2, 1, 3, 4, 3]
        for b in 3..<60 {
            let ch = Soundtrack.chords[prog[b]]!
            let k = kind(b)
            for s8 in 0..<8 {
                let t = Double(b) * bar + Double(s8) * e8
                if b == 59 && s8 >= 6 { continue }                  // silencio antes del icono
                if b == 3 && s8 == 0 { continue }                    // la campana de «Meet Aula» ya suena
                if k == .card && s8 % 2 == 1 { continue }            // cartela: la mitad de notas
                if k == .dusk && s8 % 4 != 0 { continue }            // anochece: casi nada
                let shift = isNight(b) ? -12.0 : (b >= 57 ? 12.0 : 0)
                let note = ch.arp[pattern[(s8 + b) % 8]] + shift
                var vel = s8 % 2 == 0 ? 0.62 : 0.42
                if b < 6 { vel *= 0.75 }
                if k == .card { vel *= 0.7 }
                if isNight(b) { vel *= 0.9 }
                if s8 == 0 { vel *= 1.2 }
                mallet(note: note, t0: t, vel: vel, pan: s8 % 2 == 0 ? -0.28 : 0.28, send: k == .card ? 0.6 : 0.38, decay: isNight(b) ? 0.55 : (k == .card ? 0.9 : 0.45),
                       bright: isNight(b) ? 0.75 : (b >= 54 ? 1.15 : 0.95))
            }
        }
        // Destellos: clics, mensajes del chat, etiquetas
        for t in Timeline.accents where t >= 7.5 {
            mallet(note: [88, 90, 93, 95, 97][Int(t * 8) % 5], t0: t, vel: 0.42, pan: 0.2, send: 0.7, decay: 0.7, bright: 1.4)
        }
        // un clic suave en cada pulsación del puntero
        for t in [16.2, 90.7, 92.55, 97.1, 106.7, 124.0, 126.3] {
            add(&drumsL, &drumsR, from: t, dur: 0.05, pan: 0.15, send: 0.1) { x in sin(2 * .pi * 2400 * x) * exp(-x / 0.006) * 0.25 }
        }
        // los iconos pixel-art: un arpegio que sube como una ola
        for i in 0..<14 { mallet(note: [74.0, 78, 81, 85, 86, 90, 93, 97, 98, 102, 105, 109, 110, 114][i] - 12, t0: 137.05 + Double(i) * 0.065, vel: 0.32, pan: Double(i - 7) * 0.08, send: 0.5, decay: 0.35, bright: 1.3) }
        // campanas: «Meet Aula», cada cartela, el amanecer con la marca
        bell(note: 74, t0: Timeline.meet, vel: 0.65, pan: -0.1)
        bell(note: 81, t0: Timeline.meet + 0.02, vel: 0.35, pan: 0.15)
        for c in Timeline.chapters {
            let t0 = Timeline.bar(Double(c.bar)) + c.textAt
            bell(note: c.dark ? 71 : 78, t0: t0, vel: 0.42, pan: 0.1)
            bell(note: c.dark ? 78 : 85, t0: t0 + 0.02, vel: 0.22, pan: -0.15)
        }
        // Bajo: notas largas en intro, cartelas y al anochecer; pulso en corcheas el resto
        for b in 3..<60 {
            let ch = Soundtrack.chords[prog[b]]!
            let f = Soundtrack.hz(ch.bass + 12)
            let t0 = Double(b) * bar
            let k = kind(b)
            if b < 5 || k == .card || k == .dusk {
                let len = bar + 0.3
                add(&lowL, &lowR, from: t0, dur: len) { t in
                    let env = min(1, t / 0.12) * (t > bar ? max(0, 1 - (t - bar) / 0.3) : 1)
                    return (sin(2 * .pi * f * t) + 0.18 * sin(4 * .pi * f * t)) * env * 0.26
                }
            } else {
                for s8 in 0..<8 {
                    if b == 59 && s8 >= 6 { continue }
                    let ts = t0 + Double(s8) * e8
                    add(&lowL, &lowR, from: ts, dur: e8 + 0.05) { t in
                        let env = min(1, t / 0.012) * exp(-t / 0.22) * (t > e8 ? max(0, 1 - (t - e8) / 0.05) : 1)
                        return (sin(2 * .pi * f * t) + 0.25 * sin(4 * .pi * f * t)) * env * 0.31
                    }
                }
            }
        }
        // Bombo, shaker y rim
        for b in 3..<60 {
            let t0 = Double(b) * bar
            let k = kind(b)
            switch k {
            case .meet: kick(t0, vel: 0.5)
            case .card, .dusk: kick(t0, vel: 0.55)
            default:
                kick(t0, vel: 0.75)
                if b != 59 { kick(t0 + 2 * beat, vel: 0.62) }
            }
            if k == .day || k == .night {
                for s8 in 0..<8 where !(b == 59 && s8 >= 6) { shaker(t0 + Double(s8) * e8, vel: s8 % 2 == 1 ? 0.9 : 0.45, pan: 0.35) }
                rim(t0 + beat, vel: 0.55); if b != 59 { rim(t0 + 3 * beat, vel: 0.65) }
            }
        }
        // Aire: los cortes, la llegada de Aula, cada cambio de luz y el icono
        whoosh(endingAt: Timeline.meet, dur: 1.8, vel: 0.5)
        for c in Timeline.cuts { whoosh(endingAt: c, dur: 0.6, vel: 0.13) }
        for c in Timeline.changes { whoosh(endingAt: c.t1, dur: c.t1 - c.t0 + 0.4, vel: 0.36, down: c.toDark) }
        whoosh(endingAt: Timeline.logo, dur: 2.0, vel: 0.42)
        boom(Timeline.logo, vel: 0.9)
        bell(note: 74, t0: Timeline.logo, vel: 0.9, pan: -0.15)
        bell(note: 81, t0: Timeline.logo + 0.015, vel: 0.6, pan: 0.2)
        bell(note: 86, t0: Timeline.logo + 0.03, vel: 0.35, pan: 0.05)
        for (t, m) in [(145.2, 81.0), (145.5, 78.0), (146.4, 85.0), (147.6, 81.0), (148.8, 86.0)] { mallet(note: m, t0: t, vel: 0.45, pan: 0, send: 0.75, decay: 1.0) }
        _ = B
    }

    // MARK: Mezcla

    /// Freeverb (Schroeder/Moorer): 8 filtros peine con amortiguación + 4 pasa-todo por canal.
    func reverb(_ inL: [Float], _ inR: [Float], room: Float = 0.86, damp: Float = 0.3) -> ([Float], [Float]) {
        let scale = sr / 44_100
        let combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map { Int(Double($0) * scale) }
        let alls = [556, 441, 341, 225].map { Int(Double($0) * scale) }
        func channel(_ x: [Float], spread: Int) -> [Float] {
            var out = [Float](repeating: 0, count: n)
            var bufs = combs.map { [Float](repeating: 0, count: $0 + spread) }
            var pos = [Int](repeating: 0, count: combs.count)
            var store = [Float](repeating: 0, count: combs.count)
            var abufs = alls.map { [Float](repeating: 0, count: $0 + spread) }
            var apos = [Int](repeating: 0, count: alls.count)
            for i in 0..<n {
                let inp = x[i] * 0.015
                var acc: Float = 0
                for c in 0..<combs.count {
                    let y = bufs[c][pos[c]]
                    store[c] = y * (1 - damp) + store[c] * damp
                    bufs[c][pos[c]] = inp + store[c] * room
                    pos[c] += 1; if pos[c] >= bufs[c].count { pos[c] = 0 }
                    acc += y
                }
                for a in 0..<alls.count {
                    let b = abufs[a][apos[a]]
                    let y = -acc + b
                    abufs[a][apos[a]] = acc + b * 0.5
                    apos[a] += 1; if apos[a] >= abufs[a].count { apos[a] = 0 }
                    acc = y
                }
                out[i] = acc
            }
            return out
        }
        return (channel(inL, spread: 0), channel(inR, spread: 23))
    }

    /// Eco ping-pong (corchea con puntillo) con filtro en la realimentación.
    func pingPong(_ L: inout [Float], _ R: inout [Float], time: Double, feedback: Float, wet: Float) {
        let d = Int(time * sr)
        var bl = [Float](repeating: 0, count: d), br = [Float](repeating: 0, count: d)
        var p = 0
        var lpL: Float = 0, lpR: Float = 0
        for i in 0..<n {
            let yl = bl[p], yr = br[p]
            lpL += 0.45 * (yl - lpL); lpR += 0.45 * (yr - lpR)
            bl[p] = (L[i] + R[i]) * 0.5 + lpR * feedback
            br[p] = lpL * feedback
            L[i] += yl * wet; R[i] += yr * wet
            p += 1; if p >= d { p = 0 }
        }
    }

    /// Filtro paso bajo de 2 polos (SVF) con frecuencia de corte que cambia con el tiempo.
    func lowpass(_ x: inout [Float], cutoff: (Double) -> Double, q: Double = 0.7) {
        var ic1 = 0.0, ic2 = 0.0
        for i in 0..<n {
            if i % 32 == 0 { _ = 0 }
            let fc = cutoff(Double(i) / sr)
            let g = tan(.pi * min(fc, sr * 0.45) / sr), k = 1 / q
            let a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2
            let v0 = Double(x[i])
            let v3 = v0 - ic2
            let v1 = a1 * ic1 + a2 * v3
            let v2 = ic2 + a2 * ic1 + a3 * v3
            ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2
            x[i] = Float(v2)
        }
    }

    /// Renderiza la banda sonora completa (estéreo intercalado, float) y devuelve picos/RMS para el informe.
    func render() -> (samples: [Float], peakDB: Double, rmsDB: Double) {
        compose()
        if ProcessInfo.processInfo.environment["AULA_AUDIO_DEBUG"] != nil {
            for (name, b) in [("padL", padL), ("keysL", keysL), ("lowL", lowL), ("drumsL", drumsL), ("fxL", fxL), ("sendL", sendL)] {
                let firstNaN = b.firstIndex { !$0.isFinite }
                print(name, "nan at", firstNaN.map { Double($0) / sr } ?? -1, "max", b.map { abs($0) }.filter { $0.isFinite }.max() ?? 0)
            }
        }
        // el pad se abre con la historia: oscuro al principio, brillante en el cierre
        // el pad se abre de día y se cierra de noche (con rampas en cada cambio de luz)
        let cut: (Double) -> Double = { t in
            if t < 7.2 { return 700 + 700 * t / 7.2 }
            if t >= 144 { return 2600 - 1400 * min(1, (t - 144) / 9) }
            func level(_ dark: Bool) -> Double { dark ? 780 : 2050 }
            if let c = Timeline.changes.first(where: { t >= $0.t0 && t < $0.t1 }) {
                let p = (t - c.t0) / (c.t1 - c.t0)
                return level(!c.toDark) + (level(c.toDark) - level(!c.toDark)) * p
            }
            return level(Timeline.dark(at: t))
        }
        lowpass(&padL, cutoff: cut); lowpass(&padR, cutoff: cut)
        pingPong(&keysL, &keysR, time: Beat.beat * 0.75, feedback: 0.34, wet: 0.3)
        var (rvL, rvR) = reverb(sendL, sendR)
        // cada bus a su nivel (RMS en el tramo con ritmo, 25–50 s): mezcla estable aunque cambien los instrumentos
        func rms(_ L: [Float], _ R: [Float], _ a: Double, _ b: Double) -> Double {
            var acc = 0.0
            let i0 = Int(a * sr), i1 = min(n, Int(b * sr))
            for i in i0..<i1 { acc += Double(L[i] * L[i] + R[i] * R[i]) }
            return sqrt(acc / Double(max(1, 2 * (i1 - i0))))
        }
        func peak(_ L: [Float], _ R: [Float]) -> Double { Double(max(L.map { abs($0) }.max() ?? 0, R.map { abs($0) }.max() ?? 0)) }
        func level(_ L: inout [Float], _ R: inout [Float], rmsDB target: Double, name: String) {
            let r = rms(L, R, lv0, lv1)
            guard r > 1e-9 else { return }
            let g = Float(pow(10, target / 20) / r)
            for i in 0..<n { L[i] *= g; R[i] *= g }
            if ProcessInfo.processInfo.environment["AULA_AUDIO_DEBUG"] != nil { print(String(format: "  %@: %.1f dB → %.1f dB", name, 20 * log10(r), target)) }
        }
        let lv0 = 24.0, lv1 = 140.0
        level(&padL, &padR, rmsDB: -21, name: "pad")
        level(&keysL, &keysR, rmsDB: -20, name: "marimba")
        level(&lowL, &lowR, rmsDB: -21, name: "bajo")
        level(&drumsL, &drumsR, rmsDB: -24, name: "percusión")
        level(&rvL, &rvR, rmsDB: -26, name: "reverb")
        let fxPeak = peak(fxL, fxR)
        if fxPeak > 0 { let g = Float(pow(10, -13.0 / 20) / fxPeak); for i in 0..<n { fxL[i] *= g; fxR[i] *= g } }
        var L = [Float](repeating: 0, count: n), R = [Float](repeating: 0, count: n)
        for i in 0..<n {
            L[i] = padL[i] + keysL[i] + lowL[i] + drumsL[i] + fxL[i] + rvL[i]
            R[i] = padR[i] + keysR[i] + lowR[i] + drumsR[i] + fxR[i] + rvR[i]
        }
        // dinámica de la historia: el arranque más íntimo (-6 dB) y crece hasta «Meet Aula»
        for i in 0..<min(n, Int(7.2 * sr)) {
            let t = Double(i) / sr
            let db = t < 5.8 ? -6.0 : -6.0 + 6.0 * (t - 5.8) / 1.4
            let g = Float(pow(10, db / 20))
            L[i] *= g; R[i] *= g
        }
        // quitar continua (paso alto ~20 Hz)
        var pl: Float = 0, pr: Float = 0, yl: Float = 0, yr: Float = 0
        let a: Float = 0.9974
        for i in 0..<n { let xl = L[i], xr = R[i]; yl = a * (yl + xl - pl); yr = a * (yr + xr - pr); pl = xl; pr = xr; L[i] = yl; R[i] = yr }
        // fundidos
        let fin = Int(1.2 * sr), fout0 = Int(150.4 * sr), fout1 = min(n, Int(153.8 * sr))
        for i in 0..<n {
            var g: Float = 1
            if i < fin { g = Float(sin(.pi / 2 * Double(i) / Double(fin))) }
            if i >= fout0 { g *= i >= fout1 ? 0 : Float(cos(.pi / 2 * Double(i - fout0) / Double(fout1 - fout0))) }
            L[i] *= g; R[i] *= g
        }
        // nivel: RMS del tramo con ritmo a ~ -17 dBFS
        var acc = 0.0, cnt = 0
        for i in Int(24 * sr)..<Int(140 * sr) { acc += Double(L[i] * L[i] + R[i] * R[i]); cnt += 2 }
        let rms = sqrt(acc / Double(max(cnt, 1)))
        let gain = Float(pow(10, -17.0 / 20) / max(rms, 1e-6))
        for i in 0..<n { L[i] *= gain; R[i] *= gain }
        // limitador con anticipación (5 ms) y techo de -1,6 dBFS
        let ceiling = Float(pow(10, -1.6 / 20))
        let look = Int(0.005 * sr)
        var env: Float = 1
        let rel = Float(exp(-1 / (0.08 * sr)))
        var peaks = [Float](repeating: 0, count: n)
        for i in 0..<n { peaks[i] = max(abs(L[i]), abs(R[i])) }
        // máximo en la ventana [i, i+look]
        var win = [Float](repeating: 0, count: n)
        var dq: [Int] = []; dq.reserveCapacity(look + 2)
        var head = 0
        for i in stride(from: n - 1, through: 0, by: -1) {
            while dq.count > head, peaks[dq.last!] <= peaks[i] { dq.removeLast() }
            dq.append(i)
            while dq.count > head, dq[head] > i + look { head += 1 }
            win[i] = peaks[dq[head]]
            if head > 4096 { dq.removeFirst(head); head = 0 }
        }
        var out = [Float](repeating: 0, count: 2 * n)
        var peak: Float = 0
        for i in 0..<n {
            let need: Float = win[i] > ceiling ? ceiling / win[i] : 1
            env = need < env ? need : min(need, 1 - (1 - env) * rel)
            let l = L[i] * env, r = R[i] * env
            out[2 * i] = l; out[2 * i + 1] = r
            peak = max(peak, max(abs(l), abs(r)))
        }
        var acc2 = 0.0
        for i in Int(24 * sr)..<Int(140 * sr) { acc2 += Double(out[2 * i] * out[2 * i] + out[2 * i + 1] * out[2 * i + 1]) }
        let rmsOut = sqrt(acc2 / Double(Int(116 * sr) * 2))
        return (out, 20 * log10(Double(peak)), 20 * log10(rmsOut))
    }
}

/// Pico real (4× sobremuestreo con sinc enventanada) de una señal estéreo intercalada.
func truePeakDB(_ x: [Float]) -> Double {
    let taps = 16
    var kernels: [[Float]] = []
    for ph in 1..<4 {
        let frac = Double(ph) / 4
        var k = [Float](repeating: 0, count: 2 * taps)
        for j in 0..<(2 * taps) {
            let d = Double(j - taps + 1) - frac
            let sinc = d == 0 ? 1 : sin(.pi * d) / (.pi * d)
            let w = 0.5 * (1 + cos(.pi * d / Double(taps)))
            k[j] = Float(sinc * w)
        }
        kernels.append(k)
    }
    let frames = x.count / 2
    var peak: Float = 0
    // audio vacío o más corto que el filtro: el rango sería inválido (taps..<negativo) y el motor se cerraba
    guard frames > 2 * taps else { return 20 * log10(Double(max(x.map(abs).max() ?? 0, 1e-9))) }
    for ch in 0..<2 {
        for i in taps..<(frames - taps) {
            let v = abs(x[2 * i + ch]); if v > peak { peak = v }
            for k in kernels {
                var s: Float = 0
                for j in 0..<(2 * taps) { s += x[2 * (i - taps + 1 + j) + ch] * k[j] }
                if abs(s) > peak { peak = abs(s) }
            }
        }
    }
    return 20 * log10(Double(max(peak, 1e-9)))
}
