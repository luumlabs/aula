// Validación de los bloques visuales (port de StudyEngine/Content/VisualValidation.swift): diagrama etiquetado, 3D,
// simulación, mapa, procesos, línea de tiempo y diapositivas. Estricta donde un fallo rompe la experiencia o la corrección
// (coordenadas fuera de la figura, partes con el mismo nombre en un ejercicio de señalar, expresiones que no se entienden,
// imágenes ajenas sin crédito) y con avisos para lo mejorable.
import {
  effectiveAspect, effectiveLabelMode, FigureGeometry, HistoricalDate, labelAnswerParts, MODEL_EXTENSIONS, SimulationPresets, SOLID_SHAPES,
  cardTargetPart, simulationSymbolNames,
  type AnswerOf, type CardFigure, type ContentIssue, type DiagramBlock, type FigureLayer, type FigurePart, type IssueSeverity, type LabeledBlock, type MapBlock,
  type Model3DBlock, type SimulationBlock, type Slide, type SourceRef, type TimelineBlock
} from '@shared/schema'
import { freeVariables } from '@engine/math/core/expr'
import type { ContentValidator } from './validator'
import { assetCredit, assetNeedsCredit, captionHasCredit } from './asset-meta'
import { buildMolecule, ELEMENT_SYMBOLS } from './molecules'
import { SimulationEngine } from './simulation'
import { latexIssues, texProblems } from './tex'

const issue = (severity: IssueSeverity, path: string, message: string): ContentIssue => ({ severity, path, message })
/** Números en mensajes (sin notación rara), como `%g`. */
const n = (v: number): string => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : '?')
const inUnit = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= 1

// MARK: Créditos

/** Una imagen o modelo traído de fuera (con autor o licencia en su ficha) debe citarlo en `credit` o en el pie. */
export function checkCredit(v: ContentValidator, asset: string | undefined, credit: string | undefined, caption: string | undefined, path: string): ContentIssue[] {
  if (asset === undefined) return []
  const meta = v.assetInfo(asset)
  if (!meta || !assetNeedsCredit(meta)) return []
  if (credit && credit.trim()) return []
  if (captionHasCredit(caption)) return []
  const example = assetCredit(meta)
  return [issue('error', path + '.credit', `Falta el crédito de la imagen «${asset}»: escribe en \`credit\` el autor y la licencia` + (example ? ` (p. ej. «${example}»)` : '') + '.')]
}

// MARK: Partes de una figura

export function checkParts(parts: readonly FigurePart[], layers: readonly FigureLayer[], aspect: number, path: string, strictNames: boolean, pixelSize?: [number, number]): ContentIssue[] {
  const out: ContentIssue[] = []
  const layerIDs = new Set(layers.map((l) => l.id))
  const pixHint = pixelSize ? ` (la imagen mide ${pixelSize[0]}×${pixelSize[1]} px: divide x entre ${pixelSize[0]} e y entre ${pixelSize[1]})` : ''
  let looksPercent = false
  parts.forEach((p, i) => {
    const pp = `${path}[${i}]`
    if (!p.name.trim()) out.push(issue('error', pp + '.name', 'La parte no tiene nombre.'))
    if (!inUnit(p.x) || !inUnit(p.y)) {
      if (p.x > 1 && p.x <= 100 && p.y >= 0 && p.y <= 100) looksPercent = true
      out.push(issue('error', pp, `x e y deben ser fracciones entre 0 y 1 del ancho y el alto de la figura (hay x=${n(p.x)}, y=${n(p.y)})${pixHint}.`))
    }
    if (p.r !== undefined && !(p.r > 0 && p.r <= 0.5)) out.push(issue('error', pp + '.r', 'r es el radio de la zona como fracción del ancho (entre 0 y 0,5).'))
    if (p.rect) {
      const r = p.rect
      if (r.length !== 4 || !r.every(Number.isFinite) || r[2] <= 0 || r[3] <= 0 || r[0] < -0.001 || r[1] < -0.001 || r[0] + r[2] > 1.001 || r[1] + r[3] > 1.001) {
        out.push(issue('error', pp + '.rect', 'rect es [x, y, ancho, alto] en fracciones de la figura, dentro de 0–1.'))
      }
    }
    if (p.polygon && (p.polygon.length < 3 || p.polygon.some((q) => q.length < 2 || !inUnit(q[0]) || !inUnit(q[1])))) {
      out.push(issue('error', pp + '.polygon', 'polygon necesita al menos 3 puntos [x, y] con fracciones entre 0 y 1.'))
    }
    if (FigureGeometry.hasRegion(p) && !FigureGeometry.contains(p, p.x, p.y, aspect, 0.01)) out.push(issue('warning', pp, `El punto (x, y) de «${p.name}» queda fuera de su zona: ponlo dentro.`))
    if (p.layer !== undefined && layerIDs.size && !layerIDs.has(p.layer)) out.push(issue('error', pp + '.layer', `La capa «${p.layer}» no existe (capas: ${[...layerIDs].sort().join(', ')}).`))
    if (p.detail !== undefined) out.push(...latexIssues(p.detail, pp + '.detail'))
  })
  if (looksPercent) out.push(issue('error', path, 'Parece que usaste porcentajes (0–100): divide entre 100.'))
  const names = new Map<string, number>()
  parts.forEach((p, i) => {
    const k = p.name.toLowerCase().trim()
    const j = names.get(k)
    if (j !== undefined) out.push(issue(strictNames ? 'error' : 'warning', `${path}[${i}]`, `Dos partes se llaman «${p.name}» (la ${j + 1} y la ${i + 1}): en la práctica de señalar no se distinguirían.`))
    else names.set(k, i)
  })
  const ids = new Set<string>()
  parts.forEach((p, i) => { if (ids.has(p.id)) out.push(issue('error', `${path}[${i}].id`, `Id de parte repetido «${p.id}».`)); ids.add(p.id) })
  // anclajes casi encima unos de otros
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (FigureGeometry.distance(parts[i].x, parts[i].y, parts[j].x, parts[j].y, aspect) < 0.02) {
      out.push(issue('warning', `${path}[${j}]`, `«${parts[j].name}» está casi en el mismo punto que «${parts[i].name}»: sepáralos o dale a cada uno su zona.`))
    }
  }
  // cada anclaje debe señalar su propia parte (si no, «señala X» se corregiría mal)
  parts.forEach((p, i) => {
    if (!inUnit(p.x) || !inUnit(p.y)) return
    const h = FigureGeometry.hit(p.x, p.y, [...parts], aspect)
    if (h !== undefined && h !== i && parts[h].name.toLowerCase() !== p.name.toLowerCase()) {
      out.push(issue(strictNames ? 'error' : 'warning', `${path}[${i}]`, `Al pulsar el punto de «${p.name}» se elige «${parts[h].name}» (su zona lo cubre y es más pequeña): mueve el punto o ajusta las zonas.`))
    }
  })
  return out
}

/** Una figura sobre una página que no se puede dibujar: el estudiante vería un recuadro vacío. */
export function sourcePageIssue(s: SourceRef, path: string): ContentIssue {
  return issue('error', path, `No se puede dibujar la página${s.page !== undefined ? ` ${s.page}` : ''} de «${s.source}» como figura: solo sirven un PDF (con \`page\` dentro del documento) o una foto guardados en el curso. Usa una imagen (add_image) o un dibujo (\`drawing\`).`)
}

// MARK: Diagrama etiquetado

export function checkLabeled(v: ContentValidator, l: LabeledBlock, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  const bases = [l.asset !== undefined, l.drawing !== undefined, l.source !== undefined].filter(Boolean).length
  if (bases === 0) out.push(issue('error', path, 'El diagrama etiquetado necesita la figura: `asset` (de add_image), `drawing` (dibujo vectorial) o `source` (página de un material).'))
  if (bases > 1) out.push(issue('warning', path, 'Usa solo una figura (asset, drawing o source); se mostrará la primera.'))
  let pixel: [number, number] | undefined
  if (l.asset !== undefined) {
    if (!v.assetExists(l.asset)) out.push(issue('error', path + '.asset', `El archivo «${l.asset}» no existe en el curso (añádelo con add_image).`))
    const m = v.assetInfo(l.asset)
    if (m) {
      if (m.kind === 'model') out.push(issue('error', path + '.asset', `«${l.asset}» es un modelo 3D: úsalo en un bloque model3d.`))
      if (m.width !== undefined && m.height !== undefined) pixel = [m.width, m.height]
    }
    out.push(...checkCredit(v, l.asset, l.credit, l.caption, path))
  }
  if (l.source && !v.sourceExists(l.source.source)) out.push(issue('error', path + '.source', `La fuente «${l.source.source}» no existe.`))
  else if (l.source && l.asset === undefined && l.drawing === undefined && !v.sourcePageDrawable(l.source)) out.push(sourcePageIssue(l.source, path + '.source'))
  if (l.drawing) out.push(...v.checkBlock({ id: '', type: 'drawing', ...l.drawing }, path + '.drawing'))
  if (!l.alt.trim()) out.push(issue('warning', path + '.alt', 'Falta `alt`: describe la figura para quien no la ve.'))
  if (!l.parts.length) out.push(issue('error', path + '.parts', 'Marca al menos una parte (`parts`: [{id, name, x, y, detail}]).'))
  if (l.parts.length > 40) out.push(issue('warning', path + '.parts', `${l.parts.length} partes es mucho para una figura: divide en varias (p. ej. por capas o regiones).`))
  if (l.practice && l.parts.length < 3) out.push(issue('info', path + '.practice', 'Con menos de 3 partes la práctica de señalar es trivial; pon `practice: false` o marca más partes.'))
  if (!['auto', 'names', 'numbers', 'hidden'].includes(l.labels)) out.push(issue('warning', path + '.labels', 'labels debe ser auto, names, numbers o hidden.'))
  const layerIDs = new Set<string>()
  l.layers.forEach((ly, i) => {
    const lp = `${path}.layers[${i}]`
    if (!ly.name) out.push(issue('error', lp, 'La capa no tiene nombre.'))
    if (layerIDs.has(ly.id)) out.push(issue('error', lp, `Id de capa repetido «${ly.id}».`))
    layerIDs.add(ly.id)
    if (ly.asset !== undefined && !v.assetExists(ly.asset)) out.push(issue('error', lp + '.asset', `El archivo «${ly.asset}» no existe.`))
    if (ly.items.length && l.drawing) {
      out.push(...v.checkBlock({ id: '', type: 'drawing', width: l.drawing.width, height: l.drawing.height, items: ly.items }, lp).filter((x) => x.severity !== 'warning' || !x.message.includes('vacío')))
    }
  })
  if (l.layers.length && l.parts.every((p) => p.layer === undefined)) out.push(issue('info', path + '.layers', 'Hay capas pero ninguna parte dice a qué capa pertenece (`layer`).'))
  out.push(...checkParts(l.parts, l.layers, effectiveAspect(l), path + '.parts', l.practice, pixel))
  if (l.caption !== undefined) out.push(...latexIssues(l.caption, path + '.caption'))
  return out
}

// MARK: Ejercicios de rotular (escribir, elegir, arrastrar, señalar)

export function checkLabelAnswer(v: ContentValidator, l: AnswerOf<'label'>, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  if (l.asset === undefined && l.source === undefined && l.drawing === undefined) out.push(issue('error', path, 'Rotular necesita la figura: `asset`, `drawing` o `source`.'))
  let pixel: [number, number] | undefined
  if (l.asset !== undefined) {
    if (!v.assetExists(l.asset)) out.push(issue('error', path + '.asset', `El archivo «${l.asset}» no existe.`))
    const m = v.assetInfo(l.asset)
    if (m?.width !== undefined && m.height !== undefined) pixel = [m.width, m.height]
    out.push(...checkCredit(v, l.asset, l.credit, undefined, path))
  }
  if (l.source && l.asset === undefined && l.drawing === undefined) {
    if (!v.sourceExists(l.source.source)) out.push(issue('error', path + '.source', `La fuente «${l.source.source}» no existe.`))
    else if (!v.sourcePageDrawable(l.source)) out.push(sourcePageIssue(l.source, path + '.source'))
  }
  if (l.drawing) out.push(...v.checkBlock({ id: '', type: 'drawing', ...l.drawing }, path + '.drawing'))
  if (!l.spots.length) out.push(issue('error', path + '.spots', 'No hay puntos que rotular.'))
  l.spots.forEach((s, i) => {
    if (!s.accepted.length || s.accepted.every((a) => !a.trim())) out.push(issue('error', `${path}.spots[${i}]`, 'Falta `accepted` (el nombre de la parte y sus sinónimos).'))
  })
  const mode = effectiveLabelMode(l)
  out.push(...checkParts(labelAnswerParts(l), [], effectiveAspect(l), path + '.spots', mode === 'locate' || mode === 'drag', pixel).filter((x) => !x.message.startsWith('La parte no tiene nombre')))
  if (mode === 'bank' || (mode === 'drag' && l.wordBank.length)) {
    // cada parte debe poder rotularse con una palabra del banco
    const bank = new Set(l.wordBank.map((w) => w.toLowerCase().trim()))
    l.spots.forEach((s, i) => {
      if (!s.accepted.some((a) => bank.has(a.toLowerCase().trim()))) out.push(issue('error', `${path}.spots[${i}]`, `Ninguna respuesta aceptada de este punto («${s.accepted[0] ?? ''}») está en \`wordBank\`: el estudiante no podría acertarlo.`))
    })
  }
  if (mode === 'locate' && l.spots.length > 12) out.push(issue('warning', path + '.spots', 'Pedir que señale más de 12 partes en un ejercicio es largo: divide en varios.'))
  if (mode === 'drag' && l.spots.length > 10) out.push(issue('warning', path + '.spots', 'Más de 10 etiquetas para arrastrar es mucho: divide en varios ejercicios.'))
  return out
}

export function checkCardFigure(v: ContentValidator, f: CardFigure, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  if (f.asset === undefined && f.drawing === undefined) out.push(issue('error', path, 'La figura de la tarjeta necesita `asset` o `drawing`.'))
  if (f.asset !== undefined) {
    if (!v.assetExists(f.asset)) out.push(issue('error', path + '.asset', `El archivo «${f.asset}» no existe.`))
    out.push(...checkCredit(v, f.asset, f.credit, undefined, path))
  }
  if (!cardTargetPart(f)) out.push(issue('error', path + '.target', `\`target\` debe ser el id de una de las partes (${f.parts.map((p) => p.id).join(', ')}).`))
  out.push(...checkParts(f.parts, [], effectiveAspect(f), path + '.parts', false))
  return out
}

// MARK: Visor 3D

export function checkModel3D(v: ContentValidator, m: Model3DBlock, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  const formula = m.formula ?? ''
  if (!m.atoms.length && !m.solids.length && m.asset === undefined && !formula) {
    out.push(issue('error', path, 'El visor 3D necesita algo que mostrar: `formula` (molécula), `atoms` + `bonds`, `solids` o `asset` (modelo de add_model).'))
  }
  const built = formula ? buildMolecule(formula) : undefined
  if (!m.atoms.length && formula && !m.solids.length && m.asset === undefined && !built) {
    out.push(issue('error', path + '.formula', `No sé construir «${formula}» en 3D. Las de un átomo central (CH4, NH3, H2O, SF6, SO4^2-…) y las de la biblioteca (agua, etanol, benceno, ácido acético, NaCl…) salen solas; para otras escribe \`atoms\` (elemento y x, y, z en Å) y \`bonds\`.`))
  }
  if (formula && m.lonePairs && !m.atoms.length && built && built.central === undefined) out.push(issue('info', path + '.lonePairs', 'Los pares libres solo se dibujan en moléculas con un átomo central (VSEPR).'))
  if (m.atoms.length > 400) out.push(issue('warning', path + '.atoms', `${m.atoms.length} átomos es mucho para el visor; usa una parte representativa.`))
  m.atoms.forEach((a, i) => {
    const sym = a.element.slice(0, 1).toUpperCase() + a.element.slice(1).toLowerCase()
    if (!ELEMENT_SYMBOLS.has(sym)) out.push(issue('error', `${path}.atoms[${i}]`, `«${a.element}» no es un símbolo químico.`))
    if (![a.x, a.y, a.z].every((c) => Number.isFinite(c) && Math.abs(c) < 500)) out.push(issue('error', `${path}.atoms[${i}]`, 'Coordenadas no válidas (en ángstroms, |x|, |y|, |z| < 500).'))
  })
  m.bonds.forEach((b, i) => {
    if (b.a < 0 || b.b < 0 || b.a >= m.atoms.length || b.b >= m.atoms.length || b.a === b.b) out.push(issue('error', `${path}.bonds[${i}]`, `El enlace ${b.a}–${b.b} usa átomos que no existen (índices desde 0).`))
    if (![1, 1.5, 2, 2.5, 3].includes(b.order)) out.push(issue('warning', `${path}.bonds[${i}]`, 'order debe ser 1, 1.5 (aromático), 2 o 3.'))
  })
  if (!['ballstick', 'spacefill', 'stick', 'wireframe'].includes(m.style)) out.push(issue('warning', path + '.style', 'style debe ser ballstick, spacefill o stick.'))
  m.solids.forEach((s, i) => {
    const p = `${path}.solids[${i}]`
    if (!(SOLID_SHAPES as readonly string[]).includes(s.shape)) { out.push(issue('error', p, `shape «${s.shape}» no válida (${SOLID_SHAPES.join(', ')}).`)); return }
    for (const x of [s.a, s.w, s.h, s.d, s.r, s.r2]) if (x !== undefined && !(x > 0 && x < 1e4)) { out.push(issue('error', p, 'Las medidas deben ser positivas.')); break }
  })
  if (m.asset !== undefined) {
    if (!v.assetExists(m.asset)) out.push(issue('error', path + '.asset', `El modelo «${m.asset}» no existe en el curso (tráelo con add_model).`))
    const dot = m.asset.lastIndexOf('.')
    const ext = dot >= 0 ? m.asset.slice(dot + 1).toLowerCase() : ''
    if (!MODEL_EXTENSIONS.has(ext)) out.push(issue('error', path + '.asset', `«${m.asset}» no es un modelo 3D (${[...MODEL_EXTENSIONS].sort().join(', ')}).`))
    out.push(...checkCredit(v, m.asset, m.credit, m.caption, path))
  }
  if (!m.alt.trim() && m.caption === undefined) out.push(issue('warning', path + '.alt', 'Falta `alt` o `caption`: describe el modelo para quien no lo ve.'))
  m.labels.forEach((l, i) => out.push(...latexIssues(l.text, `${path}.labels[${i}]`)))
  return out
}

// MARK: Simulación

export function checkSimulation(_v: ContentValidator, s: SimulationBlock, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  if (s.preset !== undefined && !SimulationPresets.make(s.preset)) out.push(issue('error', path + '.preset', `Modelo «${s.preset}» desconocido. Modelos: ${SimulationPresets.names.join(', ')}.`))
  const engine = new SimulationEngine(s)
  for (const p of engine.problems()) out.push(issue(p.isError ? 'error' : 'warning', `${path}.${p.path}`, p.message))
  // la gráfica: curvas en x con los nombres del modelo
  const names = new Set(simulationSymbolNames(s).map(SimulationEngine.key))
  const expr = (text: string, p: string, extra: readonly string[]): void => {
    const c = engine.compile(text)
    if (!c.ok) { out.push(issue('error', p, `Expresión «${text}» no válida: ${c.message}.`)); return }
    const allowed = new Set([...names, ...extra])
    const unknown = [...freeVariables(c.expr)].filter((x) => !allowed.has(x)).sort()
    if (unknown.length) out.push(issue('error', p, `«${text}» usa «${unknown.join(', ')}», que no está definido.`))
  }
  const pl = s.plot
  pl.curves.forEach((c, i) => expr(c.expr, `${path}.plot.curves[${i}]`, ['x']))
  pl.lines.forEach((l, i) => { for (const x of [l.x, l.y, l.x1, l.y1, l.x2, l.y2]) if (x !== undefined) expr(x, `${path}.plot.lines[${i}]`, []) })
  pl.points.forEach((pt, i) => { expr(pt.x, `${path}.plot.points[${i}]`, []); expr(pt.y, `${path}.plot.points[${i}]`, []) })
  if (pl.xMin !== undefined && pl.xMax !== undefined && pl.xMin >= pl.xMax) out.push(issue('error', path + '.plot', 'xMin debe ser menor que xMax.'))
  if (pl.yMin !== undefined && pl.yMax !== undefined && pl.yMin >= pl.yMax) out.push(issue('error', path + '.plot', 'yMin debe ser menor que yMax.'))
  if (!pl.curves.length && !s.objects.length) out.push(issue('error', path, 'La simulación no dibuja nada: añade curvas a `plot` u `objects`.'))
  if (!s.time && s.objects.some((o) => o.trail)) out.push(issue('warning', path + '.objects', '`trail` necesita un reloj (`time`).'))
  if ((pl.xMin === undefined || pl.xMax === undefined) && s.objects.length) out.push(issue('info', path + '.plot', 'Fija xMin/xMax/yMin/yMax para que los ejes no cambien al mover los deslizadores.'))
  s.formulas.forEach((f, i) => out.push(...texProblems(f.tex, `${path}.formulas[${i}].tex`)))
  s.derived.forEach((d, i) => { if (d.tex !== undefined) out.push(...texProblems(d.tex, `${path}.derived[${i}].tex`)) })
  s.prompts.forEach((q, i) => out.push(...latexIssues(q, `${path}.prompts[${i}]`)))
  if (s.intro !== undefined) out.push(...latexIssues(s.intro, path + '.intro'))
  return out
}

// MARK: Mapa

export function checkMap(m: MapBlock, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  if (!m.markers.length && !m.regions.length && !m.routes.length) out.push(issue('error', path, 'El mapa está vacío: añade markers, regions o routes.'))
  const ok = (lat: number, lon: number): boolean => Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
  m.markers.forEach((mk, i) => {
    if (!ok(mk.lat, mk.lon)) out.push(issue('error', `${path}.markers[${i}]`, 'Coordenadas fuera de rango (lat −90…90, lon −180…180); ¿están al revés?'))
    if (!mk.title) out.push(issue('error', `${path}.markers[${i}]`, 'El marcador necesita `title`.'))
    if (mk.md !== undefined) out.push(...latexIssues(mk.md, `${path}.markers[${i}].md`))
  })
  m.regions.forEach((r, i) => {
    if (r.points.length < 3) out.push(issue('error', `${path}.regions[${i}]`, 'Una región necesita al menos 3 puntos [lat, lon].'))
    if (r.points.some((p) => p.length < 2 || !ok(p[0], p[1]))) out.push(issue('error', `${path}.regions[${i}]`, 'Puntos no válidos: usa [lat, lon] en grados.'))
    if (!r.name) out.push(issue('warning', `${path}.regions[${i}]`, 'La región no tiene nombre.'))
  })
  m.routes.forEach((r, i) => {
    if (r.points.length < 2 || r.points.some((p) => p.length < 2 || !ok(p[0], p[1]))) out.push(issue('error', `${path}.routes[${i}]`, 'Una ruta necesita al menos 2 puntos [lat, lon] válidos.'))
  })
  if (m.span !== undefined && !(m.span > 0 && m.span <= 180)) out.push(issue('warning', path + '.span', 'span son los grados de latitud visibles (0–180).'))
  if (m.lat !== undefined && m.lon !== undefined && !ok(m.lat, m.lon)) out.push(issue('error', path, 'Centro fuera de rango.'))
  if (!['standard', 'muted', 'satellite', 'hybrid'].includes(m.style)) out.push(issue('warning', path + '.style', 'style debe ser standard, muted, satellite o hybrid.'))
  if (m.practice) {
    if (m.markers.length < 3) out.push(issue('warning', path + '.practice', 'La práctica «¿dónde está…?» necesita al menos 3 marcadores.'))
    if (new Set(m.markers.map((x) => x.title.toLowerCase())).size !== m.markers.length) out.push(issue('error', path + '.markers', 'Hay marcadores con el mismo título: en la práctica no se distinguirían.'))
  }
  return out
}

// MARK: Procesos animados y línea de tiempo

export function checkDiagramSteps(d: DiagramBlock, path: string): ContentIssue[] {
  if (!d.steps.length) return []
  const out: ContentIssue[] = []
  const ids = new Set(d.nodes.map((x) => x.id))
  const edges = new Set(d.edges.map((e) => `${e.from}>${e.to}`))
  d.steps.forEach((s, i) => {
    const p = `${path}.steps[${i}]`
    if (!s.md.trim() && !s.title) out.push(issue('error', p, 'El paso no explica nada (`md`).'))
    for (const x of s.nodes) if (!ids.has(x)) out.push(issue('error', p, `El paso resalta el nodo «${x}», que no existe.`))
    for (const e of s.edges) if (e.length === 2 && !edges.has(`${e[0]}>${e[1]}`) && d.kind !== 'cycle') out.push(issue('warning', p, `El paso resalta la flecha ${e[0]}→${e[1]}, que no está en \`edges\`.`))
    if (!s.nodes.length && !s.edges.length) out.push(issue('info', p, 'El paso no resalta ningún nodo (`nodes`).'))
    out.push(...latexIssues(s.md, p))
  })
  if (d.steps.length < 2) out.push(issue('warning', path + '.steps', 'Un proceso animado necesita al menos 2 pasos.'))
  return out
}

export function checkTimeline(v: ContentValidator, t: TimelineBlock, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  const parsed = t.events.filter((e) => HistoricalDate.parse(e.when) !== undefined).length
  if (t.layout === 'horizontal') {
    t.events.forEach((e, i) => { if (!HistoricalDate.parse(e.when)) out.push(issue('error', `${path}.events[${i}].when`, `No entiendo la fecha «${e.when}»: usa años («1789», «44 a. C.», «1914–1918», «65 Ma») o fechas ISO («1789-07-14»).`)) })
  } else if (t.layout === 'auto' && t.events.length && parsed < t.events.length * 0.7) {
    out.push(issue('info', path, `Solo ${parsed} de ${t.events.length} fechas se entienden como años: se mostrará como lista (no a escala).`))
  }
  t.events.forEach((e, i) => {
    if (e.end !== undefined && !HistoricalDate.parse(e.end)) out.push(issue('warning', `${path}.events[${i}].end`, `No entiendo la fecha de fin «${e.end}».`))
    if (e.asset !== undefined && !v.assetExists(e.asset)) out.push(issue('error', `${path}.events[${i}].asset`, `El archivo «${e.asset}» no existe.`))
    if (e.md !== undefined) out.push(...latexIssues(e.md, `${path}.events[${i}].md`))
  })
  t.periods.forEach((p, i) => {
    const a = HistoricalDate.parse(p.from), b = HistoricalDate.parse(p.to)
    if (!a || !b) { out.push(issue('error', `${path}.periods[${i}]`, `Fechas del periodo no válidas («${p.from}»–«${p.to}»).`)); return }
    if (a.start >= (b.end ?? b.start)) out.push(issue('error', `${path}.periods[${i}]`, `El periodo «${p.title}» termina antes de empezar.`))
  })
  if (!['auto', 'horizontal', 'vertical'].includes(t.layout)) out.push(issue('warning', path + '.layout', 'layout debe ser auto, horizontal o vertical.'))
  return out
}

// MARK: Diapositivas

export function checkSlide(v: ContentValidator, s: Slide, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  if (s.layout === 'image' && s.image === undefined && !s.blocks.some((b) => b.type === 'image' || b.type === 'labeled')) {
    out.push(issue('error', path, 'El diseño `image` necesita `image` (archivo de add_image) o un bloque de imagen.'))
  }
  if (s.image !== undefined) {
    if (!v.assetExists(s.image)) out.push(issue('error', path + '.image', `El archivo «${s.image}» no existe.`))
    out.push(...checkCredit(v, s.image, s.credit, undefined, path))
  }
  if (s.layout === 'comparison') {
    if (!s.right.length) out.push(issue('error', path + '.right', 'El diseño `comparison` necesita la segunda columna (`right`).'))
    if (!s.leftTitle || !s.rightTitle) out.push(issue('warning', path, 'Pon `leftTitle` y `rightTitle` a las dos columnas de la comparación.'))
  }
  if (s.notes !== undefined) out.push(...latexIssues(s.notes, path + '.notes'))
  const words = s.blocks.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.md).join(' ').split(' ').filter((w) => w !== '').length
  if (words > 110) out.push(issue('warning', path, `Diapositiva con ${words} palabras: es mucho texto; deja las ideas clave y pasa el resto a \`notes\`.`))
  return out
}
