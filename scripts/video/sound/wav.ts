// WAV estéreo: flotante de 32 bits (por defecto, lo que lee el compositor con decodeAudioData) o PCM de 16 bits con
// tramado triangular. La lectura está en ../audio/track.ts (readWav).

export function encodeWav(channels: Float32Array[], rate: number, format: 'f32' | 's16' = 'f32'): Buffer {
  const nch = channels.length
  const frames = channels[0].length
  const bytes = format === 'f32' ? 4 : 2
  const data = Buffer.alloc(frames * nch * bytes)
  let seed = 0x9e3779b9
  const tpdf = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const a = seed / 4294967296
    seed = (seed * 1664525 + 1013904223) >>> 0
    return a - seed / 4294967296
  }
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < nch; c++) {
      const v = channels[c][i]
      const o = (i * nch + c) * bytes
      if (format === 'f32') data.writeFloatLE(v, o)
      else data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767 + tpdf()))), o)
    }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0, 'latin1')
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVE', 8, 'latin1')
  head.write('fmt ', 12, 'latin1')
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(format === 'f32' ? 3 : 1, 20)
  head.writeUInt16LE(nch, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * nch * bytes, 28)
  head.writeUInt16LE(nch * bytes, 32)
  head.writeUInt16LE(bytes * 8, 34)
  head.write('data', 36, 'latin1')
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}
