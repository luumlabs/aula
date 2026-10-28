// Un documento de Aula en Word (port de DocumentDocx.swift, con el paquete `docx`): estilos de título, texto con negrita y
// cursiva, listas, tablas, imágenes del curso con su pie, fórmulas como ecuaciones nativas de Word (Swift las ponía como
// imagen), saltos de página y pie con el número de página. Las gráficas interactivas se describen (como en Markdown).
import {
  AlignmentType, BorderStyle, Document, Footer, ImageRun, Math as DocxMath, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell,
  TableRow, TabStopType, TextRun, WidthType, type IRunOptions, type ParagraphChild
} from 'docx'
import type { Answer, Block, FormulaGroup, Inline, RichBlock } from '@shared/schema'
import { coursePrintInk, parseInline, parseRichText } from '@shared/schema'
import type { DocumentItem, DocumentPlan, DocumentQuestion } from '@shared/documents'
import type { AssetReader } from './markdown'
import { block as markdownBlock, calloutName } from './markdown'
import { blanks, choiceLetter, printablePrompt, stableShuffle } from './planner'
import { texToMath } from './texMath'
import { longDate, pointsText, words, type DocLang } from './words'

type Child = Paragraph | Table

/** Tamaño del papel en puntos (vertical). */
const PAPER = { a4: { w: 595.28, h: 841.89 }, letter: { w: 612, h: 792 } }
const MARGIN_TW = 1134            // 2 cm en vigésimos de punto
const PX = 96 / 72                // puntos → píxeles (docx mide las imágenes a 96 ppp)

/** Color del curso para el papel: la tinta de su tono (la misma que en la interfaz; nunca violeta). */
export function hueHex(hue: number): string {
  return coursePrintInk(hue)
}

/** Formato y tamaño (píxeles) de una imagen PNG, JPEG o GIF (las que Word abre); undefined para las demás. */
export function wordImage(d: Uint8Array): { type: 'png' | 'jpg' | 'gif'; width: number; height: number } | undefined {
  if (d.length > 24 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
    return { type: 'png', width: v.getUint32(16), height: v.getUint32(20) }
  }
  if (d.length > 10 && d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46) return { type: 'gif', width: d[6] | (d[7] << 8), height: d[8] | (d[9] << 8) }
  if (d.length > 4 && d[0] === 0xff && d[1] === 0xd8) {
    let o = 2
    while (o + 9 < d.length) {
      if (d[o] !== 0xff) { o++; continue }
      const marker = d[o + 1]
      const len = (d[o + 2] << 8) | d[o + 3]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpg', height: (d[o + 5] << 8) | d[o + 6], width: (d[o + 7] << 8) | d[o + 8] }
      }
      o += 2 + len
    }
  }
  return undefined
}

class DocxBuilder {
  readonly body: Child[] = []
  private pendingBreak = false
  readonly lang: DocLang
  readonly textWidth: number
  readonly accent: string

  constructor(readonly plan: DocumentPlan, readonly asset: AssetReader) {
    this.lang = plan.lang
    this.textWidth = PAPER[plan.request.style.paper].w - 2 * 56.7
    this.accent = plan.request.style.color ? hueHex(plan.hue) : '333333'
  }

  // MARK: Documento

  build(): void {
    const plan = this.plan
    const w = words(this.lang)
    this.para(plan.title, 'Title')
    const meta: string[] = []
    if (plan.subtitle) meta.push(plan.subtitle)
    else if (plan.courseTitle && plan.courseTitle !== plan.title) meta.push(plan.courseTitle)
    if (plan.examDate) meta.push(w.examOn(longDate(plan.examDate, this.lang)))
    if (meta.length) this.para(meta.join(' · '), 'Subtitle')
    if (plan.request.kind === 'exam') this.examHeader()
    const toc = plan.sections.filter((s) => s.toc).map((s) => s.title)
    if (toc.length > 2 && plan.request.kind !== 'exam') {
      this.para(w.contents, 'Heading2')
      for (const t of toc) this.listItem(parseInline(t), '•')
    }
    plan.sections.forEach((sec, i) => {
      if (sec.newPage && i > 0) this.pendingBreak = true
      if (sec.eyebrow) this.para(sec.eyebrow, 'Eyebrow')
      if (sec.title) this.inlinePara(parseInline(sec.title), 'Heading1')
      if (sec.summary) this.inlinePara(parseInline(sec.summary), 'Lead')
      if (sec.role === 'cards') { this.cardsTable(sec.items); return }
      for (const item of sec.items) this.item(item)
    })
    this.para(plan.notice, 'Caption')
  }

  private examHeader(): void {
    const plan = this.plan
    const w = words(this.lang)
    this.para(w.nameDateDocx, 'Normal')
    const facts: string[] = []
    if (plan.minutes !== undefined) facts.push(w.minutes(plan.minutes))
    if (plan.totalPoints !== undefined) facts.push(pointsText(plan.totalPoints, this.lang))
    if (facts.length) this.para(facts.join(' · '), 'Caption')
    if (plan.instructions) this.inlinePara(parseInline(plan.instructions), 'Quote')
  }

  private item(item: DocumentItem): void {
    const w = words(this.lang)
    switch (item.type) {
      case 'heading': this.inlinePara(parseInline(item.text), item.level <= 2 ? 'Heading2' : 'Heading3'); return
      case 'markdown': this.rich(parseRichText(item.md)); return
      case 'block': case 'lessonBlock': this.block(item.block); return
      case 'bullets': for (const x of item.items) this.listItem(parseInline(x), '•'); return
      case 'formulas': this.formulas(item.group); return
      case 'term': {
        const e = item.entry
        const runs: Inline[] = [{ kind: 'bold', children: [{ kind: 'text', text: e.term }] }]
        if (e.aliases.length) runs.push({ kind: 'text', text: ` (${e.aliases.join(', ')})` })
        runs.push({ kind: 'text', text: ': ' })
        this.inlinePara([...runs, ...parseInline(e.definition.replace(/\n/g, ' '))], 'Normal')
        return
      }
      case 'mistake': {
        const m = item.mistake
        this.inlinePara([{ kind: 'bold', children: parseInline(m.title) }, ...(item.skill ? [{ kind: 'text', text: ' — ' } as Inline, { kind: 'italic', children: [{ kind: 'text', text: item.skill }] } as Inline] : [])], 'Normal')
        if (m.wrong) this.listItem(parseInline(m.wrong), '✗')
        if (m.right) this.listItem(parseInline(m.right), '✓')
        if (m.why) this.listItem(parseInline(m.why), '→')
        return
      }
      case 'note':
        this.inlinePara([{ kind: 'highlight', children: [{ kind: 'text', text: item.note.excerpt }] }], 'Quote')
        if (item.note.note) this.inlinePara(parseInline(item.note.note), 'Caption')
        return
      case 'question': this.question(item.question); return
      case 'answer':
        this.inlinePara([{ kind: 'bold', children: [{ kind: 'text', text: `${item.answer.number}. ` }] }, ...parseInline(item.answer.answer.replace(/\n\n/g, '  '))], 'Normal')
        for (const b of item.answer.solution) this.block(b)
        return
      case 'card': {
        const c = item.card
        this.inlinePara([{ kind: 'bold', children: [{ kind: 'text', text: `${c.number}. ` }] }, ...parseInline(c.front)], 'Normal')
        this.rich(parseRichText(c.back))
        return
      }
      case 'slide': {
        const s = item.slide
        if (s.index > 1) this.pendingBreak = true
        this.inlinePara(parseInline(`${s.index}. ${s.slide.title ?? s.deckTitle}`), 'Heading2')
        if (s.slide.subtitle) this.inlinePara(parseInline(s.slide.subtitle), 'Lead')
        if (s.slide.image) this.block({ id: 'slide-image', type: 'image', asset: s.slide.image, alt: s.slide.title ?? '', hotspots: [], ...(s.slide.credit ? { caption: s.slide.credit } : {}) })
        if (s.slide.leftTitle) this.inlinePara([{ kind: 'bold', children: parseInline(s.slide.leftTitle) }], 'Normal')
        for (const b of s.slide.blocks) this.block(b)
        if (s.slide.rightTitle) this.inlinePara([{ kind: 'bold', children: parseInline(s.slide.rightTitle) }], 'Normal')
        for (const b of s.slide.right) this.block(b)
        if (s.slide.notes) this.inlinePara([{ kind: 'italic', children: [{ kind: 'text', text: `${w.speakerNotes} ` }] }, ...parseInline(s.slide.notes)], 'Caption')
        return
      }
    }
  }

  private question(q: DocumentQuestion): void {
    const pts: Inline = { kind: 'italic', children: [{ kind: 'text', text: `  (${pointsText(q.points, this.lang)})` }] }
    const num: Inline = { kind: 'bold', children: [{ kind: 'text', text: `${q.number}. ` }] }
    let first = true
    for (const b of printablePrompt(q.exercise)) {
      if (first && b.type === 'text') {
        this.inlinePara([num, ...parseInline(b.md.replace(/\n/g, ' ')), pts], 'Question')
        first = false
      } else {
        if (first) { this.inlinePara([num, pts], 'Question'); first = false }
        this.block(b)
      }
    }
    if (first) this.inlinePara([num], 'Question')
    this.answerArea(q.exercise.answer, q.optionOrder, q.exercise.id)
  }

  /** Dónde responde el estudiante en papel. `key`: semilla del barajado (la misma que el PDF). */
  private answerArea(a: Answer, order: number[], key: string): void {
    const w = words(this.lang)
    switch (a.kind) {
      case 'choice': {
        const ord = order.length ? order : a.options.map((_, i) => i)
        ord.forEach((i, pos) => { if (a.options[i]) this.listItem(parseInline(a.options[i].md), `☐ ${choiceLetter(pos)})`) })
        return
      }
      case 'truefalse': this.listItem([{ kind: 'text', text: w.true }], '☐'); this.listItem([{ kind: 'text', text: w.false }], '☐'); return
      case 'ordering': for (const x of stableShuffle(a.items, key)) this.listItem(parseInline(x), '☐'); return
      case 'matching': {
        const rights = stableShuffle([...a.pairs.map((p) => p.right), ...a.extraRights], key)
        a.pairs.forEach((p, i) => this.listItem([...parseInline(p.left), { kind: 'text', text: '  → ______' }], `${i + 1}.`))
        this.inlinePara(parseInline(rights.map((r, i) => `${choiceLetter(i)}. ${r}`).join('   ')), 'Normal')
        return
      }
      case 'cloze': if (a.text) this.rich(parseRichText(blanks(a.text))); return
      case 'multi':
        for (const p of a.parts) {
          const text = p.prompt.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.md : '')).join(' ')
          this.inlinePara([{ kind: 'bold', children: [{ kind: 'text', text: `${p.label}) ` }] }, ...parseInline(text)], 'Normal')
          this.answerArea(p.answer, [], key + p.label)
        }
        return
      case 'open':
        for (let i = 0; i < Math.max(4, Math.min(14, Math.floor((a.maxWords ?? 120) / 15))); i++) this.ruledLine()
        return
      default: this.inlinePara([{ kind: 'text', text: `${w.answer} ____________________________` }], 'Normal')
    }
  }

  private cardsTable(items: DocumentItem[]): void {
    const w = words(this.lang)
    const cards = items.flatMap((i) => (i.type === 'card' ? [i.card] : []))
    if (!cards.length) return
    const rows = [this.row([[{ kind: 'bold', children: [{ kind: 'text', text: w.question }] }], [{ kind: 'bold', children: [{ kind: 'text', text: w.response }] }]], true)]
    for (const c of cards) {
      let front = `${c.number}. ${c.front.replace(/\n/g, ' ')}`
      if (c.figure) {
        const target = c.figure.parts.find((p) => p.id === c.figure?.target)
        front += `  [${w.figure}${target ? `: ${target.name}` : c.figure.alt ? `: ${c.figure.alt}` : ''}]`
      }
      rows.push(this.row([parseInline(front), parseInline(c.back.replace(/\n/g, ' '))], false))
    }
    this.push(this.table(rows, 2))
    this.para('', 'Normal')
  }

  // MARK: Bloques

  private block(b: Block): void {
    const w = words(this.lang)
    switch (b.type) {
      case 'text': this.rich(parseRichText(b.md)); return
      case 'math':
        if (b.label) this.inlinePara([{ kind: 'bold', children: parseInline(b.label) }], 'Normal')
        this.displayMath(b.tex)
        if (b.note) this.inlinePara(parseInline(b.note), 'Caption')
        return
      case 'callout':
        this.inlinePara([{ kind: 'bold', children: parseInline(b.title?.trim() ? b.title : calloutName(b.kind, this.lang)) }], 'Callout')
        this.rich(parseRichText(b.md), 'Callout')
        return
      case 'example':
        this.inlinePara([{ kind: 'bold', children: parseInline(b.title?.trim() ? b.title : w.workedExample) }], 'Normal')
        this.rich(parseRichText(b.problem))
        b.steps.forEach((s, i) => this.listItem(parseInline(s.md.replace(/\n/g, ' ')), `${i + 1}.`))
        if (b.answer) this.inlinePara([{ kind: 'bold', children: [{ kind: 'text', text: `${w.answer} ` }] }, ...parseInline(b.answer)], 'Normal')
        return
      case 'table': this.tableBlock(b.headers, b.rows, b.caption); return
      case 'compare':
        if (b.title) this.inlinePara([{ kind: 'bold', children: parseInline(b.title) }], 'Normal')
        this.tableBlock(['', b.leftTitle, b.rightTitle], b.rows.map((r) => [r.label ?? '', r.left, r.right]))
        return
      case 'steps':
        if (b.title) this.inlinePara([{ kind: 'bold', children: parseInline(b.title) }], 'Normal')
        b.steps.forEach((s, i) => this.listItem([...(s.title ? [{ kind: 'bold', children: parseInline(s.title) } as Inline, { kind: 'text', text: ': ' } as Inline] : []), ...parseInline(s.md.replace(/\n/g, ' '))], `${i + 1}.`))
        return
      case 'formulas':
        if (b.title) this.inlinePara([{ kind: 'bold', children: parseInline(b.title) }], 'Normal')
        this.formulas({ title: '', items: b.items })
        return
      case 'recap':
        if (b.title) this.inlinePara([{ kind: 'bold', children: parseInline(b.title) }], 'Normal')
        for (const p of b.points) this.listItem(parseInline(p), '•')
        return
      case 'image': {
        const got = b.asset ? this.asset(b.asset) : undefined
        const info = got ? wordImage(got.data) : undefined
        if (got && info && info.width > 0 && info.height > 0) {
          const maxW = this.textWidth * 0.85
          let width = Math.min(maxW, Math.max(120, info.width / 2)), height = (width * info.height) / info.width
          // una lámina vertical se reduce entera
          if (height > 560) { width *= 560 / height; height = 560 }
          this.image(got.data, info.type, width, height, b.alt)
        } else this.inlinePara([{ kind: 'italic', children: [{ kind: 'text', text: `[${w.image}: ${b.alt}]` }] }], 'Normal')
        if (b.caption) this.inlinePara(parseInline(b.caption), 'Caption')
        return
      }
      default: {
        // sin dibujo: la descripción (y los datos, en las gráficas) que da Markdown
        const [md] = markdownBlock(b, { plan: this.plan, folder: '', lang: this.lang, asset: () => undefined })
        if (md) this.rich(parseRichText(md))
      }
    }
  }

  private formulas(g: FormulaGroup): void {
    if (g.title) this.inlinePara(parseInline(g.title), 'Heading3')
    for (const f of g.items) {
      const runs: Inline[] = [{ kind: 'bold', children: parseInline(f.name) }, { kind: 'text', text: '   ' }, { kind: 'math', tex: f.tex }]
      if (f.when) runs.push({ kind: 'text', text: '   ' }, { kind: 'italic', children: parseInline(f.when) })
      this.inlinePara(runs, 'Normal')
      if (f.vars.length) {
        const vr: Inline[] = []
        f.vars.forEach((v, i) => {
          if (i > 0) vr.push({ kind: 'text', text: '; ' })
          vr.push({ kind: 'math', tex: v.symbol }, { kind: 'text', text: ` = ${v.meaning}` + (v.unit ? ` (${v.unit})` : '') })
        })
        this.inlinePara(vr, 'Caption')
      }
    }
  }

  // MARK: Markdown → párrafos

  private rich(blocks: RichBlock[], style = 'Normal'): void {
    for (const rb of blocks) {
      switch (rb.kind) {
        case 'heading': this.inlinePara(rb.inlines, rb.level <= 1 ? 'Heading2' : 'Heading3'); break
        case 'paragraph': this.inlinePara(rb.inlines, style); break
        case 'list':
          rb.items.forEach((it, i) => {
            const marker = rb.ordered ? `${rb.start + i}.` : '•'
            let done = false
            for (const sub of it) {
              if (!done && sub.kind === 'paragraph') { this.listItem(sub.inlines, marker); done = true } else this.rich([sub], style)
            }
            if (!done) this.listItem([], marker)
          })
          break
        case 'quote': this.rich(rb.blocks, 'Quote'); break
        case 'code': for (const line of rb.text.split('\n')) this.inlinePara([{ kind: 'code', text: line }], 'Code'); break
        case 'displayMath': this.displayMath(rb.tex); break
        case 'rule': this.para('', 'Rule'); break
        case 'table': {
          const cols = Math.max(rb.header.length, ...rb.rows.map((r) => r.length), 0)
          if (!cols) break
          const rows: TableRow[] = []
          if (rb.header.length) rows.push(this.row(Array.from({ length: cols }, (_, i) => rb.header[i] ?? []), true))
          for (const r of rb.rows) rows.push(this.row(Array.from({ length: cols }, (_, i) => r[i] ?? []), false))
          this.push(this.table(rows, cols))
          break
        }
      }
    }
  }

  private tableBlock(headers: string[], rows: string[][], caption?: string): void {
    const cols = Math.max(headers.length, ...rows.map((r) => r.length), 0)
    if (!cols) return
    const out: TableRow[] = []
    if (headers.length) out.push(this.row(Array.from({ length: cols }, (_, i) => parseInline(headers[i] ?? '')), true))
    for (const r of rows) out.push(this.row(Array.from({ length: cols }, (_, i) => parseInline(r[i] ?? '')), false))
    this.push(this.table(out, cols))
    if (caption) this.inlinePara(parseInline(caption), 'Caption')
  }

  private table(rows: TableRow[], cols: number): Table {
    const border = { style: BorderStyle.SINGLE, size: 4, color: 'D6D0C8' }
    const total = Math.round(this.textWidth * 20)
    return new Table({
      rows, width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: Array.from({ length: cols }, () => Math.floor(total / cols)),
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border }
    })
  }

  private row(cells: Inline[][], header: boolean): TableRow {
    return new TableRow({
      tableHeader: header,
      children: cells.map((c) => new TableCell({
        children: [new Paragraph({ style: 'TableText', children: this.runs(header ? [{ kind: 'bold', children: c }] : c) })],
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        ...(header ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1EEE8' } } : {})
      }))
    })
  }

  // MARK: Párrafos y piezas

  private push(c: Child): void {
    if (this.pendingBreak) {
      this.pendingBreak = false
      this.body.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 0 } }))
    }
    this.body.push(c)
  }

  private para(text: string, style: string): void {
    this.push(new Paragraph({ style, children: text ? this.plainRuns(text, {}) : [] }))
  }

  private inlinePara(inl: Inline[], style: string): void {
    this.push(new Paragraph({ style, children: this.runs(inl) }))
  }

  private listItem(inl: Inline[], marker: string): void {
    this.push(new Paragraph({ style: 'ListItem', indent: { left: 440, hanging: 300 }, children: [new TextRun({ text: marker }), new TextRun({ children: ['\t'] }), ...this.runs(inl)] }))
  }

  private ruledLine(): void {
    this.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, space: 1, color: 'BBBBBB' } }, spacing: { before: 240, after: 0 } }))
  }

  private displayMath(tex: string): void {
    this.push(new Paragraph({ style: 'MathDisplay', children: [new DocxMath({ children: texToMath(tex) })] }))
  }

  private image(data: Uint8Array, type: 'png' | 'jpg' | 'gif', widthPt: number, heightPt: number, alt: string): void {
    const scale = widthPt > this.textWidth ? this.textWidth / widthPt : 1
    this.push(new Paragraph({
      style: 'Figure',
      children: [new ImageRun({ type, data, transformation: { width: Math.round(widthPt * scale * PX), height: Math.round(heightPt * scale * PX) }, altText: { name: alt.slice(0, 60) || 'Aula', description: alt, title: alt.slice(0, 60) } })]
    }))
  }

  /** Texto con saltos de línea y tabuladores como elementos propios de Word. */
  private plainRuns(text: string, props: Omit<IRunOptions, 'text' | 'children'>): ParagraphChild[] {
    const out: ParagraphChild[] = []
    text.split('\n').forEach((line, i) => {
      if (i > 0) out.push(new TextRun({ ...props, break: 1 }))
      line.split('\t').forEach((part, j) => {
        if (j > 0) out.push(new TextRun({ children: ['\t'] }))
        if (part) out.push(new TextRun({ ...props, text: part }))
      })
    })
    return out
  }

  private runs(inl: Inline[], props: Omit<IRunOptions, 'text' | 'children'> = {}): ParagraphChild[] {
    const out: ParagraphChild[] = []
    for (const x of inl) {
      switch (x.kind) {
        case 'text': out.push(...this.plainRuns(x.text, props)); break
        case 'bold': out.push(...this.runs(x.children, { ...props, bold: true })); break
        case 'italic': out.push(...this.runs(x.children, { ...props, italics: true })); break
        case 'strike': out.push(...this.runs(x.children, { ...props, strike: true })); break
        case 'highlight': out.push(...this.runs(x.children, { ...props, highlight: 'yellow' })); break
        case 'code': out.push(...this.plainRuns(x.text, { ...props, font: 'Menlo' })); break
        case 'link': out.push(...this.runs(x.children, { ...props, underline: {} })); break
        case 'lineBreak': out.push(new TextRun({ break: 1 })); break
        case 'math': out.push(new DocxMath({ children: texToMath(x.tex) })); break
      }
    }
    return out
  }

  // MARK: Paquete

  document(): Document {
    const plan = this.plan
    const style = plan.request.style
    const paper = PAPER[style.paper]
    const sz = Math.round(style.fontSize * 2)
    const bodyFont = style.serif ? 'Georgia' : 'Helvetica Neue'
    const accent = this.accent
    const lang = /^[A-Za-z0-9-]+$/.test(plan.contentLanguage) ? plan.contentLanguage : this.lang
    const ps = (id: string, name: string, paragraph: object, run: object = {}, next = 'Normal'): {
      id: string; name: string; basedOn: string; next: string; quickFormat: boolean; paragraph: object; run: object
    } => ({ id, name, basedOn: 'Normal', next, quickFormat: true, paragraph, run })
    const footerText = `Aula · ${plan.title}${plan.courseTitle && plan.courseTitle !== plan.title ? ` · ${plan.courseTitle}` : ''}`
    return new Document({
      creator: 'Aula',
      title: plan.title,
      subject: plan.courseTitle ?? words(this.lang).kind[plan.request.kind],
      keywords: words(this.lang).kind[plan.request.kind],
      description: plan.notice,
      styles: {
        default: { document: { run: { font: bodyFont, size: sz, language: { value: lang } }, paragraph: { spacing: { after: 120, line: 288 } } } },
        paragraphStyles: [
          { id: 'Normal', name: 'Normal', quickFormat: true, run: { font: bodyFont, size: sz } },
          ps('Title', 'Title', { spacing: { after: 60 } }, { font: 'Georgia', bold: true, size: 52, color: '1F1B16' }),
          ps('Subtitle', 'Subtitle', { spacing: { after: 360 } }, { color: '6B6560', size: sz + 4 }),
          ps('Heading1', 'heading 1', { keepNext: true, spacing: { before: 360, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 4, color: accent } }, outlineLevel: 0 }, { font: 'Georgia', bold: true, size: 40, color: '1F1B16' }),
          ps('Heading2', 'heading 2', { keepNext: true, spacing: { before: 280, after: 120 }, outlineLevel: 1 }, { font: 'Georgia', bold: true, size: 30, color: '1F1B16' }),
          ps('Heading3', 'heading 3', { keepNext: true, spacing: { before: 200, after: 80 }, outlineLevel: 2 }, { bold: true, size: sz + 4, color: accent }),
          ps('Eyebrow', 'Eyebrow', { keepNext: true, spacing: { before: 240, after: 0 } }, { allCaps: true, bold: true, size: 16, characterSpacing: 20, color: accent }),
          ps('Lead', 'Lead', { spacing: { after: 200 } }, { italics: true, color: '4A4540' }),
          ps('Quote', 'Quote', { indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, space: 8, color: 'CFC8BE' } } }, { color: '3A3530' }),
          ps('Callout', 'Callout', { indent: { left: 200, right: 200 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F6F3EE' }, border: { left: { style: BorderStyle.SINGLE, size: 18, space: 6, color: accent } }, spacing: { after: 60 } }),
          ps('Caption', 'caption', { spacing: { after: 200 } }, { italics: true, size: Math.max(14, sz - 4), color: '6B6560' }),
          ps('ListItem', 'List Paragraph', { spacing: { after: 60 } }),
          ps('Question', 'Question', { keepNext: true, spacing: { before: 240, after: 80 } }),
          ps('Code', 'Code', { spacing: { after: 0 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F2EF' } }, { font: 'Menlo', size: Math.max(14, sz - 3) }),
          ps('MathDisplay', 'Math', { alignment: AlignmentType.CENTER, spacing: { before: 80, after: 120 } }),
          ps('Figure', 'Figure', { alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 } }),
          ps('TableText', 'Table Text', { spacing: { after: 0 } }, { size: Math.max(14, sz - 2) }),
          ps('Rule', 'Rule', { border: { bottom: { style: BorderStyle.SINGLE, size: 4, space: 1, color: 'CCCCCC' } } }),
          ps('Footer', 'footer', {}, { size: 16, color: '8A847E' })
        ]
      },
      sections: [{
        properties: {
          page: {
            size: { width: Math.round(paper.w * 20), height: Math.round(paper.h * 20) },
            margin: { top: MARGIN_TW, right: MARGIN_TW, bottom: MARGIN_TW, left: MARGIN_TW, header: 567, footer: 567, gutter: 0 }
          }
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              style: 'Footer',
              tabStops: [{ type: TabStopType.RIGHT, position: Math.round(paper.w * 20) - 2 * MARGIN_TW }],
              children: [new TextRun(footerText), new TextRun({ children: ['\t', PageNumber.CURRENT] })]
            })]
          })
        },
        children: this.body
      }]
    })
  }
}

/** El documento en Word (.docx). `asset` lee las imágenes del curso. */
export async function renderDocx(plan: DocumentPlan, asset: AssetReader = () => undefined): Promise<Uint8Array> {
  const b = new DocxBuilder(plan, asset)
  b.build()
  const buf = await Packer.toBuffer(b.document())
  return new Uint8Array(buf)
}
