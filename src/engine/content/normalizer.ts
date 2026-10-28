// Arregla desviaciones comunes del JSON que escriben los modelos antes de decodificarlo (port de
// StudyEngine/Content/Normalizer.swift). Es conservador: solo corrige patrones reconocibles; lo demás lo informa el validador.
import { IDs } from '@engine/base/ids'
import { asBool, asDouble, asInt, asText, isJSONObject, type JSONObject, type JSONValue } from '@engine/base/json'
import { canonicalBlockType, ownValue, setOwn } from '@shared/schema'

/** Anidamiento máximo que se normaliza (tryit → ejercicio → tryit…). */
const MAX_DEPTH = 24
/** Profundidad máxima del JSON: lo que queda más abajo se sustituye por null. */
const MAX_JSON_DEPTH = 64

type O = JSONObject

const obj = (v: JSONValue | undefined): O | undefined => (isJSONObject(v) ? v : undefined)
const arr = (v: JSONValue | undefined): JSONValue[] | undefined => (Array.isArray(v) ? v : undefined)
const strOf = (v: JSONValue | undefined): string | undefined => (typeof v === 'string' ? v : undefined)
/** `.int` de Swift: número o texto numérico, redondeado. */
const intOf = (v: JSONValue | undefined): number | undefined => (v === undefined || typeof v === 'boolean' ? undefined : asInt(v))
const isStr = (v: JSONValue | undefined): v is string => typeof v === 'string'

/** Copia acotada en profundidad (lo más hondo pasa a null). */
export function boundedJSON(v: JSONValue, depth = 0): JSONValue {
  if (Array.isArray(v)) return depth >= MAX_JSON_DEPTH ? null : v.map((x) => boundedJSON(x, depth + 1))
  if (isJSONObject(v)) {
    if (depth >= MAX_JSON_DEPTH) return null
    const out: O = {}
    for (const [k, x] of Object.entries(v)) setOwn(out, k, boundedJSON(x, depth + 1))
    return out
  }
  return v
}

/** Id de la opción `i`: a, b, c… z y después o27, o28… */
export const optionID = (i: number): string => (i >= 0 && i < 26 ? String.fromCharCode(97 + i) : `o${i + 1}`)

/** Mueve el primer campo presente de `from` a `to` (si `to` no está). */
function move(o: O, from: readonly string[], to: string): void {
  if (o[to] !== undefined) return
  for (const f of from) if (o[f] !== undefined) { o[to] = o[f]; delete o[f]; return }
}

const first = (o: O, keys: readonly string[]): JSONValue | undefined => { for (const k of keys) if (o[k] !== undefined) return o[k]; return undefined }

function normalizeSliders(ps: JSONValue[]): JSONValue[] {
  return ps.map((p) => {
    const po = obj(p)
    if (!po) return p
    const o: O = { ...po }
    if (o.name === undefined) { const n = first(o, ['symbol', 'var', 'id']); if (n !== undefined) o.name = n }
    const r = arr(o.range)
    if (o.min === undefined && r && r.length >= 2) { o.min = r[0]; o.max = r[1] }
    if (o.value === undefined) { const d = first(o, ['default', 'initial']); if (d !== undefined) o.value = d }
    return o
  })
}

// MARK: Bloques

export function normalizeBlocks(v: JSONValue | undefined): JSONValue[] {
  return blocksAt(v === undefined ? undefined : boundedJSON(v), 0)
}

function blocksAt(v: JSONValue | undefined, depth: number): JSONValue[] {
  if (v === undefined || v === null) return []
  if (isStr(v)) return [{ type: 'text', md: v }]
  if (Array.isArray(v)) return v.map((b) => blockAt(b, depth))
  if (isJSONObject(v)) return [blockAt(v, depth)]
  return []
}

export function normalizeBlock(v: JSONValue): JSONValue {
  return blockAt(boundedJSON(v), 0)
}

function blockAt(v: JSONValue, depth: number): JSONValue {
  if (isStr(v)) return { type: 'text', md: v }
  if (depth >= MAX_DEPTH) return v
  const src = obj(v)
  if (!src) return { type: 'text', md: '' }
  const o: O = { ...src }
  const rawType = strOf(o.type) ?? strOf(o.kind) ?? strOf(o.block) ?? 'text'
  const type = canonicalBlockType(rawType)
  switch (type) {
    case 'text': move(o, ['content', 'markdown', 'body', 'value', 'text', 'paragraph'], 'md'); break
    case 'math': move(o, ['latex', 'formula', 'expression', 'equation', 'value'], 'tex'); break
    case 'callout':
      move(o, ['content', 'markdown', 'body', 'text'], 'md')
      // el tipo de bloque venía en `kind`: el tipo de aviso sale de `variant`, `style`… o del propio nombre
      if (o.kind === undefined) {
        const k = first(o, ['variant', 'style', 'callout_type'])
        if (k !== undefined) o.kind = k
        else if (['note', 'tip', 'warning', 'definition', 'theorem'].includes(rawType.toLowerCase())) o.kind = rawType.toLowerCase()
      }
      break
    case 'example': {
      move(o, ['question', 'statement', 'exercise'], 'problem'); move(o, ['solution', 'result', 'final_answer'], 'answer')
      const steps = arr(o.steps)
      if (steps) o.steps = steps.map((s) => (isStr(s) ? { md: s } : s))
      break
    }
    case 'plot': {
      if (o.curves === undefined) {
        const f = first(o, ['functions', 'expressions', 'function', 'f'])
        if (f !== undefined) { const list = arr(f) ?? [f]; o.curves = list.map((x) => (isStr(x) ? { expr: x } : x)) }
      }
      const c = arr(o.curves)
      if (c) o.curves = c.map((x) => (isStr(x) ? { expr: x } : x))
      const pts = arr(o.points)
      if (pts) o.points = pts.map((p) => { const a = arr(p); return a && a.length >= 2 ? { x: a[0], y: a[1] } : p })
      const xr = arr(o.x_range) ?? arr(o.xRange) ?? arr(o.domain)
      if (o.xMin === undefined && xr && xr.length === 2) { o.xMin = xr[0]; o.xMax = xr[1] }
      const yr = arr(o.y_range) ?? arr(o.yRange) ?? arr(o.range)
      if (o.yMin === undefined && yr && yr.length === 2) { o.yMin = yr[0]; o.yMax = yr[1] }
      for (const [snake, camel] of [['x_min', 'xMin'], ['x_max', 'xMax'], ['y_min', 'yMin'], ['y_max', 'yMax'], ['x_pi', 'xPi'], ['equal_aspect', 'equalAspect']]) {
        if (o[camel] === undefined && o[snake] !== undefined) { o[camel] = o[snake]; delete o[snake] }
      }
      break
    }
    case 'explore': {
      move(o, ['sliders', 'variables', 'parameters'], 'params')
      if (o.plot === undefined) {
        const p: O = {}
        for (const k of ['curves', 'functions', 'points', 'lines', 'xMin', 'xMax', 'yMin', 'yMax', 'x_min', 'x_max', 'y_min', 'y_max', 'xPi', 'regions', 'parametric', 'polar', 'labels']) {
          if (o[k] !== undefined) { p[k] = o[k]; delete o[k] }
        }
        if (Object.keys(p).length) o.plot = blockAt({ ...p, type: 'plot' }, depth + 1)
      }
      const pl = obj(o.plot)
      if (pl) { const q = { ...pl }; delete q.type; delete q.id; o.plot = q }
      const ps = arr(o.params)
      if (ps) o.params = normalizeSliders(ps)
      break
    }
    case 'table':
      if (o.headers === undefined) { const c = first(o, ['columns', 'header']); if (c !== undefined) o.headers = c }
      if (o.rows === undefined && o.data !== undefined) o.rows = o.data
      break
    case 'steps': {
      move(o, ['items', 'list'], 'steps')
      const st = arr(o.steps)
      if (st) o.steps = st.map((s) => (isStr(s) ? { md: s } : s))
      break
    }
    case 'recap':
      move(o, ['items', 'bullets', 'key_points', 'summary'], 'points')
      if (isStr(o.points)) o.points = [o.points]
      break
    case 'predict': {
      move(o, ['prompt', 'text'], 'question'); move(o, ['choices'], 'options')
      const ops = arr(o.options)
      if (ops && ops.some(isStr)) {
        const correct = intOf(o.correct) ?? intOf(o.answer_index) ?? intOf(o.correct_index)
        o.options = ops.map((x, i) => (isStr(x) ? { md: x, correct: correct === i } : x))
      }
      break
    }
    case 'spot': {
      move(o, ['steps', 'work', 'solution_lines'], 'lines'); move(o, ['wrong_index', 'error_index', 'wrongLine'], 'wrongIndex')
      const w = intOf(o.wrongIndex), lines = arr(o.lines)
      if (w !== undefined && o._zero_based === undefined && lines && w >= 1 && w <= lines.length && intOf(o.wrongIndexBase) === 1) o.wrongIndex = w - 1
      break
    }
    case 'tryit': {
      move(o, ['exercises', 'ids', 'exercise_ids'], 'exerciseIDs')
      const ex = arr(o.exerciseIDs)
      if (ex && ex.some((x) => isJSONObject(x))) {
        o.inline = ex.filter((x) => isJSONObject(x)).map((x) => exerciseAt(x, '', IDs.short(5), depth + 1))
        o.exerciseIDs = ex.filter(isStr)
      }
      break
    }
    case 'diagram': {
      const nodes = arr(o.nodes)
      if (nodes) o.nodes = nodes.map((nd) => (isStr(nd) ? { id: IDs.slug(nd, 24), label: nd } : nd))
      const edges = arr(o.edges)
      if (edges) o.edges = edges.map((e) => { const a = arr(e); return a && a.length >= 2 ? { from: a[0], to: a[1] } : e })
      break
    }
    case 'image': move(o, ['src', 'file', 'path'], 'asset'); move(o, ['description', 'alt_text', 'caption'], 'alt'); break
    case 'labeled': {
      if (o.parts === undefined && arr(o.labels)) { o.parts = o.labels; delete o.labels }
      move(o, ['hotspots', 'structures', 'regions', 'points', 'markers', 'spots'], 'parts')
      move(o, ['image', 'src', 'file', 'path'], 'asset'); move(o, ['description', 'alt_text'], 'alt'); move(o, ['attribution', 'license'], 'credit')
      if (o.drawing === undefined && arr(o.items)) { o.drawing = { width: o.width ?? 400, height: o.height ?? 300, items: o.items as JSONValue[] }; delete o.items }
      const ps = arr(o.parts)
      if (ps) o.parts = ps.map(figurePart)
      break
    }
    case 'model3d': {
      move(o, ['molecule', 'compound', 'chemical'], 'formula'); move(o, ['shapes', 'solid_list'], 'solids'); move(o, ['model', 'file', 'src'], 'asset')
      const at = arr(o.atoms)
      if (at) o.atoms = at.map((a) => {
        const list = arr(a)
        if (list && list.length >= 4 && isStr(list[0])) return { element: list[0], x: list[1], y: list[2], z: list[3] }
        const ao = obj(a)
        if (ao && ao.x === undefined) {
          const pos = arr(first(ao, ['pos', 'position', 'xyz']))
          if (pos && pos.length >= 3) return { ...ao, x: pos[0], y: pos[1], z: pos[2] }
        }
        return a
      })
      break
    }
    case 'simulation': {
      move(o, ['sliders', 'parameters', 'variables', 'inputs'], 'params'); move(o, ['graph', 'chart'], 'plot'); move(o, ['outputs', 'results', 'computed', 'quantities'], 'derived')
      move(o, ['model', 'template'], 'preset'); move(o, ['clock', 'animation'], 'time')
      if (o.plot === undefined) {
        const p: O = {}
        for (const k of ['curves', 'lines', 'points', 'xMin', 'xMax', 'yMin', 'yMax', 'xLabel', 'yLabel', 'equalAspect', 'regions', 'labels']) if (o[k] !== undefined) { p[k] = o[k]; delete o[k] }
        if (Object.keys(p).length) o.plot = p
      }
      const pl = obj(o.plot)
      if (pl) {
        const q = { ...pl }
        delete q.type; delete q.id
        const c = arr(q.curves)
        if (c) q.curves = c.map((x) => (isStr(x) ? { expr: x } : x))
        o.plot = q
      }
      const ps = arr(o.params)
      if (ps) o.params = normalizeSliders(ps)
      const ds = arr(o.derived)
      if (ds) o.derived = ds.map((d) => { const dobj = obj(d); if (!dobj) return d; const q = { ...dobj }; if (q.expr === undefined) { const e = first(q, ['expression', 'value']); if (e !== undefined) q.expr = e } return q })
      break
    }
    case 'map': {
      move(o, ['points', 'places', 'pins', 'locations', 'cities'], 'markers'); move(o, ['areas', 'polygons', 'zones'], 'regions'); move(o, ['lines', 'paths', 'borders'], 'routes')
      const ms = arr(o.markers)
      if (ms) o.markers = ms.map((m) => {
        const mo = obj(m)
        if (!mo) return m
        const c = arr(first(mo, ['coords', 'coordinates', 'position', 'latlng', 'latLng']))
        return mo.lat === undefined && c && c.length >= 2 ? { ...mo, lat: c[0], lon: c[1] } : mo
      })
      break
    }
    default: break
  }
  o.type = type
  if (strOf(o.id) === undefined || o.id === '') delete o.id
  return o
}

/** Una parte de una figura: posición como [x, y] o «35%» → x, y numéricos. */
export function figurePart(v: JSONValue): JSONValue {
  const src = obj(v)
  if (!src) return v
  const po: O = { ...src }
  const c = arr(first(po, ['pos', 'position', 'at', 'point', 'coords']))
  if (po.x === undefined && c && c.length >= 2) { po.x = c[0]; po.y = c[1] }
  for (const k of ['x', 'y', 'r', 'labelX', 'labelY']) {
    const s = strOf(po[k])?.trim()
    if (s && s.endsWith('%')) { const d = asDouble(s.slice(0, -1).trim().replace(/,/g, '.')); if (d !== undefined) po[k] = d / 100 }
  }
  if (po.detail === undefined) { const d = first(po, ['description', 'explanation', 'info']); if (d !== undefined) po.detail = d }
  return po
}

// MARK: Ejercicios

/** ¿Es un número, fracción o expresión numérica ("3/4", "-2.5", "sqrt(2)/2", "pi/6")? */
export function looksNumeric(s: string): boolean {
  let t = s.toLowerCase().replace(/ /g, '')
  for (const tok of ['sqrt', '√', 'π', 'pi', 'arcsin', 'arccos', 'arctan', 'sin', 'cos', 'tan', 'abs', 'ln', 'log', 'e']) t = t.split(tok).join('')
  if (!/\p{N}/u.test(t) && !s.toLowerCase().includes('pi')) return false
  return Array.from(t).every((c) => /\p{N}/u.test(c) || '+-−*/^().,%'.includes(c))
}

const LEVEL_WORDS: Record<string, number> = {
  easy: 1, fácil: 1, facil: 1, básico: 1, basico: 1, basic: 1, medium: 2, medio: 2, estándar: 2, estandar: 2, standard: 2, hard: 3, difícil: 3, dificil: 3, exam: 3, examen: 3, advanced: 3
}

export function normalizeExercise(v: JSONValue, skill: string, defaultID: string): JSONValue {
  return exerciseAt(boundedJSON(v), skill, defaultID, 0)
}

function exerciseAt(v: JSONValue, skill: string, defaultID: string, depth: number): JSONValue {
  const src = obj(v)
  if (depth >= MAX_DEPTH || !src) return v
  const o: O = { ...src }
  move(o, ['question', 'statement', 'text', 'problem'], 'prompt')
  move(o, ['solution_steps', 'worked_solution', 'explanation', 'steps'], 'solution')
  move(o, ['hint'], 'hints')
  move(o, ['wrong_answers', 'common_mistakes', 'misconceptions'], 'wrongs')
  move(o, ['difficulty', 'lvl'], 'level')
  if (isStr(o.level)) {
    const s = o.level.toLowerCase()
    o.level = ownValue(LEVEL_WORDS, s) ?? (/^[+-]?\d+$/.test(s) ? Number(s) : 2)
  }
  if (isStr(o.hints)) o.hints = [o.hints]
  const sol = arr(o.solution)
  if (sol && sol.every(isStr)) o.solution = (sol as string[]).map((x, i) => `${i + 1}. ${x}`).join('\n')
  // forma de la respuesta
  const choicesRaw = first(o, ['options', 'choices', 'alternatives'])
  let answer = o.answer
  const declaredRaw = strOf(first(o, ['type', 'kind', 'answer_type']))
  const declared = (!isJSONObject(answer) && declaredRaw ? declaredRaw : '').toLowerCase()
  delete o.type; delete o.answer_type
  if (!isJSONObject(answer)) {
    const ch = arr(choicesRaw)
    if (ch && ch.length) {
      const labels = 'abcdefghijklmnopqrstuvwxyz'
      const opts: O[] = ch.map((c, i): O => { const co = obj(c); return co ? { ...co, id: co.id ?? optionID(i) } : { id: optionID(i), md: c } })
      const correctIdx = new Set<number>()
      const idxOf = (x: JSONValue): number | undefined => {
        const i = intOf(x)
        if (i !== undefined && (!isStr(x) || /^[+-]?\d+$/.test(x.trim()))) return i >= 0 && i < ch.length ? i : undefined
        const s = strOf(x)?.trim().toLowerCase()
        if (s) {
          if (Array.from(s).length === 1) { const li = labels.indexOf(s); if (li >= 0 && li < ch.length) return li }
          const p = ch.findIndex((c) => (strOf(c) ?? strOf(obj(c)?.md))?.trim().toLowerCase() === s)
          if (p >= 0) return p
        }
        return undefined
      }
      if (answer !== undefined) {
        const list = arr(answer)
        if (list) for (const x of list) { const i = idxOf(x); if (i !== undefined) correctIdx.add(i) }
        else { const i = idxOf(answer); if (i !== undefined) correctIdx.add(i) }
      }
      if (!correctIdx.size) { const ci = intOf(o.correct_index) ?? intOf(o.answer_index) ?? intOf(o.correct); if (ci !== undefined) correctIdx.add(ci) }
      const marked = opts.map((op, i) => (op.correct === undefined ? { ...op, correct: correctIdx.has(i) } : op))
      answer = { kind: 'choice', options: marked, multi: correctIdx.size > 1 }
    } else if (answer !== undefined && answer !== null) {
      const a = answer
      const asB = asBool(a)
      if (asB !== undefined) answer = { kind: 'truefalse', value: asB }
      else if (isStr(a)) {
        if (['numeric', 'number', 'num'].includes(declared) || looksNumeric(a)) answer = { kind: 'numeric', value: a }
        else if (['expression', 'expr', 'algebra'].includes(declared)) answer = { kind: 'expression', expected: a }
        else if (['set', 'list'].includes(declared)) answer = { kind: 'set', expected: a.split(',').map((x) => x.trim()) }
        else answer = { kind: 'short', accepted: [a] }
      } else if (typeof a === 'number') answer = { kind: 'numeric', value: asText(a) }
      else if (Array.isArray(a)) answer = declared === 'ordering' ? { kind: 'ordering', items: a } : { kind: ['set', 'ordering'].includes(declared) ? declared : 'set', expected: a }
    }
  } else {
    const ao: O = { ...answer }
    if (ao.kind === undefined && ao.type !== undefined) { ao.kind = ao.type; delete ao.type }
    if (ao.kind === undefined && declared) ao.kind = declared
    // opciones dentro de answer como cadenas
    const ops = arr(ao.options)
    if (ops && ops.some(isStr)) {
      const correct = intOf(ao.correct) ?? intOf(ao.correct_index)
      ao.options = ops.map((x, i) => (isStr(x) ? { id: optionID(i), md: x, correct: correct === i } : x))
    }
    // el valor numérico puede venir como `answer: {value: 3}` o `{expected: …}`
    if ((strOf(ao.kind) ?? '').toLowerCase().startsWith('num') && ao.value === undefined) { const e = first(ao, ['expected', 'answer']); if (e !== undefined) ao.value = e }
    answer = ao
  }
  if (answer !== undefined) o.answer = answer
  delete o.options; delete o.choices; delete o.alternatives; delete o.correct_index; delete o.answer_index
  o.prompt = blocksAt(o.prompt, depth + 1)
  if (o.solution !== undefined) o.solution = blocksAt(o.solution, depth + 1)
  const ans = obj(o.answer)
  const parts = arr(ans?.parts)
  if (ans && parts) {
    const fixed: JSONValue[] = []
    for (const p of parts) {
      const po0 = obj(p)
      if (!po0) continue
      const po: O = { ...po0 }
      po.prompt = blocksAt(po.prompt ?? po.question, depth + 1)
      const subSrc: O = { prompt: po.prompt ?? '', answer: po.answer ?? null }
      for (const k of ['options', 'choices']) if (po[k] !== undefined) subSrc[k] = po[k]
      const sub = obj(exerciseAt(subSrc, skill, '', depth + 1))
      po.answer = sub?.answer ?? null
      fixed.push(po)
    }
    o.answer = { ...ans, parts: fixed }
  }
  const id = strOf(o.id)
  o.id = id === undefined || id === '' ? defaultID : IDs.slug(id, 60)
  if (skill) o.skill = skill
  return o
}

// MARK: Plantillas, tarjetas, presentaciones

export function normalizeTemplate(v: JSONValue, skill: string, defaultID: string): JSONValue {
  const src = obj(boundedJSON(v))
  if (!src) return v
  const o: O = { ...src }
  if (o.vars === undefined) { const vs = first(o, ['variables', 'params', 'parameters']); if (vs !== undefined) o.vars = vs }
  const varsObj = obj(o.vars)
  if (varsObj) o.vars = Object.keys(varsObj).sort().map((k) => ({ ...(obj(varsObj[k]) ?? {}), name: k }))
  const vs = arr(o.vars)
  if (vs) o.vars = vs.map((x) => {
    const xo0 = obj(x)
    if (!xo0) return x
    const xo: O = { ...xo0 }
    if (xo.kind === undefined && isStr(xo.type)) { xo.kind = xo.type; delete xo.type }
    if (xo.kind === undefined) xo.kind = xo.values !== undefined ? 'pick' : xo.expr !== undefined || xo.expression !== undefined ? 'expr' : xo.decimals !== undefined ? 'real' : 'int'
    if (xo.expr === undefined) { const e = first(xo, ['expression', 'formula']); if (e !== undefined) xo.expr = e }
    const r = arr(xo.range)
    if (r && r.length === 2) { xo.min = r[0]; xo.max = r[1] }
    return xo
  })
  if (isStr(o.constraints)) o.constraints = [o.constraints]
  const asEx = obj(exerciseAt(o, skill, defaultID, 0))
  if (!asEx) return o
  const out: O = { ...asEx }
  if (o.vars !== undefined) out.vars = o.vars; else delete out.vars
  if (o.constraints !== undefined) out.constraints = o.constraints; else delete out.constraints
  return out
}

export function normalizeCard(v: JSONValue, skill: string, defaultID: string): JSONValue {
  const src = obj(boundedJSON(v))
  if (!src) return v
  const o: O = { ...src }
  if (o.front === undefined) { const q = first(o, ['question', 'term', 'prompt']); if (q !== undefined) o.front = q }
  if (o.back === undefined) { const a = first(o, ['answer', 'definition', 'response']); if (a !== undefined) o.back = a }
  if (strOf(o.id) === undefined) o.id = defaultID
  if (skill) o.skill = skill
  return o
}

export function normalizeDeck(v: JSONValue): JSONValue {
  const src = obj(boundedJSON(v))
  if (!src) return v
  const o: O = { ...src }
  const slides = arr(o.slides)
  if (slides) o.slides = slides.map((s) => {
    const so0 = obj(s)
    if (!so0) return s
    const so: O = { ...so0 }
    so.blocks = normalizeBlocks(first(so, ['blocks', 'content', 'body']))
    if (so.right !== undefined) so.right = normalizeBlocks(so.right)
    return so
  })
  return o
}

export const ContentNormalizer = {
  blocks: normalizeBlocks, block: normalizeBlock, exercise: normalizeExercise, template: normalizeTemplate, card: normalizeCard, deck: normalizeDeck,
  figurePart, looksNumeric, optionID
}
