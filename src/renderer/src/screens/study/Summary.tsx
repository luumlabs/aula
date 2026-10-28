// Final de una sesión (lección, práctica, tarjetas, errores, plan): la medalla pixel-art que brilla y suelta píxeles,
// el título en serif, las cifras que cuentan y lo que se puede hacer después.
import { useEffect, useRef, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { AnimatedNumber, Button, Card, Icon, PixelMedal, pixelBurst, Stagger, StaggerItem } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { activePlan, completeCurrentStep, nextStep, runStep } from './plan/session'

export interface SummaryStat {
  value: number
  /** Texto en lugar de la cifra («6 de 9»). */
  text?: string
  suffix?: string
  label: string
}

export function SessionSummary({ title, body, stats, medal = true, children, actions, icon, packId }: {
  /** Curso: si se sigue el plan de hoy, el paso queda hecho y se ofrece el siguiente. */
  packId?: string
  title: ReactNode
  body?: ReactNode
  stats?: SummaryStat[]
  medal?: boolean
  icon?: ReactNode
  children?: ReactNode
  actions?: ReactNode
}) {
  const medalRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!medal) return
    const t = setTimeout(() => medalRef.current && pixelBurst(medalRef.current, { count: 18 }), 380)
    return () => clearTimeout(t)
  }, [medal])
  return (
    <Stagger className="flex flex-col items-center gap-6 pt-6 text-center" gap={0.07}>
      <StaggerItem>
        <motion.div ref={medalRef} initial={{ scale: 0.4, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 16, delay: 0.1 }}>
          {icon ?? (medal ? <PixelMedal size={72} /> : null)}
        </motion.div>
      </StaggerItem>
      <StaggerItem className="flex max-w-[560px] flex-col items-center gap-2">
        <h1 className="t-display text-[38px] leading-[44px]">{title}</h1>
        {body && <p className="t-body text-text2">{body}</p>}
      </StaggerItem>
      {stats && stats.length > 0 && (
        <StaggerItem className="w-full max-w-[640px]">
          <Card padded="lg" className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(4, stats.length)}, minmax(0, 1fr))` }}>
            {stats.map((s, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <span className="t-number text-[34px] leading-[38px]">{s.text ?? <AnimatedNumber value={s.value} suffix={s.suffix ?? ''} />}</span>
                <span className="t-caption">{s.label}</span>
              </div>
            ))}
          </Card>
        </StaggerItem>
      )}
      {children && <StaggerItem className="w-full max-w-[640px] text-left">{children}</StaggerItem>}
      {packId && (
        <StaggerItem className="w-full max-w-[640px]">
          <PlanContinue packId={packId} />
        </StaggerItem>
      )}
      {actions && <StaggerItem className="flex flex-wrap items-center justify-center gap-2">{actions}</StaggerItem>}
    </Stagger>
  )
}

/** Siguiendo «Estudiar ahora»: el paso queda hecho y se ofrece el siguiente. */
export function PlanContinue({ packId }: { packId: string }) {
  const { t } = useTranslation('study')
  const plan = activePlan(packId)
  useEffect(() => {
    completeCurrentStep(packId)
  }, [packId])
  const next = plan ? nextStep(packId) : null
  if (!next) return null
  return (
    <div className="flex w-full items-center gap-3 rounded-[18px] bg-accent-wash px-4 py-3 text-left">
      <Icon name="today" size={18} className="shrink-0 text-accent-text" />
      <span className="min-w-0 flex-1">
        <span className="block t-ui font-semibold text-accent-text">{t('plan.nextStep')}</span>
        <span className="block t-callout truncate"><RichText text={next.item.title} inline /></span>
      </span>
      <Button variant="primary" size="lg" iconRight={<Icon name="arrow-right" size={15} />} onClick={() => runStep(packId, next.index)}>{t('plan.continue')}</Button>
    </div>
  )
}
