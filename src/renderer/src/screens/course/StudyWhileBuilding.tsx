// Estudiar mientras Aula crea el curso: el botón que abre lo que ya está listo y, si la creación se paró por un límite, qué
// pasó y cuándo seguir (la renovación, el detalle del proveedor y «Cambiar de proveedor»: «Reanudar» usa el que esté activo).
// Lo comparten la pantalla del curso y el monitor de la creación.
import { useTranslation } from 'react-i18next'
import { Button, Icon } from '@renderer/design'
import { fmtDate, fmtTime } from '@renderer/lib/format'
import type { RunView } from '@shared/generation/types'
import { navigate } from '@renderer/app/router'
import { renewalWhen } from './failure'

type ButtonProps = { packId: string; ready: number; variant?: 'primary' | 'secondary'; size?: 'sm' | 'md' | 'lg' }

/** «Empezar con lo que está listo (n)»: abre Aprender en la primera lección lista que quede por dominar. */
export function StudyReadyButton({ packId, ready, variant = 'primary', size = 'sm' }: ButtonProps) {
  const { t } = useTranslation('course')
  return (
    <Button variant={variant} size={size} icon={<Icon name="learn" size={size === 'sm' ? 13 : 15} />} onClick={() => navigate({ name: 'study', id: packId, mode: 'learn' })}>
      {t('failure.studyReady', { n: ready })}
    </Button>
  )
}

/** Cuándo se puede seguir tras un límite, en una frase (nada si no se sabe). */
export function RenewalLine({ resumeAt, className }: { resumeAt?: string; className?: string }) {
  const { t } = useTranslation('course')
  const when = renewalWhen(resumeAt, new Date())
  if (!when) return null
  const text =
    when.kind === 'passed'
      ? t('failure.limit.renewed')
      : when.kind === 'today'
        ? t('failure.limit.renewsAt', { time: fmtTime(when.at) })
        : t('failure.limit.renewsOn', { day: fmtDate(when.at, { weekday: 'long', day: 'numeric', month: 'long' }), time: fmtTime(when.at) })
  return (
    <p className={className ?? 't-footnote text-text2'}>
      <Icon name="clock" size={12} className="inline mr-1 align-[-1px] text-text3" />
      {text}
    </p>
  )
}

/** «Cambiar de proveedor» (Ajustes → IA); con el tope de gasto diario de Aula, «Ajustes de IA»: no se arregla cambiando de IA. */
export function SwitchProviderButton({ errorCode, variant = 'secondary' }: { errorCode?: string; variant?: 'secondary' | 'ghost' }) {
  const { t } = useTranslation('course')
  return (
    <Button variant={variant} size="sm" icon={<Icon name="settings" size={13} />} onClick={() => navigate({ name: 'settings', section: 'ai' })}>
      {errorCode === 'ai_budget' ? t('failure.limit.aiSettings') : t('failure.limit.switchProvider')}
    </Button>
  )
}

/** El detalle de un límite: la renovación, lo que dijo el proveedor y (si `button`) dónde cambiar de IA. */
export function LimitNotice({ run, showDetail = true, button = true }: { run: Pick<RunView, 'resumeAt' | 'error' | 'errorCode'>; showDetail?: boolean; button?: boolean }) {
  const { t } = useTranslation('course')
  const detail = showDetail ? run.error?.trim() : undefined
  return (
    <div className="mt-2 flex flex-col gap-2">
      <RenewalLine resumeAt={run.resumeAt} />
      {detail && (
        <div className="rounded-[12px] bg-sunken px-3.5 py-2.5">
          <div className="t-caption font-semibold text-text3">{t('failure.detail')}</div>
          <div className="t-footnote text-text2 mt-0.5 break-words">{detail}</div>
        </div>
      )}
      {button && (
        <div>
          <SwitchProviderButton errorCode={run.errorCode} />
        </div>
      )}
    </div>
  )
}
