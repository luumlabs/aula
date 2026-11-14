// Atajos que escribe la IA para las formas ya hechas, pasados a nodos y flechas antes de leer el bloque: los niveles de una
// pirámide como lista, los conjuntos de un Venn con sus elementos (`sets` + `in`), el mapa mental anidado (`root` +
// `children`) y las filas de una comparación marcadas como clave o iguales.
import { IDs } from '@engine/base/ids'
import { isJSONObject, type JSONObject, type JSONValue } from '@engine/base/json'
import { parseCompareMode, parseCompareTone, parseDiagramForm } from '@shared/schema'

type O = JSONObject

const obj = (v: JSONValue | undefined): O | undefined => (isJSONObject(v) ? v : undefined)
const arr = (v: JSONValue | undefined): JSONValue[] | undefined => (Array.isArray(v) ? v : undefined)
const text = (v: JSONValue | undefined): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined)
const first = (o: O, keys: readonly string[]): JSONValue | undefined => { for (const k of keys) if (o[k] !== undefined) return o[k]; return undefined }
const labelOf = (o: O): string | undefined => text(first(o, ['label', 'name', 'title', 'text']))

/** Ids únicos sacados de la etiqueta («Núcleo celular» → «nucleo-celular», «nucleo-celular-2»…). */
class IdMaker {
  private used = new Set<string>()
  constructor(existing: Iterable<string> = []) { for (const x of existing) this.used.add(x) }
  take(wanted: string | undefined, label: string): string {
    const id = IDs.unique(wanted?.trim() ? wanted.trim() : IDs.slug(label, 24), this.used)
    this.used.add(id)
    return id
  }
}

/** La forma del bloque y sus atajos, pasados a `nodes` y `edges`. `rawType` es el tipo tal como lo escribió la IA. */
export function normalizeDiagramForm(o: O, rawType: string): void {
  const form = parseDiagramForm(text(o.form)) ?? parseDiagramForm(text(o.kind)) ?? parseDiagramForm(rawType)
  if (!form) return
  o.form = form
  switch (form) {
    case 'pyramid': case 'funnel': levels(o); break
    case 'venn': venn(o); break
    case 'mindmap': mindmap(o); break
  }
}

function levels(o: O): void {
  if (o.nodes !== undefined) return
  const list = arr(first(o, ['levels', 'items', 'layers', 'stages', 'tiers', 'steps_list']))
  if (!list) return
  const ids = new IdMaker()
  o.nodes = list.map((x): JSONValue => {
    const label = text(x) ?? (obj(x) ? labelOf(obj(x)!) : undefined) ?? ''
    const src = obj(x) ?? {}
    return { ...src, id: ids.take(text(src.id), label), label }
  })
  for (const k of ['levels', 'items', 'layers', 'stages', 'tiers']) delete o[k]
}

function venn(o: O): void {
  const setsRaw = arr(first(o, ['sets', 'circles', 'groups']))
  const nodes: JSONValue[] = (arr(o.nodes) ?? []).slice()
  const edges: JSONValue[] = (arr(o.edges) ?? []).slice()
  const taken = nodes.map((n) => text(obj(n)?.id)).filter((x): x is string => x !== undefined)
  const ids = new IdMaker(taken)
  const setIds: string[] = []
  // nombre o id de un conjunto → su id
  const setByName = new Map<string, string>()
  const itemByLabel = new Map<string, string>()
  // los conjuntos que ya vienen como nodos círculo
  for (const n of nodes) {
    const no = obj(n)
    const id = no ? text(no.id) : undefined
    if (!no || id === undefined || text(no.shape)?.toLowerCase() !== 'circle') continue
    setIds.push(id)
    setByName.set(id.toLowerCase(), id)
    const label = labelOf(no)
    if (label) setByName.set(label.trim().toLowerCase(), id)
  }
  const link = (item: string, set: string): void => { edges.push({ from: item, to: set }) }
  const itemId = (label: string, wanted?: string): string => {
    const key = label.trim().toLowerCase()
    const had = itemByLabel.get(key)
    if (had) return had
    const id = ids.take(wanted, label)
    itemByLabel.set(key, id)
    nodes.push({ id, label })
    return id
  }
  const setsNew: JSONValue[] = []
  for (const s of setsRaw ?? []) {
    const so = obj(s)
    const label = text(s) ?? (so ? labelOf(so) : undefined) ?? ''
    const id = ids.take(so ? text(so.id) : undefined, label)
    setIds.push(id)
    setByName.set(id.toLowerCase(), id)
    setByName.set(label.trim().toLowerCase(), id)
    const node: O = { id, label, shape: 'circle' }
    if (so && text(so.color)) node.color = text(so.color)!
    if (so && text(so.detail)) node.detail = text(so.detail)!
    setsNew.push(node)
    // elementos dentro de cada conjunto: los repetidos en dos conjuntos van a la intersección
    for (const it of arr(so ? first(so, ['items', 'members', 'elements', 'only']) : undefined) ?? []) {
      const lab = text(it) ?? (obj(it) ? labelOf(obj(it)!) : undefined)
      if (lab) link(itemId(lab, obj(it) ? text(obj(it)!.id) : undefined), id)
    }
  }
  const resolveSet = (v: JSONValue): string | undefined => {
    const s = text(v)
    return s === undefined ? undefined : setByName.get(s.trim().toLowerCase()) ?? (setIds.includes(s) ? s : undefined)
  }
  // lo que comparten todos
  for (const it of arr(first(o, ['both', 'shared', 'common', 'intersection', 'all'])) ?? []) {
    const lab = text(it) ?? (obj(it) ? labelOf(obj(it)!) : undefined)
    if (lab) { const id = itemId(lab); setIds.forEach((s) => link(id, s)) }
  }
  // elementos sueltos con su pertenencia: {"label":"…","in":["a","b"]}
  const loose = arr(first(o, ['items', 'elements']))
  const withIn = (n: O): O => {
    const member = first(n, ['in', 'sets', 'members', 'belongs', 'belongsTo'])
    const list = arr(member) ?? (text(member) !== undefined ? [member!] : undefined)
    if (!list) return n
    const out: O = { ...n }
    for (const k of ['in', 'sets', 'members', 'belongs', 'belongsTo']) delete out[k]
    const label = labelOf(out) ?? ''
    if (out.id === undefined) out.id = ids.take(undefined, label)
    if (out.label === undefined) out.label = label
    for (const m of list) { const s = resolveSet(m); if (s) link(text(out.id)!, s) }
    return out
  }
  for (const it of loose ?? []) {
    const io = obj(it)
    if (io) nodes.push(withIn(io))
    else if (text(it)) itemId(text(it)!)
  }
  const fixed = nodes.map((n) => (obj(n) ? withIn(obj(n)!) : n))
  if (setsRaw) o.nodes = [...setsNew, ...fixed]
  else o.nodes = fixed
  o.edges = edges
  for (const k of ['sets', 'circles', 'groups', 'items', 'elements', 'both', 'shared', 'common', 'intersection', 'all']) delete o[k]
}

/**
 * Tope de seguridad del árbol anidado (entrada patológica): muy por encima de lo que se dibuja, para que el validador vea
 * cuántos nodos hay y avise de los que sobran en vez de perderlos aquí sin decir nada.
 */
const MINDMAP_SHORTCUT = { nodes: 400, depth: 16 }

function mindmap(o: O): void {
  if (o.nodes !== undefined) return
  const rootRaw = first(o, ['root', 'center', 'centre', 'topic', 'central'])
  const top = arr(first(o, ['children', 'branches', 'items']))
  if (rootRaw === undefined && !top) return
  const ids = new IdMaker()
  const nodes: JSONValue[] = []
  const edges: JSONValue[] = []
  const add = (v: JSONValue, parent: string | undefined, depth: number): void => {
    if (nodes.length >= MINDMAP_SHORTCUT.nodes || depth > MINDMAP_SHORTCUT.depth) return
    const vo = obj(v)
    const label = text(v) ?? (vo ? labelOf(vo) : undefined)
    if (label === undefined) return
    const id = ids.take(vo ? text(vo.id) : undefined, label)
    const node: O = { id, label }
    if (vo && text(vo.color)) node.color = text(vo.color)!
    if (vo && text(first(vo, ['detail', 'description', 'note']))) node.detail = text(first(vo, ['detail', 'description', 'note']))!
    nodes.push(node)
    if (parent !== undefined) edges.push({ from: parent, to: id })
    for (const c of arr(vo ? first(vo, ['children', 'branches', 'items', 'subtopics']) : undefined) ?? []) add(c, id, depth + 1)
  }
  if (rootRaw !== undefined) {
    add(rootRaw, undefined, 0)
    const rootId = text(obj(nodes[0])?.id)
    for (const c of top ?? []) add(c, rootId, 1)
  } else {
    add({ label: text(o.title) ?? '' }, undefined, 0)
    const rootId = text(obj(nodes[0])?.id)
    for (const c of top ?? []) add(c, rootId, 1)
  }
  o.nodes = nodes
  if (o.edges === undefined || !arr(o.edges)?.length) o.edges = edges
  for (const k of ['root', 'center', 'centre', 'topic', 'central', 'children', 'branches', 'items']) delete o[k]
}

/** Comparación: modo analogía desde el tipo («analogy», «metáfora») y filas marcadas como clave o iguales. */
export function normalizeCompare(o: O, rawType: string): void {
  if (o.mode === undefined && parseCompareMode(rawType)) o.mode = 'analogy'
  const rows = arr(o.rows)
  if (!rows) return
  o.rows = rows.map((r) => {
    const ro = obj(r)
    if (!ro || ro.tone !== undefined) return r
    const out: O = { ...ro }
    const t = parseCompareTone(text(first(ro, ['emphasis', 'highlight', 'kind'])))
    if (t) out.tone = t
    else if (ro.key === true || ro.important === true) out.tone = 'key'
    else if (ro.same === true || ro.shared === true) out.tone = 'same'
    return out
  })
}
