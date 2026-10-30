import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readWav } from '../audio/track.ts'
import { checkEvents } from './analysis.ts'
import { rms, SR } from './dsp.ts'
import { phoneCheck } from './profile.ts'
import { renderSoundtrack } from './score.ts'
import type { CueSheet } from './sheet.ts'
import { encodeWav } from './wav.ts'

// una pieza corta con toda la forma: intro → drop → día → cartela → noche → final, y un efecto de cada tipo
const beat = 60 / 120
const V = (bar: number, b = 1) => (bar - 1) * 4 * beat + (b - 1) * beat
const sheet: CueSheet = {
  version: 1,
  name: 'test',
  duration: V(9) + 1.5,
  bpm: 120,
  mode: 'short',
  sections: [
    { bar: 1, kind: 'intro' },
    { bar: 2, kind: 'drop' },
    { bar: 3, kind: 'day' },
    { bar: 5, kind: 'card' },
    { bar: 6, kind: 'night' },
    { bar: 7, kind: 'rise' },
    { bar: 8, kind: 'end' }
  ],
  events: [
    { t: V(1, 2), type: 'word', i: 0 },
    { t: V(1, 2) + 0.16, type: 'word', i: 1 },
    { t: V(2, 1), type: 'whoosh', dur: 0.4, size: 0.8, peak: 0.25 },
    { t: V(3, 1) + 0.02, type: 'click', pan: 0.3 }, // 20 ms tarde: se encaja en el pulso
    { t: V(3, 3), type: 'keys', dur: 0.6, n: 8 },
    { t: V(4, 1), type: 'whoosh', dur: 0, size: 0.3 },
    { t: V(4, 2), type: 'count', dur: 0.8, n: 6 },
    { t: V(5, 1), type: 'light', dur: 1, to: 'dark' },
    { t: V(5, 1), type: 'card', n: 2, dark: true },
    { t: V(6, 1), type: 'arp', dur: 0.8, n: 10 },
    { t: V(6, 4), type: 'impact' },
    { t: V(8, 1), type: 'logo' }
  ]
}

describe('banda sonora', () => {
  const st = renderSoundtrack(sheet)

  it('estéreo, 48 kHz, la duración del vídeo, −14 LUFS y ≤ −2,5 dBTP', () => {
    expect(st.sampleRate).toBe(48000)
    expect(st.channels).toHaveLength(2)
    expect(st.channels[0].length).toBe(Math.ceil(sheet.duration * SR))
    expect(st.report.mix.master.lufs).toBeCloseTo(-14, 0)
    expect(Math.abs(st.report.mix.master.lufs + 14)).toBeLessThan(0.2)
    expect(st.report.mix.master.truePeak).toBeLessThanOrEqual(-2.5)
    for (const c of st.channels) expect(c.every(Number.isFinite)).toBe(true)
  })

  it('es determinista', () => {
    const again = renderSoundtrack(sheet)
    const h = (x: Float32Array[]) => createHash('sha1').update(Buffer.from(x[0].buffer)).update(Buffer.from(x[1].buffer)).digest('hex')
    expect(h(again.channels)).toBe(h(st.channels))
  })

  it('cada efecto cae donde lo pide la imagen (medido sintetizándolo solo) y se oye sobre la música', () => {
    const checks = checkEvents(st)
    // los automáticos de la forma: el golpe del drop y la subida que lleva a él
    expect(checks.some((c) => c.auto && c.type === 'impact' && Math.abs(c.hit - V(2)) < 1e-6)).toBe(true)
    // la subida calla una corchea antes del golpe del drop (el respiro)
    expect(checks.some((c) => c.auto && c.type === 'rise' && c.hit < V(2) && c.hit >= V(2) - 0.3)).toBe(true)
    for (const c of checks) {
      if (c.errorMs === null) continue
      const tol = c.type === 'whoosh' || c.type === 'rise' ? 60 : 3
      expect(Math.abs(c.errorMs), `${c.type} @ ${c.t}`).toBeLessThanOrEqual(tol)
    }
    // (el golpe del drop se funde con el de la música: lo mide la prueba del móvil)
    const atDrop = (c: { hit: number }) => Math.abs(c.hit - V(2)) < 0.01
    for (const c of checks.filter((x) => ['click', 'card', 'logo', 'count'].includes(x.type) && !atDrop(x))) expect(c.snrDb, `${c.type} @ ${c.t}`).toBeGreaterThan(3)
    // los golpes: que asomen en su banda; lo que importa de ellos (que suban en un móvil) lo mide la prueba del móvil
    for (const c of checks.filter((x) => x.type === 'impact' && !atDrop(x))) expect(c.snrDb, `${c.type} @ ${c.t}`).toBeGreaterThan(0)
    // y lo que cae encima de un golpe fuerte se funde en él
    const hits = checks.filter((x) => x.type === 'impact' || x.type === 'flash' || x.type === 'logo').map((x) => x.hit)
    for (const c of checks.filter((x) => !['impact', 'flash', 'logo'].includes(x.type) && !hits.some((h) => Math.abs(h - x.hit) < 0.2))) expect(c.snrDb, `${c.type} @ ${c.t}`).toBeGreaterThan(c.type === 'whoosh' ? -5 : -3)
  })

  it('a tempo: el clic de 20 ms tarde suena en el pulso; las palabras de un rótulo guardan su escalonado', () => {
    const click = st.report.placements.find((p) => p.type === 'click')!
    expect(click.hit).toBeCloseTo(V(3), 6)
    expect(click.snapMs).toBeCloseTo(-20, 0)
    const words = st.report.placements.filter((p) => p.type === 'word')
    expect(words[1].hit - words[0].hit).toBeCloseTo(0.16, 6)
  })

  it('respira antes del drop: la música calla la última corchea', () => {
    const [a, b] = st.report.gaps[0]
    expect(b).toBeCloseTo(V(2), 3)
    const inGap = rms(st.music, a + 0.01, b - 0.005)
    const before = rms(st.music, a - 0.4, a - 0.05)
    expect(20 * Math.log10(inGap / before)).toBeLessThan(-6)
  })

  it('la armonía sigue la forma y las notas de los efectos están en la tonalidad', () => {
    expect(st.report.bars.map((b) => b.chord).slice(0, 2)).toEqual(['Asus4', 'Dadd9'])
    const dMajor = [2, 4, 6, 7, 9, 11, 1]
    for (const p of st.report.placements) for (const m of p.notes) expect(dMajor, `${p.type} ${m}`).toContain(((m % 12) + 12) % 12)
  })

  it('el WAV se lee igual que se escribió', () => {
    const w = readWav(encodeWav(st.channels, st.sampleRate))
    expect(w.rate).toBe(48000)
    expect(w.channels[1][12345]).toBe(st.channels[1][12345])
    const s16 = readWav(encodeWav(st.channels, st.sampleRate, 's16'))
    expect(Math.abs(s16.channels[0][20000] - st.channels[0][20000])).toBeLessThan(2 / 32767)
  })
})

describe('banda sonora de la película (carácter del v3)', () => {
  const film = renderSoundtrack({ ...sheet, mode: 'film' })
  it('los efectos clave se oyen igual con la mezcla cálida de la película', () => {
    const checks = checkEvents(film)
    for (const c of checks.filter((x) => ['click', 'card', 'logo', 'count'].includes(x.type))) expect(c.snrDb, `${c.type} @ ${c.t}`).toBeGreaterThan(3)
    // el golpe del drop se funde con el de la música (palmada, caja y acorde): lo mide la prueba del móvil; los demás
    // golpes, que asomen
    for (const c of checks.filter((x) => x.type === 'impact' && Math.abs(x.hit - V(2)) > 0.01)) expect(c.snrDb, `${c.type} @ ${c.t}`).toBeGreaterThan(0)
    // lo que cae encima del golpe del drop se funde en él a propósito; el resto, que asome. El aire de los cortes es,
    // como en el v3, lo más discreto (allí iba ~8 dB por debajo de la música): basta con −5 dB en su banda
    const hits = checks.filter((x) => x.type === 'impact' || x.type === 'flash' || x.type === 'logo').map((x) => x.hit)
    for (const c of checks.filter((x) => !['impact', 'flash', 'logo'].includes(x.type) && !hits.some((h) => Math.abs(h - x.hit) < 0.2))) expect(c.snrDb, `${c.type} @ ${c.t}`).toBeGreaterThan(c.type === 'whoosh' ? -5 : -3)
    expect(film.report.mix.master.truePeak).toBeLessThanOrEqual(-2.5)
  })
})

describe('prueba del móvil (por encima de 300 Hz)', () => {
  for (const mode of ['short', 'film'] as const) {
    it(`${mode}: el drop sube ≥ 6 dB y ningún golpe fuerte baja`, () => {
      const st = renderSoundtrack({ ...sheet, mode })
      const hits = st.report.placements.filter((p) => p.type === 'impact' || p.type === 'flash' || p.type === 'logo').map((p) => ({ t: p.hit, label: p.type }))
      const res = phoneCheck(st.channels, st.sampleRate, hits, [])
      const drop = res.hits.find((h) => Math.abs(h.t - V(2)) < 1e-6)!
      expect(drop.rise, 'drop').toBeGreaterThanOrEqual(6)
      for (const h of res.hits) expect(h.rise, `${h.label} @ ${h.t}`).toBeGreaterThanOrEqual(0)
    })
  }
})

describe('calidez del día de la película', () => {
  it('−2 dB por encima de 4 kHz solo en el día de la película (no en drop, subida, noche ni en el corto)', async () => {
    const { boostCurve, warmCurve } = await import('./score.ts')
    const { harmonize } = await import('./harmony.ts')
    const { parseSheet } = await import('./sheet.ts')
    const film = parseSheet({ ...sheet, mode: 'film' })
    const H = harmonize(film)
    const warm = warmCurve(film, H, boostCurve(film, H))
    expect(warm(V(4, 3))).toBeCloseTo(-2) // día
    expect(warm(V(2, 3))).toBeCloseTo(0) // drop
    expect(warm(V(6, 3))).toBeCloseTo(0) // noche
    expect(warm(V(7, 3))).toBeCloseTo(0) // subida
    const short = parseSheet(sheet)
    expect(warmCurve(short, harmonize(short), () => 1)(V(4, 3))).toBe(0)
  })
})
