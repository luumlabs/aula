// Pruebas de SMILES; las pruebas de etiquetas y enlaces están adaptadas de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs:
// test/science.test.ts.
import { describe, expect, it } from 'vitest'
import { parseSmiles, parseStructure, withExplicitHydrogens } from './smiles'
import { depictStructure, type Depiction, type DepictOptions } from './structure-depict'
import { layoutStructure } from './structure-layout'

const depict = (smiles: string, opts: DepictOptions = {}): Depiction => {
  const parsed = parseStructure(smiles)
  const mol = opts.style === 'expanded' ? withExplicitHydrogens(parsed.molecule) : parsed.molecule
  return depictStructure(mol, layoutStructure(mol, { straight: opts.style === 'condensed' || opts.style === 'expanded' }), { ...opts, species: parsed.species })
}
const labels = (smiles: string, opts: DepictOptions = {}): string[] => depict(smiles, opts).labels.map((l) => l.text)
const segments = (d: Depiction): number => d.bonds.reduce((s, b) => s + b.segments.length, 0)

describe('etiquetas (como en Sketchy)', () => {
  it('los heteroátomos llevan sus H y los carbonos no', () => {
    expect(labels('CCO')).toEqual(['OH'])
    expect(labels('O')).toEqual(['H₂O'])
    expect(labels('C')).toEqual(['CH₄'])
    expect(labels('CC', { style: 'condensed' })).toEqual(['H₃C', 'CH₃'])
    expect(labels('[NH4+]')).toEqual(['NH₄⁺'])
  })
  it('los H van al lado libre', () => {
    const left = depict('OCC').labels[0]
    expect(left.text).toBe('HO')
    expect(left.hSide).toBe('left')
    expect(depict('CCO').labels[0].hSide).toBe('right')
    expect(labels('[OH-]')).toEqual(['OH⁻'])
    expect(labels('[OH3+]')).toEqual(['H₃O⁺'])
    expect(labels('Cl')).toEqual(['HCl'])
  })
  it('grupos R con su número e isótopos', () => {
    expect(labels('*C(=O)O')).toEqual(['R', 'O', 'OH'])
    expect(labels('[*:1]CC[*:2]')).toEqual(['R¹', 'R²'])
    const iso = depict('[13CH4]').labels[0]
    expect(iso.isotope).toBe(13)
    expect(iso.parts.map((p) => p.role)).toEqual(['element', 'isotope', 'hydrogen', 'count'])
  })
  it('el etano, el eteno y el etino (dos carbonos) se escriben con letras', () => {
    expect(labels('C=C')).toEqual(['H₂C', 'CH₂'])
    expect(labels('C#C')).toEqual(['HC', 'CH'])
  })
})

describe('enlaces y anillos', () => {
  it('benceno de Kekulé: 9 trazos, los 3 de dentro más cortos y hacia el centro', () => {
    const d = depict('C1=CC=CC=C1')
    expect(segments(d)).toBe(9)
    const cx = d.atoms.reduce((s, a) => s + a.x, 0) / 6
    const cy = d.atoms.reduce((s, a) => s + a.y, 0) / 6
    for (const b of d.bonds.filter((x) => x.kind === 'double')) {
      const [outer, inner] = b.segments
      const len = (s: number[]): number => Math.hypot(s[2] - s[0], s[3] - s[1])
      const mid = (s: number[]): number => Math.hypot((s[0] + s[2]) / 2 - cx, (s[1] + s[3]) / 2 - cy)
      expect(len(inner)).toBeLessThan(len(outer))
      expect(mid(inner)).toBeLessThan(mid(outer))
    }
  })
  it('benceno aromático: un círculo; en Kekulé, tres dobles', () => {
    expect(depict('c1ccccc1').circles).toHaveLength(1)
    expect(depict('c1ccccc1', { aromatic: 'kekule' }).bonds.filter((b) => b.kind === 'double')).toHaveLength(3)
    expect(depict('c1ccc2ccccc2c1').circles).toHaveLength(2)
  })
  it('la cafeína aromática se dibuja como la de Kekulé (sin círculo engañoso)', () => {
    const a = depict('Cn1cnc2c1c(=O)n(C)c(=O)n2C')
    const k = depict('CN1C=NC2=C1C(=O)N(C(=O)N2C)C')
    expect(a.circles).toHaveLength(0)
    expect(a.bonds.filter((b) => b.kind === 'double')).toHaveLength(k.bonds.filter((b) => b.kind === 'double').length)
    // en «circle» sí lleva círculos
    expect(depict('Cn1cnc2c1c(=O)n(C)c(=O)n2C', { aromatic: 'circle' }).circles).toHaveLength(2)
  })
  it('triple: 3 trazos; O=C=O: dos dobles centrados', () => {
    const nitrile = depict('CC#N')
    expect(nitrile.bonds.find((b) => b.kind === 'triple')?.segments).toHaveLength(3)
    const co2 = depict('O=C=O')
    expect(co2.bonds.every((b) => b.kind === 'double' && b.segments.length === 2)).toBe(true)
  })
  it('ningún extremo de enlace entra en la letra de otro átomo (cafeína, aspirina)', () => {
    for (const s of ['CN1C=NC2=C1C(=O)N(C(=O)N2C)C', 'CC(=O)OC1=CC=CC=C1C(=O)O', 'CC(=O)NC1=CC=C(C=C1)O']) {
      const d = depict(s)
      for (const b of d.bonds) {
        for (const seg of b.segments) {
          for (const l of d.labels) {
            for (const [x, y] of [[seg[0], seg[1]], [seg[2], seg[3]]]) {
              const inside = x > l.box.x + 0.5 && x < l.box.x + l.box.w - 0.5 && y > l.box.y + 0.5 && y < l.box.y + l.box.h - 0.5
              expect(inside).toBe(false)
            }
          }
        }
      }
    }
  })
  it('el orden de trazado recorre todos los enlaces una vez', () => {
    const d = depict('CC(=O)OC1=CC=CC=C1C(=O)O')
    expect([...d.drawOrder].sort((a, b) => a - b)).toEqual(d.bonds.map((b) => b.index).sort((a, b) => a - b))
  })
})

describe('estilos', () => {
  it('semidesarrollada: cada carbono con sus H', () => {
    expect(labels('CCO', { style: 'condensed' })).toEqual(['H₃C', 'CH₂', 'OH'])
  })
  it('desarrollada: el etanol tiene 9 átomos con letra y 8 enlaces', () => {
    const d = depict('CCO', { style: 'expanded' })
    expect(d.labels).toHaveLength(9)
    expect(d.bonds).toHaveLength(8)
    expect(d.labels.slice(0, 3).map((l) => l.text)).toEqual(['C', 'C', 'O'])
  })
  it('notas junto a su átomo', () => {
    const d = depict('CC(=O)O', { notes: [{ atom: 1, text: 'α' }] })
    expect(d.notes).toHaveLength(1)
    expect(Math.hypot(d.notes[0].x - d.atoms[1].x, d.notes[0].y - d.atoms[1].y)).toBeLessThan(40)
  })
})

describe('reacciones', () => {
  it('esterificación: «+», flecha y especies sin solaparse', () => {
    const d = depict('CC(=O)O.OCC>>CC(=O)OCC.O', { conditions: 'H₂SO₄, calor' })
    expect(d.symbols.map((s) => s.kind)).toEqual(['plus', 'arrow', 'plus'])
    const arrow = d.symbols[1]
    expect(arrow.above).toBe('H₂SO₄, calor')
    // los reactivos a la izquierda de la flecha y los productos a la derecha
    for (let i = 0; i < 7; i++) expect(d.atoms[i].x).toBeLessThan(arrow.x)
    for (let i = 7; i < 14; i++) expect(d.atoms[i].x).toBeGreaterThan(arrow.x2!)
  })
  it('los agentes van sobre la flecha como fórmula', () => {
    const d = depict('C=C.[H][H]>[Ni]>CC')
    const arrow = d.symbols.find((s) => s.kind === 'arrow')
    expect(arrow?.above).toBe('Ni')
    expect(d.atoms.filter((a) => a.hidden)).toHaveLength(1)
  })
  it('equilibrio', () => {
    expect(depict('N#N.[H][H]>>N', { reversible: true }).symbols.some((s) => s.kind === 'equilibrium')).toBe(true)
  })
})

describe('molécula sola', () => {
  it('[Na+].[Cl-]: dos etiquetas separadas', () => {
    const d = depict('[Na+].[Cl-]')
    expect(d.labels.map((l) => l.text)).toEqual(['Na⁺', 'Cl⁻'])
    expect(d.labels[0].box.x + d.labels[0].box.w).toBeLessThan(d.labels[1].box.x)
  })
  it('límites que contienen todo', () => {
    const d = depict('CC(=O)Oc1ccccc1C(=O)O')
    for (const l of d.labels) {
      expect(l.box.x).toBeGreaterThanOrEqual(d.bounds.x - 0.01)
      expect(l.box.x + l.box.w).toBeLessThanOrEqual(d.bounds.x + d.bounds.w + 0.01)
    }
  })
  it('parseSmiles directo también sirve', () => {
    const mol = parseSmiles('CCO')
    expect(depictStructure(mol, layoutStructure(mol)).labels).toHaveLength(1)
  })
})
