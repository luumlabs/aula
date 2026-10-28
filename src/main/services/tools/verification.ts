// Verificación independiente de las claves (port de StudyEngine/Tools/VerificationTools.swift): un solucionador resuelve los
// ejercicios SIN ver la clave, la app compara su respuesta con la clave en privado y un árbitro decide las discrepancias. El
// registro va en `runs/verify-<ejecución>-<habilidad>.json` (con cerrojo: varias soluciones a la vez no se pisan).
import { join } from 'node:path'
import { IDs, Hashing } from '@engine/base/ids'
import { compactJSON, isJSONObject, Schema, type JSONObject, type JSONValue } from '@engine/base/json'
import { JSONRepair } from '@engine/base/jsonRepair'
import { grade as gradeExercise, Input, type AnswerInput } from '@engine/grading'
import { tr } from '@shared/ai/i18n'
import { answerForGrading, encodeBlock, encodeExercise, type Answer, type Block, type Exercise, type MatchingAnswer } from '@shared/schema'
import type { AgentTool } from '../ai'
import type { PackStore } from '../store'
import { withFileLock } from '../store'
import { defineTool, ToolOut, type ToolContext } from './context'

// MARK: Registro de verificación

export type VerificationOutcome = 'match' | 'mismatch' | 'unparsable'

export interface VerificationRecord {
  exerciseID: string
  outcome: VerificationOutcome
  solverAnswer: string
  work: string
  feedback: string
  /** Huella del ejercicio cuando se comparó: si cambia, el árbitro lo corrigió. */
  exerciseHash: string
  resolved: boolean
  verdict?: string
  note?: string
}

export interface VerificationFile {
  skill: string
  /** Ejercicios que se le presentaron al solucionador (los demás no se pueden verificar: abiertos, con imagen…). */
  presented: string[]
  skipped: Record<string, string>
  records: Record<string, VerificationRecord>
}

const OUTCOMES: readonly VerificationOutcome[] = ['match', 'mismatch', 'unparsable']

function decodeRecord(raw: unknown): VerificationRecord | undefined {
  if (!isJSONObject(raw) || typeof raw.exerciseID !== 'string') return undefined
  const r: VerificationRecord = {
    exerciseID: raw.exerciseID, outcome: OUTCOMES.includes(raw.outcome as VerificationOutcome) ? (raw.outcome as VerificationOutcome) : 'unparsable',
    solverAnswer: typeof raw.solverAnswer === 'string' ? raw.solverAnswer : '', work: typeof raw.work === 'string' ? raw.work : '',
    feedback: typeof raw.feedback === 'string' ? raw.feedback : '', exerciseHash: typeof raw.exerciseHash === 'string' ? raw.exerciseHash : '', resolved: raw.resolved === true
  }
  if (typeof raw.verdict === 'string') r.verdict = raw.verdict
  if (typeof raw.note === 'string') r.note = raw.note
  return r
}

export function decodeVerificationFile(raw: unknown, skill: string): VerificationFile | undefined {
  if (!isJSONObject(raw) || typeof raw.skill !== 'string') return undefined
  const records: Record<string, VerificationRecord> = {}
  if (isJSONObject(raw.records)) for (const [k, v] of Object.entries(raw.records)) { const r = decodeRecord(v); if (r) records[k] = r }
  const skipped: Record<string, string> = {}
  if (isJSONObject(raw.skipped)) for (const [k, v] of Object.entries(raw.skipped)) if (typeof v === 'string') skipped[k] = v
  return {
    skill: raw.skill || skill, presented: Array.isArray(raw.presented) ? raw.presented.filter((x): x is string => typeof x === 'string') : [], skipped, records
  }
}

export const VerificationStore = {
  name(runID: string | undefined, skill: string): string {
    return `verify-${runID ?? 'adhoc'}-${IDs.slug(skill, 60)}`
  },

  load(store: PackStore, runID: string | undefined, skill: string): VerificationFile {
    return store.loadJSON('runs', VerificationStore.name(runID, skill), (raw) => decodeVerificationFile(raw, skill)) ?? { skill, presented: [], skipped: {}, records: {} }
  },

  /** Transacción: releer, modificar y guardar bajo el mismo cerrojo. El corrector se ejecuta antes de entrar aquí. */
  update<T>(store: PackStore, runID: string | undefined, skill: string, change: (file: VerificationFile) => T): T {
    const name = VerificationStore.name(runID, skill)
    const lock = join(store.runsDirectory, `${IDs.slug(name, 80)}.json.lock`)
    return withFileLock(lock, () => {
      const file = VerificationStore.load(store, runID, skill)
      if (file.skill !== skill) throw new Error('Verification file belongs to another skill.')
      const out = change(file)
      store.saveJSON(file, 'runs', name)
      return out
    })
  },

  /** Huella estable del contenido de un ejercicio (sin la marca de revisión). */
  hash(e: Exercise): string {
    const c: Exercise = { ...e }
    delete c.review
    return Hashing.sha256Hex(compactJSON(encodeExercise(c))).slice(0, 16)
  }
}

// MARK: El enunciado como texto plano (para el solucionador)

export function renderPlain(blocks: readonly Block[]): { text: string; hasImage: boolean } {
  const parts: string[] = []
  let image = false
  for (const b of blocks) {
    switch (b.type) {
      case 'text': parts.push(b.md); break
      case 'math': parts.push(`$$${b.tex}$$`); break
      case 'callout': parts.push((b.title !== undefined ? `**${b.title}** ` : '') + b.md); break
      case 'table': {
        const lines = ['| ' + b.headers.join(' | ') + ' |', '|' + b.headers.map(() => ' --- ').join('|') + '|']
        for (const r of b.rows) lines.push('| ' + r.join(' | ') + ' |')
        parts.push(lines.join('\n'))
        break
      }
      case 'image': image = true; parts.push(`[Image: ${b.alt}]`); break
      default: {
        const o = { ...encodeBlock(b) } as JSONObject
        delete o.id
        parts.push(`[Figure ${b.type === 'unknown' ? b.rawType : b.type}: ${compactJSON(o)}]`)
      }
    }
  }
  return { text: parts.join('\n\n'), hasImage: image }
}

// MARK: Presentar y leer las respuestas

/** Mezcla determinista (para que «ordenar» y «emparejar» no se presenten ya resueltos). */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const h = Hashing.sha256Hex(seed)
  let state = BigInt('0x' + h.slice(0, 16)) || 0x9e3779b97f4a7c15n
  const mask = (1n << 64n) - 1n
  const next = (): bigint => {
    state = (state + 0x9e3779b97f4a7c15n) & mask
    let z = state
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask
    return z ^ (z >> 31n)
  }
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Number(next() % BigInt(i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** El orden en que el solucionador ve las opciones de la derecha (incluidos los distractores). */
export function matchingRightOrder(m: MatchingAnswer, seed: string): string[] {
  return seededShuffle([...m.pairs.map((p) => p.right), ...m.extraRights], seed)
}

/** Cómo debe escribirse la respuesta (según el tipo) y los datos que el solucionador necesita para responder. */
export function presentation(e: Exercise): { format: string; extra: Record<string, unknown> } | undefined {
  const fmt = (raw: Answer): { format: string; extra: Record<string, unknown> } | undefined => {
    const a = answerForGrading(raw)
    switch (a.kind) {
      case 'choice': {
        const options = a.options.map((o) => ({ id: o.id, text: o.md }))
        return { format: a.multi ? 'Reply with the ids of ALL correct options separated by commas (e.g. "a,c").' : 'Reply with the id of the single correct option (e.g. "b").', extra: { options } }
      }
      case 'numeric': {
        let f = 'Reply with the final number exactly as a student would type it: an integer, decimal, fraction like 3/4, or an exact expression like sqrt(2)/2 or 5*pi/6.'
        if (a.unit !== undefined) f += ' Include the unit if the problem asks for it.'
        return { format: f, extra: {} }
      }
      case 'expression': return { format: 'Reply with the expression in calculator syntax (e.g. 2*x+1, (x-1)^2, sqrt(x)). Use * for multiplication.', extra: {} }
      case 'equation': return { format: 'Reply with the equation in calculator syntax (e.g. y=2*x+1).', extra: {} }
      case 'set': return { format: 'Reply with all the values separated by commas (e.g. "2, -3"). Exact forms like sqrt(2) are fine.', extra: {} }
      case 'interval': return { format: 'Reply with interval notation using inf for infinity (e.g. "(-inf, 3]" or "[1,2) U (4, inf)").', extra: {} }
      case 'point': return { format: 'Reply with the coordinates separated by commas (e.g. "1, -2").', extra: {} }
      case 'short': return { format: 'Reply with the word or short phrase only.', extra: {} }
      case 'cloze': {
        // la frase con los huecos puede ir en la respuesta (no en el enunciado): el solucionador tiene que verla
        const text = a.text.trim()
        return { format: `Reply with the blanks in order, separated by " | " (exactly ${a.blanks.length} blank(s)).`, extra: text ? { text_with_blanks: text } : {} }
      }
      case 'ordering': return { format: 'Reply with the items in the correct order, as a JSON array of the exact item texts.', extra: { items_shuffled: seededShuffle(a.items, e.id) } }
      case 'matching':
        return {
          format: 'Reply with a JSON object (not a string) mapping each left item, copied exactly, to its right item, copied exactly from right_shuffled (or its 1-based position there), e.g. {"<left 1>": "<right>", …}.',
          extra: { left: a.pairs.map((p) => p.left), right_shuffled: matchingRightOrder(a, e.id) }
        }
      case 'truefalse': return { format: 'Reply with "true" or "false".', extra: {} }
      case 'chem':
        switch (a.mode) {
          case 'formula': return { format: 'Reply with the chemical formula only (e.g. Fe2O3, Ca(OH)2, SO4^2-).', extra: {} }
          case 'equation': return { format: 'Reply with the balanced equation, arrow as -> (e.g. 2 H2 + O2 -> 2 H2O).', extra: {} }
          case 'name': return { format: 'Reply with the name of the substance in the course language (e.g. sulfato de cobre(II)).', extra: {} }
          case 'number': return { format: 'Reply with the number' + (a.unit !== undefined ? ` in ${a.unit}` : '') + (a.sigFigs !== undefined ? `, with ${a.sigFigs} significant figures` : '') + '.', extra: {} }
          case 'configuration': return { format: 'Reply with the electron configuration (e.g. [Ar] 4s2 3d6).', extra: {} }
        }
        return undefined
      case 'label': case 'open': case 'multi': return undefined
    }
  }
  const ans = answerForGrading(e.answer)
  if (ans.kind === 'multi') {
    const parts: unknown[] = []
    for (const p of ans.parts) {
      const f = fmt(p.answer)
      if (!f) return undefined
      parts.push({ label: p.label, prompt: renderPlain(p.prompt).text, answer_format: f.format, ...f.extra })
    }
    const example = '{' + ans.parts.map((p) => `"${p.label}": "…"`).join(', ') + '}'
    return { format: `Reply with ONE JSON object whose keys are the part labels and whose values are the answers for each part, in each part's own format — e.g. ${example} (pass it as the \`answer\` value, not as text).`, extra: { parts } }
  }
  return fmt(e.answer)
}

/** ¿Lo puede resolver el solucionador sin ver nada que no sea texto? (las abiertas y las que dependen de una imagen, no) */
export function isVerifiable(e: Exercise): boolean {
  return presentation(e) !== undefined && !renderPlain(e.prompt).hasImage
}

const fold = (s: string): string => s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()

function plainText(v: JSONValue): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(plainText).join(', ')
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (v === null) return ''
  return compactJSON(v)
}

/** Texto comparable de un elemento: sin $, sin espacios (ni `\ `, `\,`), barras dobles reducidas, sin mayúsculas ni tildes. */
export function matchKey(s: string): string {
  let t = fold(s).split('$').join('')
  while (t.includes('\\\\')) t = t.split('\\\\').join('\\')
  for (const junk of ['\\left', '\\right', '\\ ', '\\,', '\\;', '\\!', '\\quad']) t = t.split(junk).join('')
  return t.replace(/\s+/gu, '')
}

type Parsed = { ok: true; input: AnswerInput } | { ok: false; message: string }

/** Lista u objeto mandados como texto JSON («"[\"paso 1\", …]"»): se leen como lo que son. */
function structured(v: JSONValue): JSONValue {
  if (typeof v !== 'string') return v
  const s = v.trim()
  if (!s.startsWith('[') && !s.startsWith('{')) return v
  try { const p = JSONRepair.parse(s); if (Array.isArray(p) || isJSONObject(p)) return p } catch { /* sigue */ }
  // una lista al estilo de Python, con comillas simples: ['paso 1', 'paso 2']
  if (s.startsWith('[')) {
    const items = [...s.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1])
    if (items.length) return items
  }
  return v
}

/** Relacionar: objeto, el mismo objeto como texto, una lista de pares o líneas «izquierda -> derecha»; cada lado por su texto o su posición. */
export function parseMatching(m: MatchingAnswer, value: JSONValue, rightOrder: readonly string[]): Parsed {
  const lefts = m.pairs.map((p) => p.left)
  const rights = [...m.pairs.map((p) => p.right), ...m.extraRights]
  const position = (s: string, count: number): number | undefined => {
    const t = s.trim().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '').toLowerCase()
    const digits = t.replace(/^\p{L}+/u, '')
    if (digits && t.length - digits.length <= 2 && /^\d+$/.test(digits)) { const n = Number(digits); if (n >= 1 && n <= count) return n - 1 }
    if (t.length === 1) { const c = t.charCodeAt(0); if (c >= 97 && c < 97 + count) return c - 97 }
    return undefined
  }
  const find = (s: string, items: readonly string[], order: readonly string[]): string | undefined => {
    const k = matchKey(s)
    const exact = items.find((x) => matchKey(x) === k)
    if (exact !== undefined) return exact
    const i = position(s, order.length)
    if (i !== undefined) return order[i]
    const hits = items.filter((x) => { const y = matchKey(x); return k !== '' && y !== '' && (y.includes(k) || k.includes(y)) })
    return hits.length === 1 ? hits[0] : undefined
  }
  const v = structured(value)
  const raw: Array<[string, string]> = []
  const splitLine = (line: string): void => {
    for (const sep of ['->', '→', '=>', '⇒', ':', '=']) {
      const i = line.indexOf(sep)
      if (i < 0) continue
      const l = line.slice(0, i).trim(), r = line.slice(i + sep.length).trim()
      if (l && r) { raw.push([l, r]); return }
    }
  }
  if (isJSONObject(v)) for (const [k, x] of Object.entries(v)) raw.push([k, plainText(x)])
  else if (Array.isArray(v)) {
    for (const item of v) {
      if (isJSONObject(item)) {
        const l = item.left ?? item.l ?? item.item
        const r = item.right ?? item.r ?? item.match
        if (l !== undefined && r !== undefined) raw.push([plainText(l), plainText(r)])
        else { const e = Object.entries(item); if (e.length === 1) raw.push([e[0][0], plainText(e[0][1])]) }
      } else if (Array.isArray(item) && item.length === 2) raw.push([plainText(item[0]), plainText(item[1])])
      else if (typeof item === 'string') splitLine(item)
    }
  } else for (const line of plainText(v).split(/[\n;]/)) splitLine(line)
  const map: Record<string, string> = {}
  const unknown: string[] = []
  for (const [l, r] of raw) {
    const left = find(l, lefts, lefts)
    const right = find(r, rights, rightOrder)
    if (left === undefined || right === undefined) { unknown.push(`${l} → ${r}`); continue }
    map[left] = right
  }
  if (Object.keys(map).length === lefts.length) return { ok: true, input: Input.matching(map) }
  const missing = lefts.filter((x) => map[x] === undefined)
  let msg = `Match every left item (${lefts.length}); ${missing.length} missing.`
  if (unknown.length) msg += ` Not recognized: ${unknown.slice(0, 3).join('; ')}.`
  msg += ' Send a JSON object (not a string) whose keys are exactly: ' + lefts.map((x) => `"${x}"`).join(', ') + ' and whose values are copied from right_shuffled (or their 1-based position).'
  return { ok: false, message: msg }
}

function zipParts(labels: readonly string[], values: readonly JSONValue[]): Record<string, JSONValue> | undefined {
  if (!values.length || values.length !== labels.length) return undefined
  const out: Record<string, JSONValue> = {}
  labels.forEach((l, i) => { if (!(l in out)) out[l] = values[i] })
  return out
}

/** «a) 3\nb) x = 2» o «a: 3; b: 5» → objeto por etiqueta (undefined si falta alguna parte). */
export function labeledParts(text: string, labels: readonly string[]): Record<string, JSONValue> | undefined {
  const out: Record<string, JSONValue> = {}
  for (const raw of text.split(/[\n;]/)) {
    const line = raw.trim()
    for (const l of labels) {
      if (out[l] !== undefined) continue
      for (const prefix of [`(${l})`, `${l})`, `${l}:`, `${l}.`, `${l} -`, `${l}=`]) {
        if (line.toLowerCase().startsWith(prefix.toLowerCase())) out[l] = line.slice(prefix.length).trim()
      }
    }
  }
  return Object.keys(out).length === labels.length ? out : undefined
}

/** Convierte la respuesta del solucionador a la entrada que entiende el corrector. */
export function parseSolverAnswer(answer: Answer, value: JSONValue, exerciseID = ''): Parsed {
  const text = (v: JSONValue): string => plainText(v)
  const a = answerForGrading(answer)
  switch (a.kind) {
    case 'choice': {
      const valid = new Map(a.options.map((o) => [o.id.toLowerCase(), o.id] as const))
      const tokens = (Array.isArray(value) ? value.map(text) : [text(value)]).flatMap((t) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))
      const chosen = new Set<string>()
      for (const t of tokens) {
        const id = valid.get(t)
        if (id === undefined) return { ok: false, message: `Unknown option id '${t}'. Valid ids: ${a.options.map((o) => o.id).join(', ')}.` }
        chosen.add(id)
      }
      return chosen.size ? { ok: true, input: Input.choice(chosen) } : { ok: false, message: 'No option chosen.' }
    }
    case 'truefalse': {
      const t = text(value).toLowerCase().trim().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '')
      if (['true', 'verdadero', 'v', 'cierto', 'yes', 'sí', 'si', 't'].includes(t)) return { ok: true, input: Input.bool(true) }
      if (['false', 'falso', 'f', 'no'].includes(t)) return { ok: true, input: Input.bool(false) }
      return { ok: false, message: 'Reply "true" or "false".' }
    }
    case 'cloze': {
      const v = structured(value)
      const blanks = Array.isArray(v) ? v.map(text) : text(v).split(/[|\n]/).map((x) => x.trim())
      return blanks.length === a.blanks.length ? { ok: true, input: Input.blanks(blanks) } : { ok: false, message: `Expected ${a.blanks.length} blank(s), got ${blanks.length}.` }
    }
    case 'ordering': {
      const v = structured(value)
      const given = Array.isArray(v) ? v.map(text) : text(v).split('\n').map((x) => x.trim()).filter(Boolean)
      const norm = (s: string): string => fold(s).trim().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '')
      const mapped: string[] = []
      for (const g of given) {
        const m = a.items.find((x) => norm(x) === norm(g))
        if (m === undefined) return { ok: false, message: `'${g}' is not one of the items.` }
        mapped.push(m)
      }
      return new Set(mapped).size === a.items.length && mapped.length === a.items.length ? { ok: true, input: Input.ordering(mapped) } : { ok: false, message: 'Give every item exactly once.' }
    }
    case 'matching':
      return parseMatching(a, structured(value), matchingRightOrder(a, exerciseID))
    case 'multi': {
      const labels = a.parts.map((p) => p.label)
      const example = '{' + labels.map((l) => `"${l}": "<answer to ${l}>"`).join(', ') + '}'
      let obj: Record<string, JSONValue> | undefined = isJSONObject(value) ? value : undefined
      // tolerante: JSON como texto, una lista en el orden de las partes, o líneas «a) …», «b: …»
      if (!obj && typeof value === 'string') {
        try { const p = JSONRepair.parse(value); obj = isJSONObject(p) ? p : Array.isArray(p) ? zipParts(labels, p) : undefined } catch { /* sigue */ }
      }
      if (!obj && Array.isArray(value)) obj = zipParts(labels, value)
      if (!obj && typeof value === 'string') obj = labeledParts(value, labels)
      if (!obj) return { ok: false, message: `Reply with a JSON object keyed by part label, e.g. ${example}.` }
      const parts: AnswerInput[] = []
      for (const p of a.parts) {
        const v = obj[p.label] ?? obj[p.label.toLowerCase()] ?? obj[p.label.toUpperCase()]
        if (v === undefined) return { ok: false, message: `Missing part ${p.label}. Use e.g. ${example}.` }
        const r = parseSolverAnswer(p.answer, v, exerciseID)
        if (!r.ok) return { ok: false, message: `Part ${p.label}: ${r.message}` }
        parts.push(r.input)
      }
      return { ok: true, input: Input.parts(parts) }
    }
    case 'label': case 'open':
      return { ok: false, message: 'This exercise cannot be checked automatically.' }
    default: {
      const t = text(value).trim()
      return t ? { ok: true, input: Input.text(t) } : { ok: false, message: 'Empty answer.' }
    }
  }
}

// MARK: Herramientas del solucionador y del árbitro

function skillOf(ctx: ToolContext, sid: string | undefined): ReturnType<PackStore['loadSkill']> | undefined {
  if (!sid || !ctx.store.hasSkill(sid)) return undefined
  try { return ctx.store.loadSkill(sid) } catch { return undefined }
}

export function listExercisesToSolve(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'list_exercises_to_solve', 'Returns the skill\'s exercises WITHOUT their answer keys, hints or solutions. Solve each one yourself, from scratch, then record your answer with submit_solution. Some exercises are not included because they cannot be checked automatically (open answers, labelled images, figures you cannot see).',
    Schema.object([['skill_id', Schema.string()]]),
    (a) => {
      const sid = a.string('skill_id', ['skill']) ?? ctx.assignedSkill
      const s = skillOf(ctx, sid)
      if (!sid || !s) return ToolOut.error('Unknown skill.')
      const out: unknown[] = []
      const presented: string[] = []
      const skipped: Record<string, string> = {}
      for (const e of s.exercises) {
        const r = renderPlain(e.prompt)
        const pres = presentation(e)
        if (!pres) { skipped[e.id] = `kind ${e.answer.kind === 'unknown' ? e.answer.rawKind : e.answer.kind} is not auto-checkable`; continue }
        if (r.hasImage) { skipped[e.id] = 'prompt depends on an image'; continue }
        const o: Record<string, unknown> = { id: e.id, level: e.level, kind: e.answer.kind, prompt: r.text, answer_format: pres.format, ...pres.extra }
        const ans = answerForGrading(e.answer)
        if (ans.kind === 'numeric' && ans.unit !== undefined) o.unit_hint = ans.unit
        if (ans.kind === 'choice' && ans.multi) o.multiple_answers = true
        out.push(o)
        presented.push(e.id)
      }
      try {
        VerificationStore.update(ctx.store, ctx.runID, sid, (file) => { file.presented = presented; file.skipped = skipped })
      } catch (err) {
        return ToolOut.error(`Could not save verification: ${err instanceof Error ? err.message : String(err)}`)
      }
      return ToolOut.json({
        ok: true, skill_id: sid, count: out.length, skipped: Object.keys(skipped).length, exercises: out,
        how_to: 'Work through every exercise. Do the maths carefully (use the calculator tool for arithmetic). Then call submit_solution once per exercise. Do NOT try to read the course\'s answer keys; you are an independent check.'
      })
    })
}

export function submitSolution(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'submit_solution', 'Record your independent answer to ONE exercise (the app compares it with the key privately; you will not be told whether it matched). `answer` follows the exercise\'s answer_format. `work` is a short summary of how you solved it (2–6 lines) so a referee can check your reasoning if the answers differ. If the exercise itself looks broken, ambiguous or unanswerable, still submit your best answer and say so in `work`.',
    Schema.object([['skill_id', Schema.string()], ['exercise_id', Schema.string()], ['answer', Schema.any('The answer in the exercise\'s answer_format (string, array or object)')], ['work', Schema.string('brief reasoning')]], { required: ['exercise_id', 'answer'] }),
    (a) => {
      const sid = a.string('skill_id', ['skill']) ?? ctx.assignedSkill
      const skill = skillOf(ctx, sid)
      if (!sid || !skill) return ToolOut.error('Unknown skill.')
      const eid = a.string('exercise_id', ['id']) ?? ''
      const ex = skill.exercises.find((e) => e.id === eid)
      if (!ex) return ToolOut.error(`Unknown exercise '${eid}'.`)
      const value = a.value('answer')
      if (value === undefined) return ToolOut.error("Missing 'answer'.")
      const work = a.string('work') ?? ''
      const file = VerificationStore.load(ctx.store, ctx.runID, sid)
      if (!file.presented.includes(eid)) return ToolOut.error(`Exercise '${eid}' was not offered by list_exercises_to_solve.`)
      const hash = VerificationStore.hash(ex)
      let record: VerificationRecord
      let problem: string | undefined
      const parsed = parseSolverAnswer(ex.answer, value, ex.id)
      if (!parsed.ok) {
        record = { exerciseID: eid, outcome: 'unparsable', solverAnswer: plainText(value), work, feedback: parsed.message, exerciseHash: hash, resolved: false }
        problem = `I could not read that answer: ${parsed.message} Re-send it following the exercise's answer_format.`
      } else {
        // el corrector va fuera del cerrojo: dos soluciones a la vez se corrigen en paralelo
        const g = (ctx.grade ?? gradeExercise)(ex, parsed.input)
        const outcome: VerificationOutcome = g.status === 'correct' ? 'match' : g.status === 'invalid' ? 'unparsable' : 'mismatch'
        const fb = [g.status, ...g.feedback.map((f) => f.markdown)].join(' · ')
        record = { exerciseID: eid, outcome, solverAnswer: plainText(value), work, feedback: fb, exerciseHash: hash, resolved: false }
        if (outcome === 'unparsable') problem = `The app could not interpret that answer (${g.feedback[0]?.markdown ?? 'invalid'}). Re-send it following the exercise's answer_format.`
      }
      try {
        return VerificationStore.update(ctx.store, ctx.runID, sid, (current) => {
          if (!current.presented.includes(eid)) return ToolOut.error(`Exercise '${eid}' was not offered by list_exercises_to_solve.`)
          current.records[eid] = record
          if (problem) return ToolOut.error(problem)
          const remaining = current.presented.filter((id) => current.records[id] === undefined).length
          return ToolOut.json({ ok: true, recorded: true, remaining })
        })
      } catch (err) {
        return ToolOut.error(`Could not save verification: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function listDisagreements(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'list_disagreements', 'Exercises where an independent solver\'s answer did NOT match the answer key (or could not be interpreted). For each: the full exercise (with the key), the solver\'s answer and reasoning. Decide who is right.',
    Schema.object([['skill_id', Schema.string()]]),
    (a) => {
      const sid = a.string('skill_id', ['skill']) ?? ctx.assignedSkill
      const skill = skillOf(ctx, sid)
      if (!sid || !skill) return ToolOut.error('Unknown skill.')
      const file = VerificationStore.load(ctx.store, ctx.runID, sid)
      const out: unknown[] = []
      for (const rec of Object.values(file.records).sort((x, y) => x.exerciseID.localeCompare(y.exerciseID))) {
        if (rec.outcome === 'match' || rec.resolved) continue
        const ex = skill.exercises.find((e) => e.id === rec.exerciseID)
        if (!ex) continue
        out.push({ exercise: encodeExercise(ex), solver_answer: rec.solverAnswer, solver_work: rec.work, grader_verdict: rec.feedback, exercise_hash: rec.exerciseHash })
      }
      return ToolOut.json({
        ok: true, count: out.length, disagreements: out,
        how_to: 'For each: re-derive the answer yourself (use calculate; check the course materials). Verdicts: key_wrong (the key was wrong → fix the exercise with add_exercises, same id), ambiguous (the statement allows several answers → rewrite it with add_exercises, same id, or delete it with delete_items), format_problem (the answer is right but the app could not read the solver\'s format; fix the answer spec so equivalent forms are accepted), solver_wrong (the key is right; explain why in note), cannot_decide (flag it for the student). Always call resolve_disagreement after deciding.'
      })
    })
}

export function resolveDisagreement(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'resolve_disagreement', 'Record your decision for one disagreement. For key_wrong, ambiguous and format_problem you must already have changed or deleted the exercise (add_exercises / delete_items) — the tool checks.',
    Schema.object([['skill_id', Schema.string()], ['exercise_id', Schema.string()], ['verdict', Schema.string(undefined, ['key_wrong', 'ambiguous', 'format_problem', 'solver_wrong', 'cannot_decide'])],
      ['note', Schema.string('one or two sentences: what was wrong / why the key is right')]], { required: ['exercise_id', 'verdict', 'note'] }),
    (a) => {
      const sid = a.string('skill_id', ['skill']) ?? ctx.assignedSkill
      if (!sid) return ToolOut.error('Missing skill_id.')
      const eid = a.string('exercise_id', ['id']) ?? ''
      const verdict = a.string('verdict') ?? ''
      const note = a.string('note') ?? ''
      try {
        return VerificationStore.update(ctx.store, ctx.runID, sid, (file) => {
          const rec = file.records[eid]
          if (!rec) return ToolOut.error(`No disagreement recorded for '${eid}'.`)
          const current = skillOf(ctx, sid)?.exercises.find((e) => e.id === eid)
          const changed = current === undefined || VerificationStore.hash(current) !== rec.exerciseHash
          if (['key_wrong', 'ambiguous', 'format_problem'].includes(verdict)) {
            if (!changed) return ToolOut.error(`The exercise '${eid}' has not changed. Fix it first with add_exercises (same id) or remove it with delete_items, then resolve.`)
          } else if (!['solver_wrong', 'cannot_decide'].includes(verdict)) return ToolOut.error(`Unknown verdict '${verdict}'.`)
          file.records[eid] = { ...rec, resolved: true, verdict, note }
          const left = Object.values(file.records).filter((r) => r.outcome !== 'match' && !r.resolved).length
          return ToolOut.json({ ok: true, resolved: true, left })
        })
      } catch (err) {
        return ToolOut.error(`Could not save verification: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

// MARK: Aplicar el resultado (lo hace la tubería, no la IA)

export interface VerificationSummary { verified: number; fixed: number; flagged: number; disagreements: number; skipped: number }

/** Marca cada ejercicio según el registro: ✓ verificado, ✎ corregido, ⚑ sin resolver. */
export function applyVerification(store: PackStore, runID: string | undefined, sid: string, now = new Date()): VerificationSummary {
  const file = VerificationStore.load(store, runID, sid)
  const sum: VerificationSummary = { verified: 0, fixed: 0, flagged: 0, disagreements: 0, skipped: Object.keys(file.skipped).length }
  if (!store.hasSkill(sid)) return sum
  const date = now.toISOString()
  try {
    store.updateSkill(sid, (s) => {
      s.exercises = s.exercises.map((e) => {
        const rec = file.records[e.id]
        if (!rec) return e
        // el registro es de esta versión del ejercicio: si cambió después, lo que se comprobó era otro ejercicio
        const same = VerificationStore.hash(e) === rec.exerciseHash
        const out: Exercise = { ...e }
        if (rec.outcome === 'match') {
          if (!same) { delete out.review; sum.skipped++ } else { out.review = { state: 'verified', note: tr('Un solucionador independiente obtuvo la misma respuesta.', 'An independent solver got the same answer.'), date }; sum.verified++ }
          return out
        }
        sum.disagreements++
        if (rec.resolved) {
          const v = rec.verdict ?? ''
          if (v === 'solver_wrong' && !same) { delete out.review; sum.skipped++ }
          else if (v === 'solver_wrong') { out.review = { state: 'verified', note: rec.note ?? tr('Revisado: la clave es correcta.', 'Reviewed: the key is correct.'), date }; sum.verified++ }
          else if (v === 'cannot_decide') { out.review = { state: 'flagged', note: rec.note ?? tr('No se pudo decidir cuál respuesta es correcta.', 'It could not be decided which answer is correct.'), date }; sum.flagged++ }
          else { out.review = { state: 'fixed', note: rec.note ?? tr('Corregido tras una discrepancia.', 'Fixed after a disagreement.'), date }; sum.fixed++ }
        } else {
          out.review = { state: 'flagged', note: tr(`Un solucionador independiente obtuvo otra respuesta (${rec.solverAnswer}) y no se resolvió. Revísalo antes de confiar en él.`, `An independent solver got a different answer (${rec.solverAnswer}) and it was not resolved. Check it before trusting it.`), date }
          sum.flagged++
        }
        return out
      })
    })
  } catch { /* la habilidad no se pudo escribir: sin marcas */ }
  return sum
}
