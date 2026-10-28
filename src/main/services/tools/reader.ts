// Fichas de los materiales hechas por los lectores del equipo (port de StudyEngine/Tools/ReaderTools.swift): qué es cada
// material, qué temas trata y cómo pregunta. La leen el planificador (en lugar de releerlo todo) y los autores (para buscar justo
// donde hace falta). Se guardan en `Packs/<id>/digests/<material>.json`, como en la app Swift.
import { isJSONObject, Schema } from '@engine/base/json'
import type { SourceDigest } from '@engine/pipeline'
import { tr } from '@shared/ai/i18n'
import type { Pack } from '@shared/schema'
import type { AgentTool } from '../ai'
import type { PackStore } from '../store'
import { defineTool, ToolOut, type ToolContext } from './context'

export const DIGESTS_FOLDER = 'digests'

export function decodeDigest(raw: unknown): SourceDigest | undefined {
  if (!isJSONObject(raw) || typeof raw.sourceID !== 'string' || typeof raw.summary !== 'string') return undefined
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const d: SourceDigest = {
    sourceID: raw.sourceID, title: typeof raw.title === 'string' ? raw.title : raw.sourceID, characters: typeof raw.characters === 'number' ? raw.characters : 0,
    kind: typeof raw.kind === 'string' ? raw.kind : 'other', summary: raw.summary, topics: strs(raw.topics), formulas: strs(raw.formulas),
    date: typeof raw.date === 'string' ? raw.date : new Date(0).toISOString()
  }
  if (typeof raw.questionStyles === 'string') d.questionStyles = raw.questionStyles
  if (typeof raw.conventions === 'string') d.conventions = raw.conventions
  return d
}

/** Las fichas al día de los materiales del curso (las de materiales cambiados o borrados se ignoran). */
export function loadDigests(store: PackStore, pack: Pack): SourceDigest[] {
  const out: SourceDigest[] = []
  for (const m of pack.sources) {
    const d = store.loadJSON(DIGESTS_FOLDER, m.id, decodeDigest)
    if (d && d.characters === m.characters) out.push(d)
  }
  return out
}

const KINDS = ['notes', 'slides', 'textbook', 'review', 'exam', 'syllabus', 'worksheet', 'other']

export function saveSourceDigest(ctx: ToolContext, allowed?: ReadonlySet<string>): AgentTool {
  return defineTool(ctx, 'save_source_digest', 'Save your digest of ONE material (call it once per material you were assigned). Be concrete: the planner and the authors rely on it instead of re-reading the material.',
    Schema.object([
      ['source_id', Schema.string()],
      ['kind', Schema.string('what the material is', KINDS)],
      ['summary', Schema.string('2–4 sentences: what it is, what it covers, how useful it is for the exam')],
      ['topics', Schema.array(Schema.string(), 'topics/sections in order, with pages when known, e.g. "5.2 Balancing equations (pp. 4–9)"')],
      ['formulas', Schema.array(Schema.string(), 'key formulas, definitions and facts, in LaTeX when math ($…$)')],
      ['question_styles', Schema.string('for review sheets/exams: how questions are asked, answer formats, difficulty, how many')],
      ['conventions', Schema.string('notation, units, rounding, what the instructor insists on')]
    ], { required: ['source_id', 'summary', 'topics'] }),
    (a) => {
      const sid = a.string('source_id')
      const summary = a.string('summary')
      if (!sid || !summary) return ToolOut.error("Missing 'source_id' and 'summary'.")
      if (allowed && !allowed.has(sid)) return ToolOut.error(`You were not assigned '${sid}'. Your materials: ${[...allowed].sort().join(', ')}.`)
      let meta
      try { meta = ctx.store.loadPack().sources.find((s) => s.id === sid) } catch { meta = undefined }
      if (!meta) return ToolOut.error(`Source '${sid}' not found. Use list_sources.`)
      const clean = (xs: string[] | undefined): string[] => (xs ?? []).map((x) => x.trim()).filter(Boolean).map((x) => Array.from(x).slice(0, 300).join(''))
      const cut = (s: string, n: number): string => Array.from(s).slice(0, n).join('')
      const d: SourceDigest = {
        sourceID: sid, title: meta.title, characters: meta.characters, kind: a.string('kind') ?? 'other', summary: cut(summary, 1200),
        topics: clean(a.strings('topics')).slice(0, 60), formulas: clean(a.strings('formulas')).slice(0, 60), date: new Date().toISOString()
      }
      const qs = a.string('question_styles'); if (qs) d.questionStyles = cut(qs, 1200)
      const conv = a.string('conventions'); if (conv) d.conventions = cut(conv, 800)
      try { ctx.store.saveJSON(d, DIGESTS_FOLDER, sid) } catch (err) { return ToolOut.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`) }
      ctx.notify({ kind: 'note', text: tr(`Ficha de «${meta.title}» lista`, `Digest of “${meta.title}” ready`) })
      return ToolOut.json({ ok: true, source_id: sid, topics: d.topics.length })
    })
}
