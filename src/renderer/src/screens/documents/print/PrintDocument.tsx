// El documento en papel (port de DocumentPrintViews.swift y la composición del PDF): portada con el icono del curso, índice,
// cada lección con sus bloques dibujados igual que en la app (en `mode: 'print'`: estáticos), hoja de fórmulas, glosario,
// errores comunes y mis notas; la chuleta a dos columnas; el examen con su sitio para responder y la hoja de respuestas aparte;
// las tarjetas para recortar (a doble cara, en espejo) y las diapositivas (una por página o en folleto con líneas).
import { useMemo, type CSSProperties, type ReactNode } from 'react'
import type { Answer, Block, CardFigure } from '@shared/schema'
import type { DocumentCard, DocumentItem, DocumentPlan, DocumentQuestion, DocumentSection, DocumentSlide } from '@shared/documents'
import { blanks, choiceLetter, markCSS, printablePrompt, stableShuffle } from '@shared/documents'
import { CourseIcon, cx, toneForHue } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { SafeBlockView } from '@renderer/blocks/BlockView'
import { makeBlockContext, type BlockContext } from '@renderer/blocks/types'
import './print.css'

/** Alto útil de la página (pulgadas) con los márgenes de print.ts. */
const PAGE_HEIGHT = { a4: { portrait: 9.95, landscape: 6.55 }, letter: { portrait: 9.3, landscape: 6.8 } }

export function PrintDocument({ plan }: { plan: DocumentPlan }) {
  const style = plan.request.style
  const tone = toneForHue(plan.hue)
  const ink = style.color ? tone.inkLight : '#3a3631'
  const ctx = useMemo(() => makeBlockContext(plan.packId ?? null, plan.contentLanguage, { mode: 'print', hue: plan.hue }), [plan.packId, plan.contentLanguage, plan.hue])
  const kind = plan.request.kind
  const css: CSSProperties = {
    fontSize: `${style.fontSize}pt`,
    ['--ink' as string]: ink,
    // los bloques de la app están pensados para leer a 17–18 px: se escalan a la letra del documento
    ['--pd-zoom' as string]: ((style.fontSize * 4) / 3 / 17).toFixed(3)
  }
  return (
    <article className={cx('pd', !style.serif && 'pd-sans', !style.color && 'pd-gray', style.paper === 'letter' && 'pd-letter', kind === 'cheatsheet' && 'pd-cheat')} style={css} lang={plan.lang}>
      {kind === 'guide' || kind === 'summary' ? <Cover plan={plan} /> : kind === 'exam' || kind === 'cheatsheet' ? <Head plan={plan} /> : null}
      {kind === 'exam' && <ExamHeader plan={plan} />}
      {kind === 'flashcards' ? (
        <CardsSheets plan={plan} ctx={ctx} />
      ) : kind === 'slides' ? (
        <Slides plan={plan} ctx={ctx} />
      ) : (
        <div className="pd-sections">
          {plan.sections.map((s, i) => <Section key={s.id + i} section={s} first={i === 0} plan={plan} ctx={ctx} />)}
        </div>
      )}
      {kind !== 'guide' && kind !== 'summary' && kind !== 'flashcards' && kind !== 'slides' && <p className="pd-notice mt-6">{plan.notice}</p>}
    </article>
  )
}

function longDate(iso: string, lang: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

function Cover({ plan }: { plan: DocumentPlan }) {
  const toc = plan.sections.filter((s) => s.toc)
  return (
    <section className="pd-cover">
      <div className="pd-cover-top">
        {plan.icon && <CourseIcon icon={plan.icon} hue={plan.hue} size={46} />}
        <span className="pd-eyebrow">{plan.courseTitle ?? 'Aula'}</span>
      </div>
      <h1>{plan.title}</h1>
      {plan.subtitle && plan.subtitle !== plan.courseTitle && <p className="pd-cover-sub">{plan.subtitle}</p>}
      <div className="pd-cover-rule" />
      <div className="pd-cover-meta">
        {plan.subject && <span>{plan.subject}</span>}
        {plan.examDate && <span>{plan.words.exam}: {plan.examTitle ? `${plan.examTitle} · ` : ''}{longDate(plan.examDate, plan.lang)}</span>}
        <span>{longDate(plan.created, plan.lang)}</span>
      </div>
      {toc.length > 2 && (
        <nav className="pd-toc">
          <h2>{plan.words.contents}</h2>
          <ol>{toc.map((s, i) => <li key={s.id}><span>{i + 1}</span><span>{s.title}</span></li>)}</ol>
        </nav>
      )}
      <p className="pd-notice">{plan.notice}</p>
    </section>
  )
}

function Head({ plan }: { plan: DocumentPlan }) {
  const sub = [plan.subtitle ?? plan.courseTitle, plan.examDate ? `${plan.words.exam}: ${longDate(plan.examDate, plan.lang)}` : undefined].filter(Boolean).join(' · ')
  return (
    <header className="pd-head">
      <h1>{plan.title}</h1>
      {sub && <div className="pd-head-sub">{sub}</div>}
    </header>
  )
}

function ExamHeader({ plan }: { plan: DocumentPlan }) {
  const w = plan.words
  const facts = [plan.minutes !== undefined ? `${plan.minutes} ${w.minutes}` : '', plan.totalPoints !== undefined ? `${fmtPoints(plan.totalPoints)} ${plan.totalPoints === 1 ? w.point : w.points}` : ''].filter(Boolean)
  return (
    <>
      <div className="pd-examhead">
        <span>{w.name}:<span className="pd-line" /></span>
        <span>{w.date}:<span className="pd-line" style={{ minWidth: '1.3in' }} /></span>
        {facts.length > 0 && <span className="col-span-2 text-[var(--pd-text3)]">{facts.join(' · ')}</span>}
      </div>
      {plan.instructions && <p className="pd-instructions">{plan.instructions}</p>}
    </>
  )
}

const fmtPoints = (p: number): string => (Math.round(p) === p ? String(p) : p.toFixed(1))

// MARK: - Secciones e items

function Section({ section: s, first, plan, ctx }: { section: DocumentSection; first: boolean; plan: DocumentPlan; ctx: BlockContext }) {
  return (
    <section className={cx('pd-section', s.newPage && !first && 'pd-newpage')}>
      {(s.title || s.eyebrow || s.summary) && (
        <header className="pd-section-head">
          {s.eyebrow && <div className="pd-eyebrow">{s.eyebrow}</div>}
          {s.title && <h2>{s.title}</h2>}
          {s.summary && <p className="pd-lead"><RichText text={s.summary} inline /></p>}
        </header>
      )}
      {s.items.map((it, i) => <Item key={i} item={it} plan={plan} ctx={ctx} />)}
    </section>
  )
}

/** Bloques que no se deben partir entre dos páginas (los textos largos sí pueden). */
const AVOID = new Set(['math', 'callout', 'formulas', 'table', 'compare', 'image', 'plot', 'chart', 'diagram', 'drawing', 'numberline', 'example', 'recap', 'steps', 'predict', 'spot', 'labeled', 'map', 'model3d', 'simulation', 'explore', 'timeline', 'code', 'quote'])

function BlockItem({ block, ctx }: { block: Block; ctx: BlockContext }) {
  return (
    <div className={cx('pd-item', AVOID.has(block.type) && 'pd-avoid')} data-block={block.type} style={{ zoom: 'var(--pd-zoom)' }}>
      <SafeBlockView block={block} ctx={ctx} />
    </div>
  )
}

function Item({ item, plan, ctx }: { item: DocumentItem; plan: DocumentPlan; ctx: BlockContext }) {
  if (plan.request.kind === 'cheatsheet') {
    if (item.type === 'formulas') return <CompactFormulas group={item.group} />
    if (item.type === 'block' && item.block.type === 'callout') {
      const b = item.block
      return <div className="pd-item pd-compact"><b>{b.title?.trim() || plan.words.callouts[b.kind]}.</b> <RichText text={b.md} inline /></div>
    }
  }
  switch (item.type) {
    case 'heading': return item.level <= 3 ? <h3 className="pd-h3">{item.text}</h3> : <h4 className="pd-h4">{item.text}</h4>
    case 'markdown': return <div className="pd-item"><RichText text={item.md} /></div>
    case 'block':
    case 'lessonBlock': return <BlockItem block={item.block} ctx={ctx} />
    case 'bullets': return <ul className="pd-item">{item.items.map((x, i) => <li key={i}><RichText text={x} inline /></li>)}</ul>
    case 'formulas': return <BlockItem block={{ id: `f-${item.group.title}`, type: 'formulas', ...(item.group.title ? { title: item.group.title } : {}), items: item.group.items }} ctx={ctx} />
    case 'term': {
      const e = item.entry
      return (
        <p className="pd-item pd-term pd-avoid">
          <b>{e.term}</b>{e.aliases.length > 0 && <span className="pd-alias"> ({e.aliases.join(', ')})</span>}: <RichText text={e.definition} inline />
        </p>
      )
    }
    case 'mistake': {
      const m = item.mistake
      return (
        <div className="pd-item pd-mistake">
          <div><b><RichText text={m.title} inline /></b>{item.skill && <i className="text-[var(--pd-text3)]"> — {item.skill}</i>}</div>
          <div className="pd-mk">
            {m.wrong && <><span>✗</span><span><RichText text={m.wrong} inline /></span></>}
            {m.right && <><span>✓</span><span><RichText text={m.right} inline /></span></>}
            {m.why && <><span>→</span><span className="text-[var(--pd-text2)]"><RichText text={m.why} inline /></span></>}
          </div>
        </div>
      )
    }
    case 'note': {
      const color = (['yellow', 'green', 'blue', 'pink'] as const).find((c) => c === item.note.color) ?? 'yellow'
      return (
        <div className="pd-item pd-note" style={{ ['--mark' as string]: markCSS(color) }}>
          <div>{item.note.excerpt}</div>
          {item.note.note && <div className="pd-note-text">{item.note.note}</div>}
        </div>
      )
    }
    case 'question': return <Question q={item.question} plan={plan} ctx={ctx} />
    case 'answer': {
      const a = item.answer
      return (
        <div className="pd-ans">
          <b style={{ color: 'var(--ink)' }}>{a.number}.</b> <RichText text={a.answer} inline />
          {a.solution.length > 0 && <div className="pd-sol">{a.solution.map((b, i) => <BlockItem key={i} block={b} ctx={ctx} />)}</div>}
        </div>
      )
    }
    case 'card': return <div className="pd-item"><b>{item.card.number}.</b> <RichText text={item.card.front} inline /> — <RichText text={item.card.back} inline /></div>
    case 'slide': return <SlideFrame s={item.slide} ctx={ctx} words={plan.words} />
  }
}

/** Fórmulas de la chuleta: nombre, la fórmula y cuándo se usa, en una línea cada una. */
function CompactFormulas({ group }: { group: { title: string; items: { name: string; tex: string; when?: string }[] } }) {
  return (
    <div className="pd-item">
      {group.title && <h3 className="pd-h4">{group.title}</h3>}
      {group.items.map((f, i) => (
        <div key={i} className="pd-formula">
          <span className="pd-formula-name">{f.name}</span>
          <span className="pd-formula-tex"><RichText text={`$${f.tex}$`} inline /></span>
          {f.when && <span className="pd-formula-when"><RichText text={f.when} inline /></span>}
        </div>
      ))}
    </div>
  )
}

// MARK: - Examen

function Question({ q, plan, ctx }: { q: DocumentQuestion; plan: DocumentPlan; ctx: BlockContext }) {
  return (
    <div className="pd-q">
      <span className="pd-qn">{q.number}.</span>
      <div className="pd-qbody">
        {printablePrompt(q.exercise).map((b, i) => <BlockItem key={i} block={b} ctx={ctx} />)}
        <AnswerArea answer={q.exercise.answer} order={q.optionOrder} seedKey={q.exercise.id} plan={plan} ctx={ctx} />
      </div>
      <span className="pd-qpts">{fmtPoints(q.points)} {q.points === 1 ? plan.words.point : plan.words.points}</span>
    </div>
  )
}

function Ruled({ n }: { n: number }) {
  return <div>{Array.from({ length: n }, (_, i) => <div key={i} className="pd-ruled" />)}</div>
}

function AnswerLine({ prefix, suffix }: { prefix?: string; suffix?: string }) {
  return (
    <div className="pd-answerline">
      {prefix && <RichText text={prefix} inline />}
      <span className="pd-fill" />
      {suffix && <RichText text={suffix} inline />}
    </div>
  )
}

/** El sitio para responder según el tipo de respuesta (como PrintedAnswerArea en Swift). */
function AnswerArea({ answer: a, order, seedKey, plan, ctx }: { answer: Answer; order: number[]; seedKey: string; plan: DocumentPlan; ctx: BlockContext }) {
  const w = plan.words
  switch (a.kind) {
    case 'choice': {
      const ord = order.length ? order : a.options.map((_, i) => i)
      return (
        <div>
          {ord.map((idx, pos) => a.options[idx] && (
            <div key={pos} className="pd-opt">
              <span className={cx('pd-box', a.multi && 'pd-square')} />
              <span className="font-semibold text-[var(--pd-text2)]">{choiceLetter(pos)})</span>
              <span><RichText text={a.options[idx].md} inline /></span>
            </div>
          ))}
        </div>
      )
    }
    case 'truefalse':
      return (
        <div>
          <div className="flex gap-8"><span className="flex items-center gap-1.5"><span className="pd-box" />{w.true}</span><span className="flex items-center gap-1.5"><span className="pd-box" />{w.false}</span></div>
          {a.explainWhy && <Ruled n={2} />}
        </div>
      )
    case 'numeric': return <div className="flex flex-col gap-1.5"><div className="pd-work" /><AnswerLine prefix={a.prefix} suffix={a.unit ?? a.suffix} /></div>
    case 'expression': return <div className="flex flex-col gap-1.5"><div className="pd-work" /><AnswerLine prefix={a.prefix} /></div>
    case 'equation': case 'set': case 'interval': case 'point': return <div className="flex flex-col gap-1.5"><div className="pd-work" /><AnswerLine /></div>
    case 'chem': return <div className="flex flex-col gap-1.5">{(a.mode === 'number' || a.mode === 'equation') && <div className="pd-work" />}<AnswerLine suffix={a.unit} /></div>
    case 'short': return <AnswerLine />
    case 'cloze': return a.text ? <RichText text={blanks(a.text)} /> : null
    case 'ordering':
      return (
        <div>
          <div className="text-[0.85em] text-[var(--pd-text2)] mb-1">{w.order}</div>
          {stableShuffle(a.items, seedKey).map((s, i) => <div key={i} className="pd-opt"><span className="pd-box pd-square" /><span /><span><RichText text={s} inline /></span></div>)}
        </div>
      )
    case 'matching': {
      const rights = stableShuffle([...a.pairs.map((p) => p.right), ...a.extraRights], seedKey)
      return (
        <div className="pd-match">
          <div>{a.pairs.map((p, i) => <div key={i} className="flex items-baseline gap-1.5 my-1"><b>{i + 1}.</b><span className="flex-1"><RichText text={p.left} inline /></span><span className="pd-box pd-square" /></div>)}</div>
          <div>{rights.map((r, i) => <div key={i} className="flex items-baseline gap-1.5 my-1"><b>{choiceLetter(i)}.</b><RichText text={r} inline /></div>)}</div>
        </div>
      )
    }
    case 'label':
      return (
        <div>
          {a.asset && (
            <div className="relative inline-block max-w-[3.8in]">
              <img src={ctx.assetUrl(`assets/${a.asset}`)} alt={a.alt} className="block max-h-[2.6in] w-auto" />
              {a.spots.map((s, i) => (
                <span key={i} className="absolute grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/75 text-[8px] font-bold text-white" style={{ left: `${unit(s.x) * 100}%`, top: `${unit(s.y) * 100}%` }}>{i + 1}</span>
              ))}
            </div>
          )}
          {a.spots.map((_, i) => <div key={i} className="pd-answerline mt-1"><b>{i + 1}.</b><span className="pd-fill" /></div>)}
          {a.wordBank.length > 0 && <div className="text-[0.85em] text-[var(--pd-text2)] mt-1">{[...a.wordBank].sort().join(' · ')}</div>}
        </div>
      )
    case 'open': return <Ruled n={Math.max(4, Math.min(14, Math.floor((a.maxWords ?? 120) / 15)))} />
    case 'multi':
      return (
        <div className="flex flex-col gap-2">
          {a.parts.map((p, i) => (
            <div key={i} className="grid grid-cols-[1.4em_1fr] gap-1">
              <b>{p.label})</b>
              <div className="flex flex-col gap-1">
                {p.prompt.map((b, k) => <BlockItem key={k} block={b} ctx={ctx} />)}
                <AnswerArea answer={p.answer} order={[]} seedKey={seedKey + p.label} plan={plan} ctx={ctx} />
              </div>
            </div>
          ))}
        </div>
      )
    default: return <AnswerLine />
  }
}

const unit = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5)

// MARK: - Tarjetas para recortar

function CardsSheets({ plan, ctx }: { plan: DocumentPlan; ctx: BlockContext }) {
  const style = plan.request.style
  const cards = plan.sections.flatMap((s) => s.items.flatMap((i) => (i.type === 'card' ? [i.card] : [])))
  const per = style.cardsPerPage
  const H = PAGE_HEIGHT[style.paper].portrait
  const pages: DocumentCard[][] = []
  const perPage = style.duplex ? per : Math.max(3, per / 2 + 1)
  for (let i = 0; i < cards.length; i += perPage) pages.push(cards.slice(i, i + perPage))
  if (!style.duplex) {
    // pregunta y respuesta lado a lado: recorta por las líneas y dobla por el medio
    const rowH = `${H / perPage}in`
    return (
      <>
        {pages.map((pg, pi) => (
          <div key={pi}>
            <div className="pd-cards-page">
              {pg.flatMap((c) => [<CardFace key={`f${c.number}`} card={c} side="front" height={rowH} ctx={ctx} />, <CardFace key={`b${c.number}`} card={c} side="back" height={rowH} ctx={ctx} />])}
            </div>
          </div>
        ))}
      </>
    )
  }
  const rows = per / 2
  const h = `${H / rows}in`
  return (
    <>
      {pages.flatMap((pg, pi) => {
        const fronts = pg.map((c) => <CardFace key={`f${c.number}`} card={c} side="front" height={h} ctx={ctx} />)
        // reversos en espejo (se imprime a doble cara girando por el borde largo): cada fila con sus dos tarjetas cambiadas
        const backs: ReactNode[] = []
        for (let r = 0; r < Math.ceil(pg.length / 2); r++) {
          const a = pg[r * 2], b = pg[r * 2 + 1]
          backs.push(b ? <CardFace key={`b${b.number}`} card={b} side="back" height={h} ctx={ctx} /> : <div key={`e${r}`} className="pd-card" style={{ height: h }} />)
          backs.push(<CardFace key={`b${a.number}`} card={a} side="back" height={h} ctx={ctx} />)
        }
        return [
          <div key={`p${pi}f`} className="pd-cards-page">{fronts}</div>,
          <div key={`p${pi}b`} className="pd-cards-page">{backs}</div>
        ]
      })}
    </>
  )
}

function CardFace({ card, side, height, ctx }: { card: DocumentCard; side: 'front' | 'back'; height: string; ctx: BlockContext }) {
  return (
    <div className={cx('pd-card', side === 'back' && 'pd-back')} style={{ height }}>
      {side === 'front' && <span className="pd-card-topic">{card.topic}</span>}
      <span className="pd-card-n">{card.number}</span>
      <div className="pd-card-body">
        {side === 'front' && card.figure && <Figure figure={card.figure} ctx={ctx} />}
        <RichText text={side === 'front' ? card.front : card.back} />
        {side === 'front' && card.hint && <div className="text-[0.8em] text-[var(--pd-text3)] mt-1"><RichText text={card.hint} inline /></div>}
      </div>
    </div>
  )
}

/** La figura de una tarjeta con la parte que se pregunta resaltada (como el anverso en la app). */
function Figure({ figure: f, ctx }: { figure: CardFigure; ctx: BlockContext }) {
  if (!f.asset) return <div className="text-[0.8em] italic text-[var(--pd-text3)]">[{f.alt}]</div>
  const part = f.parts.find((p) => p.id === f.target)
  return (
    <div className="relative mx-auto mb-1.5 inline-block max-w-full">
      <img src={ctx.assetUrl(`assets/${f.asset}`)} alt={f.alt} className="block max-h-[1.5in] w-auto max-w-full" />
      {part && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {part.polygon && part.polygon.length >= 3 ? (
            <polygon points={part.polygon.map(([x, y]) => `${unit(x) * 100},${unit(y) * 100}`).join(' ')} fill="rgba(255,140,0,.28)" stroke="rgb(230,90,0)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          ) : part.rect && part.rect.length >= 4 ? (
            <rect x={unit(part.rect[0]) * 100} y={unit(part.rect[1]) * 100} width={unit(part.rect[2]) * 100} height={unit(part.rect[3]) * 100} fill="rgba(255,140,0,.28)" stroke="rgb(230,90,0)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          ) : (
            <ellipse cx={unit(part.x) * 100} cy={unit(part.y) * 100} rx={Math.min(30, Math.max(1, (part.r ?? 0.04) * 100))} ry={Math.min(30, Math.max(1, (part.r ?? 0.04) * 100))} fill="rgba(255,140,0,.28)" stroke="rgb(230,90,0)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      )}
    </div>
  )
}

// MARK: - Diapositivas

function Slides({ plan, ctx }: { plan: DocumentPlan; ctx: BlockContext }) {
  const slides = plan.sections.flatMap((s) => s.items.flatMap((i) => (i.type === 'slide' ? [i.slide] : [])))
  if (plan.request.style.handout) {
    return (
      <>
        <Head plan={plan} />
        {slides.map((s, i) => (
          <div key={i} className="pd-handout">
            <SlideFrame s={s} ctx={ctx} words={plan.words} />
            <div className="pd-lines"><Ruled n={8} /></div>
          </div>
        ))}
      </>
    )
  }
  return <>{slides.map((s, i) => <SlideFrame key={i} s={s} ctx={ctx} words={plan.words} />)}</>
}

function SlideFrame({ s, ctx, words }: { s: DocumentSlide; ctx: BlockContext; words: DocumentPlan['words'] }) {
  const slide = s.slide
  const cover = slide.layout === 'title' || slide.layout === 'section'
  const two = slide.right.length > 0
  return (
    <section className={cx('pd-slide', cover && 'pd-cover-slide')}>
      {cover && <div className="pd-eyebrow mb-2">{s.deckTitle}</div>}
      <h2 className="pd-slide-title">{slide.title ?? s.deckTitle}</h2>
      {slide.subtitle && <p className="pd-lead mb-3">{slide.subtitle}</p>}
      {slide.image && <img src={ctx.assetUrl(`assets/${slide.image}`)} alt={slide.title ?? ''} className="mx-auto my-2 block max-h-[2.6in] w-auto max-w-full rounded-[6px]" />}
      <div className={cx(two ? 'grid grid-cols-2 gap-6' : 'flex flex-col')}>
        <div>
          {slide.leftTitle && <h3 className="pd-h4">{slide.leftTitle}</h3>}
          {slide.blocks.map((b, i) => <BlockItem key={i} block={b} ctx={ctx} />)}
        </div>
        {two && (
          <div>
            {slide.rightTitle && <h3 className="pd-h4">{slide.rightTitle}</h3>}
            {slide.right.map((b, i) => <BlockItem key={i} block={b} ctx={ctx} />)}
          </div>
        )}
      </div>
      {slide.notes && <div className="pd-slide-notes"><b>{words.notes}</b> {slide.notes}</div>}
      <span className="pd-slide-num">{s.index} / {s.total}</span>
    </section>
  )
}
