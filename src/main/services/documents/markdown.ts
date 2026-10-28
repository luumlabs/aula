// Un documento de Aula en Markdown con `$LaTeX$` (port de DocumentMarkdown.swift): se abre en Obsidian, Typora, Notion, iA
// Writer… Las imágenes del curso van en una carpeta al lado («<nombre> — imágenes/») con su pie; las gráficas interactivas
// quedan descritas con palabras (y las de barras o líneas, con sus datos en una tabla).
import type { Answer, Block, CalloutKind, FormulaGroup, TableBlock } from '@shared/schema'
import type { DocumentItem, DocumentPlan, DocumentQuestion } from '@shared/documents'
import { blanks, choiceLetter, printablePrompt, stableShuffle } from './planner'
import { longDate, pointsText, words, type DocLang } from './words'

/** Lee una imagen del curso por su id (`assets/<id>`): nombre de archivo y bytes. */
export type AssetReader = (asset: string) => { name: string; data: Uint8Array } | undefined

export interface MarkdownOutput {
  text: string
  /** Imágenes a guardar junto al .md: nombre (relativo a la carpeta) y datos. */
  images: { name: string; data: Uint8Array }[]
}

interface Ctx {
  plan: DocumentPlan
  folder: string
  lang: DocLang
  asset: AssetReader
}

type Out = [string, { name: string; data: Uint8Array }[]]

export function renderMarkdown(plan: DocumentPlan, imageFolder: string, asset: AssetReader = () => undefined): MarkdownOutput {
  const lang = plan.lang
  const w = words(lang)
  const ctx: Ctx = { plan, folder: imageFolder, lang, asset }
  const out: string[] = [`# ${plan.title}`]
  const images: { name: string; data: Uint8Array }[] = []
  const meta: string[] = []
  if (plan.subtitle) meta.push(plan.subtitle)
  else if (plan.courseTitle && plan.courseTitle !== plan.title) meta.push(plan.courseTitle)
  if (plan.examDate) meta.push(w.examOn(longDate(plan.examDate, lang)))
  if (meta.length) out.push('*' + meta.join(' · ') + '*')
  if (plan.request.kind === 'exam') out.push(examHeader(plan))
  const toc = plan.sections.filter((s) => s.toc).map((s) => s.title)
  if (toc.length > 2 && plan.request.kind !== 'exam') {
    out.push(`## ${w.contents}`)
    out.push(toc.map((t) => `- ${t}`).join('\n'))
  }
  for (const sec of plan.sections) {
    if (sec.newPage && plan.request.kind === 'exam') out.push('---')
    if (sec.title) {
      if (sec.eyebrow) out.push(`*${sec.eyebrow}*`)
      out.push(`## ${sec.title}`)
    }
    if (sec.summary) out.push(`> ${sec.summary}`)
    for (const item of sec.items) {
      const [md, imgs] = itemMarkdown(item, ctx)
      if (md) out.push(md)
      images.push(...imgs)
    }
  }
  out.push(`---\n*${plan.notice}*`)
  // sin repetir imágenes
  const seen = new Set<string>()
  return { text: out.join('\n\n') + '\n', images: images.filter((i) => !seen.has(i.name) && (seen.add(i.name), true)) }
}

function examHeader(plan: DocumentPlan): string {
  const w = words(plan.lang)
  const lines = [w.nameDate]
  const facts: string[] = []
  if (plan.minutes !== undefined) facts.push(w.minutes(plan.minutes))
  if (plan.totalPoints !== undefined) facts.push(pointsText(plan.totalPoints, plan.lang))
  if (facts.length) lines.push(facts.join(' · '))
  if (plan.instructions) lines.push(`> ${plan.instructions}`)
  return lines.join('\n\n')
}

const quoteLines = (s: string): string => s.split('\n').map((l) => '> ' + l).join('\n')

function itemMarkdown(item: DocumentItem, ctx: Ctx): Out {
  const w = words(ctx.lang)
  switch (item.type) {
    case 'heading': return ['#'.repeat(Math.min(6, Math.max(3, item.level))) + ' ' + item.text, []]
    case 'markdown': return [item.md, []]
    case 'block':
    case 'lessonBlock': return block(item.block, ctx)
    case 'bullets': return [item.items.map((x) => `- ${x}`).join('\n'), []]
    case 'formulas': return [formulas(item.group), []]
    case 'term': {
      const e = item.entry
      return [`**${e.term}**${e.aliases.length ? ` (${e.aliases.join(', ')})` : ''}: ${e.definition}`, []]
    }
    case 'mistake': {
      const m = item.mistake
      let s = `**${m.title}**` + (item.skill ? ` — *${item.skill}*` : '')
      if (m.wrong) s += `\n- ✗ ${m.wrong}`
      if (m.right) s += `\n- ✓ ${m.right}`
      if (m.why) s += `\n- 💡 ${m.why}`
      return [s, []]
    }
    case 'note': {
      let s = `> ${item.note.excerpt}`
      if (item.note.note) s += `\n>\n> — ${item.note.note}`
      return [s, []]
    }
    case 'question': return question(item.question, ctx)
    case 'answer': {
      const a = item.answer
      let s = `**${a.number}.** ${a.answer}`
      const rendered = a.solution.map((b) => block(b, ctx))
      const sol = rendered.map((r) => r[0]).filter(Boolean).join('\n\n')
      if (sol) s += '\n\n' + quoteLines(sol)
      return [s, rendered.flatMap((r) => r[1])]
    }
    case 'card': {
      const c = item.card
      let front = `**${c.number}.** ${c.front}`
      const imgs: Out[1] = []
      // tarjeta de figura: la figura (con la parte que se pregunta nombrada); si es un dibujo sin imagen, su descripción
      if (c.figure) {
        const f = c.figure
        const got = f.asset ? ctx.asset(f.asset) : undefined
        const target = f.parts.find((p) => p.id === f.target)
        if (got) {
          imgs.push(got)
          front += `\n\n![${f.alt}](<${ctx.folder}/${got.name}>)`
          if (target) front += ` *(${w.figure}: ${target.name})*`
        } else front += ` *[${w.figure}${f.alt ? `: ${f.alt}` : ''}]*`
      }
      return [front + '\n\n' + quoteLines(c.back), imgs]
    }
    case 'slide': {
      const s = item.slide
      const parts = [`### ${s.index}. ${s.slide.title ?? s.deckTitle}`]
      if (s.slide.subtitle) parts.push(`*${s.slide.subtitle}*`)
      const imgs: Out[1] = []
      const add = (b: Block): void => { const [md, i] = block(b, ctx); if (md) parts.push(md); imgs.push(...i) }
      if (s.slide.image) add({ id: 'slide-image', type: 'image', asset: s.slide.image, alt: s.slide.title ?? '', hotspots: [], ...(s.slide.credit ? { caption: s.slide.credit } : {}) })
      if (s.slide.leftTitle) parts.push(`**${s.slide.leftTitle}**`)
      s.slide.blocks.forEach(add)
      if (s.slide.rightTitle) parts.push(`**${s.slide.rightTitle}**`)
      s.slide.right.forEach(add)
      if (s.slide.notes) parts.push(`> ${w.speakerNotes} ${s.slide.notes}`)
      return [parts.join('\n\n'), imgs]
    }
  }
}

function question(q: DocumentQuestion, ctx: Ctx): Out {
  const prompt = printablePrompt(q.exercise).map((b) => block(b, ctx))
  const text = prompt.map((p) => p[0]).filter(Boolean).join('\n\n')
  const parts = [`**${q.number}.** ${text} *(${pointsText(q.points, ctx.lang)})*`, answerArea(q.exercise.answer, q.optionOrder, q.exercise.id, ctx.lang)]
  return [parts.filter(Boolean).join('\n\n'), prompt.flatMap((p) => p[1])]
}

/** Dónde responde el estudiante en papel (opciones, huecos, líneas). `key`: semilla del barajado (la misma que el PDF). */
export function answerArea(a: Answer, order: number[], key: string, lang: DocLang): string {
  const w = words(lang)
  switch (a.kind) {
    case 'choice': {
      const ord = order.length ? order : a.options.map((_, i) => i)
      return ord.flatMap((i, pos) => (a.options[i] ? [`- [ ] ${choiceLetter(pos)}) ${a.options[i].md}`] : [])).join('\n')
    }
    case 'truefalse': return `- [ ] ${w.true}\n- [ ] ${w.false}`
    case 'ordering': return stableShuffle(a.items, key).map((x) => `- [ ] ${x}`).join('\n')
    case 'matching': {
      const rights = stableShuffle([...a.pairs.map((p) => p.right), ...a.extraRights], key)
      return a.pairs.map((p, i) => `${i + 1}. ${p.left} → ____`).join('\n') + '\n\n' + rights.map((r, i) => `${choiceLetter(i)}. ${r}`).join(' · ')
    }
    case 'cloze': return blanks(a.text)
    case 'multi': return a.parts.map((p) => `**${p.label})** ` + p.prompt.map(blockPlain).join(' ') + '\n\n' + answerArea(p.answer, [], key + p.label, lang)).join('\n\n')
    case 'open': {
      const lines = Math.max(4, Math.min(14, Math.floor((a.maxWords ?? 120) / 15)))
      return Array.from({ length: lines }, () => '______________________________________________').join('\n')
    }
    default: return `**${w.answer}** ______________________`
  }
}

/** El texto de un bloque sin formato (para los enunciados de las partes). */
function blockPlain(b: Block): string {
  switch (b.type) {
    case 'text': return b.md
    case 'math': return `$${b.tex}$`
    case 'callout': return b.md
    default: return ''
  }
}

export function formulas(g: FormulaGroup): string {
  let s = g.title ? `### ${g.title}\n\n` : ''
  s += g.items.map((f) => {
    let line = `- **${f.name}**: $${f.tex}$`
    if (f.when) line += ` — ${f.when}`
    if (f.vars.length) line += '\n  ' + f.vars.map((v) => `$${v.symbol}$ = ${v.meaning}` + (v.unit ? ` (${v.unit})` : '')).join('; ')
    return line
  }).join('\n')
  return s
}

export function calloutName(k: CalloutKind, lang: DocLang): string {
  return words(lang).callouts[k]
}

const visual = (kind: string, title: string | undefined): string => `*[${kind}${title ? `: ${title}` : ''}]*`
const numberText = (v: number): string => (Math.round(v) === v && Math.abs(v) < 1e15 ? String(v) : String(Number(v.toPrecision(6))))

export function table(t: Pick<TableBlock, 'headers' | 'rows'> & { caption?: string }): string {
  const cols = Math.max(t.headers.length, ...t.rows.map((r) => r.length), 0)
  if (cols === 0) return ''
  const row = (cells: string[]): string => '| ' + Array.from({ length: cols }, (_, i) => (cells[i] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |'
  const lines = [row(t.headers.length ? t.headers : Array.from({ length: cols }, () => '')), '|' + ' --- |'.repeat(cols), ...t.rows.map(row)]
  return lines.join('\n') + (t.caption ? `\n\n*${t.caption}*` : '')
}

/** Un bloque en Markdown. Las gráficas y los diagramas se describen. */
export function block(b: Block, ctx: Ctx): Out {
  const w = words(ctx.lang)
  switch (b.type) {
    case 'text': return [b.md, []]
    case 'math': {
      let s = `$$\n${b.tex}\n$$`
      if (b.label) s = `**${b.label}**\n\n` + s
      if (b.note) s += `\n\n*${b.note}*`
      return [s, []]
    }
    case 'callout': return [quoteLines(`**${b.title?.trim() ? b.title : calloutName(b.kind, ctx.lang)}**\n\n${b.md}`), []]
    case 'example': {
      let s = `**${b.title?.trim() ? b.title : w.workedExample}**\n\n${b.problem}`
      s += '\n\n' + b.steps.map((st, i) => `${i + 1}. ${st.md}` + (st.note ? ` *(${st.note})*` : '')).join('\n')
      if (b.answer) s += `\n\n**${w.answer}** ${b.answer}`
      return [s, []]
    }
    case 'table': return [table(b), []]
    case 'steps': return [(b.title ? `**${b.title}**\n\n` : '') + b.steps.map((s, i) => `${i + 1}. ` + (s.title ? `**${s.title}**: ` : '') + s.md).join('\n'), []]
    case 'compare': return [(b.title ? `**${b.title}**\n\n` : '') + table({ headers: ['', b.leftTitle, b.rightTitle], rows: b.rows.map((r) => [r.label ?? '', r.left, r.right]) }), []]
    case 'formulas': return [(b.title ? `**${b.title}**\n\n` : '') + formulas({ title: '', items: b.items }), []]
    case 'recap': return [(b.title ? `**${b.title}**\n\n` : '') + b.points.map((p) => `- ${p}`).join('\n'), []]
    case 'code': return ['```' + (b.language ?? '') + '\n' + b.code + '\n```' + (b.caption ? `\n\n*${b.caption}*` : ''), []]
    case 'quote': return [`> ${b.md}` + (b.author ? `\n>\n> — ${b.author}` : ''), []]
    case 'timeline': return [(b.title ? `**${b.title}**\n\n` : '') + b.events.map((e) => `- **${e.when}** — ${e.title}` + (e.md ? `: ${e.md}` : '')).join('\n'), []]
    case 'predict': {
      let s = `**${b.question}**\n\n` + b.options.map((o, i) => `${choiceLetter(i)}) ${o.md}`).join('\n')
      if (b.explanation) s += `\n\n*${b.explanation}*`
      return [s, []]
    }
    case 'spot': return [`${b.intro}\n\n` + b.lines.map((l, i) => `${i + 1}. ${l}`).join('\n') + `\n\n*${b.explanation}*`, []]
    case 'image': {
      let line = `*[${w.image}: ${b.alt}]*`
      const imgs: Out[1] = []
      const got = b.asset ? ctx.asset(b.asset) : undefined
      if (got) {
        imgs.push(got)
        line = `![${b.alt}](<${ctx.folder}/${got.name}>)`      // <…>: la carpeta lleva espacios
      }
      if (b.caption) line += `\n\n*${b.caption}*`
      return [line, imgs]
    }
    case 'plot': return [visual(w.plot, b.title), []]
    case 'explore': return [visual(w.interactivePlot, b.title) + (b.prompts.length ? '\n\n' + b.prompts.map((p) => `- ${p}`).join('\n') : ''), []]
    case 'chart': {
      // los datos de la gráfica como tabla (se pueden leer y copiar)
      const labels = b.series[0]?.points.map((p) => p.label ?? (p.x !== undefined ? String(p.x) : '')) ?? []
      const t = { headers: [b.xLabel ?? '', ...b.series.map((s) => s.name)], rows: labels.map((l, i) => [l, ...b.series.map((s) => (s.points[i] ? numberText(s.points[i].y) : ''))]) }
      return [visual(w.plot, b.title) + '\n\n' + table(t) + (b.caption ? `\n\n*${b.caption}*` : ''), []]
    }
    case 'diagram': {
      let s = visual(w.diagram, b.title)
      const names = new Map(b.nodes.map((n) => [n.id, n.label]))
      s += '\n\n' + (b.edges.length
        ? b.edges.map((e) => `- ${names.get(e.from) ?? e.from} → ${names.get(e.to) ?? e.to}` + (e.label ? ` (${e.label})` : '')).join('\n')
        : b.nodes.map((n) => `- ${n.label}`).join('\n'))
      return [s, []]
    }
    case 'drawing': return [visual(w.drawing, b.title ?? b.caption), []]
    case 'numberline': return [visual(w.numberLine, b.caption), []]
    case 'tryit':
    case 'unknown': return ['', []]
    default: return [interactive(b, ctx.lang), []]
  }
}

/** Descripción de un bloque visual que no se puede pasar a texto tal cual (título, introducción, rótulos, pie y crédito). */
export function interactive(b: Block, lang: DocLang): string {
  const w = words(lang)
  const v = b as unknown as Record<string, unknown>
  const name = b.type === 'model3d' ? w.model3d : b.type === 'map' ? w.map : b.type === 'simulation' ? w.simulation : b.type === 'labeled' ? w.labeled : w.interactive
  const str = (k: string): string | undefined => (typeof v[k] === 'string' && (v[k] as string).trim() ? (v[k] as string) : undefined)
  let s = visual(name, str('title') ?? str('formula'))
  if (str('intro')) s += '\n\n' + str('intro')
  const labels: string[] = []
  for (const k of ['parts', 'markers', 'labels', 'regions']) {
    const arr = v[k]
    if (!Array.isArray(arr)) continue
    for (const x of arr) {
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>
        const l = [o.label, o.name, o.title].find((y) => typeof y === 'string' && y.trim()) as string | undefined
        if (l) labels.push(l)
      }
    }
  }
  if (labels.length) s += '\n\n' + labels.slice(0, 40).map((l) => `- ${l}`).join('\n')
  const prompts = Array.isArray(v.prompts) ? v.prompts.filter((x): x is string => typeof x === 'string').slice(0, 6) : []
  for (const p of prompts) s += `\n- ${p}`
  if (str('caption')) s += `\n\n*${str('caption')}*`
  if (str('credit')) s += `\n\n*${str('credit')}*`
  return s
}

export type { Ctx as MarkdownContext }
