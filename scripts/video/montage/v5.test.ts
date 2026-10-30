import { ease } from './ease.ts'
import { describe, expect, it } from 'vitest'
import { keynoteFit, whipBlur, setWordMeasure, titleHost, KEYNOTE_MIN, PANEL_MIN, balanceBreaks, cleanBreaks, clipPanelRect, estimateWidth, avoidRect, clearRect, convergeTarget, fitTitleSize, keynoteColumn, keynoteTextRect, panelRect, titleSize, titleStart, underlineTime, wordTimes } from './v5.ts'
import type { Montage } from './types.ts'

const m = (size: [number, number]): Montage => ({ name: 'x', fps: 60, size, theme: 'light', duration: 10, takes: {}, clips: [] })

describe('composición keynote (V5)', () => {
  it('el panel ocupa el 60–75 % del ancho a un lado y el titular va al otro, sin pisarse', () => {
    for (const side of ['left', 'right'] as const) {
      const P = panelRect(m([1920, 1080]), { kind: 'keynote', side })
      expect(P.w / 1920).toBeGreaterThanOrEqual(0.6)
      expect(P.w / 1920).toBeLessThanOrEqual(0.75)
      const T = keynoteTextRect(m([1920, 1080]), side === 'right' ? 'left' : 'right')
      const overlap = Math.max(0, Math.min(P.x + P.w, T.x + T.w) - Math.max(P.x, T.x))
      expect(overlap).toBe(0)
    }
  })
  it('en vertical el panel va abajo, ancho, y el titular arriba; el primer plano llena el cuadro', () => {
    const P = panelRect(m([1080, 1920]), { kind: 'keynote', side: 'right' })
    expect(P.w / 1080).toBeGreaterThan(0.85)
    expect(P.y).toBeGreaterThan(1920 * 0.25)
    const T = keynoteTextRect(m([1080, 1920]), 'left')
    expect(T.y + T.h).toBeLessThanOrEqual(P.y)
    expect(panelRect(m([1920, 1080]), { kind: 'detail' })).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
  })
  it('palabras escalonadas y cuerpos de letra legibles', () => {
    const t = wordTimes({ start: 2, dur: 3, text: 'Meet *Aula.*', style: 'type' })
    expect(t).toHaveLength(2)
    expect(t[1] - t[0]).toBeCloseTo(0.075)
    expect(titleSize(m([1920, 1080]), { start: 0, dur: 1, text: 'x', style: 'type' })).toBeGreaterThan(150)
    expect(titleSize(m([1080, 1920]), { start: 0, dur: 1, text: 'x', style: 'keynote' })).toBeGreaterThan(80)
  })
  it('en cuadrado, como en vertical: titular arriba (ancho) y panel abajo', () => {
    const P = panelRect(m([1080, 1080]), { kind: 'keynote', side: 'left' })
    const T = keynoteTextRect(m([1080, 1080]), 'right')
    expect(T.w / 1080).toBeGreaterThan(0.8)
    expect(T.y + T.h).toBeLessThanOrEqual(P.y)
    expect(P.w / 1080).toBeGreaterThan(0.85)
  })
  it('gancho: los materiales salen del claro del rótulo (8 % de margen) y convergen por sus lados', () => {
    const R = clearRect({ x: 600, y: 400, w: 720, h: 200 }, 1920, 1080)
    expect(R.x).toBeCloseTo(600 - 153.6)
    expect(R.h).toBeCloseTo(200 + 2 * 86.4)
    // un material en medio del texto sale por el lado más cercano, entero
    const [x, y] = avoidRect(700, 500, 60, 40, R)
    const inside = x + 60 > R.x && x - 60 < R.x + R.w && y + 40 > R.y && y - 40 < R.y + R.h
    expect(inside).toBe(false)
    // si la salida más corta lo saca del cuadro, sale por otra que lo deja dentro
    const wide = { x: 100, y: 300, w: 1720, h: 300 }
    const [, y2] = avoidRect(960, 320, 60, 60, wide, { W: 1920, H: 1080 })
    expect(y2).toBeGreaterThanOrEqual(240)
    // fuera del claro, no se mueve
    expect(avoidRect(100, 100, 30, 30, R)).toEqual([100, 100])
    // convergen a un lado del claro (nunca a su centro)
    const [tx] = convergeTarget(200, 540, 1920, 1080, R)
    expect(tx).toBeLessThanOrEqual(R.x)
    const [tx2] = convergeTarget(1700, 540, 1920, 1080, R)
    expect(tx2).toBeGreaterThanOrEqual(R.x + R.w)
    expect(convergeTarget(100, 100, 1920, 1080, null)).toEqual([960, 1080 * 0.48])
  })
  it('un titular que cae en una entrada con rack focus o luz espera a que deje de verse el plano viejo (salvo overlap)', () => {
    const mm: Montage = { ...m([1920, 1080]), clips: [{ take: 'a', start: 0, dur: 4 }, { take: 'a', start: 4, dur: 4, enter: { kind: 'focus', dur: 0.45 } }, { take: 'a', start: 8, dur: 4, enter: { kind: 'light', dur: 1.15, style: 'dusk' } }] }
    const k = (start: number, extra = {}) => ({ start, dur: 2.3, text: 'Just ask *Aula.*', style: 'keynote' as const, ...extra })
    expect(titleStart(mm, k(4))).toBeCloseTo(4 + 0.45 * 0.85)
    expect(titleStart(mm, k(8))).toBeCloseTo(9.15)
    expect(titleStart(mm, k(8, { overlap: true }))).toBe(8)
    expect(titleStart(mm, k(5))).toBe(5)
    expect(wordTimes(k(8), mm)[0]).toBeCloseTo(9.15)
    // subrayado opt-in: solo con underline: {}
    expect(underlineTime(k(5))).toBeNull()
    expect(underlineTime(k(5, { underline: {} }))).not.toBeNull()
    expect(underlineTime(k(5, { underline: false }))).toBeNull()
  })
  it('el titular keynote se ajusta al hueco junto al panel y baja el cuerpo para que quepa la palabra más larga', () => {
    const mm: Montage = { ...m([1920, 1080]), clips: [{ take: 'a', start: 0, dur: 4, layout: { kind: 'keynote', side: 'right', size: 0.62 } }] }
    const col = keynoteColumn(mm, { start: 0.5, dur: 2, text: 'x', style: 'keynote', side: 'left' })
    const P = panelRect(mm, { kind: 'keynote', side: 'right', size: 0.62 })
    expect(col.x + col.w).toBeLessThan(P.x)
    expect(col.x).toBeGreaterThan(0)
    // 20 px por letra: «Understanding» (13) a 100 px mide 1300 → en 500 px baja a ~37
    const mw = (w: string, size: number) => w.length * size * 0.2
    expect(fitTitleSize(100, 500, ['A', 'Understanding'], mw)).toBe(Math.floor(100 * (500 / 260) * 0.98) > 100 ? 100 : Math.floor(100 * (500 / 260) * 0.98))
    expect(fitTitleSize(100, 200, ['Understanding'], mw)).toBeLessThan(100)
    expect(fitTitleSize(100, 200, ['Understanding'], mw) * 13 * 0.2).toBeLessThanOrEqual(200)
  })
  it('el titular también espera en entradas de contenido, forma o fundido (no en un corte seco)', () => {
    const mm: Montage = { ...m([1920, 1080]), clips: [{ take: 'a', start: 0, dur: 4 }, { take: 'a', start: 4, dur: 4, enter: { kind: 'content', dur: 0.25 } }, { take: 'a', start: 8, dur: 4, enter: { kind: 'shape', dur: 0.6 } }, { take: 'a', start: 12, dur: 4, enter: { kind: 'cut', dur: 0 } }] }
    const k = (start: number) => ({ start, dur: 2.3, text: 'One *click.*', style: 'keynote' as const })
    expect(titleStart(mm, k(4))).toBeCloseTo(4.25)
    expect(titleStart(mm, k(8))).toBeCloseTo(8.33)
    expect(titleStart(mm, k(12))).toBe(12)
  })
  it('si el titular no cabe a cuerpo mínimo, se estrecha el panel (hasta PANEL_MIN), no el texto', () => {
    const clip = { take: 'a', start: 0, dur: 4, layout: { kind: 'keynote' as const, side: 'right' as const, size: 0.64 } }
    const short: Montage = { ...m([1920, 1080]), clips: [clip], titles: [{ start: 0.2, dur: 2, text: '*Hi.*', style: 'keynote', side: 'left' }] }
    expect(clipPanelRect(short, clip).w).toBeCloseTo(1920 * 0.64)
    const long: Montage = { ...m([1920, 1080]), clips: [clip], titles: [{ start: 0.2, dur: 2, text: 'Understandingly *everything.*', style: 'keynote', side: 'left' }] }
    const P = clipPanelRect(long, clip)
    expect(P.w).toBeLessThan(1920 * 0.64)
    expect(P.w).toBeGreaterThanOrEqual(1920 * PANEL_MIN - 1)
    const col = 1920 - P.w - 1920 * (0.04 + 0.05 + 0.035)
    expect(col >= estimateWidth('Understandingly', 1080 * KEYNOTE_MIN) || P.w <= 1920 * PANEL_MIN + 1).toBe(true)
  })
  it('líneas equilibradas sin palabra sola al final', () => {
    // «It knows your exams.» en 2 líneas: mejor «It knows / your exams.» que «It knows your / exams.»
    const w = [40, 120, 90, 130]
    expect(balanceBreaks(w, 20, 2, 300)).toEqual([0, 2])
    // «Filled in.» nunca deja «in.» sola si cabe de otra forma
    const w2 = [200, 110, 60]
    const b = balanceBreaks(w2, 20, 2, 400)
    expect(b).toEqual([0, 1])
    // ninguna palabra corta sola en medio: «Simulations / you can / play with.», no «Simulations / you / can play with.»
    expect(balanceBreaks([558, 168, 168, 198, 234], 25, 3, 600)).toEqual([0, 1, 3])
  })
  it('si ni en el panel más estrecho parte limpio, el panel no se estrecha', () => {
    const clip = { take: 'a', start: 0, dur: 4, layout: { kind: 'keynote' as const, side: 'right' as const, size: 0.62 } }
    const mm: Montage = { ...m([1920, 1080]), clips: [clip], titles: [{ start: 0.2, dur: 2, text: 'Lorem ipsum dolor sit amet elit sed do eiusmod tempor magna aliqua enim minim veniam nostrud *labore.*', style: 'keynote', side: 'left' }] }
    expect(clipPanelRect(mm, clip).w).toBeCloseTo(1920 * 0.62)
  })
  it('con la medida real del compositor, el panel se estrecha según la serif de verdad', () => {
    const clip = { take: 'a', start: 0, dur: 4, layout: { kind: 'keynote' as const, side: 'right' as const, size: 0.62 } }
    const mm: Montage = { ...m([1920, 1080]), clips: [clip], titles: [{ start: 0.2, dur: 2, text: 'It remembers how you *learn.*', style: 'keynote', side: 'left' }] }
    try {
      setWordMeasure((w, _i, size) => w.length * size * 0.6)
      const wide = clipPanelRect(mm, clip).w
      setWordMeasure((w, _i, size) => w.length * size * 0.66)
      expect(clipPanelRect(mm, clip).w).toBeLessThan(wide)
    } finally {
      setWordMeasure(null)
    }
  })
  it('cleanBreaks: el titular parte limpio en la columna o hay que bajar el cuerpo / estrechar el panel', () => {
    const w = [182, 258, 272, 116] // One click. Filled in.
    expect(cleanBreaks(w, 25, 490)).toBe(true) // One click. / Filled in.
    expect(cleanBreaks(w, 25, 440)).toBe(false) // solo cabría con «One» o «in.» sueltas
    expect(cleanBreaks([600], 25, 500)).toBe(false)
    // sin estricto basta con caber en tres líneas (aunque quede una suelta)
    expect(cleanBreaks(w, 25, 300, 3)).toBe(false)
    expect(cleanBreaks(w, 25, 300, 3, false)).toBe(false) // cuatro líneas: no
    expect(cleanBreaks([182, 258, 272, 116], 25, 420, 3, false)).toBe(true)
  })
  it('el titular pertenece al plano que empieza con él, no al anterior que acaba en ese instante (redondeo)', () => {
    const a = { take: 'a', start: 0, dur: 13.846200001, layout: { kind: 'keynote' as const, side: 'left' as const, size: 0.62 } }
    const b = { take: 'a', start: 13.8462, dur: 3, layout: { kind: 'keynote' as const, side: 'right' as const, size: 0.62 } }
    const mm: Montage = { ...m([1920, 1080]), clips: [a, b] }
    expect(titleHost(mm, { start: 13.8462, dur: 2, text: 'It knows your *exams.*', style: 'keynote' })).toBe(b)
    expect(titleHost(mm, { start: 13.75, dur: 2, text: 'x', style: 'keynote' })).toBe(b)
    expect(titleHost(mm, { start: 5, dur: 2, text: 'x', style: 'keynote' })).toBe(a)
  })
  it('montage.keynote: cuerpo mínimo y líneas por montaje (los cortos 16:9, enormes); sin él, 8 % y 3 líneas', () => {
    const base = m([1920, 1080])
    expect(keynoteFit(base)).toEqual({ min: KEYNOTE_MIN, maxLines: 3 })
    const short: Montage = { ...base, keynote: { min: 0.11, maxLines: 4 } }
    expect(keynoteFit(short)).toEqual({ min: 0.11, maxLines: 4 })
    // a 11 % el titular necesita más columna: el panel del corto se estrecha más que el de la película
    const clip = { take: 'a', start: 0, dur: 4, layout: { kind: 'keynote' as const, side: 'right' as const, size: 0.62 } }
    const titles = [{ start: 0.2, dur: 2, text: 'It builds the *course.*', style: 'keynote' as const, side: 'left' as const }]
    const film = clipPanelRect({ ...base, clips: [clip], titles }, clip).w
    const strict = clipPanelRect({ ...base, keynote: { min: 0.11, maxLines: 3 }, clips: [clip], titles }, clip).w
    const shortW = clipPanelRect({ ...short, clips: [clip], titles }, clip).w
    expect(strict).toBeLessThan(film)
    // aceptar 4 líneas le quita menos sitio a la interfaz
    expect(shortW).toBeGreaterThanOrEqual(strict)
    // con 4 líneas admitidas, una palabra por línea cabe sin palabra suelta si todas son largas
    expect(cleanBreaks([300, 300, 300, 300], 20, 320, 4)).toBe(true)
    expect(cleanBreaks([300, 300, 300, 300], 20, 320, 3)).toBe(false)
  })
  it('whip: el desenfoque es lo que se mueve el plano con un obturador de 180° (medio fotograma)', () => {
    const D = 1920
    const dur = 0.35
    for (const p of [0.2, 0.5, 0.8]) {
      const blur = whipBlur(D, dur, p, 60)
      // desplazamiento real en medio fotograma (1/120 s) alrededor de p
      const dp = 1 / 120 / dur
      const real = D * (ease('inOut', p + dp / 2) - ease('inOut', p - dp / 2))
      expect(Math.abs(blur - real) / real).toBeLessThan(0.03)
      // a 30 fps el obturador está abierto el doble
      expect(whipBlur(D, dur, p, 30)).toBeCloseTo(blur * 2, 3)
    }
    expect(whipBlur(D, dur, 0, 60)).toBeLessThan(1) // parado al empezar y al acabar
    expect(whipBlur(D, dur, 1, 60)).toBeLessThan(1)
    expect(whipBlur(D, dur, 0.5, 60, 360)).toBeCloseTo(whipBlur(D, dur, 0.5, 60) * 2, 3)
  })
  it('un titular que sigue en pantalla en el plano siguiente: los dos paneles le dejan sitio y su columna cabe en ambos', () => {
    const a = { take: 'a', start: 0, dur: 1, layout: { kind: 'keynote' as const, side: 'left' as const, size: 0.62 } }
    const b = { take: 'a', start: 1, dur: 0.5, layout: { kind: 'keynote' as const, side: 'left' as const, size: 0.62 } }
    const mm: Montage = { ...m([1920, 1080]), keynote: { min: 0.11, maxLines: 4 }, clips: [a, b], titles: [{ start: 0, dur: 1.5, text: 'It builds the *course.*', style: 'keynote', side: 'right' }] }
    const pa = clipPanelRect(mm, a)
    const pb = clipPanelRect(mm, b)
    expect(pb.w).toBeCloseTo(pa.w)
    const col = keynoteColumn(mm, mm.titles![0])
    expect(col.x).toBeGreaterThanOrEqual(Math.max(pa.x + pa.w, pb.x + pb.w))
  })
})
