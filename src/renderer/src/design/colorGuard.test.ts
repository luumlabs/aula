// Nada violeta en la interfaz (decisión del dueño): tonos de los cursos, pixel-art, compañeros, logos, paletas de gráficas y
// cualquier color escrito a mano en el código de la interfaz.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COURSE_TONE_HUES, canonicalCourseHue, courseHueForTitle, coursePrintInk, courseToneFor } from '@shared/schema'
import { isViolet, rgbToOklch } from './colorGuard'
import { TONES, accentRamp, toneForHue } from './pixel/tones'
import { PALETTE } from './pixel/sprites'
import { COMPANIONS } from './pixel/companions'
import { BRAND_LOGOS } from './providers/logos'

const RENDERER = join(__dirname, '..')

function* sourceFiles(dir: string): Generator<string> {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) yield* sourceFiles(p)
    else if (/\.(ts|tsx|css)$/.test(f) && !/\.test\.tsx?$/.test(f)) yield p
  }
}

describe('el guardián del color', () => {
  it('reconoce el índigo, el ciruela y el lila; deja pasar azules, rosas, ladrillo y grises', () => {
    for (const c of ['#5753B0', '#8B4C86', '#A9A6F0', '#D49BCF', '#6950EF', '#8E75B2', '#b386ee']) expect(isViolet(c), c).toBe(true)
    for (const c of ['#3F6797', '#2E4D7B', '#B04664', '#8D3140', '#B4502F', '#22767A', '#fcfaf5', '#2a1e26', '#574D58']) expect(isViolet(c), c).toBe(false)
    expect(rgbToOklch(255, 255, 255).c).toBeLessThan(0.001)
  })
})

describe('nada violeta en Aula', () => {
  it('ningún tono de curso (relleno, tinta, rampa del pixel-art) es violeta, en claro ni en oscuro', () => {
    for (const t of TONES) {
      for (const c of [t.fillLight, t.inkLight, t.fillDark, t.inkDark, t.top, t.bottom, ...accentRamp(t)]) expect(isViolet(c), `${t.name} ${c}`).toBe(false)
    }
  })

  it('los tonos de la interfaz y los del proceso principal son los mismos', () => {
    expect(TONES.map((t) => [t.name, t.hue])).toEqual(Object.entries(COURSE_TONE_HUES))
  })

  it('cualquier hue guardado (también los antiguos índigo y ciruela) se pinta con un tono no violeta', () => {
    expect(toneForHue(0.68).name).toBe('navy')
    expect(toneForHue(0.72).name).toBe('navy')
    expect(toneForHue(0.78).name).toBe('wine')
    expect(toneForHue(0.8).name).toBe('wine')
    for (let h = 0; h <= 1; h += 0.0025) {
      const t = toneForHue(h)
      expect(isViolet(t.inkLight) || isViolet(t.inkDark), String(h)).toBe(false)
      expect(courseToneFor(h)).toBe(t.name)
      expect(isViolet(`#${coursePrintInk(h)}`)).toBe(false)
    }
  })

  it('un curso nuevo recibe uno de los diez tonos, repartidos', () => {
    const titles = ['Química general', 'English B2', 'Art history', 'Cell biology', 'AWS Cloud Practitioner', 'Trigonometría', 'Física I', 'Derecho romano', 'Música', 'Literatura']
    const hues = titles.map(courseHueForTitle)
    for (const h of hues) expect(Object.values(COURSE_TONE_HUES)).toContain(h)
    expect(new Set(hues).size).toBeGreaterThan(4)
    expect(canonicalCourseHue(0.71)).toBe(0.68)
  })

  it('la paleta del pixel-art no tiene morados', () => {
    for (const [name, c] of Object.entries(PALETTE)) expect(isViolet(c), name).toBe(false)
    expect(Object.keys(PALETTE).some((k) => k.startsWith('purple'))).toBe(false)
  })

  it('ningún compañero es violeta (libro, pluma, nota, cristal, mariposa…)', () => {
    for (const c of COMPANIONS) for (const col of c.palette) expect(isViolet(col), `${c.id} ${col}`).toBe(false)
  })

  it('los logos de las IA no se vuelven violetas al pasar el ratón', () => {
    for (const [id, l] of Object.entries(BRAND_LOGOS)) if (l.color) expect(isViolet(l.color), id).toBe(false)
  })

  it('no hay colores violetas escritos a mano en el código de la interfaz', () => {
    const found: string[] = []
    for (const file of sourceFiles(RENDERER)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/#([0-9a-fA-F]{6})\b|0x([0-9a-fA-F]{6})\b/g)) {
          if (isViolet(`#${m[1] ?? m[2]}`)) found.push(`${relative(RENDERER, file)}:${i + 1} ${m[0]}`)
        }
      })
    }
    expect(found).toEqual([])
  })
})
