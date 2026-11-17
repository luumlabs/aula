// Comprueba una vista previa del App Store contra lo que pide Apple y lo que decidimos (sin ffprobe), con AVFoundation:
//   xcrun swift -suppress-warnings scripts/dev/appstore/preview-probe.swift <archivo> iphone|ipad [--duration 27] [--size 886x1920]
//        [--stills 2.5,5.0 --stills-dir <carpeta>] [--sheet <hoja.jpg>] [--sheet-step 1]
// Falla (sale con 1) si algo no cuadra: contenedor y peso (≤ 500 MB), moov delante del mdat, duración (15–30 s, o la de
// --duration), una pista de vídeo y una de audio, todas activadas; H.264 High con nivel ≤ 4.0 (del avcC), tamaño exacto
// (iPhone 886×1920, iPad 1600×1200 en horizontal, o --size), sin giro, píxeles cuadrados, 30 fps CONSTANTES (muestra a
// muestra, sin decodificar), tasa ≤ 25 Mb/s; audio AAC-LC estéreo a 48 kHz y 256 kb/s (del esds), que dura lo mismo
// que el vídeo; y que todo se decodifica. Avisa (sin fallar) si la tasa de vídeo sale de 10–12 Mb/s o falta BT.709.
// Con --stills exporta esos instantes como PNG (pósteres), y con --sheet, una hoja de contacto cada --sheet-step s.
// La sonoridad tras el AAC se mide aparte: node scripts/dev/appstore/preview-music.mjs measure <archivo>.
import AVFoundation
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

func usage() -> Never {
    print("uso: preview-probe.swift <archivo> iphone|ipad [--duration s] [--size WxH] [--stills t1,t2 --stills-dir dir] [--sheet hoja.jpg] [--sheet-step s]")
    exit(2)
}
let a = CommandLine.arguments
guard a.count >= 3, ["iphone", "ipad"].contains(a[2]) else { usage() }
func opt(_ k: String) -> String? { a.firstIndex(of: k).flatMap { $0 + 1 < a.count ? a[$0 + 1] : nil } }
let url = URL(fileURLWithPath: a[1])
let expectedSize = opt("--size") ?? (a[2] == "iphone" ? "886x1920" : "1600x1200")
let expectedDuration = opt("--duration").flatMap(Double.init)
var fails: [String] = []
var warnings: [String] = []
var info: [String: Any] = [:]
func check(_ ok: Bool, _ what: String) { if !ok { fails.append(what) } }

// ── Contenedor: peso y orden de las cajas (moov delante = se reproduce mientras se descarga) ──────────────────────────
let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
info["fileMB"] = (Double(bytes) / 1_048_576 * 100).rounded() / 100
check(["mp4", "m4v", "mov"].contains(url.pathExtension.lowercased()), "extensión .mp4/.m4v/.mov")
check(bytes > 0 && bytes <= 500 * 1_048_576, "peso ≤ 500 MB")
func topLevelBoxes(_ u: URL) -> [String] {
    guard let fh = try? FileHandle(forReadingFrom: u) else { return [] }
    defer { try? fh.close() }
    var boxes: [String] = []
    var offset: UInt64 = 0
    while boxes.count < 64, let head = try? fh.read(upToCount: 16), head.count >= 8 {
        let b = [UInt8](head)
        var size = UInt64(b[0]) << 24 | UInt64(b[1]) << 16 | UInt64(b[2]) << 8 | UInt64(b[3])
        let type = String(bytes: b[4..<8], encoding: .ascii) ?? "????"
        if size == 1, b.count >= 16 { size = b[8..<16].reduce(UInt64(0)) { $0 << 8 | UInt64($1) } }
        boxes.append(type)
        if size == 0 { break } // hasta el final del archivo
        guard size >= 8 else { break }
        offset += size
        guard (try? fh.seek(toOffset: offset)) != nil else { break }
    }
    return boxes
}
let boxes = topLevelBoxes(url)
info["boxes"] = boxes
if let m = boxes.firstIndex(of: "moov"), let d = boxes.firstIndex(of: "mdat") { check(m < d, "moov delante del mdat (faststart)") }
else { fails.append("cajas moov y mdat") }

let asset = AVURLAsset(url: url)
let duration = try await asset.load(.duration).seconds
info["duration"] = (duration * 1000).rounded() / 1000
check(duration >= 15 && duration <= 30, "duración de 15 a 30 s")
if let d = expectedDuration { check(abs(duration - d) < 0.01, String(format: "duración %.3f s", d)) }

let tracks = try await asset.load(.tracks)
for t in tracks { check(try await t.load(.isEnabled), "pista \(t.trackID) activada") }

// ── Vídeo ──────────────────────────────────────────────────────────────────────────────────────────────────────────
let videos = try await asset.loadTracks(withMediaType: .video)
check(videos.count == 1, "una sola pista de vídeo")
var videoSeconds = 0.0
if let v = videos.first {
    let size = try await v.load(.naturalSize)
    let transform = try await v.load(.preferredTransform)
    let nominal = try await v.load(.nominalFrameRate)
    let rate = Double(try await v.load(.estimatedDataRate))
    let fd = try await v.load(.formatDescriptions).first!
    let sub = CMFormatDescriptionGetMediaSubType(fd)
    let fourcc = String(bytes: [24, 16, 8, 0].map { UInt8((sub >> $0) & 255) }, encoding: .ascii) ?? "?"
    let key = "\(Int(size.width))x\(Int(size.height))"
    var vinfo: [String: Any] = ["codec": fourcc, "size": key, "nominalFps": nominal, "mbps": (rate / 1e4).rounded() / 100]
    check(fourcc == "avc1", "H.264 (avc1)")
    check(key == expectedSize, "tamaño \(expectedSize)")
    check(transform.isIdentity, "sin giro en la pista (píxeles ya en su orientación)")
    check(abs(Double(nominal) - 30) < 0.01, "30 fps nominales")
    // 10–12 Mb/s es el objetivo de Apple, no un mínimo: lo quieto (papel) comprime mucho y VideoToolbox no rellena
    if rate < 10e6 || rate > 12e6 { warnings.append(String(format: "tasa de vídeo %.1f Mb/s (objetivo de Apple 10–12)", rate / 1e6)) }
    check(rate <= 25e6, "tasa ≤ 25 Mb/s (techo de High 4.0)")
    // perfil y nivel, del avcC: byte 1 = profile_idc (100 = High), byte 3 = level_idc (40 = 4.0)
    if let atoms = CMFormatDescriptionGetExtension(fd, extensionKey: kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms) as? [String: Any],
       let avcC = atoms["avcC"] as? Data, avcC.count > 3 {
        let p = [UInt8](avcC)
        vinfo["profile"] = Int(p[1])
        vinfo["level"] = Int(p[3])
        check(p[1] == 100, "perfil High (100)")
        check(p[3] <= 40, "nivel ≤ 4.0")
    } else { fails.append("avcC legible") }
    // píxeles cuadrados y color BT.709
    if let par = CMFormatDescriptionGetExtension(fd, extensionKey: kCMFormatDescriptionExtension_PixelAspectRatio) as? [String: Any],
       let h = par[kCMFormatDescriptionKey_PixelAspectRatioHorizontalSpacing as String] as? Int,
       let w = par[kCMFormatDescriptionKey_PixelAspectRatioVerticalSpacing as String] as? Int {
        check(h == w, "píxeles cuadrados")
    }
    let tag = { (k: CFString) in CMFormatDescriptionGetExtension(fd, extensionKey: k) as? String ?? "sin etiqueta" }
    let color = [tag(kCMFormatDescriptionExtension_ColorPrimaries), tag(kCMFormatDescriptionExtension_TransferFunction), tag(kCMFormatDescriptionExtension_YCbCrMatrix)]
    vinfo["color"] = color
    if !color.allSatisfy({ $0 == "ITU_R_709_2" }) { warnings.append("color sin BT.709 en primarios, transferencia y matriz: \(color)") }
    // ritmo real, muestra a muestra (sin decodificar): todas duran 1/30 s y no hay saltos
    let reader = try AVAssetReader(asset: asset)
    let raw = AVAssetReaderTrackOutput(track: v, outputSettings: nil)
    reader.add(raw)
    reader.startReading()
    var count = 0, bad = 0
    var pts: [Double] = []
    while let s = raw.copyNextSampleBuffer() {
        guard CMSampleBufferGetNumSamples(s) > 0 else { continue }
        count += 1
        pts.append(CMSampleBufferGetPresentationTimeStamp(s).seconds)
        if abs(CMSampleBufferGetDuration(s).seconds - 1.0 / 30) > 1e-4 { bad += 1 }
    }
    pts.sort()
    let gaps = zip(pts.dropFirst(), pts).map { $0 - $1 }
    videoSeconds = Double(count) / 30
    vinfo["frames"] = count
    vinfo["gap"] = [gaps.min() ?? 0, gaps.max() ?? 0]
    check(bad == 0 && (gaps.min() ?? 0) > 1.0 / 30 - 1e-4 && (gaps.max() ?? 1) < 1.0 / 30 + 1e-4, "30 fps constantes (cada muestra 1/30 s)")
    // (las muestras llevan el retraso del reordenado de fotogramas; lo que cuenta es dónde empieza la pista en la película)
    let vrange = try await v.load(.timeRange)
    vinfo["start"] = vrange.start.seconds
    check(abs(vrange.start.seconds) < 1e-4, "el vídeo empieza en 0")
    check(abs(Double(count) - (duration * 30).rounded()) < 0.5, "fotogramas = duración × 30")
    info["video"] = vinfo
}

// ── Audio (App Store Connect rechaza una vista previa sin pista de audio; vale una silenciosa) ───────────────────────
/// Del esds (magic cookie del AAC): la tasa media y máxima declaradas y el tipo de objeto (2 = AAC-LC).
func esds(_ fd: CMAudioFormatDescription) -> (avg: Int, max: Int, object: Int)? {
    var size = 0
    guard let ptr = CMAudioFormatDescriptionGetMagicCookie(fd, sizeOut: &size), size > 0 else { return nil }
    let b = [UInt8](UnsafeRawBufferPointer(start: ptr, count: size))
    func length(_ i: inout Int) -> Int { var n = 0; for _ in 0..<4 where i < b.count { let c = b[i]; i += 1; n = n << 7 | Int(c & 0x7f); if c & 0x80 == 0 { break } }; return n }
    var i = 0
    while i < b.count - 1 {
        if b[i] == 0x04 { // DecoderConfigDescriptor
            var j = i + 1
            _ = length(&j)
            guard j + 13 <= b.count, b[j] == 0x40 else { i += 1; continue } // 0x40 = audio MPEG-4
            let be32 = { (k: Int) in Int(b[k]) << 24 | Int(b[k + 1]) << 16 | Int(b[k + 2]) << 8 | Int(b[k + 3]) }
            let maxRate = be32(j + 5), avgRate = be32(j + 9)
            var object = 0
            var k = j + 13
            if k < b.count, b[k] == 0x05 { k += 1; _ = length(&k); if k < b.count { object = Int(b[k] >> 3) } }
            return (avgRate, maxRate, object)
        }
        i += 1
    }
    return nil
}
let audios = try await asset.loadTracks(withMediaType: .audio)
check(audios.count == 1, "una sola pista de audio")
if let au = audios.first, let fd = try await au.load(.formatDescriptions).first,
   let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fd)?.pointee {
    let measured = Double(try await au.load(.estimatedDataRate))
    let range = try await au.load(.timeRange)
    var ainfo: [String: Any] = ["format": asbd.mFormatID == kAudioFormatMPEG4AAC ? "aac" : String(asbd.mFormatID), "hz": asbd.mSampleRate,
                                "channels": asbd.mChannelsPerFrame, "measuredKbps": (measured / 100).rounded() / 10,
                                "seconds": (range.duration.seconds * 1000).rounded() / 1000]
    check(asbd.mFormatID == kAudioFormatMPEG4AAC, "audio AAC")
    check(asbd.mSampleRate == 48_000, "audio a 48 kHz")
    check(asbd.mChannelsPerFrame == 2, "audio estéreo (una pista, 2 canales)")
    if let e = esds(fd) {
        ainfo["declaredKbps"] = ["avg": e.avg / 1000, "max": e.max / 1000]
        ainfo["object"] = e.object
        check(abs(e.avg - 256_000) <= 2_560, "audio a 256 kb/s (declarado en el esds)")
        check(e.object == 2 || (e.object == 0 && asbd.mFormatFlags == 2), "AAC-LC")
    } else {
        // sin esds legible, lo medido: una pista silenciosa mide ~2 kb/s aunque se codifique a 256
        check(asbd.mFormatFlags == 2, "AAC-LC")
        if measured < 200_000 || measured > 300_000 { warnings.append(String(format: "audio medido a %.0f kb/s (esds no legible)", measured / 1000)) }
    }
    check(abs(range.duration.seconds - duration) < 1.0 / 30, "el audio dura lo mismo que el vídeo")
    info["audio"] = ainfo
}

// ── Se decodifica entera, como al reproducirla ─────────────────────────────────────────────────────────────────────
let full = try AVAssetReader(asset: asset)
if let v = videos.first { full.add(AVAssetReaderTrackOutput(track: v, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])) }
if let au = audios.first { full.add(AVAssetReaderTrackOutput(track: au, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM])) }
full.startReading()
var decoded = 0
for o in full.outputs { while let s = o.copyNextSampleBuffer() { if o.mediaType == .video { decoded += CMSampleBufferGetNumSamples(s) } } }
check(full.status == .completed, "se decodifica entera")
if videoSeconds > 0 { check(decoded == Int((videoSeconds * 30).rounded()), "decodifica todos los fotogramas") }

// ── Fotogramas para mirar: pósteres y hoja de contacto ────────────────────────────────────────────────────────────
let gen = AVAssetImageGenerator(asset: asset)
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
func frame(_ t: Double) async throws -> CGImage {
    try await gen.image(at: CMTime(value: CMTimeValue((t * 30).rounded()), timescale: 30)).image
}
func save(_ img: CGImage, _ path: String, _ type: UTType) {
    let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, type.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, img, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
    CGImageDestinationFinalize(dest)
}
if let list = opt("--stills"), let dir = opt("--stills-dir") {
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    var stills: [String] = []
    for t in list.split(separator: ",").compactMap({ Double($0) }) {
        let path = (dir as NSString).appendingPathComponent(String(format: "frame-%06.3fs.png", t))
        save(try await frame(t), path, .png)
        stills.append(path)
    }
    info["stills"] = stills
}
if let sheet = opt("--sheet") {
    let step = opt("--sheet-step").flatMap(Double.init) ?? 1
    var shots: [(Double, CGImage)] = []
    var t = 0.0
    while t < duration - 1e-6 { shots.append((t, try await frame(t))); t += step }
    let first = shots[0].1
    let cols = 9, tw = first.width >= first.height ? 240 : 150
    let th = Int(Double(first.height) / Double(first.width) * Double(tw)), label = 18, gap = 6
    let rows = (shots.count + cols - 1) / cols
    let SW = cols * (tw + gap) + gap, SH = rows * (th + label + gap) + gap
    let ctx = CGContext(data: nil, width: SW, height: SH, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: SW, height: SH))
    ctx.interpolationQuality = .high
    let font = CTFontCreateWithName("Helvetica" as CFString, 12, nil)
    for (i, (t, img)) in shots.enumerated() {
        let x = gap + (i % cols) * (tw + gap), y = SH - (i / cols + 1) * (th + label + gap)
        ctx.draw(img, in: CGRect(x: x, y: y + label, width: tw, height: th))
        let attr = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: CGColor(gray: 0, alpha: 1)] as CFDictionary
        ctx.textPosition = CGPoint(x: x + 2, y: y + 5)
        CTLineDraw(CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, String(format: "%.1f s", t) as CFString, attr)), ctx)
    }
    save(ctx.makeImage()!, sheet, .jpeg)
    info["sheet"] = sheet
}

info["fails"] = fails
info["warnings"] = warnings
let json = try JSONSerialization.data(withJSONObject: info, options: [.prettyPrinted, .sortedKeys])
print(String(decoding: json, as: UTF8.self))
print(fails.isEmpty ? "✓ pasa" : "✗ falla: " + fails.joined(separator: "; "))
exit(fails.isEmpty ? 0 : 1)
