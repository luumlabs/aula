// Los pasos de un dibujo que se construye poco a poco: anterior, ver/pausar, siguiente, la barra de pasos y la explicación del
// paso; «Ver todo» vuelve al dibujo entero. En papel, la lista numerada debajo del dibujo completo. Mismo aspecto que los
// pasos de los diagramas.
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Button, Icon, IconButton } from '@renderer/design'
import type { DrawingStep } from '@shared/schema/drawing'
import { RichText } from '@renderer/lib/RichText'
import { StepScrubber } from './DiagramBlock'

export function DrawingSteps({ steps, step, playing, onGo, onToggle, onAll, reduced }: {
  steps: readonly DrawingStep[]; step: number | null; playing: boolean; onGo: (k: number) => void; onToggle: () => void; onAll: () => void; reduced: boolean
}) {
  const { t } = useTranslation('visual')
  const n = steps.length
  const cur = step !== null ? steps[step] : undefined
  return (
    <div className="flex flex-col gap-2.5" role="group" aria-label={t('draw.stepByStep')}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <IconButton size="sm" label={t('diagram.prev')} onClick={() => onGo((step ?? 0) - 1)} disabled={(step ?? 0) <= 0}>
          <Icon name="chevron-left" size={15} />
        </IconButton>
        <Button size="sm" variant="secondary" icon={<Icon name={playing ? 'pause' : 'play'} size={13} />} onClick={onToggle}>
          {playing ? t('pause') : step === null ? t('draw.watch') : t('play')}
        </Button>
        <IconButton size="sm" label={t('diagram.next')} onClick={() => onGo((step ?? -1) + 1)} disabled={(step ?? -1) >= n - 1}>
          <Icon name="chevron-right" size={15} />
        </IconButton>
        <StepScrubber n={n} step={step} onGo={onGo} />
        <span className="t-footnote tabular text-text3 whitespace-nowrap">{step !== null ? t('diagram.stepOf', { k: step + 1, n }) : t('diagram.steps', { count: n })}</span>
        {step !== null && (
          <Button size="sm" variant="ghost" onClick={onAll}>
            {t('diagram.all')}
          </Button>
        )}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {cur && step !== null && (
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
              {cur.md && (
                <div className="t-reading text-[16px] leading-[25px] text-text">
                  <RichText text={cur.md} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Los pasos en papel: una lista numerada bajo el dibujo entero. */
export function PrintedDrawingSteps({ steps }: { steps: readonly DrawingStep[] }) {
  return (
    <ol className="flex flex-col gap-2 m-0 p-0 list-none">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="font-serif text-[16px] tabular text-text3 w-6 text-right">{i + 1}.</span>
          <div className="min-w-0 flex-1 t-callout">
            {s.title && <div className="font-semibold"><RichText text={s.title} inline /></div>}
            {s.md && <RichText text={s.md} />}
          </div>
        </li>
      ))}
    </ol>
  )
}
