// El recorrido guiado de una figura etiquetada: encima de la figura, un velo de papel con huecos donde están las partes
// del paso y, alrededor de cada una, un lazo a pluma de ladrillo que se dibuja al entrar en el paso; debajo, la barra de
// pasos (anterior, reproducir, siguiente, un punto por paso con su título) y lo que cuenta el paso.
// La idea de rodear a pluma lo que cuenta cada paso y apagar lo demás viene de Sketchy (https://github.com/ddkbs/sketchy),
// MIT © 2026 ddkbs: viewer/src/steps.ts (applyStep, drawHighlights) y viewer/src/scene-view.ts (el paso a paso).
import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, IconButton, Ink, cx } from '@renderer/design'
import type { FigurePart, LabeledStep } from '@shared/schema/visual'
import { RichText } from '@renderer/lib/RichText'
import { regionPath } from '../lib/figure'
import { fittedTransform, partBox } from '../lib/figureTour'
import { encircleInk } from '../lib/tourInk'
import type { Size } from '../lib/viewTransform'

/** Radio del hueco del velo alrededor de una parte sin zona (px de la figura sin zoom). */
const HOLE = 22

const pct = (v: number, of: number): string => `${(v / of) * 100}%`

/**
 * Lo que se dibuja sobre la figura (dentro de lo que se amplía, en coordenadas de la figura sin zoom, así sigue al zoom):
 * el velo plano de papel con los huecos de las partes del paso y un lazo a pluma alrededor de cada una.
 */
export function TourLayer({ focus, fitted, step, seed, reduced }: { focus: FigurePart[]; fitted: Size; step: number; seed: string; reduced: boolean }) {
  const mask = `tour-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const t0 = fittedTransform(fitted)
  const W = Math.max(1, fitted.width), H = Math.max(1, fitted.height)
  return (
    <motion.div
      className="pointer-events-none absolute inset-0"
      aria-hidden
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduced ? undefined : { opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <mask id={mask} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
            <rect width={W} height={H} fill="#fff" />
            {focus.map((p) => (
              <path key={p.id} d={regionPath(p, t0, HOLE)} fill="#000" stroke="#000" strokeWidth={10} strokeLinejoin="round" />
            ))}
          </mask>
        </defs>
        {/* velo plano (sin degradados): el resto de la figura queda detrás del papel */}
        <rect width={W} height={H} fill="var(--paper)" fillOpacity={0.62} mask={`url(#${mask})`} style={{ transition: 'fill-opacity 300ms' }} />
      </svg>
      {focus.map((p, i) => {
        const b = partBox(p, t0, HOLE)
        // un círculo (o un punto) se rodea con un óvalo; un rectángulo o un contorno, con un lazo que abraza sus esquinas
        const round = !(p.polygon && p.polygon.length >= 3) && !(p.rect && p.rect.length >= 4)
        const d = encircleInk(b.width, b.height, `${seed}:${p.id}`, round)
        const cx0 = b.x + b.width / 2, cy0 = b.y + b.height / 2
        return (
          // sin drawKey: el lazo se vuelve a dibujar cada vez que se entra en el paso (con movimiento reducido, ya dibujado)
          <Ink
            key={`${step}:${p.id}`}
            drawing={d}
            color="var(--pigment-brick)"
            delay={120 + i * 180}
            className="absolute"
            style={{ left: pct(cx0 - d.w / 2, W), top: pct(cy0 - d.h / 2, H), width: pct(d.w, W), height: pct(d.h, H) }}
          />
        )
      })}
    </motion.div>
  )
}

/** Debajo de la figura: empezar el recorrido o, ya dentro, moverse por los pasos y leer lo que cuenta cada uno. */
export function TourPanel({ steps, step, playing, parts, reduced, onGo, onToggle, onAll }: {
  steps: LabeledStep[]; step: number | null; playing: boolean; parts: FigurePart[]; reduced: boolean
  onGo: (k: number) => void; onToggle: () => void; onAll: () => void
}) {
  const { t } = useTranslation('visual')
  const n = steps.length
  const cur = step !== null ? steps[step] : undefined
  const names = (s: LabeledStep): string => s.parts.map((id) => parts.find((p) => p.id === id)?.name).filter(Boolean).join(', ')
  const titleOf = (s: LabeledStep, i: number): string => s.title || names(s) || t('labeled.tourStep', { k: i + 1, n })
  // al entrar o salir del recorrido, el botón pulsado desaparece: el foco pasa al que lo sustituye (y ← → / Esc siguen aquí)
  const main = useRef<HTMLButtonElement>(null)
  const idle = step === null
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const a = document.activeElement
    if (!a || a === document.body) main.current?.focus({ preventScroll: true })
  }, [idle])
  if (step === null) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button ref={main} size="sm" variant="secondary" icon={<Icon name="play" size={13} />} onClick={onToggle}>
          {t('labeled.tourStart')}
        </Button>
        <span className="t-footnote tabular text-text3">{t('labeled.tourSteps', { count: n })}</span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2.5" role="group" aria-label={t('labeled.tour')}>
      {/* sin `disabled` en los extremos: un botón deshabilitado suelta el foco y ← → / Esc dejarían de llegar al bloque */}
      <div className="flex flex-wrap items-center gap-1.5">
        <IconButton size="sm" label={t('labeled.tourPrev')} onClick={() => onGo(step - 1)} aria-disabled={step <= 0} className={cx(step <= 0 && 'opacity-35')}>
          <Icon name="chevron-left" size={15} />
        </IconButton>
        <Button ref={main} size="sm" variant="secondary" icon={<Icon name={playing ? 'pause' : 'play'} size={13} />} onClick={onToggle}>
          {playing ? t('pause') : t('play')}
        </Button>
        <IconButton size="sm" label={t('labeled.tourNext')} onClick={() => onGo(step + 1)} aria-disabled={step >= n - 1} className={cx(step >= n - 1 && 'opacity-35')}>
          <Icon name="chevron-right" size={15} />
        </IconButton>
        {/* un punto por paso, con su título: se salta a cualquiera */}
        <div className="mx-1.5 flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {steps.map((s, i) => {
            const on = i === step
            return (
              <button
                key={i}
                type="button"
                aria-label={t('labeled.tourDot', { k: i + 1, title: titleOf(s, i) })}
                aria-current={on ? 'step' : undefined}
                title={titleOf(s, i)}
                onClick={() => onGo(i)}
                className="grid h-6 w-5 place-items-center rounded-full outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-wash)]"
              >
                <span className={cx('rounded-full transition-all duration-200', on ? 'h-3 w-3 bg-accent shadow-[0_0_0_3px_var(--accent-wash)]' : i < step ? 'h-[7px] w-[7px] bg-accent' : 'h-[7px] w-[7px] border border-line-strong bg-surface')} />
              </button>
            )
          })}
        </div>
        <span className="whitespace-nowrap t-footnote tabular text-text3">{t('labeled.tourStep', { k: step + 1, n })}</span>
        <Button size="sm" variant="ghost" onClick={onAll} title={t('labeled.tourKeys')}>
          {t('labeled.tourAll')}
        </Button>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {cur && (
          <motion.div
            key={step}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.22 }}
            className="flex gap-3 rounded-[14px] bg-fill1 px-4 py-3"
            aria-live="polite"
          >
            <span className="font-serif text-[20px] leading-7 tabular text-text3">{step + 1}.</span>
            <div className="min-w-0 flex-1">
              {cur.title && (
                <div className="t-headline text-text">
                  <RichText text={cur.title} inline />
                </div>
              )}
              <div className="t-reading text-[16px] leading-[25px] text-text">
                <RichText text={cur.md} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** En papel: el recorrido como una lista numerada (con las partes que rodea cada paso). */
export function PrintedTour({ steps, parts }: { steps: LabeledStep[]; parts: FigurePart[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {steps.map((s, i) => {
        const names = s.parts.map((id) => parts.find((p) => p.id === id)?.name).filter((x): x is string => !!x)
        return (
          <li key={i} className="flex gap-3">
            <span className="w-6 text-right font-serif text-[16px] tabular text-text3">{i + 1}.</span>
            <div className="min-w-0 flex-1 t-callout">
              {(s.title || names.length > 0) && (
                <div className="font-semibold">
                  <RichText text={s.title || names.join(', ')} inline />
                </div>
              )}
              <RichText text={s.md} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}
