// Port de Tests/StudyEngineTests/VisualContentTests.swift (sin las herramientas de la IA, que son de otro dominio).
import { describe, expect, it } from 'vitest'
import { decodeBlock, decodeDeck, decodeExercise, effectiveAspect, effectiveLabelMode, SimulationPresets, type Block, type Exercise } from '@shared/schema'
import { Input, MathKitChecker, basicGrade, grade } from '@engine/grading'
import { ContentValidator } from './validator'
import { ContentNormalizer } from './normalizer'
import { MoleculeBuilder, type Molecule } from './molecules'
import { SimulationEngine } from './simulation'
import { assetCredit, captionHasCredit, enrichBlock, imageSize } from './asset-meta'

const v = ContentValidator.withMath()
const block = (json: string): Block => decodeBlock(ContentNormalizer.block(JSON.parse(json)))!
const errors = (b: Block): string[] => v.checkBlock(b, 'b').filter((i) => i.severity === 'error').map((i) => i.message)

describe('validación de bloques visuales', () => {
  it('diagrama etiquetado', () => {
    const good = block('{"type":"labeled","alt":"célula","drawing":{"width":400,"height":300,"items":[{"kind":"circle","cx":200,"cy":150,"r":100}]},"parts":[{"id":"n","name":"Núcleo","x":0.5,"y":0.5,"r":0.08},{"id":"m","name":"Membrana","x":0.75,"y":0.5},{"id":"c","name":"Citoplasma","x":0.4,"y":0.7}]}')
    expect(errors(good)).toEqual([])
    const pct = block('{"type":"labeled","alt":"a","drawing":{"width":400,"height":300,"items":[{"kind":"dot","cx":1,"cy":1}]},"parts":[{"id":"a","name":"A","x":35,"y":40}]}')
    expect(errors(pct).some((m) => m.includes('porcentajes'))).toBe(true)
    const dup = block('{"type":"labeled","alt":"a","drawing":{"width":400,"height":300,"items":[{"kind":"dot","cx":1,"cy":1}]},"parts":[{"id":"a","name":"A","x":0.2,"y":0.2},{"id":"b","name":"A","x":0.8,"y":0.8},{"id":"big","name":"Grande","x":0.5,"y":0.5,"r":0.3},{"id":"small","name":"Pequeña","x":0.55,"y":0.5,"r":0.05},{"id":"lost","name":"Perdida","x":0.56,"y":0.51}]}')
    const e = errors(dup)
    expect(e.some((m) => m.includes('Dos partes se llaman'))).toBe(true)
    expect(e.some((m) => m.includes('Perdida') && m.includes('Pequeña'))).toBe(true)
    expect(errors(block('{"type":"labeled","alt":"a","parts":[{"name":"A","x":0.2,"y":0.2}]}')).some((m) => m.includes('necesita la figura'))).toBe(true)
  })

  it('las imágenes traídas de fuera necesitan crédito (y el enriquecimiento lo rellena)', () => {
    const meta = { kind: 'image', width: 300, height: 200, author: 'Wapcaplet', license: 'CC BY-SA 3.0', pageURL: 'https://commons.wikimedia.org/wiki/File:H.svg' }
    const bound = v.with({ assetExists: (id) => id === 'h.png', assetInfo: (id) => (id === 'h.png' ? meta : undefined) })
    const b = block('{"type":"labeled","alt":"corazón","asset":"h.png","parts":[{"id":"a","name":"Aorta","x":0.5,"y":0.2}]}')
    expect(bound.checkBlock(b, 'b').some((i) => i.severity === 'error' && i.message.includes('crédito'))).toBe(true)
    const enriched = enrichBlock(b, { meta: (id) => (id === 'h.png' ? meta : undefined) })
    expect(enriched.type === 'labeled' && enriched.credit).toBe('Wapcaplet · CC BY-SA 3.0 · Wikimedia Commons')
    expect(enriched.type === 'labeled' && enriched.aspect).toBeCloseTo(1.5, 9)
    expect(bound.checkBlock(enriched, 'b').some((i) => i.severity === 'error')).toBe(false)
    expect(bound.checkBlock(block('{"type":"image","asset":"nada.png","alt":"x"}'), 'b').some((i) => i.message.includes('no existe'))).toBe(true)
    expect(captionHasCredit('Foto: Wikimedia Commons')).toBe(true)
    expect(assetCredit({ kind: 'image', creditText: 'Museo del Prado' })).toBe('Museo del Prado')
  })

  it('3D, simulación, mapa, proceso, línea de tiempo y diapositivas', () => {
    expect(errors(block('{"type":"model3d","formula":"SF6","alt":"x"}'))).toEqual([])
    expect(errors(block('{"type":"model3d","formula":"C6H12O6","alt":"x"}')).some((m) => m.includes('No sé construir'))).toBe(true)
    expect(errors(block('{"type":"model3d","alt":"x","atoms":[{"element":"Qq","x":0,"y":0,"z":0}],"bonds":[{"a":0,"b":5}]}')).length).toBeGreaterThanOrEqual(2)
    expect(errors(block('{"type":"model3d","alt":"x","solids":[{"shape":"blob"}]}')).some((m) => m.includes('shape'))).toBe(true)
    for (const p of SimulationPresets.names) expect(errors(block(`{"type":"simulation","preset":"${p}"}`)), p).toEqual([])
    const be = errors(block('{"type":"simulation","params":[{"name":"k","min":1,"max":5,"value":2}],"derived":[{"name":"T","expr":"2*pi*sqrt(m/k)"}],"plot":{"curves":[{"expr":"k*x+q"}]}}'))
    expect(be.some((m) => m.includes('«m»')), be.join('\n')).toBe(true)
    expect(be.some((m) => m.includes('«q»')), be.join('\n')).toBe(true)
    expect(errors(block('{"type":"simulation","preset":"warp-drive"}')).some((m) => m.includes('desconocido'))).toBe(true)
    expect(errors(block('{"type":"map","markers":[{"lat":-3.7,"lon":240,"title":"Madrid"}]}')).some((m) => m.includes('fuera de rango'))).toBe(true)
    expect(errors(block('{"type":"map","practice":true,"markers":[{"lat":1,"lon":1,"title":"A"},{"lat":2,"lon":2,"title":"A"},{"lat":3,"lon":3,"title":"B"}]}')).some((m) => m.includes('mismo título'))).toBe(true)
    expect(errors(block('{"type":"diagram","kind":"cycle","nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"steps":[{"md":"uno","nodes":["a"]},{"md":"dos","nodes":["zz"]}]}')).some((m) => m.includes('«zz»'))).toBe(true)
    expect(errors(block('{"type":"timeline","layout":"horizontal","events":[{"when":"1789","title":"A"},{"when":"cuando sea","title":"B"}]}')).some((m) => m.includes('cuando sea'))).toBe(true)
    const deck = decodeDeck({ title: 'D', slides: [{ layout: 'comparison', title: 'x', blocks: ['a'] }, { layout: 'image', title: 'y' }] })!
    const de = v.checkDeck(deck, 'd').filter((i) => i.severity === 'error').map((i) => i.message)
    expect(de.some((m) => m.includes('right'))).toBe(true)
    expect(de.some((m) => m.includes('image'))).toBe(true)
  })
})

describe('corrección de los ejercicios de figura', () => {
  const locateExercise = (spots: string, mode = 'locate'): Exercise =>
    decodeExercise(ContentNormalizer.exercise(JSON.parse(`{"id":"e","level":2,"prompt":"Señala…","answer":{"kind":"${mode}","drawing":{"width":400,"height":200,"items":[{"kind":"dot","cx":1,"cy":1}]},"spots":${spots}},"solution":"s"}`), 's', 'e'))!

  it('«señala la parte» se corrige con exactitud', () => {
    const ex = locateExercise('[{"x":0.25,"y":0.5,"r":0.1,"accepted":["Aurícula derecha"]},{"x":0.75,"y":0.5,"r":0.1,"accepted":["Ventrículo izquierdo","VI"]}]')
    expect(ex.answer.kind).toBe('label')
    if (ex.answer.kind !== 'label') return
    expect(effectiveLabelMode(ex.answer)).toBe('locate')
    expect(effectiveAspect(ex.answer)).toBeCloseTo(2, 9)
    expect(grade(ex, Input.blanks(['0.26,0.62', '0.74,0.40'])).status).toBe('correct')
    const half = grade(ex, Input.blanks(['0.25,0.5', '0.25,0.5']))
    expect(half.status).toBe('partial')
    expect(half.credit).toBeCloseTo(0.5, 9)
    expect(half.parts[1].feedback[0]?.markdown).toContain('Aurícula derecha')
    expect(grade(ex, Input.blanks(['0.5,0.05', ''])).status).toBe('incorrect')
    expect(grade(ex, Input.blanks(['', ''])).status).toBe('invalid')
    expect(MathKitChecker.selfCheck(ex)).toEqual([])
    expect(v.checkExercise(ex, 'e').filter((i) => i.severity === 'error')).toEqual([])
    expect(basicGrade(ex, Input.blanks(['0.25,0.5', '0.75,0.5'])).status).toBe('correct')
  })

  it('el validador encuentra puntos tragados por la zona de otra parte', () => {
    const ex = locateExercise('[{"x":0.5,"y":0.5,"r":0.05,"accepted":["A"]},{"x":0.51,"y":0.5,"accepted":["B"]}]')
    expect(v.checkExercise(ex, 'e').filter((i) => i.severity === 'error').length).toBeGreaterThan(0)
  })

  it('arrastrar y elegir del banco se corrigen por el nombre', () => {
    const ex = locateExercise('[{"x":0.2,"y":0.5,"accepted":["Núcleo"]},{"x":0.8,"y":0.5,"accepted":["Mitocondria"]}]', 'draglabel')
    expect(grade(ex, Input.blanks(['Núcleo', 'Mitocondria'])).status).toBe('correct')
    expect(grade(ex, Input.blanks(['Mitocondria', 'Núcleo'])).status).toBe('incorrect')
    if (ex.answer.kind !== 'label') throw new Error('rotular')
    const bank: Exercise = { ...ex, answer: { ...ex.answer, wordBank: ['Núcleo', 'Lisosoma'] } }
    expect(v.checkExercise(bank, 'e').some((i) => i.severity === 'error' && i.message.includes('wordBank'))).toBe(true)
  })
})

describe('moléculas (VSEPR)', () => {
  const angle = (m: Molecule, a: number, c: number, b: number): number => {
    const p = m.atoms
    const u = [p[a].x - p[c].x, p[a].y - p[c].y, p[a].z - p[c].z], w = [p[b].x - p[c].x, p[b].y - p[c].y, p[b].z - p[c].z]
    const dot = u[0] * w[0] + u[1] * w[1] + u[2] * w[2]
    return (Math.acos(dot / (Math.hypot(...u) * Math.hypot(...w))) * 180) / Math.PI
  }
  it('geometrías', () => {
    const ch4 = MoleculeBuilder.build('CH4')!
    expect(ch4.vsepr).toBe('AX4')
    expect(Math.abs(angle(ch4, 1, 0, 2) - 109.47)).toBeLessThan(0.1)
    const h2o = MoleculeBuilder.build('agua')!
    expect(h2o.vsepr).toBe('AX2E2')
    expect(Math.abs(angle(h2o, 1, 0, 2) - 104.5)).toBeLessThan(0.1)
    expect(h2o.lonePairs.length).toBe(2)
    const nh3 = MoleculeBuilder.build('NH3')!
    expect(nh3.vsepr).toBe('AX3E')
    expect(Math.abs(angle(nh3, 1, 0, 2) - 107)).toBeLessThan(0.5)
    const co2 = MoleculeBuilder.build('CO2')!
    expect(co2.vsepr).toBe('AX2')
    expect(co2.bonds.map((b) => b.order)).toEqual([2, 2])
    expect(Math.abs(angle(co2, 1, 0, 2) - 180)).toBeLessThan(0.1)
    expect(MoleculeBuilder.build('XeF4')?.vsepr).toBe('AX4E2')
    expect(MoleculeBuilder.build('SF4')?.vsepr).toBe('AX4E')
    expect(MoleculeBuilder.build('ClF3')?.vsepr).toBe('AX3E2')
    expect(MoleculeBuilder.build('SO4^2-')?.vsepr).toBe('AX4')
    expect(MoleculeBuilder.build('NO3-')?.vsepr).toBe('AX3')
    expect(MoleculeBuilder.build('NH4+')?.vsepr).toBe('AX4')
    expect(MoleculeBuilder.build('SO2')?.vsepr).toBe('AX2E')
    expect(MoleculeBuilder.build('HCN')?.vsepr).toBe('AX2')
    expect(MoleculeBuilder.build('benceno')?.atoms.length).toBe(12)
    expect(MoleculeBuilder.build('C2H5OH')?.atoms.length).toBe(9)
    expect(MoleculeBuilder.build('NaCl')?.atoms.length).toBe(27)
    expect(MoleculeBuilder.build('N2')?.bonds[0]?.order).toBe(3)
    expect(MoleculeBuilder.build('C6H12O6')).toBeUndefined()
    expect(MoleculeBuilder.build('Xx2')).toBeUndefined()
    const et = MoleculeBuilder.build('etanol')!
    const [a, b] = et.atoms
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeCloseTo(1.512, 3)
    expect(MoleculeBuilder.bondsByDistance(ch4.atoms).length).toBe(4)
    expect(MoleculeBuilder.build('SO4^9999999999-')).toBeUndefined()
  })
})

describe('simulaciones', () => {
  it('evalúa los modelos y las variables de varias letras', () => {
    const e = new SimulationEngine(SimulationPresets.make('projectile')!)
    expect(e.problems().filter((p) => p.isError)).toEqual([])
    const env = e.environment({ v0: 25, theta: 45, h0: 0 }, undefined)
    expect(env[SimulationEngine.key('R')]).toBeCloseTo((25 * 25) / 9.81, 6)
    const tb = e.timeBounds({ v0: 25, theta: 45, h0: 0 })!
    expect(tb[0]).toBe(0)
    expect(tb[1]).toBeCloseTo((2 * 25 * Math.sin(Math.PI / 4)) / 9.81, 6)
    const objs = e.resolve(e.initialParams, tb[1] / 2)
    expect(objs.some((o) => o.kind === 'point')).toBe(true)
    expect(objs.some((o) => o.kind === 'polyline' && o.points.length > 50)).toBe(true)
    for (const name of SimulationPresets.names) {
      const eng = new SimulationEngine(SimulationPresets.make(name)!)
      expect(eng.problems().filter((p) => p.isError), name).toEqual([])
      const env2 = eng.environment(eng.initialParams, undefined)
      for (const d of eng.block.derived) expect(env2[SimulationEngine.key(d.name)], `${name}.${d.name}`).toBeDefined()
    }
    expect(SimulationEngine.format(2.5, 2)).toBe('2.50')
    expect(SimulationEngine.format(2.5, undefined, ',')).toBe('2,5')
  })
})

describe('normalizador de bloques visuales', () => {
  it('arregla las formas habituales', () => {
    const l = block('{"type":"labelled_diagram","image":"x.png","hotspots":[{"label":"A","pos":[0.2,0.3]},{"name":"B","x":"35%","y":"40%","description":"bla"}]}')
    expect(l.type).toBe('labeled')
    if (l.type === 'labeled') {
      expect(l.asset).toBe('x.png')
      expect(l.parts.length).toBe(2)
      expect(l.parts[0].x).toBeCloseTo(0.2, 9)
      expect(l.parts[1].x).toBeCloseTo(0.35, 9)
      expect(l.parts[1].detail).toBe('bla')
    }
    const m = block('{"type":"map","places":[{"name":"Lima","coords":[-12.05,-77.04]}]}')
    expect(m.type === 'map' && m.markers[0]?.lat).toBe(-12.05)
    const s = block('{"type":"simulation","sliders":[{"symbol":"k","range":[1,9],"default":3}],"curves":["k*x"]}')
    expect(s.type).toBe('simulation')
    if (s.type === 'simulation') {
      expect(s.params[0]?.name).toBe('k')
      expect(s.params[0]?.max).toBe(9)
      expect(s.params[0]?.value).toBe(3)
      expect(s.plot.curves[0]?.expr).toBe('k*x')
    }
    const m3 = block('{"type":"3d","atoms":[["O",0,0,0],["H",0.96,0,0]]}')
    expect(m3.type === 'model3d' && m3.atoms.map((a) => a.element)).toEqual(['O', 'H'])
  })
})

describe('medidas de imagen', () => {
  it('lee la cabecera de un PNG', () => {
    const png = new Uint8Array(32)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0x90, 0, 0, 1, 0xf4])
    expect(imageSize(png)).toEqual([400, 500])
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeUndefined()
  })
})
