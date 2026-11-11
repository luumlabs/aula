// Los toques de pincel y la pasada de la fila elegida se describen aquí donde se puede sin lienzo: la hoja de estilos.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, 'paint.css'), 'utf8')
const recipes = readFileSync(join(__dirname, 'recipes.ts'), 'utf8')

describe('toques de pincel', () => {
  it('sin máscara pintada el cuadrado se ve como antes (la variable cae a `none`)', () => {
    const rules = css.match(/mask-image: var\(--dab-\d, none\)/g) ?? []
    expect(rules.length).toBe(8) // cuatro variantes, con y sin prefijo
    expect(css).not.toMatch(/mask-image: var\(--dab-\d\)/)
  })
  it('las cuatro variantes se reparten solas o se dicen a mano', () => {
    for (const n of [2, 3, 4]) expect(css).toContain(`.dab.dab-${n}`)
    expect(css).toContain('.dab:nth-child(4n + 2)')
  })
  it('la pasada de la fila elegida es una receta más, sin degradados ni desenfoques', () => {
    expect(recipes).toContain('{ band, tile, swatch, pass }')
    expect(css).not.toMatch(/gradient\(|blur\(/)
  })
})
