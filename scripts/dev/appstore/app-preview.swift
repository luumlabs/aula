// Monta una vista previa del App Store (App Preview) a partir de grabaciones del simulador, sin ffmpeg: AVFoundation +
// Core Image + Core Graphics, en una sola pasada. Coloca cada toma en su segundo de la salida, la remuestrea a 30 fps
// constantes, la escala y recorta al tamaño que acepta Apple, funde una toma con la anterior si se pide, pinta encima los
// rótulos (PNG con alfa a tamaño de cuadro, de store-art.mjs) y codifica H.264 High 4.0 + AAC-LC 256 kb/s estéreo a 48 kHz,
// con el moov delante.
//   xcrun swift -suppress-warnings scripts/dev/appstore/app-preview.swift <edl.json> <salida.mp4>
// Después: xcrun swift -suppress-warnings scripts/dev/appstore/preview-probe.swift <salida.mp4> iphone|ipad --duration 27
// (usa la API clásica de lectura y escritura, que el SDK de macOS 27 marca como obsoleta: de ahí -suppress-warnings)
//
// edl.json (rutas relativas a la carpeta del EDL; tiempos en segundos):
//   { "width": 886, "height": 1920, "fps": 30, "bitrate": 11000000, "rotate": 0, "duration": 27.0,
//     "clips": [ { "src": "takes/A.mov", "from": 1.2, "to": 6.0 },                       // sin «at»: detrás de la anterior
//                { "src": "takes/B.mov", "from": 0.5, "to": 4.9, "at": 4.3, "dissolveIn": 0.4 }, … ],
//     "overlays": [ { "png": "art/cap-1.png", "start": 0.0, "end": 4.35, "fade": 0.25 }, … ],  // en orden de pintado
//     "audio": "music/preview-27s.wav", "audioFadeOut": 1.5 }                           // sin «audio»: silencio
// · «at»: segundo de la salida en que empieza la toma. Si dos tomas se pisan, manda la que empieza después.
// · «dissolveIn»: fundido con la toma anterior durante esos segundos (la anterior tiene que seguir hasta at + dissolveIn).
// · «duration»: largo exacto de la salida. Ningún fotograma puede quedar sin toma (falla si hay un hueco).
// · Rótulos: entran y salen con su «fade», salvo el que empieza en 0 (ya está en el primer fotograma) y el que llega al
//   final (la cartela se queda hasta el último).
// · El audio (WAV a 48 kHz estéreo) tiene que durar exactamente «duration»; «audioFadeOut» lo apaga al final.
import AVFoundation
import CoreImage
import Foundation
import ImageIO

struct Clip: Decodable { let src: String; let from: Double; let to: Double; let at: Double?; let dissolveIn: Double? }
struct Overlay: Decodable { let png: String; let start: Double; let end: Double; let fade: Double }
struct EDL: Decodable {
    let width: Int; let height: Int; let fps: Int32; let bitrate: Int
    let rotate: Int?            // 90 / -90 si la grabación horizontal del iPad sale girada
    let duration: Double?
    let clips: [Clip]; let overlays: [Overlay]; let audio: String?; let audioFadeOut: Double?
}

func fail(_ m: String) -> Never { FileHandle.standardError.write(("✗ " + m + "\n").data(using: .utf8)!); exit(1) }
func warn(_ m: String) { FileHandle.standardError.write(("! " + m + "\n").data(using: .utf8)!) }

let argv = CommandLine.arguments
guard argv.count == 3 else { fail("uso: app-preview.swift <edl.json> <salida.mp4>") }
let base = URL(fileURLWithPath: argv[1]).deletingLastPathComponent()
let edl: EDL
do { edl = try JSONDecoder().decode(EDL.self, from: Data(contentsOf: URL(fileURLWithPath: argv[1]))) } catch { fail("EDL: \(error)") }
let W = edl.width, H = edl.height, fps = edl.fps
let frameDur = 1.0 / Double(fps)
let out = URL(fileURLWithPath: argv[2])
try? FileManager.default.removeItem(at: out)
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
let ci = CIContext(options: [.workingColorSpace: srgb, .outputColorSpace: srgb])

// ── La línea de tiempo: dónde cae cada toma en la salida ──────────────────────────────────────────────────────────────
struct Span { let clip: Clip; let index: Int; let start: Double; let end: Double }
var spans: [Span] = []
for (i, c) in edl.clips.enumerated() {
    guard c.to > c.from, c.from >= 0 else { fail("toma \(i + 1) (\(c.src)): «to» tiene que ser mayor que «from»") }
    let start = c.at ?? (spans.last?.end ?? 0)
    if let prev = spans.last, start < prev.start - 1e-6 { fail("toma \(i + 1): las tomas van en orden de «at»") }
    let span = Span(clip: c, index: i, start: start, end: start + (c.to - c.from))
    if let d = c.dissolveIn, d > 0 {
        guard let prev = spans.last else { fail("toma \(i + 1): «dissolveIn» sin toma anterior") }
        guard prev.end >= start + d - frameDur / 2 else {
            fail(String(format: "toma %d: el fundido de %.2f s necesita que la toma anterior siga hasta %.2f s (acaba en %.2f s)",
                        i + 1, d, start + d, prev.end))
        }
    }
    spans.append(span)
}
guard !spans.isEmpty else { fail("el EDL no tiene tomas") }
let contentEnd = spans.map(\.end).max()!
let durationS = edl.duration ?? contentEnd
let totalFrames = Int64((durationS * Double(fps)).rounded())
guard totalFrames > 0 else { fail("duración nula") }
if contentEnd > durationS + frameDur { warn(String(format: "las tomas siguen hasta %.2f s: se corta en %.2f s", contentEnd, durationS)) }
if durationS < 15 || durationS > 30 { warn(String(format: "%.2f s: Apple pide de 15 a 30 s", durationS)) }
let duration = CMTime(value: totalFrames * 1000, timescale: fps * 1000)

/// Las tomas que se ven en el instante t: la última que empezó y, si está fundiéndose, la anterior con su progreso.
func active(at t: Double) -> (cur: Span, prev: Span?, mix: Double)? {
    let live = spans.filter { t >= $0.start - 1e-6 && t < $0.end - 1e-6 }
    guard let cur = live.last else { return nil }
    if let d = cur.clip.dissolveIn, d > 0, t < cur.start + d - 1e-6, let prev = live.dropLast().last {
        // el primer fotograma del fundido ya lleva algo de la toma nueva y el último es solo la nueva
        return (cur, prev, min(1, (t - cur.start + frameDur) / d))
    }
    return (cur, nil, 1)
}
for n in 0..<totalFrames {
    let t = Double(n) / Double(fps)
    if active(at: t) == nil { fail(String(format: "hueco sin toma en %.3f s (fotograma %d)", t, n)) }
}

// ── El escritor: H.264 High 4.0, 30 fps constantes, BT.709; AAC-LC 256 kb/s, 48 kHz, estéreo ──────────────────────────
let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true // moov delante (faststart)
let video = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: W, AVVideoHeightKey: H,
    AVVideoColorPropertiesKey: [
        AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
        AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
        AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2
    ],
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: edl.bitrate,                  // Apple: objetivo 10–12 Mb/s
        AVVideoProfileLevelKey: AVVideoProfileLevelH264High40,  // Apple: hasta High Profile Level 4.0
        AVVideoH264EntropyModeKey: AVVideoH264EntropyModeCABAC,
        AVVideoExpectedSourceFrameRateKey: Int(fps),
        AVVideoMaxKeyFrameIntervalKey: Int(fps),                // un fotograma clave por segundo
        AVVideoAllowFrameReorderingKey: true
    ]
])
video.expectsMediaDataInRealTime = false
video.mediaTimeScale = fps * 1000
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: video, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H,
    kCVPixelBufferCGImageCompatibilityKey as String: true, kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
])
var stereo = AudioChannelLayout()
stereo.mChannelLayoutTag = kAudioChannelLayoutTag_Stereo
let audio = AVAssetWriterInput(mediaType: .audio, outputSettings: [
    AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 2,
    AVEncoderBitRateKey: 256_000, AVChannelLayoutKey: Data(bytes: &stereo, count: MemoryLayout<AudioChannelLayout>.size)
])
audio.expectsMediaDataInRealTime = false
writer.add(video)
writer.add(audio)

// ── Los rótulos: PNG del tamaño del cuadro, con alfa ───────────────────────────────────────────────────────────────────
let overlays: [(Overlay, CGImage)] = edl.overlays.map { o in
    guard let src = CGImageSourceCreateWithURL(base.appendingPathComponent(o.png) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil), img.width == W, img.height == H
    else { fail("rótulo \(o.png): falta o no mide \(W)×\(H)") }
    return (o, img)
}
/// Opacidad de un rótulo en t. Lo que empieza en 0 ya está en el primer fotograma y lo que llega al final se queda hasta
/// el último (la cartela): sin fundido en esos bordes.
func overlayAlpha(_ o: Overlay, _ t: Double) -> Double {
    guard t >= o.start, t < o.end else { return 0 }
    let f = max(o.fade, 1e-6)
    let fadeIn = o.start <= 0 ? 1 : (t - o.start) / f
    let fadeOut = o.end >= durationS - 1e-6 ? 1 : (o.end - t) / f
    return min(1, fadeIn, fadeOut)
}

// ── El audio: la música (WAV) o silencio, siempre una pista estéreo (sin pista de audio App Store Connect la rechaza) ──
// Se prepara entero ANTES (con su fundido de salida, en un WAV temporal) y se alimenta en su propia cola mientras se
// escribe el vídeo: AVAssetWriter intercala las pistas, y si se le da todo el vídeo primero, la entrada de vídeo deja de
// estar lista esperando al audio (se queda colgado).
let rate = 48_000.0
let need = AVAudioFrameCount((durationS * rate).rounded())
let fmt = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!
let pcm: AVAudioPCMBuffer
if let a = edl.audio {
    let file: AVAudioFile
    do { file = try AVAudioFile(forReading: base.appendingPathComponent(a)) } catch { fail("audio \(a): \(error.localizedDescription)") }
    let f = file.processingFormat
    guard f.sampleRate == rate, f.channelCount == 2 else { fail("audio \(a): tiene que ser de 48 kHz y estéreo (es de \(f.sampleRate) Hz y \(f.channelCount) canales)") }
    // un WAV que no dura lo mismo que el vídeo se corta o se queda corto sin avisar: mejor fallar aquí
    let have = AVAudioFrameCount(file.length)
    guard abs(Int64(have) - Int64(need)) <= 48 else {
        fail(String(format: "audio %@: dura %.3f s y el vídeo %.3f s", a, Double(have) / rate, durationS))
    }
    pcm = AVAudioPCMBuffer(pcmFormat: f, frameCapacity: have)!
    try file.read(into: pcm)
} else {
    pcm = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: need)!
    pcm.frameLength = need // a cero: silencio
}
if let fadeS = edl.audioFadeOut, fadeS > 0, let ch = pcm.floatChannelData {
    // coseno alzado: baja suave al empezar y llega a cero sin escalón en el último fotograma
    let len = Int(pcm.frameLength), fadeN = min(len, Int(fadeS * rate)), from = Int(need) - fadeN
    for i in max(0, from)..<len {
        let x = min(1, Double(i - from) / Double(max(1, fadeN)))
        let g = Float(0.5 * (1 + cos(Double.pi * x)))
        for c in 0..<Int(pcm.format.channelCount) { ch[c][i] *= g }
    }
}
let tmpWav = FileManager.default.temporaryDirectory.appendingPathComponent("aula-preview-\(ProcessInfo.processInfo.processIdentifier).wav")
do {
    // WAV flotante entrelazado (el formato de archivo); el búfer sigue en el de proceso
    let file = try AVAudioFile(forWriting: tmpWav, settings: [
        AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: rate, AVNumberOfChannelsKey: 2,
        AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false
    ], commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
    try file.write(from: pcm)
}
defer { try? FileManager.default.removeItem(at: tmpWav) }

guard writer.startWriting() else { fail("escritor: \(writer.error?.localizedDescription ?? "?")") }
writer.startSession(atSourceTime: .zero)

let aAsset = AVURLAsset(url: tmpWav)
guard let aTrack = try await aAsset.loadTracks(withMediaType: .audio).first else { fail("sin audio en el WAV temporal") }
let aReader = try AVAssetReader(asset: aAsset)
let aOut = AVAssetReaderTrackOutput(track: aTrack, outputSettings: [
    AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 2,
    AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false
])
aReader.add(aOut)
aReader.startReading()
let audioDone = DispatchSemaphore(value: 0)
var audioFinished = false
audio.requestMediaDataWhenReady(on: DispatchQueue(label: "aula.preview.audio")) {
    while audio.isReadyForMoreMediaData && !audioFinished {
        guard let s = aOut.copyNextSampleBuffer(), CMSampleBufferGetPresentationTimeStamp(s) < duration else {
            audioFinished = true
            audio.markAsFinished()
            aReader.cancelReading()
            audioDone.signal()
            return
        }
        audio.append(s)
    }
}

// ── Lectura de cada toma: el último fotograma con PTS ≤ el instante pedido (el simulador graba a ritmo variable) ────────
final class Cursor {
    let reader: AVAssetReader
    let output: AVAssetReaderTrackOutput
    var current: CVPixelBuffer?
    var next: CMSampleBuffer?
    let name: String
    init(_ clip: Clip) async throws {
        name = clip.src
        let asset = AVURLAsset(url: base.appendingPathComponent(clip.src))
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { fail("sin vídeo: \(clip.src)") }
        reader = try AVAssetReader(asset: asset)
        // desde un segundo antes: así hay fotograma aunque la pantalla no cambiara justo en «from»
        reader.timeRange = CMTimeRange(start: CMTime(seconds: max(0, clip.from - 1), preferredTimescale: 600),
                                       end: CMTime(seconds: clip.to + 0.1, preferredTimescale: 600))
        output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        output.alwaysCopiesSampleData = false
        reader.add(output)
        guard reader.startReading() else { fail("\(clip.src): \(reader.error?.localizedDescription ?? "no se puede leer")") }
        next = output.copyNextSampleBuffer()
    }
    func frame(at tSrc: Double) -> CVPixelBuffer {
        while let s = next, CMSampleBufferGetPresentationTimeStamp(s).seconds <= tSrc + 1e-4 {
            if let pb = CMSampleBufferGetImageBuffer(s) { current = pb }
            next = output.copyNextSampleBuffer()
        }
        guard let f = current else { fail("\(name): no hay fotograma antes de \(tSrc) s") }
        return f
    }
}
var cursors: [Int: Cursor] = [:]
@MainActor func cursor(_ s: Span) async throws -> Cursor {
    if let c = cursors[s.index] { return c }
    let c = try await Cursor(s.clip)
    cursors[s.index] = c
    return c
}

/// Escala al ancho (o alto) exacto y recorta lo que sobre por igual a los dos lados (19,5:9 → 886×1920 sobran 5–6 px).
func fitted(_ pb: CVPixelBuffer) -> CIImage {
    var img = CIImage(cvPixelBuffer: pb) // respeta el espacio de color que trae la grabación
    if let r = edl.rotate, r != 0 { img = img.oriented(r > 0 ? .right : .left) }
    let s = max(Double(W) / img.extent.width, Double(H) / img.extent.height)
    img = img.applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: s, kCIInputAspectRatioKey: 1])
    img = img.transformed(by: CGAffineTransform(translationX: -img.extent.minX - (img.extent.width - Double(W)) / 2,
                                                y: -img.extent.minY - (img.extent.height - Double(H)) / 2))
    return img.cropped(to: CGRect(x: 0, y: 0, width: W, height: H))
}

// ── Cada fotograma de salida ──────────────────────────────────────────────────────────────────────────────────────────
func wait(_ input: AVAssetWriterInput) { while !input.isReadyForMoreMediaData { usleep(2000) } }
var dissolves = 0
for n in 0..<totalFrames {
    let t = Double(n) / Double(fps)
    guard let a = active(at: t) else { fail("hueco en \(t) s") }
    let (cur, prev, mix) = a
    var img = fitted(try await cursor(cur).frame(at: cur.clip.from + (t - cur.start)))
    if let p = prev {
        let under = fitted(try await cursor(p).frame(at: p.clip.from + (t - p.start)))
        img = under.applyingFilter("CIDissolveTransition", parameters: [kCIInputTargetImageKey: img, kCIInputTimeKey: mix])
            .cropped(to: CGRect(x: 0, y: 0, width: W, height: H))
        dissolves += 1
    }
    // las tomas que ya acabaron sueltan su lector
    for s in spans where s.end <= t {
        guard let c = cursors[s.index] else { continue }
        c.reader.cancelReading()
        cursors[s.index] = nil
    }
    guard let pool = adaptor.pixelBufferPool else { fail("sin pool de píxeles") }
    var outBuf: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &outBuf)
    guard let dst = outBuf else { fail("sin búfer de salida") }
    ci.render(img, to: dst, bounds: CGRect(x: 0, y: 0, width: W, height: H), colorSpace: srgb)

    // rótulos encima, con su fundido, en el orden del EDL
    let live = overlays.filter { overlayAlpha($0.0, t) > 0 }
    if !live.isEmpty {
        CVPixelBufferLockBaseAddress(dst, [])
        let ctx = CGContext(data: CVPixelBufferGetBaseAddress(dst), width: W, height: H, bitsPerComponent: 8,
                            bytesPerRow: CVPixelBufferGetBytesPerRow(dst), space: srgb,
                            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
        for (o, png) in live {
            ctx.setAlpha(overlayAlpha(o, t))
            ctx.draw(png, in: CGRect(x: 0, y: 0, width: W, height: H))
        }
        CVPixelBufferUnlockBaseAddress(dst, [])
    }
    wait(video)
    guard adaptor.append(dst, withPresentationTime: CMTime(value: n * 1000, timescale: fps * 1000)) else {
        fail("append \(n): \(writer.error?.localizedDescription ?? "?")")
    }
}
for c in cursors.values { c.reader.cancelReading() }
video.markAsFinished()
await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in DispatchQueue.global().async { audioDone.wait(); k.resume() } }
writer.endSession(atSourceTime: duration) // recorta el audio al largo exacto del vídeo
await writer.finishWriting()
guard writer.status == .completed else { fail("no se pudo escribir: \(writer.error?.localizedDescription ?? "?")") }
print("✓ \(out.path) · \(W)×\(H) · \(totalFrames) fotogramas · \(String(format: "%.3f", duration.seconds)) s · " +
      "\(spans.count) tomas · \(dissolves) fotogramas fundidos · \(overlays.count) rótulos · " +
      (edl.audio.map { "audio \($0)" + (edl.audioFadeOut.map { String(format: " (se apaga en %.1f s)", $0) } ?? "") } ?? "silencio"))
