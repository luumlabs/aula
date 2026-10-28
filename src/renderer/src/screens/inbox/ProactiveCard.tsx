// «Aula siempre activa» en «Novedades» (ProactiveViews.swift): la marca de Aula con su estado (el sol sale y se pone mientras
// revisa), el interruptor, lo que necesita al estudiante con su arreglo, las rutinas con su hora y lo usado hoy. Debajo, lo
// próximo que hará, en una tarjeta que flota despacio.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { AulaMark, Button, Card, Floating, Icon, Menu, ProgressBar, SectionTitle, Switch, cx } from '@renderer/design'
import { useSettings } from '@renderer/lib/settings'
import { api } from '@renderer/lib/api'
import { navigate } from '@renderer/app/router'
import { toast } from '@renderer/design'
import { LIGHT_ROUTINES, PROACTIVE_ROUTINES, type AutomationHealthIssue, type AutomationsSnapshot, type ProactiveRoutine, type ProactiveSettings } from '@shared/automations'
import { inboxOps } from './actions'
import { ROUTINE_ICONS, hoursText, timeDisplay, weekdayName, whenText } from './format'

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e))

export function setProactive(patch: Partial<ProactiveSettings>): void {
  void api.invoke('automations.setProactive', { patch }).catch(fail)
}

export function pauseProactive(until: number | null): void {
  void api.invoke('automations.pause', { until: until === null ? null : new Date(until).toISOString() }).catch(fail)
}

/** La hora de cada rutina, corta («7:45», «24 h · 2 h», «dom 18:00»). */
function routineWhen(t: (k: string, o?: Record<string, unknown>) => string, p: ProactiveSettings, r: ProactiveRoutine): string {
  switch (r) {
    case 'morningBrief': return timeDisplay(p.morningTime)
    case 'platformCheck': return timeDisplay(p.platformCheckTime)
    case 'deadlineReminders': return [...p.reminderHours].sort((a, b) => b - a).map((h) => hoursText(t as never, h)).join(' · ')
    case 'examOffers': return t('routines.examOffersWhen', { count: p.examOfferDays })
    case 'weeklySummary': return `${weekdayName(p.weeklyDay, 'short').replace('.', '')} ${timeDisplay(p.weeklyTime)}`
  }
}

function statusLine(t: (k: string, o?: Record<string, unknown>) => string, s: AutomationsSnapshot, enabled: boolean): string {
  if (s.running.length) return t('proactive.working')
  if (!enabled) return t('proactive.off')
  if (!s.active) return s.proactive.pausedUntil && Date.parse(s.proactive.pausedUntil) - Date.now() < 300 * 86_400_000 ? t('proactive.pausedUntil', { when: whenText(t as never, s.proactive.pausedUntil) }) : t('proactive.paused')
  if (s.nextUp) return t('proactive.next', { what: s.nextUp.routine ? t(`routines.${s.nextUp.routine}`) : s.nextUp.title, when: whenText(t as never, s.nextUp.at) })
  return t('proactive.nothing')
}

export function ProactiveCard({ snapshot: s, compact }: { snapshot: AutomationsSnapshot; compact?: boolean }) {
  const { t } = useTranslation('inbox')
  const settings = useSettings((x) => x.settings)
  const update = useSettings((x) => x.update)
  const enabled = settings?.persistent.enabled ?? s.proactive.enabled
  const p = s.proactive
  const issue = s.health[0]
  const mark = s.running.length ? 'working' : enabled && s.active ? 'idle' : 'paused'
  const pauseItems = [
    { label: t('proactive.pauseHour'), onSelect: () => pauseProactive(Date.now() + 3_600_000) },
    { label: t('proactive.pauseTomorrow'), onSelect: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(7, 0, 0, 0); pauseProactive(d.getTime()) } },
    { label: t('proactive.pauseWeek'), onSelect: () => pauseProactive(Date.now() + 7 * 86_400_000) }
  ]
  return (
    <Card padded="lg" className={cx('transition-colors', enabled && s.active && 'bg-accent-wash!')}>
      <div className="flex items-start gap-3.5">
        <motion.div animate={{ scale: enabled ? 1.04 : 1 }} transition={{ duration: 0.4 }} className="text-text">
          <AulaMark size={40} state={mark} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="t-title2 text-text">{t('proactive.title')}</h2>
            <Switch checked={enabled} onChange={(v) => void update({ persistent: { enabled: v } })} label={t('proactive.title')} />
          </div>
          <p className="t-ui text-text2 mt-1">{statusLine(t, s, enabled)}</p>
        </div>
      </div>
      {!enabled && <p className="t-callout text-text2 mt-4">{t('proactive.offer')}</p>}
      {issue && <HealthRow issue={issue} />}
      {enabled && (
        <div className="mt-4 flex items-center gap-2">
          {s.active ? (
            <Menu align="start" items={pauseItems} trigger={(open) => <Button size="sm" variant="secondary" icon={<Icon name="pause" size={13} />} onClick={open}>{t('proactive.pause')}</Button>} />
          ) : (
            <Button size="sm" variant="secondary" icon={<Icon name="play" size={13} />} onClick={() => pauseProactive(null)}>{t('proactive.resume')}</Button>
          )}
        </div>
      )}
      {!compact && (
        <>
          <div className="t-ui font-semibold text-text2 mt-5 mb-1">{t('proactive.routines')}</div>
          <div className="flex flex-col">
            {PROACTIVE_ROUTINES.map((r, i) => {
              const light = LIGHT_ROUTINES.includes(r)
              const live = p[r] && (enabled || light)
              // las rutinas que necesitan «Aula siempre activa» se ven apagadas mientras esté apagada (se guarda su elección)
              const needsOn = !enabled && !light
              return (
                <motion.div key={r} initial={{ opacity: 0, x: 6 }} animate={{ opacity: needsOn ? 0.55 : 1, x: 0 }} transition={{ duration: 0.28, delay: 0.05 + i * 0.04 }}
                  className="flex items-center gap-3 py-2 border-t-[0.5px] border-line-soft first:border-t-0">
                  <Icon name={ROUTINE_ICONS[r]} size={17} className={cx('shrink-0', live ? 'text-text2' : 'text-text3')} />
                  <div className="min-w-0 flex-1">
                    <div className={cx('t-callout', live ? 'text-text' : 'text-text2')}>{t(`routines.${r}`)}</div>
                    <div className="t-footnote text-text3 truncate" title={light && !enabled ? t('proactive.lightHint') : undefined}>
                      {light && !enabled ? t('proactive.light') : t(`routines.${r}Detail`)}
                    </div>
                  </div>
                  <span className="t-caption tabular text-text3 shrink-0">{routineWhen(t, p, r)}</span>
                  <Switch size="sm" checked={live} disabled={needsOn} onChange={(v) => setProactive({ [r]: v })} label={t(`routines.${r}`)} />
                </motion.div>
              )
            })}
          </div>
          {enabled && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between t-ui">
                <span className="font-semibold text-text2">{t('proactive.usage')}</span>
                <span className="tabular text-text3">{Math.round(s.budget.used / 1000)}k / {Math.round(s.budget.limit / 1000)}k</span>
              </div>
              <ProgressBar value={Math.min(1, s.budget.used / Math.max(1, s.budget.limit))} className="mt-1.5" color={s.budget.exhausted ? 'var(--warning)' : 'var(--accent)'} />
              <p className="t-footnote text-text3 mt-1.5">{s.budget.exhausted ? t('proactive.exhausted') : t('proactive.runsLeft', { count: s.budget.runsLeft })}</p>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

/** Lo que necesita al estudiante, con su arreglo (el estado en el icono, sin banda de color). */
function HealthRow({ issue }: { issue: AutomationHealthIssue }) {
  const { t } = useTranslation('inbox')
  let title: string, detail: string
  let fix: { label: string; run: () => void } | null = null
  switch (issue.kind) {
    case 'paused':
      title = t('health.paused'); detail = issue.until ? t('health.pausedUntilDetail', { when: whenText(t as never, issue.until) }) : t('health.pausedDetail')
      fix = { label: t('proactive.resume'), run: () => pauseProactive(null) }
      break
    case 'noAI':
      title = t('health.noAI'); detail = t('health.noAIDetail'); fix = { label: t('health.fixAI'), run: () => navigate({ name: 'settings' }) }
      break
    case 'signIn':
      title = t('health.signIn', { site: issue.site }); detail = t('health.signInDetail'); fix = { label: t('health.fixSignIn'), run: () => navigate({ name: 'settings', section: 'platforms' }) }
      break
    case 'aiUnavailable':
      title = t('health.aiUnavailable'); detail = t('health.aiUnavailableDetail', { reason: issue.reason, when: whenText(t as never, issue.until) })
      break
    case 'budget':
      title = t('health.budget'); detail = t('health.budgetDetail', { when: whenText(t as never, issue.resumes) }); fix = { label: t('health.fixBudget'), run: () => navigate({ name: 'settings' }) }
      break
    case 'failing':
      title = t('health.failing', { title: issue.title }); detail = issue.message; fix = { label: t('health.fixRetry'), run: () => void inboxOps.runNow(issue.id) }
      break
  }
  return (
    <div className="mt-4 rounded-[14px] bg-fill1 px-3.5 py-3 flex items-start gap-2.5">
      <Icon name="alert" size={16} className="text-warning mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="t-callout font-semibold text-text">{title}</div>
        {detail && <div className="t-ui text-text2 mt-0.5">{detail}</div>}
        {fix && <Button size="sm" variant="secondary" className="mt-2" onClick={fix.run}>{fix.label}</Button>}
      </div>
    </div>
  )
}

/** Lo próximo que hará Aula (las rutinas en los próximos días), en una tarjeta que flota. */
export function UpNextCard({ snapshot: s }: { snapshot: AutomationsSnapshot }) {
  const { t } = useTranslation('inbox')
  const settings = useSettings((x) => x.settings)
  const enabled = settings?.persistent.enabled ?? s.proactive.enabled
  const items = s.preview.filter((x) => enabled || LIGHT_ROUTINES.includes(x.routine)).slice(0, 4)
  if (!items.length && !enabled) return null
  return (
    <Floating amplitude={2.5} duration={9} phase={0.3}>
      <Card padded="lg" elevation={2}>
        <SectionTitle title={t('proactive.upNext')} />
        {items.length === 0 ? (
          <p className="t-callout text-text3 py-1">{t('proactive.upNextEmpty')}</p>
        ) : (
          <div className="flex flex-col mt-1">
            {items.map((x, i) => (
              <motion.div key={x.routine + x.date} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: 0.15 + i * 0.05 }} className="flex items-center gap-3 py-2">
                {/* lo que hará Aula, en una loseta con la luz del sol (antes, una raya a la izquierda) */}
                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-sun/12 text-sun">
                  <Icon name={ROUTINE_ICONS[x.routine]} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="t-callout truncate">{x.detail || t(`routines.${x.routine}`)}</div>
                  <div className="t-ui text-text3">{whenText(t as never, x.date)}</div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </Card>
    </Floating>
  )
}
