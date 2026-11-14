// Las formas ya hechas del diagrama dentro de su lienzo: pirámide y embudo (filas planas de la tinta del curso, silueta a
// lápiz y explicaciones al lado), diagrama de Venn (conjuntos de color plano que se oscurecen al cruzarse, contorno a pluma y
// la región señalada al pasar el ratón) y mapa mental (ramas que se dibujan desde la idea central). Los pasos rodean a pluma
// lo que señalan y apagan lo demás; con `build`, lo que aún no ha salido no se ve, no se toca y no se nombra (ni para los
// lectores de pantalla ni para «Marcar»). Cada parte que se ve lleva `data-ask-part` y `data-ask-label` para preguntarle
// al tutor por ella.
import { useId, useMemo, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { cx, useTheme } from '@renderer/design'
import { Ink } from '@renderer/design/paint/Ink'
import { circleLoopInk, circleLoopPad, encircleInk, encirclePad, outlineInk, ovalInk } from '@renderer/design/paint/penInk'
import type { DiagramBlock } from '@shared/schema/blocks'
import { RichText } from '@renderer/lib/RichText'
import type { Box, MindmapLayout, PyramidLayout, VennLayout } from '../lib/diagramForms'
import type { Pt, StepLight } from '../lib/diagramLayout'
import { INK, vizColor, wash } from '../shared/colors'

export interface FormViewProps {
  b: DiagramBlock
  blockId: string
  hl: StepLight | undefined
  /** Lo que ya ha salido (con `build`); undefined = todo. */
  revealed: Set<string> | undefined
  step: number | null
  animate: boolean
  run: boolean
  printing: boolean
}

/** Cuánto se apaga lo que el paso no señala. */
export const DIM = 0.24
const BRICK = 'var(--pigment-brick)'
// la visibilidad cambia al final al ocultarse (deja ver el fundido) y al principio al aparecer
const fade = { transition: 'opacity 300ms, visibility 300ms' }

/** ¿Aún no ha salido (con `build`)? */
const unrevealed = (id: string, p: FormViewProps): boolean => p.revealed !== undefined && !p.revealed.has(id)

/** Opacidad de una parte: oculta si aún no ha salido, apagada si el paso no la señala. */
function partOpacity(id: string, p: FormViewProps): number {
  if (unrevealed(id, p)) return 0
  if (p.hl && !p.hl.nodes.has(id)) return DIM
  return 1
}

/** Estilo de una parte: su opacidad y, si aún no ha salido, invisible y sin recibir el puntero (no se puede señalar). */
function partStyle(id: string, p: FormViewProps, opacity = partOpacity(id, p)): CSSProperties {
  return unrevealed(id, p) ? { opacity: 0, visibility: 'hidden', pointerEvents: 'none', ...fade } : { opacity, ...fade }
}

/** Lo que aún no ha salido, oculto también para los lectores de pantalla. */
const muted = (id: string, p: FormViewProps): Record<string, string> | undefined => (unrevealed(id, p) ? { 'aria-hidden': 'true' } : undefined)

/** Atributos para «marca y pregunta al tutor»: ninguno si la parte aún no ha salido. */
const ask = (id: string, label: string, p: FormViewProps): Record<string, string> => muted(id, p) ?? { 'data-ask-part': id, 'data-ask-label': label }

/** El rodeo a pluma de lo que señala un paso (se vuelve a dibujar cada vez que se entra en el paso). */
export function PenRing({ box, seed, delay = 0, printing }: { box: Box; seed: string; delay?: number; printing: boolean }) {
  const d = encircleInk(box.w, box.h, seed)
  const pad = encirclePad()
  return <Ink drawing={d} color={BRICK} delay={delay} draw={!printing} className="ink-fixed" style={{ left: box.x - pad, top: box.y - pad, width: d.w, height: d.h, zIndex: 3 }} />
}

/** Los rodeos del paso actual: como mucho 4 (con más, se pierde el foco). */
function StepRings({ boxes, p }: { boxes: Array<{ id: string; box: Box }>; p: FormViewProps }) {
  if (!p.hl || p.step === null) return null
  return (
    <>
      {boxes.filter((x) => p.hl!.focus.has(x.id)).slice(0, 4).map((x, i) => (
        <PenRing key={`${p.step}:${x.id}`} box={x.box} seed={`${p.blockId}:${x.id}`} delay={i * 180} printing={p.printing} />
      ))}
    </>
  )
}

const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, w: b.w + by * 2, h: b.h + by * 2 })
const at = (b: Box): CSSProperties => ({ left: b.x, top: b.y, width: b.w, height: b.h })

function Label({ box, children, className, look, part }: { box: Box; children: ReactNode; className?: string; look: CSSProperties; part?: Record<string, string> }) {
  return (
    <div className={cx('viz-label absolute', className)} style={{ ...at(box), ...look }} {...part}>
      {children}
    </div>
  )
}

// MARK: Pirámide y embudo

export function PyramidView({ layout: l, ...p }: FormViewProps & { layout: PyramidLayout }) {
  const n = l.rows.length
  const outline = useMemo(() => outlineInk(l.outline.map(([x, y]) => ({ x, y })), l.width, l.height, `${p.blockId}:silueta`), [l, p.blockId])
  const fill = (i: number, color: string | undefined): string => {
    if (color?.trim().toLowerCase() === 'accent') return wash(INK, 32)
    const tint = color ? vizColor(color) : INK
    return wash(tint, 9 + (n > 1 ? (i / (n - 1)) * 15 : 8))
  }
  // la pirámide sube desde la base; el embudo cae desde la boca
  const delay = (i: number): number => (l.form === 'pyramid' ? n - 1 - i : i) * 0.08
  return (
    <>
      <svg width={l.width} height={l.height} className="absolute inset-0 overflow-visible">
        {l.rows.map((r) => (
          <g key={r.id} style={partStyle(r.id, p)}>
            <motion.polygon
              points={r.points.map((q) => q.join(',')).join(' ')}
              fill={fill(r.index, r.node.color)}
              stroke="var(--line-strong)"
              strokeWidth={0.75}
              strokeLinejoin="round"
              initial={p.animate ? { y: 14, opacity: 0 } : false}
              animate={p.run ? { y: 0, opacity: 1 } : undefined}
              transition={{ duration: 0.45, delay: p.animate ? delay(r.index) : 0, ease: [0.2, 0.7, 0.2, 1] }}
              {...ask(r.id, r.node.label, p)}
            />
          </g>
        ))}
        {l.rows.map((r) =>
          r.leader ? (
            <path key={`g-${r.id}`} d={`M${r.leader[0].join(' ')}L${r.leader[1].join(' ')}`} stroke="var(--text3)" strokeWidth={1} strokeDasharray="1.5 4" strokeLinecap="round" fill="none" style={partStyle(r.id, p)} aria-hidden />
          ) : null
        )}
      </svg>
      <Ink drawing={outline} color="var(--text2)" alpha={0.55} draw={!p.printing} drawKey={`diag:${p.blockId}:silueta`} delay={p.animate ? n * 80 + 200 : 0} className="ink-fixed" style={{ left: 0, top: 0, width: outline.w, height: outline.h }} />
      {l.rows.map((r) => (
        <Label key={`t-${r.id}`} box={r.label} look={partStyle(r.id, p)} className="flex flex-col items-center justify-center text-center" part={ask(r.id, r.node.label, p)}>
          <div className="text-[14px] leading-[19px] font-semibold text-text break-words w-full" style={{ height: r.labelH }}>
            <RichText text={r.node.label} inline />
          </div>
          {r.inlineDetail && r.node.detail && (
            <div className="mt-[3px] text-[12px] leading-4 text-text2 w-full">
              <RichText text={r.node.detail} inline />
            </div>
          )}
        </Label>
      ))}
      {l.rows.map((r) =>
        r.detail && r.node.detail ? (
          <Label key={`d-${r.id}`} box={r.detail} look={partStyle(r.id, p)} className="text-[12px] leading-4 text-text2" part={muted(r.id, p)}>
            <RichText text={r.node.detail} inline />
          </Label>
        ) : null
      )}
      <StepRings boxes={l.rows.map((r) => ({ id: r.id, box: grow(r.label, 6) }))} p={p} />
    </>
  )
}

// MARK: Venn

/** Colores de los conjuntos sin color propio: azul, ámbar y verde azulado (al cruzarse no dan nunca violeta). */
const SET_COLORS = ['var(--viz-blue)', 'var(--viz-amber)', 'var(--viz-teal)']

export function VennView({ layout: l, hover, onHover, ...p }: FormViewProps & { layout: VennLayout; hover: string | null; onHover: (key: string | null) => void }) {
  const { t } = useTranslation('visual')
  const { dark } = useTheme()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const colors = l.circles.map((c) => (c.node.color ? vizColor(c.node.color) : SET_COLORS[c.index % 3]))
  const names = new Map(l.circles.map((c) => [c.id, c.node.label]))
  const regionName = (sets: string[]): string => {
    const n = sets.map((s) => names.get(s) ?? s)
    return n.length === 1 ? t('diagram.venn.only', { a: n[0] }) : n.length === 2 ? t('diagram.venn.two', { a: n[0], b: n[1] }) : t('diagram.venn.three', { a: n[0], b: n[1], c: n[2] })
  }
  // la región señalada: «set:<id>» es el círculo entero; si no, la clave de la región (sus conjuntos). Solo con sus
  // conjuntos a la vista (con `build`, lo que aún no ha salido no se sombrea)
  const shown = (sets: string[]): boolean => sets.every((id) => !unrevealed(id, p))
  const hovered = hover?.startsWith('set:') ? { members: [hover.slice(4)], whole: true } : hover !== null ? { members: hover.split('&').filter(Boolean), whole: false } : undefined
  const shaded = hovered && shown(hovered.members) ? hovered : undefined
  const loops = useMemo(() => l.circles.map((c) => circleLoopInk(c.r, `${p.blockId}:conjunto:${c.id}`)), [l, p.blockId])
  const lit = (id: string): boolean => p.hl?.nodes.has(id) ?? false
  const loopPad = circleLoopPad()
  // el rótulo «fuera de los conjuntos», cuando ya ha salido algo de fuera
  const outsideShown = l.outside?.items.some((it) => !unrevealed(it.id, p)) ?? false
  return (
    <>
      <svg width={l.width} height={l.height} className="absolute inset-0 overflow-visible">
        <defs>
          {l.circles.map((c) => (
            <clipPath key={c.id} id={`${uid}-c${c.index}`}>
              <circle cx={c.cx} cy={c.cy} r={c.r} />
            </clipPath>
          ))}
          {shaded && !shaded.whole && (
            <mask id={`${uid}-m`} maskUnits="userSpaceOnUse" x={0} y={0} width={l.width} height={l.height}>
              <rect width={l.width} height={l.height} fill="#fff" />
              {l.circles.filter((c) => !shaded.members.includes(c.id)).map((c) => <circle key={c.id} cx={c.cx} cy={c.cy} r={c.r} fill="#000" />)}
            </mask>
          )}
        </defs>
        {l.circles.map((c) => (
          <g key={c.id} style={partStyle(c.id, p, 1)}>
            <motion.circle
              cx={c.cx}
              cy={c.cy}
              r={c.r}
              fill={wash(colors[c.index], (lit(c.id) ? 24 : 15) + (dark ? 6 : 0))}
              style={{ transition: 'fill 300ms' }}
              initial={p.animate ? { scale: 0.92, opacity: 0 } : false}
              animate={p.run ? { scale: 1, opacity: 1 } : undefined}
              transition={{ duration: 0.5, delay: p.animate ? c.index * 0.15 : 0, ease: [0.2, 0.7, 0.2, 1] }}
              onPointerEnter={() => onHover(`set:${c.id}`)}
              onPointerLeave={() => onHover(null)}
              {...ask(c.id, c.node.label, p)}
            />
          </g>
        ))}
        {shaded && shaded.members.length > 0 && (
          <g mask={shaded.whole ? undefined : `url(#${uid}-m)`} pointerEvents="none">
            {nestClips(shaded.members.map((id) => l.circles.find((c) => c.id === id)?.index).filter((i): i is number => i !== undefined), uid, <rect width={l.width} height={l.height} fill={wash('var(--text)', 9)} />)}
          </g>
        )}
      </svg>
      {l.circles.map((c, i) => (
        <div key={`o-${c.id}`} style={partStyle(c.id, p, 1)} {...muted(c.id, p)}>
          <Ink drawing={loops[i]} color="var(--text2)" alpha={0.8} draw={!p.printing} drawKey={`diag:${p.blockId}:conjunto:${c.id}`} delay={p.animate ? 250 + c.index * 220 : 0} className="ink-fixed" style={{ left: c.cx - c.r - loopPad, top: c.cy - c.r - loopPad, width: loops[i].w, height: loops[i].h }} />
        </div>
      ))}
      {l.circles.map((c) => (
        <Label key={`t-${c.id}`} box={c.title} look={partStyle(c.id, p)} className={cx('text-center font-serif text-[16px] leading-[21px] font-semibold text-text', c.below ? '' : 'flex items-end justify-center')} part={ask(c.id, c.node.label, p)}>
          <span onPointerEnter={() => onHover(`set:${c.id}`)} onPointerLeave={() => onHover(null)}>
            <RichText text={c.node.label} inline />
          </span>
        </Label>
      ))}
      {l.regions.map((g) =>
        shown(g.sets) ? (
          <div
            key={`r-${g.key}`}
            className="absolute rounded-[10px]"
            style={at(g.box)}
            onPointerEnter={() => onHover(g.key)}
            onPointerLeave={() => onHover(null)}
            data-ask-part={`region:${g.key}`}
            data-ask-label={regionName(g.sets)}
          />
        ) : null
      )}
      {l.items.map((it, i) => (
        <div key={it.id} className="absolute" style={{ ...at(it.box), ...partStyle(it.id, p) }} {...muted(it.id, p)}>
          <motion.div
            className="viz-label grid h-full w-full place-items-center text-center"
            initial={p.animate ? { opacity: 0, y: 4 } : false}
            animate={p.run ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.35, delay: p.animate ? 0.55 + Math.min(i, 16) * 0.05 : 0 }}
            onPointerEnter={() => onHover(it.region)}
            onPointerLeave={() => onHover(null)}
            {...ask(it.id, it.node.label, p)}
          >
            <span className={cx('text-[13px] leading-[17px] break-words transition-colors duration-300', lit(it.id) ? 'text-accent-text font-semibold' : 'text-text')}>
              <RichText text={it.node.label} inline />
            </span>
          </motion.div>
        </div>
      ))}
      {l.outside && (
        <>
          <div className="absolute t-footnote text-text3" style={{ ...at(l.outside.label), ...(outsideShown ? fade : { opacity: 0, visibility: 'hidden', ...fade }) }} aria-hidden={outsideShown ? undefined : true}>{t('diagram.outside')}</div>
          {l.outside.items.map((it) => (
            <div
              key={it.id}
              className={cx('viz-label absolute grid place-items-center rounded-full border-[0.5px] border-line bg-surface px-2.5 text-center text-[13px] leading-[17px]', lit(it.id) ? 'text-accent-text font-semibold' : 'text-text')}
              style={{ ...at(it.box), ...partStyle(it.id, p) }}
              {...ask(it.id, it.node.label, p)}
            >
              <RichText text={it.node.label} inline />
            </div>
          ))}
        </>
      )}
      {p.hl && p.step !== null && l.circles.filter((c) => p.hl!.focus.has(c.id)).slice(0, 3).map((c, i) => {
        const ring = circleLoopInk(c.r + 9, `${p.blockId}:rodeo:${c.id}`, 2.2, 1.1)
        const pad = circleLoopPad(2.2)
        return <Ink key={`${p.step}:${c.id}`} drawing={ring} color={BRICK} delay={i * 180} draw={!p.printing} className="ink-fixed" style={{ left: c.cx - c.r - 9 - pad, top: c.cy - c.r - 9 - pad, width: ring.w, height: ring.h, zIndex: 3 }} />
      })}
      <StepRings boxes={[...l.items, ...(l.outside?.items ?? [])].map((it) => ({ id: it.id, box: grow(it.box, 2) }))} p={p} />
    </>
  )
}

/** Un rectángulo recortado por varios círculos a la vez (su intersección). */
function nestClips(indexes: number[], uid: string, inner: ReactNode): ReactNode {
  return indexes.reduceRight<ReactNode>((acc, i) => <g clipPath={`url(#${uid}-c${i})`}>{acc}</g>, inner)
}

// MARK: Mapa mental

const curvePath = (pts: Pt[]): string => pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('')

export function MindmapView({ layout: l, ...p }: FormViewProps & { layout: MindmapLayout }) {
  const root = l.root
  const loop = useMemo(() => ovalInk(root.rx, root.ry, `${p.blockId}:centro`), [root.rx, root.ry, p.blockId])
  const pad = circleLoopPad(1.8)
  const color = (name: string | undefined): string => (name ? vizColor(name) : INK)
  return (
    <>
      <svg width={l.width} height={l.height} className="absolute inset-0 overflow-visible">
        {l.branches.map((x) => {
          const c = color(x.color)
          const w = x.depth === 1 ? 3 : 2
          return (
            <g key={x.id} style={partStyle(x.id, p)} {...ask(x.id, x.node.label, p)}>
              <motion.path d={curvePath(x.curve)} fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" initial={p.animate ? { pathLength: 0 } : false} animate={p.run ? { pathLength: 1 } : undefined} transition={{ duration: 0.45, delay: p.animate ? x.order : 0, ease: [0.4, 0, 0.2, 1] }} />
              <motion.path d={curvePath(x.underline)} fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" initial={p.animate ? { pathLength: 0 } : false} animate={p.run ? { pathLength: 1 } : undefined} transition={{ duration: 0.35, delay: p.animate ? x.order + 0.4 : 0, ease: [0.4, 0, 0.2, 1] }} />
            </g>
          )
        })}
      </svg>
      <div className="absolute" style={{ left: root.cx - root.rx, top: root.cy - root.ry, width: root.rx * 2, height: root.ry * 2, ...partStyle(root.id, p) }} {...muted(root.id, p)}>
        <motion.div
          className="h-full w-full rounded-[50%] bg-surface"
          style={{ boxShadow: `inset 0 0 0 ${Math.ceil(root.ry)}px ${wash(INK, 16)}` }}
          initial={p.animate ? { scale: 0.9, opacity: 0 } : false}
          animate={p.run ? { scale: 1, opacity: 1 } : undefined}
          transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
          {...ask(root.id, root.node.label, p)}
        />
      </div>
      <div style={partStyle(root.id, p)} {...muted(root.id, p)}>
        <Ink drawing={loop} color="var(--text)" alpha={0.75} draw={!p.printing} drawKey={`diag:${p.blockId}:centro`} className="ink-fixed" style={{ left: root.cx - root.rx - pad, top: root.cy - root.ry - pad, width: loop.w, height: loop.h }} />
      </div>
      <Label box={root.label} look={partStyle(root.id, p)} className="grid place-items-center text-center font-serif text-[17px] leading-[22px] font-semibold text-text" part={ask(root.id, root.node.label, p)}>
        <RichText text={root.node.label} inline />
      </Label>
      {l.branches.map((x) => (
        <div key={`t-${x.id}`} className="absolute" style={{ ...at(x.label), ...partStyle(x.id, p) }} {...muted(x.id, p)}>
          <motion.div
            className={cx('viz-label h-full w-full', x.side > 0 ? 'text-left' : 'text-right')}
            initial={p.animate ? { opacity: 0 } : false}
            animate={p.run ? { opacity: 1 } : undefined}
            transition={{ duration: 0.3, delay: p.animate ? x.order + 0.45 : 0 }}
            {...ask(x.id, x.node.label, p)}
          >
            <div className={cx('break-words text-text', x.depth === 1 ? 'text-[15px] leading-[20px] font-semibold' : 'text-[14px] leading-[19px]')}>
              <RichText text={x.node.label} inline />
            </div>
          </motion.div>
        </div>
      ))}
      {l.branches.map((x) =>
        x.detail && x.node.detail ? (
          <Label key={`d-${x.id}`} box={x.detail} look={partStyle(x.id, p)} className={cx('text-[12px] leading-4 text-text2', x.side > 0 ? 'text-left' : 'text-right')} part={muted(x.id, p)}>
            <RichText text={x.node.detail} inline />
          </Label>
        ) : null
      )}
      <StepRings boxes={[{ id: root.id, box: { x: root.cx - root.rx, y: root.cy - root.ry, w: root.rx * 2, h: root.ry * 2 } }, ...l.branches.map((x) => ({ id: x.id, box: grow(x.detail ? unite(x.label, x.detail) : x.label, 4) }))]} p={p} />
    </>
  )
}

const unite = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
