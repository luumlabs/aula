// Curso («pack») y contenido completo de una habilidad (port de StudyModel/Pack.swift).
import { IDs } from '@engine/base/ids'
import type { JSONObject } from '@engine/base/json'
import {
  bool, clamp, date, enumOf, flexStr, int, isObj, list, nested, nowISO, num, pickKeys, prune, str, strings, uniquifyIDs, vInt, vStr,
  SchemaError, type ISODate, type ItemID, type Obj
} from './coding'
import { blocksField, encodeBlock, type Block } from './blocks'
import { decodeDeck, decodeFlashcard, encodeDeck, encodeFlashcard, type Deck, type Flashcard } from './cards'
import {
  decodeContentIssue, decodeFormulaItem, decodeSourceRef, encodeContentIssue, encodeFormulaItem, encodeSourceRef,
  type ContentIssue, type FormulaItem, type SourceRef
} from './common'
import { CourseIconCatalog } from './courseIcons'
import { STUDY_GOAL_KINDS, type StudyGoalKind } from '@engine/pipeline/goal'
import { decodeExercise, decodeTemplate, encodeExercise, encodeTemplate, type Exercise, type ExerciseTemplate } from './exercises'

export const CONTENT_STATUSES = ['empty', 'draft', 'ready', 'needsReview'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]

/** Enumeración con `init(from:)` propio en Swift: ausente → `missing`; no-cadena → `notString`; cadena desconocida → `unknown`. */
function swiftEnum<T extends string>(c: Obj, k: string, values: readonly T[], missing: T, notString: T, unknown: T): T {
  const v = c[k]
  if (v === undefined || v === null) return missing
  if (typeof v !== 'string') return notString
  return (values as readonly string[]).includes(v) ? (v as T) : unknown
}

const contentStatus = (c: Obj, k: string, missing: ContentStatus): ContentStatus => swiftEnum(c, k, CONTENT_STATUSES, missing, 'empty', 'draft')

export interface ExamInfo {
  title: string
  date?: ISODate
  durationMinutes?: number
  totalPoints?: number
  /** Ayudas permitidas: calculadora, hoja de fórmulas, libro abierto… */
  aids?: string
  /** Lo que dijo el profesor (formato, tipo de problemas, convenciones). Se usa al generar contenido. */
  notes?: string
  location?: string
}

export interface PackUnit { id: ItemID; title: string; summary?: string; skillIDs: ItemID[] }

export interface ContentCounts { lessonBlocks: number; exercises: number; templates: number; cards: number; decks: number }

/** Resumen de una habilidad (lo que necesita el mapa del curso sin cargar la lección completa). */
export interface SkillRef {
  id: ItemID
  unit?: ItemID
  title: string
  summary?: string
  objectives: string[]
  prerequisites: ItemID[]
  /** Peso relativo en el examen (puntos). */
  weight: number
  minutes: number
  order: number
  status: ContentStatus
  counts: ContentCounts
}

export interface BlueprintSection {
  title: string
  skillIDs: ItemID[]
  count: number
  minLevel: number
  maxLevel: number
  pointsEach: number
  instructions?: string
}

export interface ExamBlueprint {
  durationMinutes: number
  totalPoints: number
  sections: BlueprintSection[]
  instructions?: string
  /** Nota de corte oficial (0…1) cuando el examen la tiene. undefined = sin nota de corte. */
  passPercent?: number
}

export interface GlossaryEntry { term: string; definition: string; aliases: string[]; skill?: ItemID }
export interface FormulaGroup { title: string; items: FormulaItem[] }

export const SOURCE_TRUSTS = ['official', 'book', 'notes', 'web', 'canvas', 'other'] as const
export type SourceTrust = (typeof SOURCE_TRUSTS)[number]
export const SOURCE_STATUSES = ['processing', 'ready', 'failed'] as const
export type SourceStatus = (typeof SOURCE_STATUSES)[number]

/** Fuentes del usuario (materiales). El texto extraído vive en `sources/<id>/chunks.json`. */
export interface SourceMeta {
  id: ItemID
  title: string
  /** pdf, docx, pptx, image, web, text, canvas… */
  kind: string
  /** Archivo original dentro de sources/<id>/. */
  filename?: string
  url?: string
  addedAt: ISODate
  pages: number
  characters: number
  status: SourceStatus
  trust: SourceTrust
  note?: string
  warnings: string[]
}

/** Fragmento de texto de una fuente (para buscar y citar). */
export interface SourceChunk { id: string; sourceID: ItemID; ordinal: number; page?: number; pageEnd?: number; heading?: string; text: string }

export interface GenerationRecord {
  id: string
  date: ISODate
  provider: string
  model: string
  summary: string
  promptTokens: number
  completionTokens: number
  /** done | failed | cancelled | running */
  status: string
}

export interface CanvasLink { host: string; courseID: number; courseName: string }

export interface Pack {
  schema: number
  id: ItemID
  title: string
  subject: string
  courseCode?: string
  /** Idioma de las explicaciones ("es", "en"…). */
  language: string
  /** Idioma de los enunciados del examen real, si es distinto (activa glosas bilingües). */
  examLanguage?: string
  /** Icono pixel-art del curso (`CourseIconCatalog.ids`). Al leer un curso antiguo, su SF Symbol se traduce. */
  icon: string
  /** Tono del color del curso, 0…1. */
  hue: number
  created: ISODate
  updated: ISODate
  exam?: ExamInfo
  units: PackUnit[]
  skills: SkillRef[]
  blueprint?: ExamBlueprint
  glossary: GlossaryEntry[]
  formulaSheet: FormulaGroup[]
  sources: SourceMeta[]
  generation: GenerationRecord[]
  canvas?: CanvasLink
  /** Instrucciones del usuario que la IA debe respetar siempre en este curso. */
  guidance?: string
  /** Curso a su ritmo, sin examen. undefined en los cursos de antes (con examen). */
  selfPaced?: boolean
  /**
   * Clase de meta con la que se creó el curso (idioma, programación…). La corrección la usa (los cursos de idiomas corrigen los
   * huecos exactos); undefined en los cursos de antes (se deduce del título). Campo nuevo: Swift lo ignora.
   */
  goalKind?: StudyGoalKind
}

export const PACK_SCHEMA = 1

export interface CommonMistake {
  title: string
  /** md: cómo se suele hacer mal */
  wrong: string
  /** md: cómo se hace bien */
  right: string
  /** md: por qué ocurre */
  why: string
}

export interface Skill {
  id: ItemID
  title: string
  summary?: string
  objectives: string[]
  prerequisites: ItemID[]
  /** La lección: una secuencia de bloques que la interfaz presenta paso a paso. */
  lesson: Block[]
  exercises: Exercise[]
  templates: ExerciseTemplate[]
  cards: Flashcard[]
  decks: Deck[]
  mistakes: CommonMistake[]
  sources: SourceRef[]
  status: ContentStatus
  issues: ContentIssue[]
  revision: number
  updated: ISODate
}

// MARK: Leer

export function decodeExamInfo(raw: unknown): ExamInfo | undefined {
  if (!isObj(raw)) return undefined
  return prune({
    title: flexStr(raw, 'title') ?? 'Examen', date: date(raw, 'date'), durationMinutes: int(raw, 'durationMinutes'), totalPoints: num(raw, 'totalPoints'),
    aids: str(raw, 'aids'), notes: str(raw, 'notes'), location: str(raw, 'location')
  })
}

export function decodePackUnit(raw: unknown): PackUnit | undefined {
  if (!isObj(raw)) return undefined
  const seen = new Set<string>()
  return prune({
    id: flexStr(raw, 'id') ?? IDs.short(5), title: flexStr(raw, 'title') ?? '', summary: str(raw, 'summary'),
    skillIDs: strings(raw, 'skillIDs').filter((s) => (seen.has(s) ? false : (seen.add(s), true)))
  })
}

export function emptyCounts(): ContentCounts {
  return { lessonBlocks: 0, exercises: 0, templates: 0, cards: 0, decks: 0 }
}

export function decodeContentCounts(raw: unknown): ContentCounts | undefined {
  if (!isObj(raw)) return undefined
  // recuentos acotados: la biblioteca los suma al listar los cursos y un Int.max de un archivo dañado desbordaba la suma
  const n = (k: string): number => clamp(int(raw, k) ?? 0, 0, 1_000_000)
  return { lessonBlocks: n('lessonBlocks'), exercises: n('exercises'), templates: n('templates'), cards: n('cards'), decks: n('decks') }
}

export function decodeSkillRef(raw: unknown, d = 0): SkillRef | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const id = flexStr(c, 'id') ?? IDs.short(5)
  return prune({
    id, unit: flexStr(c, 'unit'), title: flexStr(c, 'title') ?? id, summary: str(c, 'summary'), objectives: strings(c, 'objectives'),
    // pesos y minutos absurdos (1e308, Int.max) desbordaban las sumas del plan y de la preparación estimada
    prerequisites: strings(c, 'prerequisites'), weight: clamp(num(c, 'weight') ?? 1, 0, 1e6, 1), minutes: clamp(int(c, 'minutes') ?? 20, 0, 10_000),
    order: int(c, 'order') ?? 0, status: contentStatus(c, 'status', 'empty'), counts: nested(c, 'counts', decodeContentCounts, d) ?? emptyCounts()
  })
}

export function decodeBlueprintSection(raw: unknown): BlueprintSection | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    title: flexStr(c, 'title') ?? 'Sección', skillIDs: strings(c, 'skillIDs'), count: clamp(int(c, 'count') ?? 1, 0, 500), minLevel: int(c, 'minLevel') ?? 1,
    maxLevel: int(c, 'maxLevel') ?? 3, pointsEach: clamp(num(c, 'pointsEach') ?? 1, 0, 1e6, 1), instructions: str(c, 'instructions')
  })
}

const validPass = (p: number | undefined): number | undefined => (p !== undefined && Number.isFinite(p) && p > 0 && p <= 1 ? p : undefined)

export function decodeBlueprint(raw: unknown, d = 0): ExamBlueprint | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    durationMinutes: clamp(int(c, 'durationMinutes') ?? 60, 0, 10_000), totalPoints: clamp(num(c, 'totalPoints') ?? 100, 0, 1e9, 100),
    sections: list(c, 'sections', decodeBlueprintSection, d), instructions: str(c, 'instructions'), passPercent: validPass(num(c, 'passPercent'))
  })
}

export function decodeGlossaryEntry(raw: unknown): GlossaryEntry | undefined {
  if (!isObj(raw)) return undefined
  return prune({ term: flexStr(raw, 'term') ?? '', definition: flexStr(raw, 'definition') ?? '', aliases: strings(raw, 'aliases'), skill: flexStr(raw, 'skill') })
}

export function decodeFormulaGroup(raw: unknown, d = 0): FormulaGroup | undefined {
  if (!isObj(raw)) return undefined
  return { title: flexStr(raw, 'title') ?? 'Fórmulas', items: list(raw, 'items', decodeFormulaItem, d) }
}

export function decodeSourceMeta(raw: unknown): SourceMeta | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    id: flexStr(c, 'id') ?? IDs.short(6), title: flexStr(c, 'title') ?? 'Fuente', kind: str(c, 'kind') ?? 'text', filename: str(c, 'filename'), url: str(c, 'url'),
    addedAt: date(c, 'addedAt') ?? nowISO(), pages: int(c, 'pages') ?? 0, characters: int(c, 'characters') ?? 0,
    status: swiftEnum(c, 'status', SOURCE_STATUSES, 'ready', 'ready', 'ready'), trust: swiftEnum(c, 'trust', SOURCE_TRUSTS, 'other', 'other', 'other'),
    note: str(c, 'note'), warnings: strings(c, 'warnings')
  })
}

/** Decodificación estricta (sin `init(from:)` propio en Swift): un fragmento con campos que faltan se descarta. */
export function decodeSourceChunk(raw: unknown): SourceChunk | undefined {
  if (!isObj(raw)) return undefined
  const id = vStr(raw.id), sourceID = vStr(raw.sourceID), ordinal = vInt(raw.ordinal), text = vStr(raw.text)
  if (id === undefined || sourceID === undefined || ordinal === undefined || text === undefined) return undefined
  const opt = <T>(v: unknown, f: (x: unknown) => T | undefined): T | undefined | null => (v === undefined || v === null ? undefined : f(v) ?? null)
  const page = opt(raw.page, vInt), pageEnd = opt(raw.pageEnd, vInt), heading = opt(raw.heading, vStr)
  if (page === null || pageEnd === null || heading === null) return undefined
  return prune({ id, sourceID, ordinal, page, pageEnd, heading, text })
}

export function decodeGenerationRecord(raw: unknown): GenerationRecord | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return {
    id: flexStr(c, 'id') ?? IDs.short(6), date: date(c, 'date') ?? nowISO(), provider: str(c, 'provider') ?? '', model: str(c, 'model') ?? '',
    summary: str(c, 'summary') ?? '', promptTokens: clamp(int(c, 'promptTokens') ?? 0, 0, 1e12), completionTokens: clamp(int(c, 'completionTokens') ?? 0, 0, 1e12),
    status: str(c, 'status') ?? 'done'
  }
}

function decodeCanvasLink(raw: unknown): CanvasLink | undefined {
  if (!isObj(raw)) return undefined
  const host = vStr(raw.host), courseID = vInt(raw.courseID), courseName = vStr(raw.courseName)
  return host !== undefined && courseID !== undefined && courseName !== undefined ? { host, courseID, courseName } : undefined
}

/** Lee un curso (`pack.json`) como `Pack.init(from:)`: valores por defecto, ids únicos e icono del catálogo. */
export function decodePack(raw: unknown, d = 0): Pack {
  if (!isObj(raw)) throw new SchemaError('pack.json no es un objeto JSON')
  const c: Obj = raw
  const title = flexStr(c, 'title') ?? 'Curso'
  const subject = str(c, 'subject') ?? ''
  // una habilidad o unidad repetida (mismo id) confunde a la interfaz: gana la primera; las unidades se renombran
  const seenSkills = new Set<string>()
  const skills = list(c, 'skills', decodeSkillRef, d).filter((s) => (seenSkills.has(s.id) ? false : (seenSkills.add(s.id), true)))
  return prune({
    schema: int(c, 'schema') ?? 1, id: flexStr(c, 'id') ?? IDs.short(6), title, subject, courseCode: str(c, 'courseCode'),
    language: str(c, 'language') ?? 'es', examLanguage: str(c, 'examLanguage'),
    // el icono es un pixel-art del catálogo; los SF Symbols de los cursos anteriores se traducen al más cercano
    icon: CourseIconCatalog.resolve(str(c, 'icon') ?? '', subject, title), hue: num(c, 'hue') ?? 0.6,
    created: date(c, 'created') ?? nowISO(), updated: date(c, 'updated') ?? nowISO(), exam: nested(c, 'exam', decodeExamInfo, d),
    units: uniquifyIDs(list(c, 'units', decodePackUnit, d)), skills,
    blueprint: nested(c, 'blueprint', decodeBlueprint, d), glossary: list(c, 'glossary', decodeGlossaryEntry, d),
    formulaSheet: list(c, 'formulaSheet', decodeFormulaGroup, d), sources: list(c, 'sources', decodeSourceMeta, d),
    generation: list(c, 'generation', decodeGenerationRecord, d), canvas: nested(c, 'canvas', decodeCanvasLink, d),
    guidance: str(c, 'guidance'), selfPaced: bool(c, 'selfPaced'), goalKind: enumOf(c, 'goalKind', STUDY_GOAL_KINDS)
  })
}

export function decodeCommonMistake(raw: unknown): CommonMistake | undefined {
  if (!isObj(raw)) return undefined
  return { title: flexStr(raw, 'title') ?? '', wrong: flexStr(raw, 'wrong') ?? '', right: flexStr(raw, 'right') ?? '', why: flexStr(raw, 'why') ?? '' }
}

/** Aplica `change` a cada «Pruébalo» de la lección y de las presentaciones (en su sitio). */
export function updateSkillTryIts(s: Skill, change: (t: Extract<Block, { type: 'tryit' }>) => void): void {
  const walk = (blocks: Block[]): void => { for (const b of blocks) if (b.type === 'tryit') change(b) }
  walk(s.lesson)
  for (const deck of s.decks) for (const slide of deck.slides) { walk(slide.blocks); walk(slide.right) }
}

/** Lee el contenido de una habilidad (`skills/<id>.json`) como `Skill.init(from:)`. */
export function decodeSkill(raw: unknown, d = 0): Skill {
  if (!isObj(raw)) throw new SchemaError('La habilidad no es un objeto JSON')
  const c: Obj = raw
  const id = flexStr(c, 'id') ?? IDs.short(5)
  const s: Skill = prune({
    id, title: flexStr(c, 'title') ?? id, summary: str(c, 'summary'), objectives: strings(c, 'objectives'), prerequisites: strings(c, 'prerequisites'),
    // listas tolerantes: un elemento dañado se salta en vez de perder la lección o todos los ejercicios
    lesson: blocksField(c, 'lesson', d), exercises: list(c, 'exercises', decodeExercise, d), templates: list(c, 'templates', decodeTemplate, d),
    cards: list(c, 'cards', decodeFlashcard, d), decks: list(c, 'decks', decodeDeck, d), mistakes: list(c, 'mistakes', decodeCommonMistake, d),
    sources: list(c, 'sources', decodeSourceRef, d), status: contentStatus(c, 'status', 'draft'), issues: list(c, 'issues', decodeContentIssue, d),
    revision: int(c, 'revision') ?? 1, updated: date(c, 'updated') ?? nowISO()
  })
  // ids de bloque repetidos: el reproductor de lecciones los usa para identificar las vistas
  uniquifyIDs(s.lesson)
  // los ejercicios incrustados de un «Pruébalo» son de esta habilidad (si no, su dominio iba a `skills[""]`)
  updateSkillTryIts(s, (t) => { for (const e of t.inline) if (e.skill === '') e.skill = id })
  return s
}

// MARK: Escribir

export const encodeExamInfo = (v: ExamInfo): JSONObject => pickKeys(v, ['title', 'date', 'durationMinutes', 'totalPoints', 'aids', 'notes', 'location'])
export const encodePackUnit = (v: PackUnit): JSONObject => pickKeys(v, ['id', 'title', 'summary', 'skillIDs'])
export const encodeContentCounts = (v: ContentCounts): JSONObject => pickKeys(v, ['lessonBlocks', 'exercises', 'templates', 'cards', 'decks'])

export function encodeSkillRef(v: SkillRef): JSONObject {
  const out = pickKeys(v, ['id', 'unit', 'title', 'summary', 'objectives', 'prerequisites', 'weight', 'minutes', 'order', 'status'])
  out.counts = encodeContentCounts(v.counts)
  return out
}

export function encodeBlueprint(v: ExamBlueprint): JSONObject {
  const out = pickKeys(v, ['durationMinutes', 'totalPoints', 'instructions', 'passPercent'])
  out.sections = v.sections.map((s) => pickKeys(s, ['title', 'skillIDs', 'count', 'minLevel', 'maxLevel', 'pointsEach', 'instructions']))
  return out
}

export const encodeSourceMeta = (v: SourceMeta): JSONObject =>
  pickKeys(v, ['id', 'title', 'kind', 'filename', 'url', 'addedAt', 'pages', 'characters', 'status', 'trust', 'note', 'warnings'])
export const encodeSourceChunk = (v: SourceChunk): JSONObject => pickKeys(v, ['id', 'sourceID', 'ordinal', 'page', 'pageEnd', 'heading', 'text'])
export const encodeGenerationRecord = (v: GenerationRecord): JSONObject =>
  pickKeys(v, ['id', 'date', 'provider', 'model', 'summary', 'promptTokens', 'completionTokens', 'status'])

/** El curso como lo escribe Swift (`pack.json`). */
export function encodePack(p: Pack): JSONObject {
  const out = pickKeys(p, ['schema', 'id', 'title', 'subject', 'courseCode', 'language', 'examLanguage', 'icon', 'hue', 'created', 'updated', 'guidance', 'selfPaced', 'goalKind'])
  if (p.exam) out.exam = encodeExamInfo(p.exam)
  out.units = p.units.map(encodePackUnit)
  out.skills = p.skills.map(encodeSkillRef)
  if (p.blueprint) out.blueprint = encodeBlueprint(p.blueprint)
  out.glossary = p.glossary.map((g) => pickKeys(g, ['term', 'definition', 'aliases', 'skill']))
  out.formulaSheet = p.formulaSheet.map((g) => ({ title: g.title, items: g.items.map(encodeFormulaItem) }))
  out.sources = p.sources.map(encodeSourceMeta)
  out.generation = p.generation.map(encodeGenerationRecord)
  if (p.canvas) out.canvas = pickKeys(p.canvas, ['host', 'courseID', 'courseName'])
  return out
}

/** La habilidad como la escribe Swift (`skills/<id>.json`). */
export function encodeSkill(s: Skill): JSONObject {
  const out = pickKeys(s, ['id', 'title', 'summary', 'objectives', 'prerequisites', 'status', 'revision', 'updated'])
  out.lesson = s.lesson.map(encodeBlock)
  out.exercises = s.exercises.map(encodeExercise)
  out.templates = s.templates.map(encodeTemplate)
  out.cards = s.cards.map(encodeFlashcard)
  out.decks = s.decks.map(encodeDeck)
  out.mistakes = s.mistakes.map((m) => pickKeys(m, ['title', 'wrong', 'right', 'why']))
  out.sources = s.sources.map(encodeSourceRef)
  out.issues = s.issues.map(encodeContentIssue)
  return out
}

// MARK: Construir y consultar

export function makePack(p: Partial<Pack> & { id: ItemID; title: string }): Pack {
  const now = nowISO()
  return prune({
    schema: PACK_SCHEMA, subject: '', language: 'es', icon: CourseIconCatalog.fallback, hue: 0.6, created: now, updated: now,
    units: [], skills: [], glossary: [], formulaSheet: [], sources: [], generation: [], ...p
  })
}

export function makeSkillRef(p: Partial<SkillRef> & { id: ItemID; title: string }): SkillRef {
  return prune({ objectives: [], prerequisites: [], weight: 1, minutes: 20, order: 0, status: 'empty' as ContentStatus, counts: emptyCounts(), ...p })
}

export function makeSkill(p: Partial<Skill> & { id: ItemID; title: string }): Skill {
  return prune({
    objectives: [], prerequisites: [], lesson: [], exercises: [], templates: [], cards: [], decks: [], mistakes: [], sources: [],
    status: 'draft' as ContentStatus, issues: [], revision: 1, updated: nowISO(), ...p
  })
}

export function makeExamBlueprint(durationMinutes: number, totalPoints: number, sections: BlueprintSection[], more: Partial<ExamBlueprint> = {}): ExamBlueprint {
  return prune({ durationMinutes, totalPoints, sections, ...more, passPercent: validPass(more.passPercent) })
}

export const skillCounts = (s: Skill): ContentCounts =>
  ({ lessonBlocks: s.lesson.length, exercises: s.exercises.length, templates: s.templates.length, cards: s.cards.length, decks: s.decks.length })

/** ¿Hay un examen al que apuntar? Sí con fecha; sin fecha, salvo que sea un curso a su ritmo. */
export const packHasExam = (p: Pack): boolean => p.exam?.date !== undefined || p.selfPaced !== true

export const packSkillRef = (p: Pack, id: ItemID): SkillRef | undefined => p.skills.find((s) => s.id === id)

/** En el orden de las unidades; las que no están en ninguna unidad, al final por `order`. */
export function orderedSkills(p: Pack): SkillRef[] {
  const seen = new Set<string>()
  const out: SkillRef[] = []
  for (const u of p.units) for (const sid of u.skillIDs) {
    const s = packSkillRef(p, sid)
    if (s && !seen.has(sid)) { out.push(s); seen.add(sid) }
  }
  const rest = p.skills.filter((s) => !seen.has(s.id))
  // orden estable por `order`
  rest.map((s, i) => [s, i] as const).sort((a, b) => a[0].order - b[0].order || a[1] - b[1]).forEach(([s]) => out.push(s))
  return out
}

export const packTotalWeight = (p: Pack): number => p.skills.reduce((acc, s) => acc + s.weight, 0)
export const packIsEmpty = (p: Pack): boolean => p.skills.length === 0
