// Monitor de una creación: el icono del curso se enciende, la ruta de etapas se va llenando y el equipo trabaja en
// vivo (cada agente es un compañero pixel-art que parpadea mientras trabaja). Al terminar, medalla y a estudiar.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { AnimatedNumber, AulaMark, Button, Card, Companion, ConfirmDialog, CourseIcon, EmptyState, Icon, PixelMedal, ProgressBar, ProviderLogo, SectionTitle, Spinner, TextField, cx, logoForText, pixelBurst, spring, toneForHue, useMarkPhase, toast, useTheme } from '@renderer/design'
import { useAmbient } from '@renderer/design/ambient'
import type { GenerationStage, RunView, SkillRunStatus } from '@shared/generation/types'
import { GENERATION_STAGES } from '@shared/generation/types'
import { useRoute, navigate } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { api } from '@renderer/lib/api'
import { isDemo } from '@renderer/lib/demo'
import { useCourses } from '@renderer/lib/courses'
import { RichText } from '@renderer/lib/RichText'
import { percentSuffix } from '@renderer/lib/format'
import { demoRun } from './demo'
import { doneSummary, shownSkillStatus, type SummaryItem } from './summary'

function useRun(id: string): RunView | null | undefined {
  const [run, setRun] = useState<RunView | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    api
      .invoke('generation.run', { id })
      .then((r) => alive && setRun(r))
      .catch(() => {
        if (!alive) return
        if (isDemo()) {
          const t0 = Date.now()
          setRun(demoRun(id, t0))
          timer = setInterval(() => setRun(demoRun(id, t0)), 1000)
        } else setRun(null)
      })
    const off = api.on('generation.update', (r) => r.id === id && setRun(r))
    return () => {
      alive = false
      off()
      if (timer) clearInterval(timer)
    }
  }, [id])
  return run
}

const EXTEND_UNUSED = new Set<GenerationStage>(['gather', 'plan', 'crossCutting'])

const SKILL_TONE: Record<SkillRunStatus | 'unchanged', string> = {
  pending: 'var(--text3)', running: 'var(--sun)', repairing: 'var(--warning)', verifying: 'var(--info)', done: 'var(--success)', needsReview: 'var(--warning)', failed: 'var(--danger)', unchanged: 'var(--text3)'
}

export default function RunScreen() {
  const { t } = useTranslation('run')
  const route = useRoute()
  const id = route.name === 'run' ? route.id : ''
  const run = useRun(id)
  // sin ningún tema escrito no hay nada con lo que quedarse: un curso «listo» con 0 temas (A3-P2-8)
  const courseSkills = useCourses((s) => (run ? s.courses.find((c) => c.id === run.packId)?.skillCount : undefined))
  const { dark, reducedMotion } = useTheme()
  // «Tu curso está listo» entra abriéndose (sin saltos) y las columnas de debajo bajan juntas, sin muelles escalonados que
  // monten unas tarjetas sobre otras (A4-P1-7)
  const [doneSettled, setDoneSettled] = useState(false)
  const relayout = { layout: { duration: reducedMotion ? 0 : 0.3, ease: [0.2, 0.7, 0.2, 1] as const, delay: 0 } }
  // el brillo de la etapa en marcha: también en reposo, pero no con la ventana sin ver (design/ambient.ts)
  const live = useAmbient('activity')
  const [confirmStop, setConfirmStop] = useState(false)
  useScreenTitle(run?.title ?? t('title'), null, [run?.title])
  if (run === undefined)
    return (
      <div className="grid flex-1 place-items-center text-text3">
        <Spinner size={18} />
      </div>
    )
  if (!run) return <EmptyState title={t('notFound')} />
  const tone = toneForHue(run.hue)
  const ink = dark ? tone.inkDark : tone.inkLight
  const working = run.state === 'running' || run.state === 'waiting'
  // el tiempo se para al terminar (o al pararse)
  const endMs = run.finishedAt ? new Date(run.finishedAt).getTime() : working ? Date.now() : new Date(run.startedAt).getTime()
  const elapsedMs = endMs - new Date(run.startedAt).getTime()
  const minutes = Math.max(1, Math.round(elapsedMs / 60000))
  // menos de un minuto no es «1 min» (J2-14)
  const short = elapsedMs < 60_000
  const eyebrow = headerLabel(run.state, run.mode)
  // una ampliación no reúne materiales, ni planifica, ni rehace el glosario: esas etapas no se enseñan vacías
  const stages = GENERATION_STAGES.filter((s) => run.stages[s] !== 'skipped' && !(run.mode === 'extend' && run.stages[s] === 'pending' && EXTEND_UNUSED.has(s)))

  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-24">
      <ConfirmDialog
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        onConfirm={() => void api.invoke('generation.cancel', { id: run.id }).catch(() => {})}
        title={t('stopConfirm.title')}
        description={t('stopConfirm.body')}
        confirmLabel={t('stopConfirm.confirm')}
        cancelLabel={t('stopConfirm.keep')}
      />
      <div className="grid grid-cols-12 gap-4">
        <Card padded="lg" className="col-span-12" enterAnim>
          <div className="flex items-center gap-5 flex-wrap">
            <CourseIcon icon={run.icon} hue={run.hue} size={76} radius={22} animation="dissolve" title={run.title} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 t-ui font-semibold text-text3">
                {/* la marca de Aula: el atardecer mientras trabaja, el salto de «listo» al terminar */}
                <RunMark working={working} failed={run.state === 'failed'} />
                {t(eyebrow)}
              </div>
              <h1 className="t-title1 truncate">{run.title}</h1>
              <div className="t-ui text-text3 mt-0.5">
                {/* la IA que trabaja, con su logo (en su color mientras trabaja) */}
                <RunProvider provider={run.provider} working={working} />
                {(working || run.finishedAt) && <> · {short ? t(working ? 'elapsedShort' : 'tookShort') : t(working ? 'elapsed' : 'took', { min: minutes })}</>}
                {working && <> · {t('canClose')}</>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {run.state === 'limit' || run.state === 'failed' || run.state === 'paused' ? (
                <>
                  <Button variant="primary" onClick={() => void api.invoke('generation.resume', { id: run.id })}>
                    {t('resume')}
                  </Button>
                  {courseSkills !== 0 && (
                    <Button onClick={() => void api.invoke('generation.keep', { id: run.id }).catch((e: unknown) => toast.error(t('keepFailed'), (e as Error).message))}>{t('keep')}</Button>
                  )}
                </>
              ) : working ? (
                // un clic sin querer paraba a todo el equipo: se pregunta antes (se puede reanudar después: J2-15)
                <Button variant="ghost" onClick={() => setConfirmStop(true)}>
                  {t('cancel')}
                </Button>
              ) : null}
            </div>
          </div>
          {/* la ruta de etapas */}
          <div className="mt-6 flex items-center gap-1.5">
            {stages.map((s, i) => {
              const st = run.stages[s]
              return (
                <div key={s} className="flex-1 min-w-0">
                  <div className="relative h-1.5 rounded-full bg-fill2 overflow-hidden">
                    <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: st === 'failed' ? 'var(--danger)' : ink }} initial={{ width: 0 }} animate={{ width: st === 'done' ? '100%' : st === 'running' ? '55%' : '0%' }} transition={{ duration: 0.8, delay: i * 0.05 }} />
                    {st === 'running' && live && <motion.div className="absolute inset-y-0 w-8 rounded-full bg-white/50" animate={{ x: ['-2rem', '12rem'] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} />}
                  </div>
                  <div className={cx('t-caption mt-1.5 truncate', st === 'running' ? 'text-text font-semibold' : '')}>{t(`stages.${s}`)}</div>
                </div>
              )
            })}
          </div>
        </Card>

        <AnimatePresence initial={false}>
          {run.state === 'done' && run.report && (
            <motion.div
              key="done"
              className={cx('col-span-12', !doneSettled && 'overflow-hidden')}
              initial={{ height: 0, opacity: 0, marginBottom: -16 }}
              animate={{ height: 'auto', opacity: 1, marginBottom: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.35, ease: [0.2, 0.7, 0.2, 1] }}
              onAnimationComplete={() => setDoneSettled(true)}
            >
              <DoneCard run={run} />
            </motion.div>
          )}
        </AnimatePresence>
        {(run.state === 'limit' || run.state === 'failed' || run.state === 'cancelled') && (
          <Card padded="lg" className="col-span-12 bg-warning-soft!">
            <div className="t-headline">{run.state === 'limit' ? t('limit') : run.state === 'failed' ? t('failed') : t('cancelled')}</div>
            <div className="t-callout text-text2 mt-1">{run.state === 'limit' ? t('limitBody') : run.error}</div>
          </Card>
        )}
        {run.question && <QuestionCard run={run} />}

        <motion.div layout="position" transition={relayout} className="col-span-12 @5xl:col-span-8">
          <SectionTitle title={t('team')} detail={<AnimatedNumber value={Math.round(run.progress * 100)} suffix={percentSuffix()} />} />
          <div className="grid gap-3 mt-3 grid-cols-1 @3xl:grid-cols-2">
            <AnimatePresence initial={false}>
              {run.lanes.map((l, i) => (
                <motion.div key={l.id} layout initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ ...spring.smooth, delay: i * 0.04, ...relayout }}>
                  <Card padded="sm" className="h-full">
                    <div className="flex items-start gap-3">
                      {/* terminado: se atenúa el compañero, no el texto (el contraste bajaba a 2,95:1: A4-P2-20) */}
                      <span className={cx('shrink-0 transition-opacity', l.status === 'done' && 'opacity-60')}>
                        <Companion role={l.role} size={44} working={l.status === 'working'} appear />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="t-ui font-semibold text-text2">{t(`roles.${l.role}`)}</span>
                          <span className="t-caption tabular">{t('steps', { count: l.steps })}</span>
                        </div>
                        <div className="t-callout font-medium truncate">{l.title}</div>
                        <AnimatePresence mode="wait">
                          <motion.div key={l.current} className={cx('t-ui mt-0.5', l.status === 'failed' ? 'text-danger' : 'text-text3')} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
                            {l.status === 'done' && <Icon name="check" size={12} className="inline text-success mr-1" />}
                            {l.current}
                          </motion.div>
                        </AnimatePresence>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>

        <motion.div layout="position" transition={relayout} className="col-span-12 @5xl:col-span-4 flex flex-col gap-4">
          <Card padded="lg">
            <SectionTitle title={t('skills')} />
            <div className="mt-2 flex flex-col gap-1">
              {run.skills.map((s) => {
                const status = shownSkillStatus(s.status, run.mode, working)
                return (
                  <motion.div key={s.id} layout transition={relayout} className="flex items-center gap-2.5 py-1.5">
                    <motion.span className="w-2 h-2 rounded-[2px] shrink-0" animate={{ background: SKILL_TONE[status], scale: status === 'running' ? [1, 1.4, 1] : 1 }} transition={{ duration: 1.2, repeat: status === 'running' ? Infinity : 0 }} />
                    <span className={cx('t-callout flex-1 truncate', status === 'unchanged' && 'text-text3')}>{s.title}</span>
                    <span className="t-caption" style={{ color: SKILL_TONE[status] }}>
                      {t(`skillStatus.${status}`)}
                    </span>
                  </motion.div>
                )
              })}
            </div>
            <ProgressBar value={run.skills.filter((s) => s.status === 'done').length / Math.max(1, run.skills.length)} color={ink} className="mt-3" />
          </Card>
          {run.findings && (
            <Card padded="lg">
              <div className="flex items-center gap-2">
                <Companion role="gatherer" size={30} />
                <span className="t-headline">{t('findings')}</span>
              </div>
              <div className="t-callout text-text2 mt-2">
                <RichText text={run.findings} />
              </div>
            </Card>
          )}
        </motion.div>
      </div>
    </div>
  )
}

function DoneCard({ run }: { run: RunView }) {
  const { t, i18n } = useTranslation('run')
  const r = run.report!
  useEffect(() => {
    const el = document.querySelector('[data-run-medal]')
    if (el) pixelBurst(el, { count: 18 })
  }, [])
  const extend = run.mode === 'extend'
  const list = (xs: SummaryItem[]): string => new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(xs.map((x) => t(`summary.${x.key}`, { count: x.count })))
  const sum = doneSummary(r, run.mode)
  const sentences: string[] = []
  if (sum.kind === 'created') sentences.push(t('summary.created', { list: list(sum.items) }))
  else if (sum.kind === 'touched') sentences.push(sum.count ? t('summary.touched', { count: sum.count }) : t('summary.nothing'))
  else {
    // el verbo concuerda con lo primero de la lista («Se añadió 1 tema y 4 ejercicios», «Se añadieron 4 ejercicios»)
    if (sum.added.length) sentences.push(t('summary.added', { list: list(sum.added), count: sum.added[0].count }))
    if (sum.changed) sentences.push(t('summary.changed', { count: sum.changed }))
    if (!sentences.length) sentences.push(t('summary.nothing'))
  }
  if (sum.verified) sentences.push(t('summary.verified', { count: sum.verified }))
  return (
    <Card padded="lg" className="col-span-12 bg-success-soft!">
      <div className="flex items-center gap-5 flex-wrap">
        <motion.div data-run-medal initial={{ scale: 0.4, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={spring.bouncy}>
          <PixelMedal size={64} />
        </motion.div>
        <div className="flex-1 min-w-0">
          <h2 className="t-title2">{t(extend ? 'extendReady' : 'done')}</h2>
          <p className="t-callout text-text2 mt-1">{sentences.join(' ')}</p>
        </div>
        <Button variant="primary" size="lg" onClick={() => navigate({ name: 'course', id: run.packId })}>
          {t(extend ? 'openCourse' : 'start')}
        </Button>
      </div>
      {r.notes.length > 0 && <ReportNotes notes={r.notes} highlight={r.researchNote} />}
    </Card>
  )
}

/** Lo que conviene saber del resultado (la investigación en internet, lo que quedó por revisar). */
function ReportNotes({ notes, highlight }: { notes: string[]; highlight?: string }) {
  const { t } = useTranslation('run')
  return (
    <div className="mt-5 pt-4 border-t-[0.5px] border-line-soft">
      <div className="t-ui font-semibold text-text2">{t('notesTitle')}</div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {notes.slice(0, 8).map((n, i) => (
          <li key={i} className="flex items-start gap-2 t-callout text-text2">
            <Icon name={n === highlight ? 'alert-circle' : 'info'} size={14} className={cx('mt-[3px] shrink-0', n === highlight ? 'text-warning' : 'text-text3')} />
            <span className="min-w-0">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function QuestionCard({ run }: { run: RunView }) {
  const { t } = useTranslation('run')
  const q = run.question!
  const [other, setOther] = useState('')
  const answer = (a: string) => void api.invoke('generation.answer', { id: run.id, questionId: q.id, answer: a })
  return (
    <Card padded="lg" className="col-span-12 bg-accent-wash! border-accent-line!">
      <div className="flex items-center gap-2 t-ui font-semibold text-accent-text">
        <Icon name="help" size={15} /> {t('question')}
      </div>
      <div className="t-headline mt-1">{q.text}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {q.options.map((o) => (
          <Button key={o} onClick={() => answer(o)}>
            {o}
          </Button>
        ))}
        {q.allowsOther && (
          <div className="min-w-[240px] flex-1">
            <TextField value={other} onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && other.trim() && answer(other.trim())} />
          </div>
        )}
      </div>
    </Card>
  )
}

/** Encabezado según el estado: creando/aplicando, listo, en pausa, esperando tu respuesta… */
function headerLabel(state: string, mode: 'create' | 'extend'): string {
  switch (state) {
    case 'done':
      return mode === 'extend' ? 'header.extendDone' : 'header.done'
    case 'waiting':
      return 'header.waiting'
    case 'paused':
    case 'limit':
      return 'header.paused'
    case 'failed':
      return 'header.failed'
    case 'cancelled':
      return 'header.cancelled'
    default:
      return mode === 'extend' ? 'extendTitle' : 'title'
  }
}

/** La marca de Aula del monitor: trabaja mientras se crea el curso y salta al terminar. */
function RunMark({ working, failed }: { working: boolean; failed: boolean }) {
  const state = useMarkPhase(working, { rest: failed ? 'offline' : 'idle' })
  return <AulaMark size={16} state={state} />
}

/** El nombre de la IA de la creación con su logo delante (si se reconoce). */
function RunProvider({ provider, working }: { provider: string; working: boolean }) {
  const logo = logoForText(provider)
  if (!provider) return null
  return (
    <span className="inline-flex items-center gap-1.5 align-[-3px]">
      {logo && <ProviderLogo logo={logo} size={15} active={working} decorative />}
      {provider}
    </span>
  )
}
