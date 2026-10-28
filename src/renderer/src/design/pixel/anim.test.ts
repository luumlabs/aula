import { describe, expect, it } from 'vitest'
import { boardFromRows, compileClip, compileFrame, frameAt, parseLegend, rep, resolveColor, runsOf, CLIP_NAMES, type FrameContext } from './anim'
import { SPRITES, PALETTE } from './sprites'
import { COMPANIONS } from './companions'
import { TONES, accentRamp } from './tones'
import { FX } from './fx'
import { ICON_ANIMS } from './iconAnims'
import { COMPANION_ANIMS } from './companionAnims'
import { companionAnim, eyeBoxes, iconAnim, workingIndex } from './characters'

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

/** Un tablero de 4×4 con margen 1 para probar las operaciones. */
function tiny(): FrameContext {
  const legend = parseLegend('a:white b:ink c:red2')
  const base = boardFromRows(['ab..', 'b...', '....', '....'], legend, 4, 1)
  const cels = new Map([['dot', { x: 2, y: 2, w: 2, h: 1, px: ['#e85a48', null] as (string | null | undefined)[] }]])
  return { base, legend, cels }
}
const at = (px: (string | null)[], x: number, y: number, m = 1, s = 6) => px[(y + m) * s + x + m]

describe('formato de animación pixel-art', () => {
  it('resuelve colores de la paleta, de la rampa del curso, de la paleta del compañero y hex', () => {
    expect(resolveColor('ink')).toBe(hex(PALETTE.ink))
    expect(resolveColor('a2', ['#111111', '#222222'])).toBe('#222222')
    expect(resolveColor('p1', undefined, ['#000000', '#abcdef'])).toBe('#abcdef')
    expect(resolveColor('#ABCDEF')).toBe('#abcdef')
    expect(() => parseLegend('x:nocolor')).toThrow()
    expect(() => parseLegend('.:ink')).toThrow()
  })

  it('un fotograma vacío es el dibujo base', () => {
    const ctx = tiny()
    expect(compileFrame('', ctx).px).toEqual(ctx.base.px)
  })

  it('pega parches (con desplazamiento y borrado), mueve, refleja, recolorea y mantiene', () => {
    const ctx = tiny()
    const white = hex(PALETTE.white)
    const ink = hex(PALETTE.ink)
    const p = compileFrame('dot@-1,0', ctx).px
    expect(at(p, 1, 2)).toBe('#e85a48')
    expect(at(p, 2, 2)).toBeNull()
    expect(at(compileFrame('@1,1', ctx).px, 1, 1)).toBe(white)
    expect(at(compileFrame('<>', ctx).px, 3, 0)).toBe(white)
    expect(at(compileFrame('%ab', ctx).px, 0, 0)).toBe(ink)
    expect(at(compileFrame('%a_', ctx).px, 0, 0)).toBeNull()
    expect(compileFrame('- *3', ctx).px.every((v) => v === null)).toBe(true)
    expect(compileFrame('*3', ctx).ticks).toBe(3)
    expect(() => compileFrame('nope', ctx)).toThrow(/nope/)
    expect(() => compileFrame('%zq', ctx)).toThrow()
  })

  it('cuenta los pasos de una pista y encuentra el fotograma de cada paso', () => {
    const clip = compileClip({ ms: 50, frames: ['', '*3', ''] }, tiny())
    expect(clip.ticks).toBe(5)
    expect([0, 1, 3, 4, 5].map((t) => frameAt(clip, t))).toEqual([0, 1, 1, 2, null])
    expect(rep(2, 'a', 'b')).toEqual(['a', 'b', 'a', 'b'])
  })

  it('agrupa en tramos los píxeles del mismo color', () => {
    const ctx = tiny()
    expect(runsOf(ctx.base.px, ctx.base.stride)).toHaveLength(3)
  })
})

describe('historias de los iconos de curso', () => {
  it('cada icono tiene reposo, ratón y celebración', () => {
    for (const s of SPRITES) {
      const spec = ICON_ANIMS[s.id]
      expect(spec, s.id).toBeDefined()
      for (const c of CLIP_NAMES) expect(spec[c], `${s.id}.${c}`).toBeDefined()
    }
  })

  it('compilan con todos los tonos y solo usan la paleta y la rampa del curso', () => {
    // un solo expect al final: un expect por píxel (millones) tardaba 10 s y se agotaba con la suite completa (J2-11)
    const fixed = new Set(Object.values(PALETTE).map(hex))
    const bad = new Set<string>()
    for (const tone of TONES) {
      const allowed = new Set([...fixed, ...accentRamp(tone)])
      for (const s of SPRITES) {
        const a = iconAnim(s.id, tone)
        for (const c of CLIP_NAMES) for (const f of a.clips[c]!.frames) for (const v of f.px) if (v && !allowed.has(v)) bad.add(`${tone.name}/${s.id}.${c}: ${v}`)
      }
    }
    expect([...bad]).toEqual([])
  })

  it('cada pista hace algo (algún fotograma distinto del base) y dura lo justo', () => {
    for (const s of SPRITES) {
      const a = iconAnim(s.id, TONES[0])
      for (const c of CLIP_NAMES) {
        const clip = a.clips[c]!
        expect(clip.frames.some((f) => f.px.some((v, i) => v !== a.base[i])), `${s.id}.${c} quieta`).toBe(true)
        const ms = clip.ticks * clip.ms
        expect(ms, `${s.id}.${c} dura ${ms} ms`).toBeLessThanOrEqual(c === 'idle' ? 3000 : c === 'hover' ? 5000 : 3500)
        expect(clip.still).toBeLessThan(clip.frames.length)
      }
    }
  })

  it('ningún parche propio tapa un efecto compartido sin querer', () => {
    for (const [id, spec] of Object.entries({ ...ICON_ANIMS, ...COMPANION_ANIMS })) for (const name of Object.keys(spec.cels ?? {})) expect(FX[name], `${id}.${name}`).toBeUndefined()
  })
})

describe('historias de los compañeros', () => {
  it('cada compañero tiene su historia, compila y solo usa su paleta o la de Aula', () => {
    const fixed = new Set(Object.values(PALETTE).map(hex))
    for (const c of COMPANIONS) {
      const spec = COMPANION_ANIMS[c.id]
      expect(spec, c.id).toBeDefined()
      for (const n of CLIP_NAMES) expect(spec[n], `${c.id}.${n}`).toBeDefined()
      const a = companionAnim(c.id)
      const allowed = new Set([...fixed, ...c.palette.map((p) => p.toLowerCase()), ...c.palette])
      const bad = new Set<string>()
      for (const n of CLIP_NAMES) {
        const clip = a.clips[n]!
        expect(clip.ticks * clip.ms, `${c.id}.${n}`).toBeLessThanOrEqual(n === 'hover' ? 5000 : 3500)
        for (const f of clip.frames) for (const v of f.px) if (v && !allowed.has(v)) bad.add(`${c.id}.${n}: ${v}`)
      }
      expect([...bad]).toEqual([])
      expect(a.working).toHaveLength(8)
    }
  })

  it('encuentra los ojos en la capa de ojos cerrados', () => {
    const gato = COMPANIONS.find((c) => c.id === 'gato')!
    const eyes = eyeBoxes(gato)
    expect(eyes).toHaveLength(2)
    expect(eyes[0]).toMatchObject({ x0: 8, x1: 9, y0: 9, y1: 11 })
  })

  it('el bucle «trabajando» da un índice de 0 a 7', () => {
    for (const c of COMPANIONS) for (const t of [0, 0.37, 1.2, 2.5, 7.9]) expect(workingIndex(c, t)).toBeGreaterThanOrEqual(0)
    for (const c of COMPANIONS) for (const t of [0, 1.2, 9.4]) expect(workingIndex(c, t)).toBeLessThan(8)
  })
})
