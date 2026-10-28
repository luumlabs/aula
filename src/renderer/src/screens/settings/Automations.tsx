// Ajustes → «Aula siempre activa» (AutomationSettingsView.swift), en una tarjeta: el interruptor con su estado, el estilo
// (Discreta · Equilibrada · Muy atenta), horas de silencio, notificaciones, lo no leído en el icono, abrir al iniciar sesión,
// los seguimientos de Aula, lo usado hoy y el acceso a las rutinas y automatizaciones. Sustituye a la tarjeta sencilla de
// «Aula siempre activa» de Ajustes. Lo que es de settings.json va por 'settings.update'; lo del modo, por 'automations.*'.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { AulaMark, Button, Card, Icon, ProgressBar, SegmentedTabs, Switch, cx } from '@renderer/design'
import { useSettings } from '@renderer/lib/settings'
import { useRpc } from '@renderer/lib/useRpc'
import { openInboxTab } from '../inbox/state'
import { setProactive } from '../inbox/ProactiveCard'
import { whenText } from '../inbox/format'

function Toggle({ title, hint, checked, onChange, disabled }: { title: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={cx('flex items-start justify-between gap-4 py-3 border-t-[0.5px] border-line-soft first:border-t-0', disabled && 'opacity-50')}>
      <div className="min-w-0">
        <div className="t-callout font-medium">{title}</div>
        {hint && <div className="t-ui text-text3 mt-0.5">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  )
}

export function AutomationsSettingsCard() {
  const { t } = useTranslation('inbox')
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const { data: snap } = useRpc('automations.snapshot', undefined, { events: ['automations.changed', 'settings.changed'] })
  if (!settings) return null
  const ps = settings.persistent
  const on = ps.enabled
  const p = snap?.proactive
  const style = p?.style === 'custom' ? 'custom' : ps.style
  const quiet = ps.quietHours
  const status = !on ? t('proactive.off') : snap && !snap.active ? t('proactive.paused') : snap?.nextUp ? t('proactive.next', { what: snap.nextUp.routine ? t(`routines.${snap.nextUp.routine}`) : snap.nextUp.title, when: whenText(t, snap.nextUp.at) }) : t('proactive.on')
  return (
    <Card padded="lg" className={cx('h-full transition-colors', on && 'bg-accent-wash!')}>
      <div className="flex items-start gap-4">
        <motion.div animate={{ scale: on ? 1.05 : 1 }}>
          <AulaMark size={44} state={snap?.running.length ? 'working' : on && snap?.active !== false ? 'idle' : 'paused'} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="t-title2">{t('proactive.title')}</h2>
            <Switch checked={on} onChange={(v) => void update({ persistent: { enabled: v } })} label={t('proactive.title')} />
          </div>
          <p className="t-ui text-text2 mt-1">{status}</p>
          <p className="t-callout text-text2 mt-2">{t('settingsCard.hint')}</p>
        </div>
      </div>

      <motion.div initial={false} animate={{ opacity: on ? 1 : 0.5 }} className="mt-5 flex flex-col gap-3">
        <div className="t-ui font-semibold text-text2">{t('settingsCard.style')}</div>
        <SegmentedTabs fill value={style === 'custom' ? ps.style : style} onChange={(v) => void update({ persistent: { style: v } })} items={(['quiet', 'balanced', 'attentive'] as const).map((s) => ({ id: s, label: t(`settingsCard.styles.${s}`) }))} />
        <p className="t-footnote text-text3 -mt-1">{t(`settingsCard.styleDetail.${style}`)}</p>
      </motion.div>

      <div className="mt-3">
        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className="t-callout font-medium">{t('settingsCard.quietHours')}</div>
            <div className="t-ui text-text3 mt-0.5">{t('settingsCard.quietHint')}</div>
            {quiet && (
              <div className="flex items-center gap-2 mt-2 t-ui text-text2">
                <input type="time" aria-label={t('editor.from')} value={quiet.from} onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && void update({ persistent: { quietHours: { ...quiet, from: e.target.value } } })} className="h-8 rounded-[8px] bg-field border-[0.5px] border-line px-2 tabular outline-none" />
                <span>{t('editor.to')}</span>
                <input type="time" aria-label={t('editor.to')} value={quiet.to} onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && void update({ persistent: { quietHours: { ...quiet, to: e.target.value } } })} className="h-8 rounded-[8px] bg-field border-[0.5px] border-line px-2 tabular outline-none" />
              </div>
            )}
          </div>
          <Switch checked={!!quiet} onChange={(v) => void update({ persistent: { quietHours: v ? { from: p?.quiet.from ?? '22:30', to: p?.quiet.to ?? '07:30' } : null } })} label={t('settingsCard.quietHours')} />
        </div>
        <Toggle title={t('settingsCard.notifications')} hint={t('settingsCard.notificationsHint')} checked={p?.notifications ?? true} onChange={(v) => setProactive({ notifications: v })} disabled={!p} />
        <Toggle title={t('settingsCard.badge')} checked={p?.dockBadge ?? true} onChange={(v) => setProactive({ dockBadge: v })} disabled={!p} />
        <Toggle title={t('settingsCard.openAtLogin')} hint={t('settingsCard.openAtLoginHint')} checked={ps.openAtLogin} onChange={(v) => void update({ persistent: { openAtLogin: v } })} />
        <Toggle title={t('settingsCard.followups')} hint={t('settingsCard.followupsHint')} checked={p?.followups ?? true} onChange={(v) => setProactive({ followups: v })} disabled={!p || !on} />
      </div>

      {on && snap && (
        <div className="mt-2">
          <div className="flex items-baseline justify-between t-ui">
            <span className="font-semibold text-text2">{t('proactive.usage')}</span>
            <span className="tabular text-text3">{Math.round(snap.budget.used / 1000)}k / {Math.round(snap.budget.limit / 1000)}k</span>
          </div>
          <ProgressBar value={Math.min(1, snap.budget.used / Math.max(1, snap.budget.limit))} className="mt-1.5" color={snap.budget.exhausted ? 'var(--warning)' : 'var(--accent)'} />
          <p className="t-footnote text-text3 mt-1.5">{snap.budget.exhausted ? t('proactive.exhausted') : t('proactive.runsLeft', { count: snap.budget.runsLeft })}</p>
        </div>
      )}

      <div className="mt-4">
        <Button variant="secondary" icon={<Icon name="repeat" size={14} />} onClick={() => openInboxTab('automations')}>{t('settingsCard.manage')}</Button>
      </div>
    </Card>
  )
}
