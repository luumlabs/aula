// Un curso cuya creación falló (o se detuvo) antes de tener ningún tema: en vez del resumen vacío con «Estudiar ahora», qué
// pasó dicho en llano, el detalle del error y qué hacer: intentarlo de nuevo, ver el registro de la creación o eliminar el curso.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { AulaMark, Button, Card, CourseIcon, Icon, ProviderLogo, logoForText, toast, type IconName, type LogoId, type MarkState } from '@renderer/design'
import { fmtPercent, fmtTime } from '@renderer/lib/format'
import type { RunSummary, RunView } from '@shared/generation/types'
import type { Pack } from '@shared/schema/pack'
import { api } from '@renderer/lib/api'
import { navigate } from '@renderer/app/router'
import { CourseActions, type CourseAction } from './Actions'
import { failureReason, type CoursePartial, type CourseRunIssue } from './failure'

const MARK: Record<CourseRunIssue, MarkState> = { failed: 'offline', stopped: 'paused', limit: 'paused', building: 'working' }

/** La vista completa de la ejecución (con el error y su código), al día con 'generation.update'. */
function useRunView(id: string): RunView | null {
  const [run, setRun] = useState<RunView | null>(null)
  useEffect(() => {
    let alive = true
    api.invoke('generation.run', { id }).then((r) => alive && setRun(r)).catch(() => {})
    const off = api.on('generation.update', (r) => r.id === id && setRun(r))
    return () => {
      alive = false
      off()
    }
  }, [id])
  return run
}

export function CourseCreationFailed({ pack, runId, issue }: { pack: Pack; runId: string; issue: CourseRunIssue }) {
  const { t } = useTranslation(['course', 'common'])
  const run = useRunView(runId)
  const [action, setAction] = useState<CourseAction>(null)
  const [busy, setBusy] = useState(false)
  const reason = failureReason(run?.errorCode, run?.state ?? (issue === 'limit' ? 'limit' : 'failed'))
  const detail = run?.error?.trim()

  const retry = async (): Promise<void> => {
    setBusy(true)
    try {
      // misma petición: la ejecución sigue donde se quedó (aquí, antes del primer tema)
      await api.invoke('generation.resume', { id: runId })
      navigate({ name: 'run', id: runId })
    } catch (e) {
      toast.error(t('failure.retryFailed'), e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 mb-2 flex items-center gap-5 flex-wrap">
        <CourseIcon icon={pack.icon} hue={pack.hue} size={84} title={pack.title} animation="dissolve" radius={24} />
        <div className="min-w-0 flex-1">
          <motion.h1 className="t-title1 text-[32px] leading-[38px] line-clamp-2 break-words" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: 0.15 }}>
            {pack.title}
          </motion.h1>
          <div className="t-callout text-text2 mt-1">{t(`failure.status.${issue}`)}</div>
        </div>
      </div>

      <Card padded="lg" className="col-span-12 @5xl:col-span-8" role="status" aria-live="polite" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}>
        <div className="flex items-start gap-5">
          <div className="shrink-0 text-text2 pt-1">
            <AulaMark size={52} state={MARK[issue]} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="t-title2">{t(`failure.title.${issue}`)}</h2>
            {issue !== 'building' && <p className="t-body text-text2 mt-1.5">{t(`failure.reason.${reason}`)}</p>}
            {issue === 'building' && <p className="t-body text-text2 mt-1.5">{t('failure.buildingBody')}</p>}
            {detail && issue !== 'building' && (
              <div className="mt-4 rounded-[12px] bg-sunken px-3.5 py-2.5">
                <div className="t-caption font-semibold text-text3">{t('failure.detail')}</div>
                <div className="t-footnote text-text2 mt-0.5 break-words">{detail}</div>
              </div>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {issue === 'building' ? (
                <Button variant="primary" icon={<Icon name="activity" size={14} />} onClick={() => navigate({ name: 'run', id: runId })}>
                  {t('failure.watch')}
                </Button>
              ) : (
                <>
                  <Button variant="primary" icon={<Icon name="refresh" size={14} />} loading={busy} onClick={() => void retry()}>
                    {t('failure.retry')}
                  </Button>
                  <Button variant="secondary" icon={<Icon name="activity" size={14} />} onClick={() => navigate({ name: 'run', id: runId })}>
                    {t('failure.openLog')}
                  </Button>
                </>
              )}
              {/* mientras el equipo escribe no se borra (antes se detiene desde el monitor) */}
              {issue !== 'building' && (
                <Button variant="ghost" icon={<Icon name="trash" size={14} />} className="text-danger! hover:text-danger!" onClick={() => setAction('delete')}>
                  {t('failure.delete')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>
      <RequestCard pack={pack} run={run} delay={0.18} />
      <CourseActions pack={pack} action={action} onClose={() => setAction(null)} />
    </div>
  )
}

/** Con qué se vuelve a intentar: los materiales del curso, la IA y dónde se paró (la misma petición). */
function RequestCard({ pack, run, delay }: { pack: Pack; run: RunView | null; delay: number }) {
  const { t } = useTranslation(['course', 'run'])
  const sources = pack.sources
  const rows: Array<{ icon: IconName; logo?: LogoId | null; label: string; value: string }> = [
    { icon: 'sources', label: t('failure.request.materials'), value: sources.length ? sources.slice(0, 3).map((m) => m.title).join(' · ') + (sources.length > 3 ? ' …' : '') : t('failure.request.noMaterials') }
  ]
  if (run?.provider) rows.push({ icon: 'aula', logo: logoForText(run.provider), label: t('failure.request.ai'), value: run.provider })
  if (run?.finishedAt) rows.push({ icon: 'clock', label: t('failure.request.stopped'), value: t('failure.request.stoppedAt', { stage: t(`run:stages.${run.stage}`), time: fmtTime(run.finishedAt) }) })
  return (
    <Card padded="lg" className="col-span-12 @5xl:col-span-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay }}>
      <div className="t-headline">{t('failure.request.title')}</div>
      <p className="t-footnote text-text3 mt-0.5">{t('failure.request.body')}</p>
      <div className="mt-3 flex flex-col">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-3 border-t-[0.5px] border-line-soft py-2.5 first:border-t-0">
            {r.logo ? <ProviderLogo logo={r.logo} size={16} className="mt-[2px]" decorative /> : <Icon name={r.icon} size={16} className="mt-[2px] shrink-0 text-text3" />}
            <div className="min-w-0">
              <div className="t-caption text-text3">{r.label}</div>
              <div className="t-callout break-words">{r.value}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** Un curso a medias (la creación se cortó con temas ya escritos): una franja encima de las pestañas con hasta dónde llegó,
 * «Reanudar» (sigue donde se quedó), «Quedarme con lo que hay» (lo da por terminado) y el registro (J2-2). */
export function CoursePartialBanner({ run, partial }: { run: RunSummary; partial: CoursePartial }) {
  const { t } = useTranslation(['course', 'common'])
  const [busy, setBusy] = useState<'resume' | 'keep' | null>(null)
  const act = async (kind: 'resume' | 'keep'): Promise<void> => {
    setBusy(kind)
    try {
      if (kind === 'resume') {
        await api.invoke('generation.resume', { id: run.id })
        navigate({ name: 'run', id: run.id })
      } else {
        await api.invoke('generation.keep', { id: run.id })
        toast.success(t('failure.partial.kept'))
      }
    } catch (e) {
      toast.error(t('failure.retryFailed'), e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(null)
    }
  }
  const pct = fmtPercent(Math.min(1, Math.max(0, run.progress || 0)))
  return (
    <Card padded className="mt-5" role="status" data-course-partial={partial} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }}>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="shrink-0 text-text2">
          <AulaMark size={34} state={partial === 'failed' ? 'offline' : 'paused'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="t-headline">{t(`failure.partial.title.${partial}`, { pct })}</div>
          <p className="t-footnote text-text2 mt-0.5">{t('failure.partial.body')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" icon={<Icon name="refresh" size={13} />} loading={busy === 'resume'} disabled={!!busy} onClick={() => void act('resume')}>
            {t('failure.partial.resume')}
          </Button>
          <Button variant="secondary" size="sm" loading={busy === 'keep'} disabled={!!busy} onClick={() => void act('keep')}>
            {t('failure.partial.keep')}
          </Button>
          <Button variant="ghost" size="sm" icon={<Icon name="activity" size={13} />} onClick={() => navigate({ name: 'run', id: run.id })}>
            {t('failure.openLog')}
          </Button>
        </div>
      </div>
    </Card>
  )
}
