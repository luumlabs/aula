// Validación del dibujo vectorial (`drawing`): campos que necesita cada tipo, objetos que existen, ids únicos, movimiento
// (expresiones que se entienden y recorridos válidos), pasos coherentes y, con la misma geometría que pinta la interfaz,
// textos que se pisan y formas que se salen del lienzo (adaptado de drawIssues de Sketchy, ver engine/drawing/issues.ts).
// Los mensajes son en español: los lee la IA que escribe el dibujo para corregirlo.
import type { ContentIssue, DrawingBlock, DrawItem, IssueSeverity } from '@shared/schema'
import { freeVariables } from '@engine/math/core/expr'
import { OBJECT_NAMES, PATH_KINDS, drawingEngine, drawingIssues, isObjectName, saneDrawParams, stepState, validPoints, visibleAt } from '@engine/drawing'
import { SimulationEngine } from './simulation'
import { latexIssues } from './tex'

const issue = (severity: IssueSeverity, path: string, message: string): ContentIssue => ({ severity, path, message })

/** Más objetos que esto en un dibujo es demasiado (se vuelve un dibujo infantil, no una explicación). */
const MAX_OBJECTS = 6
const MAX_MOVING = 40

const has = (...v: Array<number | undefined>): boolean => v.every((x) => x !== undefined)

/** Campos que necesita cada tipo (los de siempre con sus mensajes de siempre). */
function itemFieldIssues(it: DrawItem, p: string): ContentIssue[] {
  const out: ContentIssue[] = []
  const pts = it.points ?? []
  switch (it.kind) {
    case 'line': case 'arrow': case 'tick': if (!has(it.x1, it.y1, it.x2, it.y2)) out.push(issue('error', p, `«${it.kind}» necesita x1,y1,x2,y2.`)); break
    case 'polyline': case 'polygon':
      if (pts.length < 2 || pts.some((q) => q.length < 2)) out.push(issue('error', p, `«${it.kind}» necesita points: [[x,y],…] con al menos 2 puntos.`))
      else if (it.smooth && pts.length < 3) out.push(issue('warning', p, '`smooth` necesita al menos 3 puntos para hacer una curva.'))
      break
    case 'rect': if (!has(it.x, it.y)) out.push(issue('error', p, 'rect necesita x, y, w, h.')); break
    case 'angle':
      if (((it.cx ?? it.x) === undefined || (it.cy ?? it.y) === undefined) && validPoints(pts).length !== 3) out.push(issue('error', p, 'angle necesita points: [[brazo],[vértice],[brazo]] (exactamente 3 puntos, el vértice en medio) o cx, cy, r, start, end.'))
      break
    case 'circle': case 'dot': case 'arc': if ((it.cx ?? it.x) === undefined || (it.cy ?? it.y) === undefined) out.push(issue('error', p, `«${it.kind}» necesita cx, cy (y r).`)); break
    case 'ellipse': if ((it.cx ?? it.x) === undefined || (it.cy ?? it.y) === undefined) out.push(issue('error', p, 'ellipse necesita cx, cy, rx, ry.')); break
    case 'text': {
      const t = it.text ?? it.label ?? ''
      if (!t || !has(it.x, it.y)) out.push(issue('error', p, 'text necesita x, y y text.'))
      else out.push(...latexIssues(t, p))
      break
    }
    case 'curve': if (pts.length < 3) out.push(issue('error', p, 'curve necesita 3 puntos (inicio, control, fin).')); break
    case 'rightAngle':
      if (((it.cx ?? it.x) === undefined || (it.cy ?? it.y) === undefined) && validPoints(pts).length !== 3) out.push(issue('error', p, 'rightAngle necesita cx, cy (o points: [[brazo],[vértice],[brazo]]).'))
      break
    case 'measure': case 'brace': if (!has(it.x1, it.y1, it.x2, it.y2)) out.push(issue('error', p, `«${it.kind}» necesita x1,y1,x2,y2 (los extremos de lo que mide).`)); break
    case 'axes':
      if ((it.x ?? it.cx) === undefined || (it.y ?? it.cy) === undefined) out.push(issue('error', p, 'axes necesita x, y (el origen), w y h (largo de cada eje).'))
      else if (!((it.w ?? 0) > 0 && (it.h ?? 0) > 0)) out.push(issue('error', p, 'axes necesita w y h mayores que 0 (largo del eje x hacia la derecha y del eje y hacia arriba).'))
      break
    case 'grid': if (!has(it.x, it.y) || !((it.w ?? 0) > 0 && (it.h ?? 0) > 0)) out.push(issue('error', p, 'grid necesita x, y (esquina de arriba a la izquierda), w y h mayores que 0 (y step).')); break
    case 'object':
      if (!it.object) out.push(issue('error', p, `object necesita "object" (qué objeto). Objetos: ${OBJECT_NAMES.join(', ')}.`))
      else if (!isObjectName(it.object)) out.push(issue('error', p, `Objeto «${it.object}» desconocido. Objetos: ${OBJECT_NAMES.join(', ')}.`))
      if (!has(it.x, it.y) && !has(it.cx, it.cy)) out.push(issue('error', p, 'object necesita x, y (su centro) y w (su tamaño).'))
      break
  }
  if (it.fillStyle === 'hatch' && it.fill === undefined && it.kind !== 'object') out.push(issue('warning', p, '`fillStyle: "hatch"` necesita `fill` (el color del rayado).'))
  if (it.label !== undefined && it.kind !== 'text') out.push(...latexIssues(it.label, p + '.label'))
  return out
}

/**
 * Avisos de un dibujo. `embedded`: está dentro de otra figura (etiquetada, ejercicio o tarjeta), donde el dibujo es fijo:
 * el movimiento y los pasos se ignoran.
 */
export function checkDrawing(b: DrawingBlock, path: string, embedded: boolean): ContentIssue[] {
  const out: ContentIssue[] = []
  const add = (...xs: ContentIssue[]): void => { out.push(...xs) }
  if (!b.items.length) add(issue('error', path + '.items', 'El dibujo está vacío.'))
  if (b.width < 50 || b.height < 50 || b.width > 1200 || b.height > 900) add(issue('warning', path, 'Tamaño de lienzo raro (usa por ejemplo 400×300).'))
  const limit = Math.max(b.width, b.height) + 50
  b.items.forEach((it, i) => {
    const p = `${path}.items[${i}]`
    add(...itemFieldIssues(it, p))
    for (const v of [it.x1, it.y1, it.x2, it.y2, it.x, it.y, it.cx, it.cy]) {
      if (v !== undefined && (v < -50 || v > limit)) { add(issue('warning', p, `Coordenada fuera del lienzo (${v}).`)); break }
    }
  })
  const objects = b.items.filter((it) => it.kind === 'object').length
  if (objects > MAX_OBJECTS) add(issue('warning', path + '.items', `${objects} objetos son demasiados: usa como mucho ${MAX_OBJECTS}, solo los que explican algo.`))
  // ids únicos (los usan along, los pasos y «marcar y preguntar»)
  const ids = new Map<string, number>()
  b.items.forEach((it, i) => {
    if (!it.id) return
    if (ids.has(it.id)) add(issue('error', `${path}.items[${i}].id`, `El id «${it.id}» está repetido (también en items[${ids.get(it.id)}]).`))
    else ids.set(it.id, i)
  })
  const moving = b.items.filter((it) => it.motion).length
  const hasDriver = !!b.params?.length || !!b.time
  if (embedded) {
    if (moving || hasDriver || b.steps?.length) add(issue('warning', path, 'Aquí el dibujo es fijo: se ignoran `motion`, `params`, `time` y `steps` (se ve la imagen en reposo).'))
  } else {
    add(...motionIssues(b, path, ids))
    add(...stepIssues(b, path, ids))
  }
  if (moving > MAX_MOVING) add(issue('warning', path, `${moving} elementos se mueven: son muchos para animar con soltura (como mucho ${MAX_MOVING}).`))
  // textos que se pisan y formas que se salen, con la geometría de la interfaz
  for (const d of drawingIssues(embedded ? { ...b, steps: undefined, params: undefined, time: undefined } : b)) add(issue('warning', d.item === undefined ? path : `${path}.items[${d.item}]`, d.message))
  return out
}

/** Expresiones del movimiento, recorridos y deslizadores. */
function motionIssues(b: DrawingBlock, path: string, ids: ReadonlyMap<string, number>): ContentIssue[] {
  const out: ContentIssue[] = []
  const params = saneDrawParams(b.params ?? [])
  const moving = b.items.some((it) => it.motion)
  if (moving && !b.params?.length && !b.time) out.push(issue('warning', path, 'Hay elementos con `motion` pero nada que los mueva: añade `params` (deslizadores) o `time` (reloj).'))
  if (!moving && (b.params?.length || b.time) && !b.steps?.length) out.push(issue('warning', path, '`params`/`time` no mueven nada: ningún elemento tiene `motion`.'))
  if (b.params?.length || b.time) {
    for (const pr of drawingEngine({ params: b.params, time: b.time }).problems()) out.push(issue(pr.isError ? 'error' : 'warning', `${path}.${pr.path}`, pr.message))
  }
  const engine = drawingEngine({ params, time: b.time })
  const allowed = new Set([...params.map((p) => SimulationEngine.key(p.name)), ...(b.time ? [SimulationEngine.key(b.time.name)] : [])])
  const expr = (text: string, p: string): void => {
    const c = engine.compile(text)
    if (!c.ok) { out.push(issue('error', p, `Expresión «${text}» no válida: ${c.message}. Usa sintaxis de calculadora: 40*v, 30*sin(rad(theta)), t/T.`)); return }
    const unknown = [...freeVariables(c.expr)].filter((x) => !allowed.has(x)).sort()
    if (unknown.length) out.push(issue('error', p, `«${text}» usa «${unknown.join(', ')}», que no está definido (disponibles: ${[...allowed].sort().join(', ') || 'ninguno: añade params o time'}).`))
  }
  b.items.forEach((it, i) => {
    const m = it.motion
    if (!m) return
    const p = `${path}.items[${i}].motion`
    for (const k of ['dx', 'dy', 'turn', 'at'] as const) { const e = m[k]; if (e !== undefined) expr(e, `${p}.${k}`) }
    if (m.along !== undefined) {
      const t = ids.get(m.along)
      if (t === undefined) out.push(issue('error', `${p}.along`, `along: no hay ningún elemento con id «${m.along}».`))
      else if (t === i) out.push(issue('error', `${p}.along`, 'along: un elemento no puede recorrerse a sí mismo.'))
      else if (!PATH_KINDS.has(b.items[t].kind)) out.push(issue('error', `${p}.along`, `along: «${m.along}» es un ${b.items[t].kind}; solo se recorren line, arrow, polyline, polygon, rect, circle, ellipse, arc o curve.`))
      else if (b.items[t].motion?.along) out.push(issue('error', `${p}.along`, `along: «${m.along}» viaja a su vez por otro recorrido; recorre uno que no viaje.`))
      if (m.at === undefined) out.push(issue('warning', `${p}.at`, 'along necesita `at`: la fracción del recorrido (0–1), p. ej. "t/T" o "v".'))
    } else if (m.at !== undefined || m.orient) out.push(issue('warning', p, '`at` y `orient` solo sirven con `along`.'))
  })
  return out
}

/** Pasos: etapas, valores de los deslizadores y elementos rodeados. */
function stepIssues(b: DrawingBlock, path: string, ids: ReadonlyMap<string, number>): ContentIssue[] {
  const out: ContentIssue[] = []
  const steps = b.steps ?? []
  const maxStage = Math.max(0, ...b.items.map((it) => it.stage ?? 0))
  if (!steps.length) {
    if (maxStage > 0) out.push(issue('warning', path, '`stage` solo sirve con `steps`: sin pasos se ve todo a la vez.'))
    return out
  }
  if (steps.length === 1) out.push(issue('warning', path + '.steps', 'Un solo paso no construye nada: usa 3–7 pasos o quita `steps`.'))
  if (maxStage > 0 && steps[0].show === undefined) out.push(issue('warning', path + '.steps[0]', 'El primer paso no fija `show`: se ve todo desde el principio. Empieza con "show": 1 (o 0).'))
  const params = saneDrawParams(b.params ?? [])
  steps.forEach((s, k) => {
    const p = `${path}.steps[${k}]`
    if (!s.md.trim() && !s.title) out.push(issue('warning', p, 'El paso no explica nada: escribe `md` (una o dos frases).'))
    if (s.show !== undefined && s.show > maxStage) out.push(issue('warning', p + '.show', `show=${s.show}, pero ningún elemento tiene una etapa (stage) mayor que ${maxStage}.`))
    for (const [name, v] of Object.entries(s.params ?? {})) {
      const pr = params.find((q) => q.name === name)
      if (!pr) out.push(issue('error', `${p}.params`, `El deslizador «${name}» no existe (${params.map((q) => q.name).join(', ') || 'no hay params'}).`))
      else if (v < pr.min || v > pr.max) out.push(issue('warning', `${p}.params`, `${name}=${v} está fuera de su rango (${pr.min}–${pr.max}).`))
    }
    // lo que se ve en este paso (el `show` se arrastra de los anteriores)
    const shown = stepState(steps, params, k).show
    for (const id of s.highlight ?? []) {
      const at = ids.get(id)
      if (at === undefined) out.push(issue('error', `${p}.highlight`, `highlight: no hay ningún elemento con id «${id}». Pon \`id\` al elemento que quieres rodear.`))
      else if (!visibleAt(b.items[at], shown)) out.push(issue('warning', `${p}.highlight`, `highlight: «${id}» todavía no se ve en este paso (su stage es ${b.items[at].stage ?? 0} y el paso enseña hasta show=${shown}): sube \`show\` o baja su \`stage\`, o no se rodea nada.`))
    }
    if ((s.highlight?.length ?? 0) > 2) out.push(issue('info', `${p}.highlight`, 'Rodea como mucho 2 elementos por paso: si todo destaca, nada destaca.'))
    if (s.title) out.push(...latexIssues(s.title, p + '.title'))
    if (s.md) out.push(...latexIssues(s.md, p + '.md'))
  })
  return out
}
