// Nueva automatización / Editar (AutomationEditor.swift): nombre, qué hacer, cuándo (a unas horas y días, cada N horas en una
// franja, una vez, o antes de entregas y exámenes), dónde mira, cómo avisa y «avísame cuando lo encuentre». Debajo, la primera
// vez que se hará (calculada aquí mismo con el planificador) y la nota de seguridad.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Chip, Dialog, Icon, IconButton, SegmentedTabs, Switch, TextArea, TextField, cx, toast } from '@renderer/design'
import { api } from '@renderer/lib/api'
import {
  AUTOMATION_CAPABILITIES, AutomationPlanner, NOTIFY_POLICIES, WEEKDAYS, defaultSchedule, scheduleIsValid, timeFromMinutes, timeMinutes,
  type AutomationDraft, type AutomationSchedule, type ScheduleKind
} from '@shared/automations'
import { localTimeZone } from '@engine/calendar/time'
import i18n from '@renderer/i18n'
import { scheduleSummary, weekdayName, whenText, hoursText } from './format'
import { useInboxUI } from './state'

export function blankDraft(instruction = '', schedule: AutomationSchedule = defaultSchedule('daily')): AutomationDraft {
  return { title: '', instruction, schedule, capabilities: ['platform', 'calendar', 'courses'], notify: 'news', untilFound: false }
}

const HOUR_CHOICES = [72, 48, 24, 12, 4, 2, 1]

export function AutomationEditor() {
  const { t } = useTranslation('inbox')
  const editing = useInboxUI((s) => s.editing)
  const set = useInboxUI((s) => s.set)
  return (
    <Dialog open={!!editing} onClose={() => set({ editing: null })} size="lg" title={editing?.id ? t('editor.editTitle') : t('editor.newTitle')} description={t('editor.subtitle')}>
      {editing && <EditorForm key={editing.id ?? 'new'} initial={editing} onDone={() => set({ editing: null })} />}
    </Dialog>
  )
}

function EditorForm({ initial, onDone }: { initial: AutomationDraft; onDone: () => void }) {
  const { t } = useTranslation('inbox')
  const [d, setD] = useState<AutomationDraft>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const s = d.schedule
  const patch = (p: Partial<AutomationDraft>) => setD((x) => ({ ...x, ...p }))
  const patchS = (p: Partial<AutomationSchedule>) => setD((x) => ({ ...x, schedule: { ...x.schedule, ...p } }))
  const valid = scheduleIsValid(s) && (d.title.trim() !== '' || d.instruction.trim() !== '')
  const next = useMemo(() => {
    if (!scheduleIsValid(s) || s.kind === 'beforeEvents') return null
    const n = new AutomationPlanner(localTimeZone()).next(s, Date.now())
    return n ? new Date(n.at).toISOString() : null
  }, [s])

  const setKind = (k: ScheduleKind) => {
    const base: Partial<AutomationSchedule> = { kind: k }
    if (k === 'daily' && !s.times.length) base.times = ['08:00']
    if (k === 'once' && !s.date) { const x = new Date(Date.now() + 2 * 3_600_000); x.setMinutes(0, 0, 0); base.date = x.toISOString() }
    if (k === 'beforeEvents' && !s.hoursBefore.length) base.hoursBefore = [24, 2]
    patchS(base)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.invoke('automations.save', { automation: d })
      toast.success(d.id ? t('editor.save') : t('editor.create'), scheduleSummary(t, d.schedule))
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <TextField label={t('editor.name')} placeholder={t('editor.namePlaceholder')} value={d.title} maxLength={80} onChange={(e) => patch({ title: e.target.value })} />
      <TextArea label={t('editor.what')} placeholder={t('editor.whatPlaceholder')} value={d.instruction} rows={2} autoGrow maxLength={4000} onChange={(e) => patch({ instruction: e.target.value })} />

      <Field label={t('editor.when')}>
        <SegmentedTabs size="sm" value={s.kind} onChange={setKind} items={(['daily', 'interval', 'once', 'beforeEvents'] as const).map((k) => ({ id: k, label: t(`editor.kinds.${k}`) }))} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={s.kind} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }} className="mt-3 flex flex-col gap-3">
            {s.kind === 'daily' && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {s.times.map((tm, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      <TimeInput value={tm} label={t('editor.when')} onChange={(v) => patchS({ times: s.times.map((x, j) => (j === i ? v : x)) })} />
                      {s.times.length > 1 && (
                        <IconButton size="sm" label={t('editor.removeTime')} onClick={() => patchS({ times: s.times.filter((_, j) => j !== i) })}><Icon name="close" size={13} /></IconButton>
                      )}
                    </span>
                  ))}
                  {s.times.length < 6 && (
                    <Button size="sm" variant="ghost" icon={<Icon name="plus" size={13} />} onClick={() => patchS({ times: [...s.times, timeFromMinutes(timeMinutes(s.times[s.times.length - 1] ?? '08:00') + 360)] })}>
                      {t('editor.addTime')}
                    </Button>
                  )}
                </div>
                <WeekdayPicker days={s.weekdays} onChange={(weekdays) => patchS({ weekdays })} />
              </>
            )}
            {s.kind === 'interval' && (
              <>
                <div className="flex flex-wrap items-center gap-2 t-ui text-text2">
                  <span>{t('editor.every')}</span>
                  <input type="number" min={1} max={24} value={s.everyHours} aria-label={t('editor.every')} onChange={(e) => patchS({ everyHours: Math.max(1, Math.min(24, Math.round(Number(e.target.value) || 1))) })}
                    className="h-8 w-16 rounded-[8px] bg-field border-[0.5px] border-line px-2 t-ui tabular text-text outline-none focus:border-accent-line" />
                  <span>{t('editor.hours')}, {t('editor.from')}</span>
                  <TimeInput value={s.windowStart} label={t('editor.from')} onChange={(windowStart) => patchS({ windowStart })} />
                  <span>{t('editor.to')}</span>
                  <TimeInput value={s.windowEnd} label={t('editor.to')} onChange={(windowEnd) => patchS({ windowEnd })} />
                </div>
                <WeekdayPicker days={s.weekdays} onChange={(weekdays) => patchS({ weekdays })} />
              </>
            )}
            {s.kind === 'once' && (
              <input type="datetime-local" aria-label={t('editor.when')} value={s.date ? localInput(s.date) : ''} min={localInput(new Date().toISOString())}
                onChange={(e) => { const v = new Date(e.target.value); if (!Number.isNaN(v.getTime())) patchS({ date: v.toISOString() }) }}
                className="h-9 w-fit rounded-[10px] bg-field border-[0.5px] border-line px-3 t-ui tabular text-text outline-none focus:border-accent-line" />
            )}
            {s.kind === 'beforeEvents' && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {HOUR_CHOICES.map((h) => (
                    <Chip key={h} active={s.hoursBefore.includes(h)} onClick={() => patchS({ hoursBefore: s.hoursBefore.includes(h) ? s.hoursBefore.filter((x) => x !== h) : [...s.hoursBefore, h] })}>
                      {hoursText(t, h)}
                    </Chip>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(['assignment', 'exam', 'quiz'] as const).map((k) => {
                    const on = s.eventKinds.length === 0 || s.eventKinds.includes(k)
                    return (
                      <Chip key={k} active={on} onClick={() => {
                        const cur = new Set(s.eventKinds.length ? s.eventKinds : ['assignment', 'exam', 'quiz'])
                        if (on) cur.delete(k)
                        else cur.add(k)
                        patchS({ eventKinds: cur.size === 3 ? [] : (['assignment', 'exam', 'quiz'] as const).filter((x) => cur.has(x)) })
                      }}>
                        {t(`editor.eventKinds.${k}`)}
                      </Chip>
                    )
                  })}
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
        {scheduleIsValid(s) && <p className="t-footnote text-text3 mt-2">{scheduleSummary(t, s)}</p>}
      </Field>

      <Field label={t('editor.where')}>
        <div className="flex flex-wrap gap-1.5">
          {AUTOMATION_CAPABILITIES.map((c) => (
            <Chip key={c} active={d.capabilities.includes(c)} onClick={() => patch({ capabilities: d.capabilities.includes(c) ? d.capabilities.filter((x) => x !== c) : [...d.capabilities, c] })}>
              {t(`editor.capabilities.${c}`)}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label={t('editor.notify')}>
        <SegmentedTabs size="sm" value={d.notify} onChange={(notify) => patch({ notify })} items={NOTIFY_POLICIES.map((n) => ({ id: n, label: t(`editor.notifyPolicies.${n}`) }))} />
        <label className="mt-3 flex items-center justify-between gap-4 cursor-pointer">
          <span className="t-callout text-text">{t('editor.untilFound')}</span>
          <Switch size="sm" checked={d.untilFound} onChange={(untilFound) => patch({ untilFound })} label={t('editor.untilFound')} />
        </label>
      </Field>

      <div className="rounded-[14px] bg-fill1 px-4 py-3 flex flex-col gap-1.5">
        {next && <p className="t-ui text-text"><Icon name="clock" size={13} className="inline -mt-0.5 mr-1.5 text-text3" />{t('editor.firstRun', { when: whenText(t, next) })}</p>}
        <p className="t-footnote text-text2"><Icon name="shield" size={13} className="inline -mt-0.5 mr-1.5 text-text3" />{t('editor.safety')}</p>
      </div>
      {error && <p className="t-ui text-danger">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>{t('common:actions.cancel')}</Button>
        <Button variant="primary" loading={saving} disabled={!valid} onClick={() => void save()}>{d.id ? t('editor.save') : t('editor.create')}</Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="t-ui font-medium text-text2 mb-2">{label}</div>
      {children}
    </div>
  )
}

function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input type="time" value={value} aria-label={label} onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && onChange(e.target.value)}
      className="h-8 rounded-[8px] bg-field border-[0.5px] border-line px-2 t-ui tabular text-text outline-none focus:border-accent-line" />
  )
}

/** L M X J V S D (lunes primero): el día elegido en el velo del acento. Vacío = todos. */
function WeekdayPicker({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="flex gap-1">
      {WEEKDAYS.mondayFirst.map((d) => {
        const on = days.length === 0 || days.includes(d)
        return (
          <button key={d} aria-pressed={on} aria-label={weekdayName(d)} onClick={() => {
            const cur = new Set(days.length ? days : WEEKDAYS.all)
            if (cur.has(d)) cur.delete(d)
            else cur.add(d)
            onChange(cur.size === 7 || cur.size === 0 ? [] : [...cur].sort((a, b) => a - b))
          }}
            className={cx('w-8 h-8 rounded-full t-ui font-semibold transition-colors', on ? 'bg-accent-wash text-accent-text' : 'bg-fill2 text-text3 hover:text-text')}>
            {i18n.language === 'es' ? weekdayName(d, 'narrow') : weekdayName(d, 'short').slice(0, 2)}
          </button>
        )
      })}
    </div>
  )
}

/** ISO → valor de `datetime-local` (hora local). */
function localInput(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
