// Qué va en cada documento (port de DocumentPlanner.swift): guía de estudio, resumen, chuleta, tarjetas para imprimir, examen
// de práctica con su hoja de respuestas y diapositivas, a partir del curso (o de un contenido propio en Markdown). El plan lo
// dibujan la vista de impresión (PDF), `docx.ts` (Word) y `markdown.ts`. Puro: el curso llega ya cargado.
import { foldDiacritics } from '@engine/base/ids'
import { messageParts } from '@engine/assistant/parser'
import { buildExam, correctAnswerMarkdown, examExercise, instantiateTemplate } from '@engine/study'
import type { Block, Deck, Exercise, Flashcard, FormulaItem, GlossaryEntry, Pack, Skill, SkillRef, Slide, StudyProgress } from '@shared/schema'
import { emptyProgress, orderedSkills } from '@shared/schema'
import type { DocumentItem, DocumentNote, DocumentPlan, DocumentRequest, DocumentScope, DocumentSection, DocumentSectionRole } from '@shared/documents'
import { blanks, choiceLetter, isWholeCourse, printablePrompt, safeFileName, stableShuffle } from '@shared/documents'
import { AulaError } from '../errors'
import { docLang, listText, pointsText, printWords, words, type DocLang } from './words'

/** No hay nada que poner en el documento (en el idioma del documento: lo ve el estudiante). */
export class DocumentError extends AulaError {
  constructor(message: string) {
    super('document_empty', message)
    this.name = 'DocumentError'
  }
}

export interface PlanInput {
  pack?: Pack
  skills: Record<string, Skill>
  progress?: StudyProgress
  /** Subrayados y notas del estudiante por lección (para la guía). */
  notes?: Record<string, DocumentNote[]>
  now?: Date
}

function section(p: Partial<DocumentSection> & { id: string; title: string }): DocumentSection {
  return { role: 'content', toc: true, newPage: false, priority: 0, items: [], ...p }
}

const blank = (s: string | undefined): boolean => !s || !s.trim()
const nb = (s: string | undefined): string | undefined => (blank(s) ? undefined : s)
const foldKey = (s: string): string => foldDiacritics(s).toLowerCase().trim()

/** Las lecciones del alcance, en el orden del curso. Ids o títulos (la IA a veces manda el título). */
export function scopedSkills(scope: DocumentScope, pack: Pack, progress?: StudyProgress): SkillRef[] {
  const ordered = orderedSkills(pack).length ? orderedSkills(pack) : [...pack.skills].sort((a, b) => a.order - b.order)
  const wanted = new Set<string>()
  for (const raw of scope.skillIDs) {
    const s = ordered.find((x) => x.id === raw) ?? ordered.find((x) => foldKey(x.title) === foldKey(raw))
    if (s) wanted.add(s.id)
  }
  for (const raw of scope.unitIDs) {
    const u = pack.units.find((x) => x.id === raw) ?? pack.units.find((x) => foldKey(x.title) === foldKey(raw))
    if (u) for (const id of u.skillIDs) wanted.add(id)
  }
  let out = scope.skillIDs.length === 0 && scope.unitIDs.length === 0 ? ordered : ordered.filter((s) => wanted.has(s.id))
  if (scope.onlyDone && progress) out = out.filter((s) => progress.skills[s.id]?.lessonDone === true)
  return out
}

/** Prepara el plan. Lanza `DocumentError` (en el idioma del documento) si no hay nada que poner. */
export function planDocument(request: DocumentRequest, input: PlanInput): DocumentPlan {
  const lang = docLang(request.lang)
  const w = words(lang)
  const pack = input.pack
  const now = input.now ?? new Date()
  const kindTitle = w.kind[request.kind]
  const custom = !blank(request.content)
  const plan: DocumentPlan = {
    request, title: nb(request.title) ?? pack?.title ?? kindTitle, subtitle: nb(request.subtitle), courseTitle: pack?.title, subject: nb(pack?.subject),
    hue: pack?.hue ?? 0.62, icon: pack?.icon, examDate: pack?.exam?.date, examTitle: pack?.exam?.title, sections: [], packId: pack?.id,
    contentLanguage: pack?.language ?? lang, lang, created: now.toISOString(), notice: w.notice, words: printWords(lang)
  }
  // título: «Chuleta» + curso en el subtítulo, salvo que la petición traiga uno propio
  if (blank(request.title) && pack) {
    plan.title = kindTitle
    plan.subtitle = plan.subtitle ?? pack.title
  }
  const refs = pack ? scopedSkills(request.scope, pack, input.progress) : []
  if (pack && !isWholeCourse(request.scope) && refs.length === 0 && !custom) throw new DocumentError(w.emptyScope)
  if (!isWholeCourse(request.scope) && refs.length > 0 && refs.length <= 3 && pack && blank(request.title)) {
    plan.subtitle = listText(refs.map((r) => r.title), lang) + ' · ' + pack.title
  }
  const ctx: Ctx = { request, pack, refs, skills: input.skills, lang }
  switch (request.kind) {
    case 'guide': plan.sections = guide(ctx, input.notes ?? {}); break
    case 'summary': plan.sections = summary(ctx); break
    case 'cheatsheet': plan.sections = cheatsheet(ctx); break
    case 'flashcards': plan.sections = flashcards(ctx); break
    case 'exam': exam(ctx, input.progress, plan, now); break
    case 'slides': plan.sections = slides(ctx); break
  }
  // contenido propio (p. ej. el resumen de una clase que escribió Aula en el chat)
  if (custom && request.content) {
    const own = contentSections(request.content, request.kind === 'cheatsheet' ? 'keyIdeas' : 'content')
    // el resumen de una clase sustituye al del curso; en los demás tipos el contenido propio va delante
    plan.sections = request.kind === 'summary' || !pack ? own : [...own, ...plan.sections]
    if (request.kind === 'cheatsheet') for (const s of plan.sections) s.newPage = false
  }
  plan.sections = plan.sections.filter((s) => s.items.length > 0 || !blank(s.summary))
  if (plan.sections.every((s) => s.items.length === 0)) throw new DocumentError(w.empty[request.kind])
  return plan
}

interface Ctx {
  request: DocumentRequest
  pack?: Pack
  refs: SkillRef[]
  skills: Record<string, Skill>
  lang: DocLang
}

// MARK: - Guía de estudio

/** Un bloque de texto que empieza con un título (`#`) abre un paso nuevo de la lección (para anclar los subrayados). */
export function isStepBreak(b: Block): boolean {
  return b.type === 'text' && b.md.startsWith('#')
}

function eyebrow(n: number, unit: string | undefined, lang: DocLang): string {
  return unit ? words(lang).lessonUnit(n, unit) : words(lang).lesson(n)
}

function unitTitle(pack: Pack, skill: string): string | undefined {
  return nb(pack.units.find((u) => u.skillIDs.includes(skill))?.title)
}

function sortedGlossary(g: GlossaryEntry[], lang: DocLang): GlossaryEntry[] {
  return [...g].sort((a, b) => a.term.localeCompare(b.term, lang, { numeric: true, sensitivity: 'base' }))
}

function guide(c: Ctx, notes: Record<string, DocumentNote[]>): DocumentSection[] {
  const { pack, refs, skills, request: r, lang } = c
  if (!pack) return []
  const w = words(lang)
  const out: DocumentSection[] = []
  const lessons = refs.filter((ref) => ref.counts.lessonBlocks > 0 || (skills[ref.id]?.lesson.length ?? 0) > 0)
  lessons.forEach((ref, n) => {
    const skill = skills[ref.id]
    if (!skill) return
    const items: DocumentItem[] = []
    let step = 0
    for (const b of skill.lesson) {
      if (isStepBreak(b)) step++
      if (b.type === 'tryit' || b.type === 'unknown') continue
      items.push({ type: 'lessonBlock', block: b, skillID: skill.id, step })
    }
    out.push(section({ id: `lesson-${skill.id}`, role: 'lesson', title: skill.title, eyebrow: eyebrow(n + 1, unitTitle(pack, ref.id), lang), summary: ref.summary ?? skill.summary, newPage: true, items }))
  })
  if (r.style.includeFormulas && pack.formulaSheet.length) {
    out.push(section({ id: 'formulas', role: 'formulas', title: w.formulaSheet, newPage: true, items: pack.formulaSheet.map((g) => ({ type: 'formulas', group: g })) }))
  }
  if (r.style.includeGlossary && pack.glossary.length) {
    out.push(section({ id: 'glossary', role: 'glossary', title: w.glossary, newPage: true, items: sortedGlossary(pack.glossary, lang).map((e) => ({ type: 'term', entry: e })) }))
  }
  if (r.style.includeMistakes) {
    const all: DocumentItem[] = refs.flatMap((ref) => (skills[ref.id]?.mistakes ?? []).map((m) => ({ type: 'mistake' as const, mistake: m, skill: ref.title })))
    if (all.length) out.push(section({ id: 'mistakes', role: 'mistakes', title: w.mistakes, newPage: true, items: all }))
  }
  if (r.style.includeNotes) {
    const items: DocumentItem[] = []
    for (const ref of refs) {
      const ns = notes[ref.id]
      if (ns?.length) {
        items.push({ type: 'heading', text: ref.title, level: 3 })
        for (const n of ns) items.push({ type: 'note', note: n })
      }
    }
    if (items.length) out.push(section({ id: 'notes', role: 'notes', title: w.myNotes, newPage: true, items }))
  }
  return out
}

// MARK: - Resumen

function summary(c: Ctx): DocumentSection[] {
  const { pack, refs, skills, request: r, lang } = c
  if (!pack) return []
  const w = words(lang)
  const out: DocumentSection[] = []
  refs.forEach((ref, n) => {
    const skill = skills[ref.id]
    if (!skill) return
    const items: DocumentItem[] = []
    if (skill.objectives.length) {
      items.push({ type: 'heading', text: w.mustKnow, level: 3 })
      items.push({ type: 'bullets', items: skill.objectives })
    }
    for (const b of keyBlocks(skill.lesson, 1)) items.push({ type: 'block', block: b })
    const terms = pack.glossary.filter((g) => g.skill === ref.id)
    if (terms.length) {
      items.push({ type: 'heading', text: w.keyTerms, level: 3 })
      for (const e of sortedGlossary(terms, lang)) items.push({ type: 'term', entry: e })
    }
    if (skill.mistakes.length) {
      items.push({ type: 'heading', text: w.watchOut, level: 3 })
      for (const m of skill.mistakes.slice(0, 3)) items.push({ type: 'mistake', mistake: m, skill: '' })
    }
    if (!items.length && blank(skill.summary)) return
    out.push(section({
      id: `summary-${skill.id}`, role: 'keyIdeas', title: skill.title, eyebrow: eyebrow(n + 1, unitTitle(pack, ref.id), lang), summary: ref.summary ?? skill.summary,
      newPage: n > 0 && refs.length > 4, items
    }))
  })
  if (isWholeCourse(r.scope) && r.style.includeFormulas && pack.formulaSheet.length) {
    out.push(section({ id: 'formulas', role: 'formulas', title: w.formulaSheet, newPage: true, items: pack.formulaSheet.map((g) => ({ type: 'formulas', group: g })) }))
  }
  return out
}

const KEY_CALLOUTS = new Set(['definition', 'theorem', 'remember', 'examTip', 'mistake', 'warning', 'note', 'tip'])
const KEY_TYPES = new Set(['math', 'formulas', 'table', 'compare', 'recap', 'steps', 'diagram', 'image', 'timeline'])

/**
 * Los bloques que hacen falta para repasar: definiciones, teoremas, «recuerda», fórmulas, tablas, comparaciones, esquemas,
 * resúmenes, imágenes y el primer ejemplo resuelto. Los títulos de sección se conservan para no perder la estructura.
 */
export function keyBlocks(lesson: Block[], maxExamples = 1): Block[] {
  const out: Block[] = []
  let examples = 0
  for (const b of lesson) {
    if (b.type === 'text') {
      const md = b.md.trim()
      if (md.startsWith('#')) out.push({ id: b.id, type: 'text', md: md.split('\n')[0] })
    } else if (b.type === 'callout') {
      if (KEY_CALLOUTS.has(b.kind)) out.push(b)
    } else if (KEY_TYPES.has(b.type)) out.push(b)
    else if (b.type === 'example' && examples < maxExamples) {
      out.push(b)
      examples++
    }
  }
  // quitar títulos que se quedaron sin nada debajo
  const isHeading = (b: Block | undefined): boolean => b?.type === 'text' && b.md.startsWith('#')
  return out.filter((b, i) => !(isHeading(b) && (i + 1 >= out.length || isHeading(out[i + 1]))))
}

// MARK: - Chuleta

/** Recorta sin partir una fórmula: hasta el último espacio fuera de `$…$`. */
export function clip(s: string, n: number): string {
  const t = s.trim()
  const chars = Array.from(t)
  if (chars.length <= n) return t
  let head = chars.slice(0, n).join('')
  if ((head.split('$').length - 1) % 2 === 1) head = head.slice(0, head.lastIndexOf('$'))
  const sp = head.lastIndexOf(' ')
  if (sp > 0) head = head.slice(0, sp)
  return head.trim() + '…'
}

function cheatsheet(c: Ctx): DocumentSection[] {
  const { pack, refs, skills, request: r, lang } = c
  if (!pack) return []
  const w = words(lang)
  const out: DocumentSection[] = []
  const ids = new Set(refs.map((x) => x.id))
  if (pack.formulaSheet.length) {
    out.push(section({ id: 'formulas', role: 'formulas', title: w.formulas, toc: false, priority: 0, items: pack.formulaSheet.map((g) => ({ type: 'formulas', group: g })) }))
  }
  // definiciones y teoremas (y las fórmulas sueltas de las lecciones si el curso no tiene hoja)
  const defs: DocumentItem[] = []
  const loose: FormulaItem[] = []
  for (const ref of refs) {
    for (const b of skills[ref.id]?.lesson ?? []) {
      if (b.type === 'callout' && ['definition', 'theorem', 'remember'].includes(b.kind)) {
        const cb: Block = { id: b.id, type: 'callout', kind: b.kind, md: clip(b.md, 320) }
        if (b.title !== undefined) cb.title = b.title
        defs.push({ type: 'block', block: cb })
      } else if (b.type === 'formulas' && !pack.formulaSheet.length) loose.push(...b.items)
      else if (b.type === 'math' && !pack.formulaSheet.length && !blank(b.label)) {
        const f: FormulaItem = { name: b.label ?? '', tex: b.tex, vars: [] }
        if (b.note !== undefined) f.when = b.note
        loose.push(f)
      }
    }
  }
  if (loose.length) {
    const seen = new Set<string>()
    const unique = loose.filter((f) => !seen.has(f.tex) && (seen.add(f.tex), true))
    out.push(section({ id: 'formulas', role: 'formulas', title: w.formulas, toc: false, priority: 0, items: [{ type: 'formulas', group: { title: '', items: unique.slice(0, 40) } }] }))
  }
  if (defs.length) out.push(section({ id: 'definitions', role: 'keyIdeas', title: w.definitions, toc: false, priority: 1, items: defs.slice(0, 40) }))
  const mistakes: DocumentItem[] = refs.flatMap((ref) => (skills[ref.id]?.mistakes ?? []).slice(0, 3).map((m) => ({ type: 'mistake' as const, mistake: m, skill: ref.title })))
  if (mistakes.length) out.push(section({ id: 'mistakes', role: 'mistakes', title: w.watchOut, toc: false, priority: 2, items: mistakes.slice(0, 12) }))
  const terms = pack.glossary.filter((g) => g.skill === undefined || ids.has(g.skill) || isWholeCourse(r.scope))
  if (terms.length) {
    const short = sortedGlossary(terms, lang).slice(0, 40).map((e): GlossaryEntry => {
      const x: GlossaryEntry = { term: e.term, definition: clip(e.definition, 180), aliases: [] }
      if (e.skill !== undefined) x.skill = e.skill
      return x
    })
    out.push(section({ id: 'glossary', role: 'glossary', title: w.terms, toc: false, priority: 3, items: short.map((e) => ({ type: 'term', entry: e })) }))
  }
  return out
}

// MARK: - Tarjetas para imprimir

function flashcards(c: Ctx): DocumentSection[] {
  const items: DocumentItem[] = []
  let n = 0
  for (const ref of c.refs) {
    for (const card of c.skills[ref.id]?.cards ?? []) {
      n++
      const { front, back } = cardFaces(card)
      const dc: DocumentItem = { type: 'card', card: { number: n, front, back, topic: ref.title } }
      if (card.hint !== undefined) dc.card.hint = card.hint
      if (card.figure !== undefined) dc.card.figure = card.figure
      items.push(dc)
    }
  }
  if (!items.length) return []
  return [section({ id: 'cards', role: 'cards', title: words(c.lang).cards, toc: false, items })]
}

/** Anverso y reverso para el papel. En las de huecos («{{c1::respuesta}}») el anverso lleva «[…]» y el reverso la frase completa. */
export function cardFaces(c: Flashcard): { front: string; back: string } {
  if (c.kind !== 'cloze' && !c.front.includes('{{c')) return { front: c.front, back: c.back }
  const re = /\{\{c\d+::(.*?)(?:::(.*?))?\}\}/g
  let front = '', full = '', last = 0
  for (const m of c.front.matchAll(re)) {
    const i = m.index ?? 0
    const before = c.front.slice(last, i)
    front += before + '[' + (m[2] !== undefined ? `${m[2]}…` : '…') + ']'
    full += before + '**' + m[1] + '**'
    last = i + m[0].length
  }
  const tail = c.front.slice(last)
  front += tail
  full += tail
  const extra = c.back.trim()
  return { front, back: extra ? `${full}\n\n${extra}` : full }
}

// MARK: - Examen de práctica

/** Generador con semilla idéntico al de DocumentPlanner.swift (mismo examen con la misma semilla). */
export class PlannerRandom {
  private state: bigint
  constructor(seed: number | bigint) {
    this.state = BigInt.asUintN(64, BigInt(seed) + 0x9e3779b97f4a7c15n)
  }
  next(): bigint {
    this.state = BigInt.asUintN(64, this.state + 0x9e3779b97f4a7c15n)
    let z = this.state
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n)
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn)
    return z ^ (z >> 31n)
  }
  shuffled<T>(a: readonly T[]): T[] {
    const out = [...a]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Number(this.next() % BigInt(i + 1))
      const t = out[i]
      out[i] = out[j]
      out[j] = t
    }
    return out
  }
}

function exam(c: Ctx, progress: StudyProgress | undefined, plan: DocumentPlan, now: Date): void {
  const { pack, refs, skills, request: r, lang } = c
  if (!pack) return
  const w = words(lang)
  const seed = r.style.seed ?? Math.max(0, Math.round(now.getTime() / 1000))
  const scoped: Record<string, Skill> = {}
  for (const ref of refs) if (skills[ref.id]) scoped[ref.id] = skills[ref.id]
  let picked: { e: Exercise; points: number; section?: string }[] = []
  let minutes = r.style.minutes
  // el plano del examen del curso (secciones, puntos, minutos) cuando se pide el curso entero sin número de preguntas
  if (r.style.questionCount === undefined && isWholeCourse(r.scope)) {
    const built = buildExam(pack, scoped, progress ?? emptyProgress(), { seed, onScreen: false, now, lang })
    if (built) {
      for (const item of built.run.items) {
        const e = examExercise(item, scoped)
        if (e) picked.push({ e, points: item.points, section: item.sectionTitle })
      }
      minutes = minutes ?? built.blueprint.durationMinutes
      if (!blank(built.blueprint.instructions)) plan.instructions = built.blueprint.instructions
    }
  }
  if (!picked.length) {
    const count = r.style.questionCount ?? Math.min(12, Math.max(6, refs.length * 3))
    picked = selectExercises(refs, scoped, count, seed).map((e) => ({ e, points: Math.max(1, e.points) }))
  }
  if (!picked.length) return
  const rng = new PlannerRandom(seed)
  const questions: DocumentItem[] = []
  const answers: DocumentItem[] = []
  let current: string | undefined
  picked.forEach(({ e, points, section: sec }, i) => {
    if (sec && sec !== current) {
      questions.push({ type: 'heading', text: sec, level: 3 })
      current = sec
    }
    let order: number[] = []
    if (e.answer.kind === 'choice') {
      order = e.answer.options.map((_, k) => k)
      if (e.answer.shuffle) order = rng.shuffled(order)
    }
    const title = pack.skills.find((s) => s.id === e.skill)?.title ?? ''
    questions.push({ type: 'question', question: { number: i + 1, exercise: e, points, optionOrder: order, skillTitle: title } })
    answers.push({ type: 'answer', answer: { number: i + 1, answer: answerText(e, order, lang), solution: r.style.includeSolutions ? e.solution : [], points } })
  })
  plan.totalPoints = picked.reduce((s, x) => s + x.points, 0)
  plan.minutes = minutes ?? Math.max(15, Math.round(picked.length * 4.5))
  if (blank(r.title)) plan.title = w.kind.exam
  plan.sections = [section({ id: 'questions', role: 'questions', title: w.questions, toc: false, items: questions })]
  if (r.style.includeAnswers) {
    plan.sections.push(section({ id: 'answers', role: 'answers', title: w.answerKey, summary: w.answerKeyNote, toc: false, newPage: true, items: answers }))
  }
}


/** Selección equilibrada: por turnos entre las lecciones, primero nivel examen y estándar; las plantillas dan variantes con semilla. */
export function selectExercises(refs: SkillRef[], skills: Record<string, Skill>, count: number, seed: number): Exercise[] {
  const rng = new PlannerRandom(seed)
  const pools: Exercise[][] = []
  for (const ref of refs) {
    const s = skills[ref.id]
    if (!s) continue
    let pool = s.exercises.filter((e) => e.review?.state !== 'flagged')
    s.templates.forEach((t, k) => {
      const e = instantiateTemplate(t, seed + k * 7919 + pools.length * 104729)
      if (e) pool.push(e)
    })
    pool = rng.shuffled(pool).sort((a, b) => Math.abs(a.level - 2.4) - Math.abs(b.level - 2.4))
    if (pool.length) pools.push(pool)
  }
  const out: Exercise[] = []
  for (let round = 0; out.length < count; round++) {
    let added = false
    for (const p of pools) {
      if (round < p.length && out.length < count) { out.push(p[round]); added = true }
    }
    if (!added) break
  }
  const idx = (e: Exercise): number => Math.max(0, refs.findIndex((r) => r.id === e.skill))
  return out.sort((a, b) => idx(a) - idx(b) || a.level - b.level)
}

/** La respuesta correcta para la hoja de respuestas; en las de opciones, con la letra con que se imprimió. */
export function answerText(e: Exercise, order: number[], lang: DocLang): string {
  const a = e.answer
  if (a.kind === 'choice') {
    const ord = order.length ? order : a.options.map((_, i) => i)
    const letters = ord.flatMap((idx, pos) => (a.options[idx]?.correct ? [`**${choiceLetter(pos)})** ${a.options[idx].md}`] : []))
    return letters.length ? letters.join(' · ') : correctAnswerMarkdown(e, lang)
  }
  if (a.kind === 'multi') return a.parts.map((p) => `**${p.label})** ` + answerText({ ...e, answer: p.answer }, [], lang)).join('\n\n')
  if (a.kind === 'open') {
    let s = a.modelAnswer
    if (a.rubric.length) s += `\n\n${words(lang).rubric}\n` + a.rubric.map((x) => `- ${x.text} (${pointsText(x.points, lang)})`).join('\n')
    return s
  }
  if (a.kind === 'cloze') return a.blanks.map((b, i) => `(${i + 1}) ${b.accepted[0] ?? ''}`).join(' · ')
  if (a.kind === 'label') return a.spots.map((s, i) => `${i + 1}. ${s.accepted[0] ?? ''}`).join(' · ')
  return correctAnswerMarkdown(e, lang)
}




// MARK: - Diapositivas

function slides(c: Ctx): DocumentSection[] {
  const { pack, refs, skills, lang } = c
  let decks: Deck[] = []
  for (const ref of refs) decks.push(...(skills[ref.id]?.decks ?? []).filter((d) => d.slides.length))
  // el curso no tiene presentaciones: una por lección con lo esencial
  if (!decks.length) decks = refs.flatMap((ref) => { const s = skills[ref.id]; const d = s ? autoDeck(s, pack ? unitTitle(pack, ref.id) : undefined, lang) : undefined; return d ? [d] : [] })
  return decks.map((deck, di) => section({
    id: `deck-${di}-${deck.id}`, role: 'slides', title: deck.title, summary: deck.summary, toc: decks.length > 1, newPage: true,
    items: deck.slides.map((s, i) => ({ type: 'slide' as const, slide: { slide: s, deckTitle: deck.title, index: i + 1, total: deck.slides.length, deck } }))
  }))
}

/** Una presentación hecha con lo esencial de una lección: portada, una diapositiva por idea clave y un repaso. */
export function autoDeck(skill: Skill, unit: string | undefined, lang: DocLang): Deck | undefined {
  const w = words(lang)
  const key = keyBlocks(skill.lesson, 2)
  const mk = (id: string, layout: Slide['layout'], title: string | undefined, blocks: Block[] = []): Slide => {
    const s: Slide = { id, layout, blocks, right: [] }
    if (title !== undefined) s.title = title
    return s
  }
  const cover = mk('cover', 'title', skill.title)
  const sub = skill.summary ?? unit
  if (sub !== undefined) cover.subtitle = sub
  const out: Slide[] = [cover]
  let pending: string | undefined
  for (const b of key) {
    const id = `s${out.length}`
    if (b.type === 'text') { pending = nb(b.md.replace(/^[#\s]+|\s+$/g, '')); continue }
    if (b.type === 'callout') out.push(mk(id, 'content', nb(b.title) ?? pending ?? w.callouts[b.kind], [b]))
    else if (b.type === 'math') out.push(mk(id, 'focus', nb(b.label) ?? pending ?? skill.title, [b]))
    else if (b.type === 'formulas') out.push(mk(id, 'focus', nb(b.title) ?? pending ?? skill.title, [b]))
    else if (b.type === 'example') out.push(mk(id, 'content', nb(b.title) ?? w.workedExample, [b]))
    else out.push(mk(id, 'content', pending ?? skill.title, [b]))
    pending = undefined
    if (out.length >= 11) break
  }
  if (skill.objectives.length) out.push(mk('recap', 'content', w.review, [{ id: 'recap', type: 'recap', points: skill.objectives.slice(0, 6) }]))
  if (out.length <= 1) return undefined
  const deck: Deck = { id: `auto-${skill.id}`, title: skill.title, slides: out }
  if (unit !== undefined) deck.summary = unit
  return deck
}

// MARK: - Contenido propio (Markdown + bloques de Aula)

function heading(line: string): { level: number; text: string } | undefined {
  const m = /^(#{1,6}) (.+)$/.exec(line)
  return m && m[2].trim() ? { level: m[1].length, text: m[2].trim() } : undefined
}

/** Parte un Markdown en secciones por sus títulos `#`/`##`; los ```aula-block``` válidos se vuelven bloques. */
export function contentSections(md: string, role: DocumentSectionRole = 'content'): DocumentSection[] {
  const sections: DocumentSection[] = []
  let current = section({ id: 'intro', role, title: '', toc: false })
  const flush = (): void => { if (current.items.length || current.title) sections.push(current) }
  for (const part of messageParts(md)) {
    if (part.kind === 'block') { current.items.push({ type: 'block', block: part.block }); continue }
    if (part.kind === 'slides') continue
    let buffer: string[] = []
    const flushText = (): void => {
      const t = buffer.join('\n').trim()
      if (t) current.items.push({ type: 'markdown', md: t })
      buffer = []
    }
    let inFence = false
    for (const line of part.text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('```')) inFence = !inFence
      const h = !inFence ? heading(trimmed) : undefined
      if (h && h.level <= 2) {
        flushText()
        flush()
        current = section({ id: `s${sections.length + 1}`, role, title: h.text, toc: true })
        continue
      }
      buffer.push(line)
    }
    flushText()
  }
  flush()
  return sections.filter((s) => s.items.length || s.title)
}

// MARK: - Nombres

/** Título para listas y tarjetas: el propio, o el tipo con las lecciones si no es el curso entero («Resumen · Vértice»). */
export function displayTitle(plan: DocumentPlan): string {
  const kindTitle = words(plan.lang).kind[plan.request.kind]
  if (plan.title !== kindTitle) return plan.title
  const c = plan.courseTitle
  if (!isWholeCourse(plan.request.scope) && plan.subtitle && c && plan.subtitle.endsWith(' · ' + c)) return plan.title + ' · ' + plan.subtitle.slice(0, -(c.length + 3))
  return plan.title
}

/** Nombre de archivo sin extensión («Funciones cuadráticas — Chuleta»). */
export function fileBaseName(plan: DocumentPlan): string {
  const parts = [plan.courseTitle, plan.title === plan.courseTitle ? undefined : plan.title].filter((x): x is string => !!x && !!x.trim())
  return safeFileName(parts.length ? parts.join(' — ') : words(plan.lang).kind[plan.request.kind])
}

export { blanks, choiceLetter, printablePrompt, stableShuffle }
