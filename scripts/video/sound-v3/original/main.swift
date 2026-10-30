import Foundation

// Prueba de fidelidad: el Audio.swift original con la línea de tiempo original (Story.swift de dfcb4e1), sin adaptador.
// uso: aula-v3-original <salida.wav>
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "original.wav"
let st = Soundtrack(duration: Timeline.duration)
let r = st.render()
print(String(format: "original: pico %.2f dBFS · RMS %.1f dBFS · pico real %.2f dBTP", r.peakDB, r.rmsDB, truePeakDB(r.samples)))
var d = Data()
func u32(_ v: UInt32) { var le = v.littleEndian; d.append(Data(bytes: &le, count: 4)) }
func u16(_ v: UInt16) { var le = v.littleEndian; d.append(Data(bytes: &le, count: 2)) }
let bytes = r.samples.count * 4
d.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + bytes)); d.append("WAVEfmt ".data(using: .ascii)!)
u32(16); u16(3); u16(2); u32(48_000); u32(48_000 * 8); u16(8); u16(32); d.append("data".data(using: .ascii)!); u32(UInt32(bytes))
r.samples.withUnsafeBufferPointer { d.append(UnsafeBufferPointer(start: UnsafeRawPointer($0.baseAddress!).assumingMemoryBound(to: UInt8.self), count: bytes)) }
try! d.write(to: URL(fileURLWithPath: out))
