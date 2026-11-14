// Fórmula estructural (`structure`): la molécula de una SMILES dibujada en tinta como en la pizarra, enlace a enlace en el
// orden en que la trazaría una mano, con las letras de los heteroátomos en sus colores de papel. Se pasa por cada átomo
// (ratón o ← →) para ver qué es; los grupos funcionales se resaltan con un pincel plano y el elegido se rodea a mano en
// ladrillo mientras el resto se apaga; con `steps`, un recorrido guiado. Esquelética, semidesarrollada o desarrollada; las
// reacciones llevan «+» y su flecha. Al imprimir, quieto. Si la SMILES no se lee, una ficha con el motivo y la fórmula.
// En el enunciado de un ejercicio sin resolver no dice lo que se pregunta: ni título, ni fórmula, ni masa molar, ni los
// nombres de los grupos (los que reconoce Aula no se buscan), ni el recorrido.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Hexagon } from 'lucide-react'
import { Button, Icon, IconButton, SegmentedTabs, cx, useTheme } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import type { StructureStyle } from '@shared/schema/structure'
import { ALL_ELEMENTS, localizedElementName } from '@engine/chem/elements'
import { smilesErrorMessage } from '@engine/chem/smiles-messages'
import type { SmilesMolecule } from '@engine/chem/smiles'
import type { Depiction, DepictLabel } from '@engine/chem/structure-depict'
import { RichText } from '@renderer/lib/RichText'
import type { BlockProps } from '../types'
import { StepScrubber } from './DiagramBlock'
import { arrowPaths, clusters, formulaCe, handStroke, ringPath, shownGroups, stepAtoms, structureView, type ShownGroup } from './lib/structureView'
import { cpkColor, seriesColor, vizColor, wash } from './shared/colors'
import { canvasMeasure, useFontsReady } from './shared/measure'
import { usePanZoom } from './shared/usePanZoom'
import { Caption, ZoomControls, canvasWell, useInView, useInk, useSize } from './shared/ui'

const PAD = 22
/** Medida con la letra real de la interfaz. */
const measure = (text: string, size: number, bold?: boolean): number => canvasMeasure(text, size, !!bold)
const MIN_LABEL_SCALE = 11 / 15

/** Tinta de la letra de un átomo: el CPK de papel mezclado con la del texto (se lee en claro y en oscuro; nada parece un botón). */
function atomInk(element: string, dark: boolean, added: boolean): string {
  if (added || element === 'H') return 'var(--text2)'
  if (element === 'C' || element === '*') return 'var(--text)'
  // el azul del N, un poco más hacia el cian (el de la tabla roza el violeta al suavizar los bordes de la letra), y el rojo
  // del O, carmín: el ladrillo es la luz de Aula y una letra no debe parecer un botón
  const base = element === 'N' ? '#2f6aa3' : element === 'O' ? (dark ? '#d77a82' : '#ad3b45') : cpkColor(element, dark)
  return `color-mix(in oklab, ${base} ${dark ? 66 : 76}%, var(--text))`
}

export default function StructureBlock({ block, ctx }: BlockProps<BlockOf<'structure'>>) {
  const { t, i18n } = useTranslation('visual')
  const ink = useInk(ctx.hue)
  const { dark, reducedMotion } = useTheme()
  const printing = ctx.mode === 'print'
  // en un enunciado sin resolver: nada que nombre la molécula o sus grupos
  const inPrompt = !!ctx.inPrompt
  const title = inPrompt ? undefined : block.title
  const fonts = useFontsReady()
  const [style, setStyle] = useState<StructureStyle>(block.style)
  useEffect(() => setStyle(block.style), [block.style])
  // se vuelve a medir cuando cargan las letras
  const view = useMemo(() => (fonts ? structureView(block, style, measure) : structureView(block, style, measure)), [block, style, fonts])
  const isReaction = view.ok && !!view.parsed.species
  const groups = useMemo(() => (view.ok ? shownGroups(inPrompt ? { ...block, autoGroups: false } : block, view.parsed.molecule, isReaction) : []), [view, block, isReaction, inPrompt])
  const steps = useMemo(() => (inPrompt ? [] : block.steps), [inPrompt, block.steps])
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [step, setStep] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  // medidas: a su tamaño natural si cabe; si no, se encoge (las letras no bajan de 11 px) y se mueve
  const [box, size] = useSize<HTMLDivElement>()
  const d = view.ok ? view.depiction : undefined
  const cw = d ? d.bounds.w + PAD * 2 : 1
  const ch = d ? d.bounds.h + PAD * 2 : 1
  const maxH = printing ? 520 : ctx.mode === 'chat' ? 320 : 460
  const avail = Math.max(160, size.width)
  let fit = Math.min(ctx.mode === 'lesson' ? 1.25 : 1, avail / cw, maxH / ch)
  if (!printing) fit = Math.max(fit, MIN_LABEL_SCALE)
  const fitted = useMemo(() => ({ width: cw * fit, height: ch * fit }), [cw, ch, fit])
  const viewport = useMemo(() => ({ width: avail, height: Math.max(printing ? 0 : 150, Math.min(ch * fit, maxH)) }), [avail, ch, fit, maxH, printing])
  const viewRef = useRef<HTMLDivElement>(null)
  const pz = usePanZoom(viewRef, fitted, viewport, { enabled: !printing, maxScale: 4 })
  const seen = useInView(box, true, '-40px')
  const animate = !printing && !reducedMotion
  const run = !animate || seen

  // un solo modelo de selección: el grupo pulsado o el paso del recorrido
  const active = useMemo<number[] | null>(() => {
    if (!view.ok) return null
    if (step !== null && steps[step]) return stepAtoms(steps[step], groups, view.parsed.molecule.atoms.length)
    const g = groups.find((x) => x.key === activeGroup)
    return g ? g.atoms : null
  }, [view, step, steps, groups, activeGroup])
  const activeSet = useMemo(() => (active ? new Set(active) : null), [active])

  const lang = i18n.language
  const elementName = useCallback((symbol: string): string => {
    const e = ALL_ELEMENTS.find((x) => x.symbol === symbol)
    return e ? localizedElementName(e, lang) : symbol
  }, [lang])
  const groupLabel = (g: ShownGroup): string => g.label ?? (g.kind ? t(`structure.groupKinds.${g.kind}`) : '')
  const groupColor = (g: ShownGroup, i: number): string => (g.color ? vizColor(g.color) : seriesColor(i))

  const pickGroup = (key: string): void => {
    setStep(null)
    setActiveGroup((k) => (k === key ? null : key))
    ctx.onInteract?.(block.id, 'structure-group')
  }
  const goStep = (k: number): void => {
    setActiveGroup(null)
    setStep(Math.max(0, Math.min(steps.length - 1, k)))
    ctx.onInteract?.(block.id, 'structure-step')
  }

  if (!view.ok || !d) {
    return (
      <section className="flex flex-col gap-3" style={ink} aria-label={[title, t('structure.broken')].filter(Boolean).join('. ')}>
        <StructureHeader eyebrow={t('structure.eyebrow')} title={title} />
        <BrokenCard error={view.ok ? undefined : smilesErrorMessage(view.error, lang.startsWith('es') ? 'es' : 'en')} smiles={block.smiles} formula={inPrompt ? undefined : block.formula} />
        <Caption text={block.caption} />
      </section>
    )
  }

  const mol = view.mol
  const formula = inPrompt ? undefined : formulaCe(view.parsed, block.reversible)
  const showFormula = block.showFormula && !!formula
  const massText = formula?.mass !== undefined ? new Intl.NumberFormat(ctx.language || lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(formula.mass) : undefined
  const s = fit * pz.t.scale
  const showZoom = !printing && (fit < 0.98 || pz.t.scale > 1.001)
  const ariaLabel = [title, block.alt, formula && !isReaction ? formula.ce : undefined].filter(Boolean).join('. ') || t('structure.eyebrow')
  const showStyles = !printing && !isReaction && view.styles.length > 1
  const visibleAtoms = d.atoms.map((a, i) => ({ ...a, i })).filter((a) => !a.hidden)
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!visibleAtoms.length) return
    const at = visibleAtoms.findIndex((a) => a.i === hover)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      setHover(visibleAtoms[(at + 1) % visibleAtoms.length].i)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      setHover(visibleAtoms[(at - 1 + visibleAtoms.length) % visibleAtoms.length].i)
    } else if (e.key === 'Escape') setHover(null)
  }

  return (
    <section className="flex flex-col gap-3" style={ink} aria-label={ariaLabel}>
      <StructureHeader
        eyebrow={isReaction ? t('structure.reactionEyebrow') : t('structure.eyebrow')}
        title={title}
        actions={showStyles ? (
          <SegmentedTabs
            size="sm"
            value={view.style}
            items={view.styles.map((st) => ({ id: st, label: t(`structure.styles.${st}`) }))}
            onChange={(st) => { setStyle(st); ctx.onInteract?.(block.id, 'structure-style') }}
          />
        ) : undefined}
      />
      <div ref={box} className="w-full">
        {/* el lienzo y lo que se mueve y se amplía: ahí se marca para preguntar al tutor (los botones de grupo quedan fuera) */}
        <div
          ref={viewRef}
          data-ask-canvas=""
          role="group"
          aria-label={ariaLabel}
          tabIndex={printing ? undefined : 0}
          onKeyDown={onKey}
          onFocus={() => {
            if (hover === null && visibleAtoms.length) setHover(visibleAtoms[0].i)
          }}
          onBlur={() => setHover(null)}
          className={cx(canvasWell, 'outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-wash)]', pz.pannable && 'viz-grab')}
          style={{ height: viewport.height + 2, touchAction: pz.pannable ? 'none' : undefined }}
          {...pz.bind}
        >
          {size.width > 0 && (
            <div
              data-ask-surface=""
              className="absolute left-0 top-0 origin-top-left"
              style={{ width: cw, height: ch, transform: `translate(${pz.t.x}px, ${pz.t.y}px) scale(${s})`, transition: pz.smooth && !pz.dragging ? 'transform 260ms cubic-bezier(.2,.7,.2,1)' : undefined }}
            >
              <StructureDrawing
                d={d}
                mol={mol}
                width={cw}
                height={ch}
                dark={dark}
                groups={groups}
                groupColor={groupColor}
                groupLabel={groupLabel}
                askGroups={!inPrompt}
                active={active}
                activeSet={activeSet}
                hover={hover}
                setHover={setHover}
                animate={animate}
                run={run}
                seed={block.id}
                atomAsk={(i) => (mol.atoms[i]?.added ? elementName('H') : t('structure.atomAsk', { name: atomName(mol, i, elementName, t('structure.rGroup')), n: i + 1 }))}
              />
              {hover !== null && !d.atoms[hover]?.hidden && <AtomTip d={d} mol={mol} i={hover} scale={s} elementName={elementName} />}
            </div>
          )}
          {showZoom && (
            <div className="absolute right-2 top-2" onPointerDown={(e) => e.stopPropagation()}>
              <ZoomControls scale={pz.t.scale} onZoom={pz.zoomBy} onReset={pz.reset} max={4} />
            </div>
          )}
        </div>
      </div>
      {groups.length > 0 && !inPrompt && (
        <GroupChips groups={groups} groupColor={groupColor} groupLabel={groupLabel} active={step === null ? activeGroup : null} onPick={pickGroup} printing={printing} />
      )}
      {!printing && step === null && activeGroup && <GroupNote g={groups.find((g) => g.key === activeGroup)} label={groupLabel} reduced={reducedMotion} />}
      {steps.length > 0 && (
        printing ? (
          <ol className="flex flex-col gap-1.5 m-0 p-0 list-none">
            {steps.map((st, i) => (
              <li key={i} className="flex gap-3 t-callout">
                <span className="font-serif tabular text-text3 w-5 text-right">{i + 1}.</span>
                <div className="min-w-0 flex-1"><RichText text={st.md} /></div>
              </li>
            ))}
          </ol>
        ) : (
          <StepsBar steps={steps} step={step} onGo={goStep} onAll={() => setStep(null)} reduced={reducedMotion} />
        )
      )}
      {(showFormula || !printing) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {showFormula && formula ? (
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-text2">
              <span className="font-serif text-[17px] text-text">
                <RichText text={`$\\ce{${formula.ce}}$`} inline />
              </span>
              {massText && <span className="t-footnote tabular">· {t('structure.molarMass', { mass: massText })}</span>}
            </div>
          ) : <span />}
          {!printing && mol.atoms.length > 1 && (
            <span className="t-footnote text-text3 inline-flex items-center gap-1.5">
              <Icon name="cursor" size={12} />
              {t('structure.keysHint')}
            </span>
          )}
        </div>
      )}
      <Caption text={block.caption} />
    </section>
  )
}

/** Cabecera como la de los demás visuales, con el hexágono del benceno de etiqueta. */
function StructureHeader({ eyebrow, title, actions }: { eyebrow: string; title?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 t-footnote font-medium text-text3">
          <Hexagon size={13} strokeWidth={1.8} aria-hidden />
          <span>{eyebrow}</span>
        </div>
        {title && (
          <h3 className="font-serif text-[19px] leading-[26px] font-medium text-text mt-0.5 tracking-[-0.2px]">
            <RichText text={title} inline />
          </h3>
        )}
      </div>
      {actions && <div className="flex items-center gap-1.5 flex-wrap">{actions}</div>}
    </div>
  )
}

/** Nombre de un átomo para leerlo («Oxígeno», «Grupo R»). */
function atomName(mol: SmilesMolecule, i: number, elementName: (s: string) => string, rGroup: string): string {
  const el = mol.atoms[i]?.element ?? ''
  return el === '*' ? rGroup : elementName(el)
}

// MARK: El dibujo

export interface DrawingProps {
  d: Depiction
  mol: SmilesMolecule
  width: number
  height: number
  dark: boolean
  groups: ShownGroup[]
  groupColor: (g: ShownGroup, i: number) => string
  groupLabel: (g: ShownGroup) => string
  /** Los grupos se pueden marcar con su nombre (no en un enunciado sin resolver: el nombre sería la respuesta). */
  askGroups?: boolean
  active: number[] | null
  activeSet: Set<number> | null
  hover: number | null
  setHover: (i: number | null) => void
  animate: boolean
  run: boolean
  seed: string
  atomAsk: (i: number) => string
}

export function StructureDrawing({ d, mol, width, height, dark, groups, groupColor, groupLabel, askGroups = true, active, activeSet, hover, setHover, animate, run, seed, atomAsk }: DrawingProps) {
  const ox = PAD - d.bounds.x
  const oy = PAD - d.bounds.y
  const order = d.drawOrder
  const step = Math.min(0.075, 1.8 / Math.max(1, order.length))
  const drawAt = new Map(order.map((bi, k) => [bi, k * step]))
  // cada letra aparece cuando llega su primer enlace
  const labelDelay = (atom: number): number => {
    let best = Infinity
    for (const b of d.bonds) if (b.a === atom || b.b === atom) best = Math.min(best, (drawAt.get(b.index) ?? 0) + 0.12)
    return Number.isFinite(best) ? best : 0.1
  }
  const end = order.length * step + 0.25
  const dimmed = (on: boolean): number => (activeSet && !on ? 0.3 : 1)
  const fade = { transition: 'opacity 260ms' }
  const rings = useMemo(() => (active && active.length ? clusters(active, d, mol).map((c, k) => ringPath(c, d, `${seed}:${c.join(',')}:${k}`)) : []), [active, d, mol, seed])

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 overflow-visible" aria-hidden>
      <g transform={`translate(${ox} ${oy})`}>
        {/* el pincel plano de los grupos, debajo de todo */}
        {groups.map((g, gi) => {
          const color = groupColor(g, gi)
          const set = new Set(g.atoms)
          const on = activeSet ? g.atoms.every((a) => activeSet.has(a)) : false
          const strength = activeSet ? (on ? (dark ? 0.42 : 0.34) : 0.1) : dark ? 0.28 : 0.22
          const w = d.bondPx * 0.52
          return (
            <motion.g
              key={g.key}
              data-ask-part={askGroups ? `group-${g.key}` : undefined}
              data-ask-label={askGroups ? groupLabel(g) : undefined}
              initial={animate ? { opacity: 0 } : false}
              animate={run ? { opacity: 1 } : undefined}
              transition={{ duration: 0.5, delay: animate ? end + 0.1 + gi * 0.06 : 0 }}
            >
              <g opacity={strength} style={{ transition: 'opacity 260ms' }}>
                {d.bonds.filter((b) => set.has(b.a) && set.has(b.b)).map((b) => (
                  <line key={b.index} x1={d.atoms[b.a].x} y1={d.atoms[b.a].y} x2={d.atoms[b.b].x} y2={d.atoms[b.b].y} stroke={color} strokeWidth={w} strokeLinecap="round" />
                ))}
                {g.atoms.map((a) => (
                  <circle key={a} cx={d.atoms[a].x} cy={d.atoms[a].y} r={w / 2} fill={color} />
                ))}
              </g>
            </motion.g>
          )
        })}
        {hover !== null && !d.atoms[hover]?.hidden && <circle cx={d.atoms[hover].x} cy={d.atoms[hover].y} r={d.fontPx * 0.95} fill="var(--accent-wash)" />}
        {/* enlaces: tinta que se traza en el orden de la mano */}
        {d.bonds.map((b) => {
          const on = !activeSet || (activeSet.has(b.a) && activeSet.has(b.b))
          const delay = drawAt.get(b.index) ?? 0
          return (
            <g key={b.index} opacity={dimmed(on)} style={fade}>
              {b.segments.map((seg, k) => {
                const common = { d: handStroke(seg, b.index * 7 + k), fill: 'none', stroke: 'var(--text)', strokeWidth: 1.6, strokeLinecap: 'round' as const }
                if (!animate) return <path key={k} {...common} />
                return <motion.path key={k} {...common} initial={{ pathLength: 0 }} animate={run ? { pathLength: 1 } : undefined} transition={{ duration: 0.3, delay: delay + k * 0.07, ease: [0.4, 0, 0.2, 1] }} />
              })}
            </g>
          )
        })}
        {/* círculos de los anillos aromáticos, al final */}
        {d.circles.map((c, k) => {
          const on = !activeSet || (mol.rings[c.ring] ?? []).every((a) => activeSet.has(a))
          const r = c.r
          const path = `M${c.cx + r} ${c.cy} A${r} ${r} 0 1 1 ${c.cx - r} ${c.cy} A${r} ${r} 0 1 1 ${c.cx + r} ${c.cy}`
          const common = { d: path, fill: 'none', stroke: 'var(--text)', strokeWidth: 1.4, strokeLinecap: 'round' as const, opacity: on ? 0.9 : 0.3 }
          if (!animate) return <path key={k} {...common} />
          return <motion.path key={k} {...common} initial={{ pathLength: 0 }} animate={run ? { pathLength: 1 } : undefined} transition={{ duration: 0.55, delay: end + k * 0.12, ease: [0.4, 0, 0.2, 1] }} style={fade} />
        })}
        {/* símbolos de la reacción */}
        {d.symbols.map((sy, k) => {
          const delay = animate ? end * 0.5 + k * 0.1 : 0
          if (sy.kind === 'plus') {
            const h = sy.size
            return (
              <motion.path key={k} d={`M${sy.x - h} ${sy.y} L${sy.x + h} ${sy.y} M${sy.x} ${sy.y - h} L${sy.x} ${sy.y + h}`} stroke="var(--text2)" strokeWidth={1.6} strokeLinecap="round" fill="none"
                initial={animate ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 0.3, delay }} />
            )
          }
          const x2 = sy.x2 ?? sy.x
          return (
            <motion.g key={k} initial={animate ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 0.4, delay }}>
              {arrowPaths(sy.x, x2, sy.y, sy.kind === 'equilibrium' ? 'equilibrium' : 'arrow', sy.size).map((p, j) => (
                <path key={j} d={p} stroke="var(--text)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              ))}
              {sy.above && <text x={(sy.x + x2) / 2} y={sy.y - d.fontPx * 0.75} textAnchor="middle" fontSize={d.fontPx * 0.8} fill="var(--text2)">{sy.above}</text>}
              {sy.below && <text x={(sy.x + x2) / 2} y={sy.y + d.fontPx * 1.3} textAnchor="middle" fontSize={d.fontPx * 0.8} fill="var(--text2)">{sy.below}</text>}
            </motion.g>
          )
        })}
        {/* letras de los átomos */}
        {d.labels.map((l) => {
          const on = !activeSet || activeSet.has(l.atom)
          return (
            <motion.g key={l.atom} initial={animate ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 0.3, delay: animate ? labelDelay(l.atom) : 0 }}>
              <g opacity={dimmed(on)} style={fade}>
                <LabelText l={l} color={atomInk(mol.atoms[l.atom].element, dark, !!mol.atoms[l.atom].added)} />
              </g>
            </motion.g>
          )
        })}
        {d.notes.map((n, k) => (
          <motion.text key={k} x={n.x} y={n.y + n.size * 0.35} textAnchor="middle" fontSize={n.size} className="font-serif italic" fill="var(--text2)"
            initial={animate ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 0.3, delay: animate ? end : 0 }}>
            {n.text}
          </motion.text>
        ))}
        {/* el rodeado a mano del grupo elegido, en ladrillo */}
        <AnimatePresence>
          {rings.map((p, k) => (
            <motion.path key={p} d={p} fill="none" stroke="var(--pigment-brick, var(--accent))" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
              initial={animate ? { pathLength: 0, opacity: 1 } : false} animate={{ pathLength: 1, opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: animate ? 0.5 : 0, delay: animate ? k * 0.12 : 0, ease: [0.4, 0, 0.2, 1] }} />
          ))}
        </AnimatePresence>
        {/* zonas para pasar el ratón (y el contrato «marca y pregunta al tutor») */}
        {d.atoms.map((a, i) => {
          if (a.hidden) return null
          const l = d.labels.find((x) => x.atom === i)
          return (
            <g key={i} data-ask-part={`atom-${i + 1}`} data-ask-label={atomAsk(i)} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} style={{ cursor: 'default' }}>
              {l ? <rect x={l.box.x - 3} y={l.box.y - 3} width={l.box.w + 6} height={l.box.h + 6} rx={6} fill="transparent" /> : <circle cx={a.x} cy={a.y} r={d.fontPx * 0.8} fill="transparent" />}
            </g>
          )
        })}
      </g>
    </svg>
  )
}

/** Las piezas de una letra (elemento, H, subíndice, carga, isótopo) en su sitio. */
function LabelText({ l, color }: { l: DepictLabel; color: string }) {
  return (
    <text fill={color} fontWeight={500} style={{ fontFeatureSettings: '"tnum"' }}>
      {l.parts.map((p, k) => (
        <tspan key={k} x={p.x} y={p.y} fontSize={p.size} fontWeight={p.role === 'element' || p.role === 'hydrogen' ? 500 : 450}>
          {p.text}
        </tspan>
      ))}
    </text>
  )
}

/** Ficha del átomo bajo el ratón: su nombre, cuántos H lleva, su carga y su número. */
function AtomTip({ d, mol, i, scale, elementName }: { d: Depiction; mol: SmilesMolecule; i: number; scale: number; elementName: (s: string) => string }) {
  const { t } = useTranslation('visual')
  const a = mol.atoms[i]
  const p = d.atoms[i]
  const ox = PAD - d.bounds.x
  const oy = PAD - d.bounds.y
  const name = a.element === '*' ? t('structure.rGroup') : `${elementName(a.element)} (${a.element})`
  const bits = [
    a.added ? undefined : t('structure.atom', { n: i + 1 }),
    mol.hydrogens[i] > 0 ? t('structure.hydrogens', { count: mol.hydrogens[i] }) : undefined,
    a.charge ? t('structure.charge', { charge: `${Math.abs(a.charge) > 1 ? Math.abs(a.charge) : ''}${a.charge > 0 ? '+' : '−'}` }) : undefined,
    a.isotope ? t('structure.isotope', { mass: a.isotope }) : undefined
  ].filter(Boolean)
  // la ficha no crece con el zoom
  return (
    <div className="absolute pointer-events-none z-10" style={{ left: p.x + ox, top: p.y + oy - d.fontPx * 1.1, transform: `translate(-50%, -100%) scale(${1 / Math.max(0.5, scale)})`, transformOrigin: '50% 100%' }}>
      <div className="rounded-[12px] bg-raised border-[0.5px] border-line shadow-[var(--e2)] px-3 py-1.5 whitespace-nowrap" role="status" aria-live="polite">
        <div className="t-callout font-medium text-text">{name}</div>
        {bits.length > 0 && <div className="t-caption text-text3">{bits.join(' · ')}</div>}
      </div>
    </div>
  )
}

// MARK: Grupos y pasos

export function GroupChips({ groups, groupColor, groupLabel, active, onPick, printing }: { groups: ShownGroup[]; groupColor: (g: ShownGroup, i: number) => string; groupLabel: (g: ShownGroup) => string; active: string | null; onPick: (key: string) => void; printing: boolean }) {
  const { t } = useTranslation('visual')
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('structure.groups')}>
      {groups.map((g, i) => {
        const on = active === g.key
        const color = groupColor(g, i)
        const content = (
          <>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: wash(color, 70), boxShadow: 'inset 0 0 0 0.5px var(--line-strong)' }} />
            <RichText text={groupLabel(g)} inline />
          </>
        )
        if (printing) return <span key={g.key} className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full t-ui bg-fill1 text-text2">{content}</span>
        return (
          <button
            key={g.key}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(g.key)}
            className={cx('inline-flex items-center gap-1.5 h-7 px-3 rounded-full t-ui font-medium whitespace-nowrap transition-colors outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-wash)]', on ? 'bg-accent-wash text-accent-text' : 'bg-fill2 text-text2 hover:bg-fill3 hover:text-text')}
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}

function GroupNote({ g, label, reduced }: { g?: ShownGroup; label: (g: ShownGroup) => string; reduced: boolean }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {g?.md && (
        <motion.div key={g.key} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -4 }} transition={{ duration: 0.22 }}
          className="rounded-[14px] bg-fill1 px-4 py-3" aria-live="polite">
          <div className="t-headline text-text"><RichText text={label(g)} inline /></div>
          <div className="t-reading text-[16px] leading-[25px] text-text"><RichText text={g.md} /></div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function StepsBar({ steps, step, onGo, onAll, reduced }: { steps: { md: string }[]; step: number | null; onGo: (k: number) => void; onAll: () => void; reduced: boolean }) {
  const { t } = useTranslation('visual')
  const n = steps.length
  const cur = step !== null ? steps[step] : undefined
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <IconButton size="sm" label={t('structure.steps.prev')} onClick={() => onGo((step ?? 0) - 1)} disabled={(step ?? 0) <= 0}>
          <Icon name="chevron-left" size={15} />
        </IconButton>
        {step === null ? (
          <Button size="sm" variant="secondary" icon={<Icon name="play" size={13} />} onClick={() => onGo(0)}>
            {t('structure.steps.start')}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onAll}>
            {t('structure.steps.all')}
          </Button>
        )}
        <IconButton size="sm" label={t('structure.steps.next')} onClick={() => onGo((step ?? -1) + 1)} disabled={(step ?? -1) >= n - 1}>
          <Icon name="chevron-right" size={15} />
        </IconButton>
        <StepScrubber n={n} step={step} onGo={onGo} />
        <span className="t-footnote tabular text-text3 whitespace-nowrap">{step !== null ? t('structure.steps.stepOf', { k: step + 1, n }) : t('structure.steps.count', { count: n })}</span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {cur && step !== null && (
          <motion.div key={step} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -4 }} transition={{ duration: 0.22 }}
            className="flex gap-3 rounded-[14px] bg-fill1 px-4 py-3" aria-live="polite">
            <span className="font-serif text-[20px] leading-7 tabular text-text3">{step + 1}.</span>
            <div className="min-w-0 flex-1 t-reading text-[16px] leading-[25px] text-text"><RichText text={cur.md} /></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// MARK: Sin dibujo

/** Ficha tranquila cuando la SMILES no se puede leer: el motivo, la SMILES y, si la hay, la fórmula. */
function BrokenCard({ error, smiles, formula }: { error?: string; smiles: string; formula?: string }) {
  const { t } = useTranslation('visual')
  return (
    <div className={cx(canvasWell, 'grid place-items-center text-center px-6 py-8')} data-structure-broken>
      <div className="flex flex-col items-center gap-2 max-w-[460px]">
        <Hexagon size={24} strokeWidth={1.6} className="text-text3" aria-hidden />
        <div className="t-headline text-text">{t('structure.broken')}</div>
        {error && <div className="t-footnote text-text2">{error}</div>}
        {smiles && <code className="t-mono text-[12.5px] text-text3 break-all">{smiles}</code>}
        {formula && (
          <div className="mt-1 flex flex-col items-center gap-0.5">
            <span className="t-caption text-text3">{t('structure.brokenFormula')}</span>
            <span className="font-serif text-[24px] leading-8 text-text"><RichText text={`$\\ce{${formula}}$`} inline /></span>
          </div>
        )}
      </div>
    </div>
  )
}
