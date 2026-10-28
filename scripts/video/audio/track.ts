// La pista real de la película (Node): se decodifica con CoreAudio (afconvert, macOS) a WAV de 32 bits flotantes a
// 48 kHz en la caché FUERA del repositorio, y de ahí la leen el análisis de la rejilla y el compositor. Un solo
// decodificador para los dos: la rejilla cae exactamente donde suena. La pista nunca entra en el repo (licencia).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'

export const DEFAULT_TRACK = join(homedir(), 'Desktop', 'Aula', 'Video', 'music', 'South Waves - Eugenio Mininni (Mixkit 555).mp3')

/** Ruta de la pista: AULA_FILM_MUSIC o la de por defecto. */
export function trackPath(explicit?: string): string {
  return explicit || process.env.AULA_FILM_MUSIC || DEFAULT_TRACK
}

export interface DecodedTrack {
  /** WAV decodificado (en la caché, fuera del repo). */
  wav: string
  rate: number
  channels: Float32Array[]
}

/** Lee un WAV PCM de 16 bits o flotante de 32 (también WAVE_FORMAT_EXTENSIBLE). */
export function readWav(buf: Buffer): { rate: number; channels: Float32Array[] } {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('no es un WAV')
  let p = 12
  let fmt = 0
  let nch = 0
  let rate = 0
  let bits = 0
  let data: Buffer | null = null
  while (p + 8 <= buf.length) {
    const id = buf.toString('latin1', p, p + 4)
    const size = buf.readUInt32LE(p + 4)
    const body = buf.subarray(p + 8, p + 8 + size)
    if (id === 'fmt ') {
      fmt = body.readUInt16LE(0)
      nch = body.readUInt16LE(2)
      rate = body.readUInt32LE(4)
      bits = body.readUInt16LE(14)
      if (fmt === 0xfffe) fmt = body.readUInt16LE(24)
    } else if (id === 'data') data = body
    p += 8 + size + (size & 1)
  }
  if (!data || !nch) throw new Error('WAV sin datos')
  const frames = Math.floor(data.length / (nch * (bits / 8)))
  const channels = Array.from({ length: nch }, () => new Float32Array(frames))
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < nch; c++) {
      const o = (i * nch + c) * (bits / 8)
      channels[c][i] = fmt === 3 && bits === 32 ? data.readFloatLE(o) : bits === 16 ? data.readInt16LE(o) / 32768 : 0
    }
  return { rate, channels }
}

export function decodeTrack(file: string, cacheDir = join(process.env.VT_CACHE || join(tmpdir(), 'aula-video-cache'), 'music')): DecodedTrack {
  if (!existsSync(file)) throw new Error(`no encuentro la pista ${file} (AULA_FILM_MUSIC)`)
  const st = statSync(file)
  const key = createHash('sha1').update(basename(file)).update(String(st.size)).update(readFileSync(file).subarray(0, 1 << 16)).digest('hex').slice(0, 12)
  mkdirSync(cacheDir, { recursive: true })
  const wav = join(cacheDir, `${key}.wav`)
  if (!existsSync(wav)) {
    const tmp = wav + '.tmp.wav'
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEF32@48000', file, tmp], { stdio: 'pipe' })
    renameSync(tmp, wav)
  }
  const { rate, channels } = readWav(readFileSync(wav))
  return { wav, rate, channels }
}

export function mono(channels: Float32Array[]): Float32Array {
  const out = new Float32Array(channels[0].length)
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length
  return out
}
