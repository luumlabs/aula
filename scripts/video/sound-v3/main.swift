import Foundation

// La banda sonora del v3 para cualquier montaje: lee la línea de tiempo (JSON) y escribe el WAV estéreo de 48 kHz.
// uso: aula-v3-sound <linea-de-tiempo.json> <salida.wav> [--s16]
// (flotante de 32 bits por defecto; --s16 escribe PCM de 16 bits como el original)
let args = CommandLine.arguments.filter { !$0.hasPrefix("--") }
guard args.count >= 3 else {
    FileHandle.standardError.write("uso: aula-v3-sound <linea-de-tiempo.json> <salida.wav> [--s16]\n".data(using: .utf8)!)
    exit(2)
}
do { try Timeline.load(path: args[1]) } catch {
    FileHandle.standardError.write("\(error.localizedDescription)\n".data(using: .utf8)!)
    exit(1)
}
let t0 = Date()
let st = Soundtrack(duration: Timeline.duration)
let r = st.render()
let s16 = CommandLine.arguments.contains("--s16")
var d = Data()
func u32(_ v: UInt32) { var le = v.littleEndian; d.append(Data(bytes: &le, count: 4)) }
func u16(_ v: UInt16) { var le = v.littleEndian; d.append(Data(bytes: &le, count: 2)) }
let bytes = r.samples.count * (s16 ? 2 : 4)
d.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + bytes)); d.append("WAVEfmt ".data(using: .ascii)!)
u32(16); u16(s16 ? 1 : 3); u16(2); u32(48_000); u32(48_000 * (s16 ? 4 : 8)); u16(s16 ? 4 : 8); u16(s16 ? 16 : 32)
d.append("data".data(using: .ascii)!); u32(UInt32(bytes))
if s16 {
    for v in r.samples { var x = Int16(max(-1, min(1, v)) * 32767).littleEndian; d.append(Data(bytes: &x, count: 2)) }
} else {
    r.samples.withUnsafeBufferPointer { d.append(UnsafeBufferPointer(start: UnsafeRawPointer($0.baseAddress!).assumingMemoryBound(to: UInt8.self), count: bytes)) }
}
try! d.write(to: URL(fileURLWithPath: args[2]))
print(String(format: "{\"seconds\": %.3f, \"peakDb\": %.2f, \"rmsDb\": %.2f, \"truePeakDb\": %.2f, \"renderS\": %.1f}", Double(r.samples.count / 2) / 48_000, r.peakDB, r.rmsDB, truePeakDB(r.samples), Date().timeIntervalSince(t0)))
