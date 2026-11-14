// Piezas del mapa: la chincheta (con su nombre donde lo colocó el que reparte los nombres), el panel de la práctica
// «¿Dónde está…?», las leyendas (grupos de países y la escala del mapa de coropletas, en toques de pincel planos) y lo
// que se imprime en papel en lugar de la ficha que se abre al pulsar.
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, PixelCheck, cx, pixelBurst, spring } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import type { Candidate } from '../lib/mapLabels'
import { legendLayout, type LegendStops } from '../lib/mapChoropleth'
import { canvasMeasure, useFontsReady } from '../shared/measure'

export type QuizRef = { kind: 'marker'; index: number } | { kind: 'country'; ne: string }
export interface Feedback {
  tapped?: QuizRef
  correct: QuizRef
  ok: boolean
  /** Nombre del país que se pulsó por error («Ahí no: eso es Bélgica»). */
  said?: string
}

export type MarkState = 'idle' | 'correct' | 'wrong'

/** Color de lo que se acaba de responder en la práctica. */
export const stateColor = (s: MarkState, idle: string): string => (s === 'correct' ? 'var(--success)' : s === 'wrong' ? 'var(--danger)' : idle)

/** Rótulo del mapa (nombre de una chincheta, una ruta o un país): papel con un filo de tinta. */
export function MapChip({ text, strong, ring }: { text: string; strong?: boolean; ring?: string }) {
  return (
    <span
      className={cx('viz-label inline-block whitespace-nowrap rounded-[7px] px-[7px] py-[1px] text-[12.5px] leading-[17px] text-text bg-raised/95 transition-shadow', strong ? 'font-semibold' : 'font-medium')}
      style={{ boxShadow: `inset 0 0 0 ${ring ? 1.4 : 0.75}px ${ring ?? 'var(--line-strong)'}` }}
    >
      <RichText text={text} inline />
    </span>
  )
}

/**
 * Chincheta. `badge`: en papel, el número de una chincheta cuyo nombre no cupo en el mapa (la lista de debajo dice cuál es).
 */
export function MapPin({ x, y, color, title, label, active, state, delay, animate, run, onTap, ask, badge }: {
  x: number; y: number; color: string; title?: string; label: Candidate | null; active: boolean; state: MarkState; delay: number; animate: boolean; run: boolean
  onTap: () => void; ask?: { part: string; label: string }; badge?: number
}) {
  const fill = stateColor(state, color)
  return (
    <motion.button
      type="button"
      aria-label={title ?? ''}
      data-ask-part={ask?.part}
      data-ask-label={ask?.label}
      className="absolute outline-none group"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onTap}
      initial={animate ? { y: -22, opacity: 0 } : false}
      animate={run ? { y: 0, opacity: 1 } : undefined}
      transition={{ ...spring.bouncy, delay }}
    >
      {/* sombra en el suelo y la chincheta (punta en el lugar exacto) */}
      <span className="absolute -translate-x-1/2 -translate-y-1/2 w-[10px] h-[4px] rounded-full bg-[rgba(32,30,26,.22)]" />
      <motion.svg width="22" height="28" viewBox="0 0 22 28" className="absolute -translate-x-1/2 -translate-y-full overflow-visible" style={{ originX: 0.5, originY: 1 }} animate={{ scale: active ? 1.18 : 1 }} transition={spring.bouncy}>
        <path d="M11 27 C11 27 2.5 17.2 2.5 10.6 A8.5 8.5 0 0 1 19.5 10.6 C19.5 17.2 11 27 11 27Z" fill={fill} stroke="rgba(255,255,255,.95)" strokeWidth="1.8" style={{ transition: 'fill 200ms' }} />
        <path d="M11 27 C11 27 2.5 17.2 2.5 10.6 A8.5 8.5 0 0 1 19.5 10.6 C19.5 17.2 11 27 11 27Z" fill="none" stroke="rgba(32,30,26,.3)" strokeWidth="0.5" />
        {badge !== undefined ? (
          <text x="11" y="10.8" textAnchor="middle" dominantBaseline="central" fontSize={badge > 9 ? 8.5 : 10} fontWeight={700} fill="rgba(255,255,255,.97)" className="tabular">
            {badge}
          </text>
        ) : (
          <circle cx="11" cy="10.5" r="3.2" fill="rgba(255,255,255,.95)" />
        )}
      </motion.svg>
      {title && label && (
        <span
          className="absolute pointer-events-none"
          style={{ left: label.x - x, top: label.y - y, transform: `translate(${-label.ax * 100}%, ${-label.ay * 100}%)` }}
        >
          <MapChip text={title} strong={active} ring={active ? fill : undefined} />
        </span>
      )}
    </motion.button>
  )
}

export function QuizPanel({ target, index, total, right, feedback, onEnd }: { target?: string; index: number; total: number; right: number; feedback: Feedback | null; onEnd: () => void }) {
  const { t } = useTranslation('visual')
  const ref = useRef<HTMLDivElement>(null)
  const done = target === undefined && total > 0
  useEffect(() => {
    if (done && right === total && ref.current) pixelBurst(ref.current, { count: 18 })
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className={cx('flex items-center gap-2.5 flex-wrap rounded-[14px] px-3.5 py-2.5', done && right === total ? 'bg-success-soft' : 'bg-fill1')}>
      {target !== undefined ? (
        <>
          <Icon name="place" size={15} className="text-accent-text" />
          <span className="t-callout text-text2">{t('map.whereIs')}</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={target + index} className="t-headline" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
              <RichText text={target} inline />
            </motion.span>
          </AnimatePresence>
          <span className="flex-1" />
          {feedback && (
            <span className={cx('t-callout font-semibold', feedback.ok ? 'text-success' : 'text-danger')}>
              {feedback.ok ? t('labeled.right') : feedback.said ? t('map.thatIs', { name: feedback.said }) : t('map.notThere')}
            </span>
          )}
          <span className="t-footnote tabular text-text3">{index + 1}/{total}</span>
        </>
      ) : (
        <>
          {right === total ? <PixelCheck size={18} /> : <Icon name="flag" size={16} className="text-text2" />}
          <span className="t-callout font-semibold">{t('labeled.score', { right, total })}</span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={onEnd}>
            {t('map.finish')}
          </Button>
        </>
      )}
    </div>
  )
}

/** Muestra de color cortada a mano (receta `tile` de los toques de pincel). */
function Swatch({ color, className, title, width }: { color: string; className?: string; title?: string; width?: number }) {
  return <span aria-hidden={title ? undefined : true} title={title} className={cx('dab inline-block shrink-0 rounded-[3px]', className)} style={{ background: color, width }} />
}

/** Grupos de países (el mismo rótulo en varios): una muestra de su color y el rótulo. */
export function GroupLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 t-ui text-text2">
          <Swatch color={it.color} className="h-3 w-3" />
          <RichText text={it.label} inline />
        </span>
      ))}
    </div>
  )
}

/** Alto de las muestras de la escala y dónde empiezan sus cifras (px). */
const SCALE_SWATCH = 14
const SCALE_TEXT = 12

/**
 * Escala del mapa de coropletas: un escalón por clase, del más claro al más intenso (planos, sin degradado), con sus cifras
 * escritas debajo (en papel y en una pantalla táctil no se puede pasar por encima): el valor de cada escalón o los límites
 * entre escalones.
 */
export function ChoroplethLegend({ colors, ranges, stops, unit, maxWidth }: { colors: string[]; ranges: string[]; stops: LegendStops; unit?: string; maxWidth: number }) {
  const { t } = useTranslation('visual')
  const fonts = useFontsReady()
  const lay = useMemo(() => {
    void fonts
    return legendLayout(stops, (s) => canvasMeasure(s, SCALE_TEXT, false), maxWidth)
  }, [stops, maxWidth, fonts])
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 t-footnote text-text2" role="group" aria-label={t('map.scale')}>
      {unit && <span className="font-medium text-text">{unit}</span>}
      <div className="relative shrink-0" style={{ width: lay.width, height: SCALE_SWATCH + 3 + 16 }}>
        <span className="absolute top-0 inline-flex" style={{ left: lay.pad, gap: lay.gap }}>
          {colors.map((c, i) => <Swatch key={i} color={c} title={ranges[i]} width={lay.swatch} className="h-3.5" />)}
        </span>
        {lay.labels.map((l, i) => (
          <span key={i} className="absolute -translate-x-1/2 whitespace-nowrap tabular" style={{ left: l.x, top: SCALE_SWATCH + 3 }}>
            {l.text}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Una línea de lo que se imprime: el nombre, su explicación y, si la chincheta va numerada en el mapa, su número. */
export interface PrintedItem { title: string; text?: string; pin?: { n: number; color: string } }

/** En papel no se puede pulsar: la explicación de los marcadores, los países, las regiones y los nombres de las rutas, en una lista. */
export function PrintedLegend({ items }: { items: PrintedItem[] }) {
  if (!items.length) return null
  return (
    <div className="flex flex-col gap-1">
      {items.map((it, i) => (
        <div key={i} className="t-ui flex gap-1.5 items-baseline">
          {it.pin && (
            <span className="self-center inline-grid place-items-center shrink-0 h-4 min-w-4 px-1 rounded-full text-[10px] leading-none font-bold tabular" style={{ background: it.pin.color, color: 'rgba(255,255,255,.97)' }}>
              {it.pin.n}
            </span>
          )}
          <span className="font-semibold"><RichText text={it.title} inline /></span>
          {it.text && <span className="text-text2"><RichText text={it.text} inline /></span>}
        </div>
      ))}
    </div>
  )
}
