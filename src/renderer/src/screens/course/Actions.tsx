// Acciones del menú «…» del curso: editar (nombre, icono pixel-art, color y examen), exportar, ver y deshacer los cambios
// que hizo Aula, y eliminar.
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Button, ConfirmDialog, CourseIcon, Dialog, Drawer, Icon, Select, Spinner, Switch, TextField, TONES, toast, cx, toneForHue } from '@renderer/design'
import { api, isAulaError } from '@renderer/lib/api'
import { fmtDate } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { CourseIconCatalog, type IconCategory } from '@shared/schema/courseIcons'
import type { Pack } from '@shared/schema/pack'
import type { ChangeGroupSummary, UndoPlan } from '@shared/schema'
import type { CourseMetaPatch } from '@shared/schema/library'

export type CourseAction = 'edit' | 'export' | 'history' | 'delete' | null

/** Otras partes de la pantalla del curso piden abrir «Editar el curso» con este evento. */
export const COURSE_EDIT_EVENT = 'aula:course-edit'

export function CourseActions({ pack, action, onClose }: { pack: Pack; action: CourseAction; onClose: () => void }) {
  return (
    <>
      <EditDialog pack={pack} open={action === 'edit'} onClose={onClose} />
      <ExportDialog pack={pack} open={action === 'export'} onClose={onClose} />
      <HistoryDrawer pack={pack} open={action === 'history'} onClose={onClose} />
      <DeleteDialog pack={pack} open={action === 'delete'} onClose={onClose} />
    </>
  )
}

function errorText(e: unknown): string {
  return isAulaError(e) || e instanceof Error ? e.message : String(e)
}

/** «AAAA-MM-DD» local de una fecha ISO (para el campo de fecha). */
function dateInput(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** El día elegido a las 9:00 locales, en ISO. */
function fromDateInput(v: string): string | null {
  if (!v) return null
  const [y, m, d] = v.split('-').map(Number)
  const date = new Date(y, m - 1, d, 9, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// MARK: Editar

function EditDialog({ pack, open, onClose }: { pack: Pack; open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['course', 'common'])
  const [title, setTitle] = useState(pack.title)
  const [subject, setSubject] = useState(pack.subject ?? '')
  const [code, setCode] = useState(pack.courseCode ?? '')
  const [icon, setIcon] = useState(CourseIconCatalog.resolve(pack.icon ?? '', pack.subject ?? '', pack.title))
  const [hue, setHue] = useState(pack.hue ?? 0.03)
  const [selfPaced, setSelfPaced] = useState(!!pack.selfPaced || !pack.exam)
  const [examTitle, setExamTitle] = useState(pack.exam?.title ?? '')
  const [examDate, setExamDate] = useState(dateInput(pack.exam?.date))
  const [category, setCategory] = useState<IconCategory>(CourseIconCatalog.entry(icon)?.category ?? 'general')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(pack.title)
    setSubject(pack.subject ?? '')
    setCode(pack.courseCode ?? '')
    const ic = CourseIconCatalog.resolve(pack.icon ?? '', pack.subject ?? '', pack.title)
    setIcon(ic)
    setCategory(CourseIconCatalog.entry(ic)?.category ?? 'general')
    setHue(pack.hue ?? 0.03)
    setSelfPaced(!!pack.selfPaced || !pack.exam)
    setExamTitle(pack.exam?.title ?? '')
    setExamDate(dateInput(pack.exam?.date))
  }, [open, pack])

  const save = async () => {
    if (!title.trim()) return
    setSaving(true)
    const patch: CourseMetaPatch = { title: title.trim(), subject: subject.trim(), courseCode: code.trim() || null, icon, hue, selfPaced }
    if (selfPaced) patch.exam = null
    else patch.exam = { title: examTitle.trim() || t('edit.defaultExam'), date: fromDateInput(examDate) }
    try {
      await api.invoke('courses.update', { id: pack.id, patch })
      toast.success(t('edit.saved'))
      onClose()
    } catch (e) {
      toast.error(t('edit.failed'), errorText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t('edit.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button variant="primary" loading={saving} disabled={!title.trim()} onClick={() => void save()}>
            {t('common:actions.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 @container">
        <div className="flex items-start gap-4">
          <motion.div key={icon + hue} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 22 }}>
            <CourseIcon icon={icon} hue={hue} size={72} radius={20} animation="drop" />
          </motion.div>
          <div className="grid gap-3 flex-1 min-w-0">
            <TextField label={t('edit.name')} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            <div className="grid grid-cols-2 gap-3">
              <TextField label={t('edit.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} />
              <TextField label={t('edit.code')} value={code} placeholder="MATH 101" onChange={(e) => setCode(e.target.value)} />
            </div>
          </div>
        </div>

        <div>
          <div className="t-ui font-medium text-text2 mb-2">{t('edit.color')}</div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('edit.color')}>
            {TONES.map((tone) => {
              const on = toneForHue(hue).name === tone.name
              return (
                <button
                  key={tone.name}
                  role="radio"
                  aria-checked={on}
                  aria-label={tone.name}
                  onClick={() => setHue(tone.hue)}
                  className={cx('h-8 w-8 rounded-full grid place-items-center transition-transform hover:scale-110', on && 'ring-2 ring-offset-2 ring-offset-raised ring-text2')}
                  style={{ background: tone.fillLight }}
                >
                  {on && <Icon name="check" size={14} className="text-white" />}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="t-ui font-medium text-text2">{t('edit.icon')}</div>
            <div className="w-[190px]">
              <Select value={category} onChange={(v) => setCategory(v)} options={CourseIconCatalog.categories.map((c) => ({ value: c, label: t(`edit.categories.${c}`) }))} />
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-1.5 max-h-[170px] overflow-y-auto p-1 -m-1">
            {CourseIconCatalog.entries(category).map((e) => (
              <button
                key={e.id}
                onClick={() => setIcon(e.id)}
                aria-pressed={icon === e.id}
                aria-label={e.id}
                title={e.id}
                className={cx('h-12 rounded-[12px] grid place-items-center transition-colors', icon === e.id ? 'bg-accent-wash ring-[1.5px] ring-accent-line' : 'hover:bg-fill1')}
              >
                <CourseIcon icon={e.id} hue={hue} size={34} />
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[16px] bg-sunken p-4 grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="t-ui font-medium text-text">{t('edit.selfPaced')}</div>
              <div className="t-footnote text-text3">{t('edit.selfPacedHint')}</div>
            </div>
            <Switch checked={selfPaced} onChange={setSelfPaced} label={t('edit.selfPaced')} />
          </div>
          {!selfPaced && (
            <div className="grid grid-cols-2 gap-3">
              <TextField label={t('edit.examTitle')} value={examTitle} placeholder={t('edit.defaultExam')} onChange={(e) => setExamTitle(e.target.value)} />
              <TextField label={t('edit.examDate')} type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}

// MARK: Exportar

function ExportDialog({ pack, open, onClose }: { pack: Pack; open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['course', 'common'])
  const [withProgress, setWithProgress] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const r = await api.invoke('courses.export', { id: pack.id, includeProgress: withProgress })
      if (r) {
        toast.success(t('exportDialog.done'), r.path)
        onClose()
      }
    } catch (e) {
      toast.error(t('exportDialog.failed'), errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={t('exportDialog.title')}
      description={t('exportDialog.body')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void run()}>
            {t('exportDialog.action')}
          </Button>
        </>
      }
    >
      <div className="flex items-center justify-between gap-4 rounded-[14px] bg-sunken px-4 py-3">
        <div>
          <div className="t-ui font-medium">{t('exportDialog.progress')}</div>
          <div className="t-footnote text-text3">{t('exportDialog.progressHint')}</div>
        </div>
        <Switch checked={withProgress} onChange={setWithProgress} label={t('exportDialog.progress')} />
      </div>
    </Dialog>
  )
}

// MARK: Eliminar

function DeleteDialog({ pack, open, onClose }: { pack: Pack; open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['course', 'common'])
  const remove = async () => {
    try {
      await api.invoke('courses.delete', { id: pack.id })
      toast.success(t('deleteDialog.done', { title: pack.title }))
      navigate({ name: 'home' }, { replace: true })
    } catch (e) {
      toast.error(t('deleteDialog.failed'), errorText(e))
    }
  }
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={() => void remove()}
      danger
      title={t('deleteDialog.title', { title: pack.title })}
      description={t('deleteDialog.body')}
      confirmLabel={t('common:actions.delete')}
      cancelLabel={t('common:actions.cancel')}
    />
  )
}

// MARK: Cambios de Aula (deshacer)

function HistoryDrawer({ pack, open, onClose }: { pack: Pack; open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['course', 'common'])
  const [groups, setGroups] = useState<ChangeGroupSummary[] | null>(null)
  const [plan, setPlan] = useState<UndoPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useMemo(
    () => () => {
      setGroups(null)
      api
        .invoke('history.list', { courseId: pack.id, limit: 50 })
        .then(setGroups)
        .catch(() => setGroups([]))
    },
    [pack.id]
  )
  useEffect(() => {
    if (open) load()
  }, [open, load])

  const ask = async (groupId: string) => {
    try {
      setPlan(await api.invoke('history.plan', { groupId }))
    } catch (e) {
      toast.error(t('history.failed'), errorText(e))
    }
  }
  const undo = async () => {
    if (!plan) return
    setBusy(true)
    try {
      await api.invoke('history.undo', { groupId: plan.group.id })
      toast.success(t('history.undone'))
      setPlan(null)
      load()
    } catch (e) {
      toast.error(t('history.failed'), errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={t('history.title')} width={460}>
      <p className="t-footnote text-text3 mb-4">{t('history.body')}</p>
      {groups == null ? (
        <div className="grid place-items-center py-10">
          <Spinner size={18} />
        </div>
      ) : groups.length === 0 ? (
        <div className="t-body text-text2 py-6">{t('history.empty')}</div>
      ) : (
        <div className="grid gap-2.5">
          {groups.map((g, i) => (
            <motion.div key={g.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className={cx('rounded-[16px] border-[0.5px] border-line bg-surface p-3.5', g.isUndone && 'opacity-60')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="t-callout font-medium text-text">{g.label || t(`history.kinds.${g.kind}`)}</div>
                  <div className="t-caption text-text3">
                    {t(`history.kinds.${g.kind}`)} · {fmtDate(g.updatedAt, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
                {g.isUndone ? (
                  <span className="t-caption text-text3 shrink-0">{t('history.wasUndone')}</span>
                ) : (
                  <Button size="sm" variant="secondary" icon={<Icon name="undo" size={14} />} onClick={() => void ask(g.id)}>
                    {t('history.undo')}
                  </Button>
                )}
              </div>
              {g.lines.length > 0 && (
                <ul className="mt-2 grid gap-0.5">
                  {g.lines.slice(0, 4).map((l, k) => (
                    <li key={k} className="t-footnote text-text2 truncate">
                      · {l.text}
                    </li>
                  ))}
                  {g.lines.length > 4 && <li className="t-caption text-text3">{t('history.more', { count: g.lines.length - 4 })}</li>}
                </ul>
              )}
            </motion.div>
          ))}
        </div>
      )}
      <Dialog
        open={!!plan}
        onClose={() => setPlan(null)}
        size="sm"
        title={t('history.confirmTitle')}
        description={plan?.group.label}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPlan(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="primary" loading={busy} disabled={!plan?.canUndo} onClick={() => void undo()}>
              {t('history.undo')}
            </Button>
          </>
        }
      >
        {plan && (
          <div className="grid gap-2">
            {plan.lines.slice(0, 6).map((l, k) => (
              <div key={k} className="t-footnote text-text2">
                · {l.text}
              </div>
            ))}
            {plan.alsoUndo.length > 0 && <div className="t-footnote text-warning">{t('history.alsoUndo', { count: plan.alsoUndo.length })}</div>}
            {plan.conflicts > 0 && <div className="t-footnote text-text3">{t('history.conflicts', { count: plan.conflicts })}</div>}
            {plan.problems.map((p, k) => (
              <div key={`p${k}`} className="t-footnote text-danger">
                {p}
              </div>
            ))}
          </div>
        )}
      </Dialog>
    </Drawer>
  )
}

