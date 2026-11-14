import { describe, expect, it } from 'vitest'
import { boxAt, intersects } from '../plot/labels'
import { clipText, fitsTwoLines, isNumericLabel, isTimeAxis, isTimeLabel, labelLines, preferHorizontal, shortTimeLabels, splitLabel } from './scale'
import { namedPoint, placeScatterLabels, scatterLabelCandidates } from './pointLabels'
import { hbarPath } from './HBarChart'

/** Medida falsa: 6 px por carácter. */
const fake = (s: string): number => Array.from(s).length * 6

describe('nombres largos de las categorías', () => {
  it('parte en dos líneas por el corte más equilibrado', () => {
    expect(splitLabel('Enfermedades cardiovasculares', 90, fake)).toEqual(['Enfermedades', 'cardiovasculares'])
    expect(splitLabel('Cáncer de pulmón y bronquios', 100, fake)).toEqual(['Cáncer de pulmón', 'y bronquios'])
    expect(splitLabel('Lun', 60, fake)).toEqual(['Lun'])
  })
  it('una sola palabra vuelve igual (se recorta al dibujarla)', () => {
    expect(splitLabel('Electroencefalografía', 40, fake)).toEqual(['Electroencefalografía'])
    expect(clipText('Electroencefalografía', 60, fake)).toBe('Electroen…')
    expect(fake(clipText('Electroencefalografía', 60, fake))).toBeLessThanOrEqual(60)
    expect(labelLines('Electroencefalografía clínica', 60, fake).every((l) => fake(l) <= 60)).toBe(true)
  })
  it('¿caben en dos líneas?', () => {
    expect(fitsTwoLines('Enfermedades cardiovasculares', 100, fake)).toBe(true)
    expect(fitsTwoLines('Enfermedades cardiovasculares', 60, fake)).toBe(false)
  })
  it('barras horizontales para nombres largos; no para Lun…Dom ni para fechas', () => {
    const causes = ['Enfermedades cardiovasculares', 'Cáncer de pulmón', 'Enfermedad de Alzheimer', 'Enfermedad pulmonar obstructiva crónica', 'Diabetes mellitus', 'Accidentes de tráfico']
    expect(preferHorizontal(causes, 60, fake)).toBe(true)
    expect(preferHorizontal(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'], 60, fake)).toBe(false)
    expect(preferHorizontal(['A muy largo de verdad', 'B'], 20, fake)).toBe(false)
    expect(isNumericLabel('2024')).toBe(true)
    expect(isNumericLabel('3,5')).toBe(true)
    expect(isNumericLabel('Lun')).toBe(false)
  })
  it('los meses (un climograma) siguen en vertical aunque no quepan enteros bajo su barra', () => {
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    // 720 px de gráfica: 55 px por mes; «Septiembre» no cabe ni en dos líneas
    expect(fitsTwoLines('Septiembre', 49, fake)).toBe(false)
    expect(preferHorizontal(meses, 55, fake)).toBe(false)
    expect(preferHorizontal(months, 55, fake, 'en')).toBe(false)
    expect(preferHorizontal(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'], 30, fake)).toBe(false)
    expect(preferHorizontal(['T1 2024', 'T2 2024', 'T3 2024', 'T4 2024'], 20, fake)).toBe(false)
    // una palabra que no es tiempo sí puede pasar a filas
    expect(preferHorizontal(['Electroencefalografía', 'Radiografía', 'Ecografía'], 40, fake)).toBe(true)
  })
  it('reconoce meses, días y trimestres (y no las palabras que se les parecen)', () => {
    for (const l of ['Enero', 'ene.', 'Mar 2024', '1 de enero', 'Lunes', 'mié', 'Sept', 'T1', 'Q3 2024', '4T', 'Aug', 'Thursday']) expect(isTimeLabel(l), l).toBe(true)
    for (const l of ['Tierra', 'Enfermedad', 'Mar Mediterráneo', 'Q5', '']) expect(isTimeLabel(l), l).toBe(false)
    expect(isTimeAxis(['Mar', 'Tierra', 'Aire'])).toBe(false)
    expect(isTimeAxis(['2023', 'Enero 2024', 'Febrero 2024'])).toBe(true)
    expect(isTimeAxis(['2023', '2024'])).toBe(false)
    // en la lengua del curso (Intl)
    expect(isTimeLabel('Januar', 'de')).toBe(true)
    expect(isTimeLabel('janvier', 'fr')).toBe(true)
  })
  it('meses y días abreviados para que quepan todos bajo el eje', () => {
    expect(shortTimeLabels(['Enero', 'Febrero', 'Septiembre', 'Diciembre'])).toEqual(['Ene', 'Feb', 'Sep', 'Dic'])
    expect(shortTimeLabels(['Miércoles 3', 'Jueves 4', '1 de enero'])).toEqual(['Mié 3', 'Jue 4', '1 de ene'])
    expect(shortTimeLabels(['January', 'May', 'T1'], 'en')).toEqual(['Jan', 'May', 'T1'])
    // si dos se abreviarían igual («juin» y «juillet»), nada; tampoco si no son tiempo
    expect(shortTimeLabels(['juin', 'juillet', 'août'], 'fr')).toBeUndefined()
    expect(shortTimeLabels(['Enfermedades', 'Cáncer'])).toBeUndefined()
  })
  it('barra horizontal con el extremo redondeado hacia su lado', () => {
    expect(hbarPath(10, 0, 50, 16, true, 4)).toMatch(/^M10 0H56Q60 0 60 4/)
    expect(hbarPath(10, 0, 50, 16, false, 4)).toMatch(/^M60 0H14Q10 0 10 4/)
    expect(hbarPath(10, 0, 0, 16, true, 4)).toBe('')
  })
})

describe('nombres junto a los puntos de una dispersión', () => {
  const frame = { x: 0, y: 0, w: 400, h: 300 }
  it('cuatro sitios alrededor del punto', () => {
    expect(scatterLabelCandidates(100, 100)).toHaveLength(4)
  })
  it('dos puntos cercanos: sus nombres no se pisan ni pisan los puntos', () => {
    const pts = [{ x: 100, y: 100, label: 'España' }, { x: 104, y: 112, label: 'Portugal' }]
    const placed = placeScatterLabels(pts, fake, frame)
    expect(placed).toHaveLength(2)
    const [a, b] = placed.map((l) => boxAt(l.at, l.w, l.h))
    expect(intersects(a, b)).toBe(false)
    for (const box of [a, b]) for (const p of pts) expect(intersects(box, { x: p.x - 5, y: p.y - 5, w: 10, h: 10 })).toBe(false)
  })
  it('los números no se escriben como nombre; demasiados nombres, ninguno (salvo en papel)', () => {
    expect(namedPoint({ x: 0, y: 0, label: '12.5' })).toBe(false)
    expect(placeScatterLabels([{ x: 10, y: 10, label: '3' }], fake, frame)).toEqual([])
    const many = Array.from({ length: 40 }, (_, i) => ({ x: 20 + (i % 8) * 45, y: 20 + Math.floor(i / 8) * 50, label: `P${i}` }))
    expect(placeScatterLabels(many, fake, frame)).toEqual([])
    expect(placeScatterLabels(many, fake, frame, { always: true }).length).toBeGreaterThan(20)
  })
  it('el destacado se coloca primero', () => {
    const pts = [{ x: 100, y: 100, label: 'Uno' }, { x: 100, y: 100, label: 'Dos', highlight: true }]
    const placed = placeScatterLabels(pts, fake, frame)
    expect(placed.find((l) => l.index === 1)?.at.ax).toBe(0)
  })
})
