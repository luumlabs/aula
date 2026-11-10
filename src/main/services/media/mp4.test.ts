import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MediaFormatError, readAudioTrack, sliceToM4A, sliceTrack } from './mp4'

const FIXTURE = join(__dirname, 'testing', 'clase.m4a')
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const temp = (): string => { const d = mkdtempSync(join(tmpdir(), 'aula-mp4-')); dirs.push(d); return d }

describe('pista de audio de un MP4', () => {
  it('lee la pista AAC de una grabación real: duración, muestras y posiciones dentro del archivo', () => {
    const t = readAudioTrack(FIXTURE)
    expect(t.codec).toBe('mp4a')
    expect(t.duration).toBeGreaterThan(8)
    expect(t.duration).toBeLessThan(20)
    expect(t.sizes.length).toBe(t.offsets.length)
    expect(t.sizes.length).toBe(t.deltas.length)
    const size = readFileSync(FIXTURE).length
    for (let i = 0; i < t.sizes.length; i++) expect(t.offsets[i] + t.sizes[i]).toBeLessThanOrEqual(size)
  })

  it('la parte en trozos seguidos que no pasan del límite y cubren toda la grabación', () => {
    const t = readAudioTrack(FIXTURE)
    const slices = sliceTrack(t, 3, 10_000_000)
    expect(slices.length).toBeGreaterThan(2)
    expect(slices[0].start).toBe(0)
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].start).toBeCloseTo(slices[i - 1].end, 6)
      expect(slices[i].first).toBe(slices[i - 1].first + slices[i - 1].count)
    }
    for (const s of slices) expect(s.end - s.start).toBeLessThanOrEqual(3.0001)
    expect(slices.at(-1)!.end).toBeCloseTo(t.duration, 3)
    expect(slices.reduce((n, s) => n + s.count, 0)).toBe(t.sizes.length)
    // por bytes: ningún trozo pasa del tope (salvo que una sola muestra ya lo supere)
    for (const s of sliceTrack(t, 3600, 4000)) expect(s.count === 1 || s.bytes <= 4000).toBe(true)
  })

  it('cada trozo es un M4A que se puede volver a leer, con las mismas muestras', () => {
    const t = readAudioTrack(FIXTURE)
    const original = readFileSync(FIXTURE)
    const dir = temp()
    for (const [i, s] of sliceTrack(t, 4, 10_000_000).entries()) {
      const file = join(dir, `parte-${i}.m4a`)
      writeFileSync(file, sliceToM4A(FIXTURE, t, s))
      const part = readAudioTrack(file)
      expect(part.codec).toBe('mp4a')
      expect(part.sizes.length).toBe(s.count)
      expect(part.duration).toBeCloseTo(s.end - s.start, 3)
      const bytes = readFileSync(file)
      for (const k of [0, s.count - 1]) {
        const a = bytes.subarray(part.offsets[k], part.offsets[k] + part.sizes[k])
        const b = original.subarray(t.offsets[s.first + k], t.offsets[s.first + k] + t.sizes[s.first + k])
        expect(Buffer.compare(a, b)).toBe(0)
      }
    }
  })

  it('dice por qué no puede con un archivo que no es una grabación con audio', () => {
    const dir = temp()
    const file = join(dir, 'roto.mp4')
    writeFileSync(file, Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypisom'), Buffer.alloc(4), Buffer.from([0, 0, 0, 8]), Buffer.from('mdat')]))
    expect(() => readAudioTrack(file)).toThrow(MediaFormatError)
    try { readAudioTrack(file) } catch (e) { expect((e as MediaFormatError).code).toBe('corrupt') }
  })
})
