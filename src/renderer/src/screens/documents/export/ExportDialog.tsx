// «Crear documento» (port de DocumentExportSheet.swift): elegir el tipo (guía, resumen, chuleta, tarjetas, examen de práctica,
// diapositivas), qué lecciones, cómo se ve y en qué formato, con la vista previa de las páginas tal como saldrán (el mismo PDF
// que se guarda). Guardar como… (PDF, Word o Markdown) o guardar en el curso (Referencia → Documentos).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { DocumentCourse, DocumentFormat, DocumentKind, DocumentRequest, DocumentStyle } from '@shared/documents'
import { defaultDocumentStyle, DOCUMENT_KINDS } from '@shared/documents'
import type { Pack } from '@shared/schema'
import { orderedSkills } from '@shared/schema'
import { AulaMark, Button, Dialog, Icon, IconButton, SegmentedTabs, Select, Switch, Tooltip, cx, toast, type IconName } from '@renderer/design'
import i18n from '@renderer/i18n'
import { api } from '@renderer/lib/api'
import { openPdf, pageThumbnail } from '../pdf'

const KIND_ICONS: Record<DocumentKind, IconName> = { guide: 'book', summary: 'note', cheatsheet: 'reference', flashcards: 'cards', exam: 'exam', slides: 'layers' }
const MEMORY = 'aula.documents.export'

interface Memory { kind: DocumentKind; style: DocumentStyle; format: DocumentFormat }

function loadMemory(): Memory {
  const paper = /^(en-US|en-CA|es-MX|en-PH|es-CL|es-CO|es-VE|es-GT|es-CR|es-PR|es-DO|es-PA|es-SV|es-NI|es-HN|es-BO)/.test(navigator.language) ? 'letter' : 'a4'
  const base: Memory = { kind: 'guide', style: defaultDocumentStyle(paper), format: 'pdf' }
  try {
    const raw = JSON.parse(localStorage.getItem(MEMORY) ?? 'null') as Partial<Memory> | null
    if (!raw) return base
    return { kind: DOCUMENT_KINDS.includes(raw.kind as DocumentKind) ? (raw.kind as DocumentKind) : base.kind, style: { ...base.style, ...(raw.style ?? {}), seed: undefined }, format: raw.format === 'docx' || raw.format === 'markdown' ? raw.format : 'pdf' }
  } catch {
    return base
  }
}

type ScopeMode = 'all' | 'done' | 'pick'

export function ExportDialog({ open, onClose, courses, courseId }: { open: boolean; onClose: () => void; courses: DocumentCourse[]; courseId?: string }) {
  const { t } = useTranslation('documents')
  const [mem] = useState(loadMemory)
  const [kind, setKind] = useState<DocumentKind>(mem.kind)
  const [style, setStyle] = useState<DocumentStyle>(mem.style)
  const [format, setFormat] = useState<DocumentFormat>(mem.format)
  const [course, setCourse] = useState<string | undefined>(courseId ?? courses[0]?.id)
  const [scopeMode, setScopeMode] = useState<ScopeMode>('all')
  const [picked, setPicked] = useState<string[]>([])
  const [pack, setPack] = useState<Pack | null>(null)

  useEffect(() => { if (open) setCourse(courseId ?? course ?? courses[0]?.id) }, [open, courseId, courses]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !course) return
    setPack(null)
    void api.invoke('courses.get', { id: course }).then((p) => setPack(p)).catch(() => setPack(null))
  }, [open, course])
  useEffect(() => {
    try { localStorage.setItem(MEMORY, JSON.stringify({ kind, style: { ...style, seed: undefined }, format })) } catch { /* sin memoria */ }
  }, [kind, style, format])

  const skills = useMemo(() => (pack ? orderedSkills(pack) : []), [pack])
  const request: DocumentRequest | null = useMemo(() => {
    if (!course) return null
    const s: DocumentStyle = { ...style }
    if (kind !== 'guide') s.includeNotes = false
    return {
      kind, courseID: course, style: s, format, lang: i18n.language,
      scope: scopeMode === 'all' ? { skillIDs: [], unitIDs: [], onlyDone: false } : scopeMode === 'done' ? { skillIDs: [], unitIDs: [], onlyDone: true } : { skillIDs: skills.map((x) => x.id).filter((id) => picked.includes(id)), unitIDs: [], onlyDone: false }
    }
  }, [course, kind, style, format, scopeMode, picked, skills])

  // los tipos que no salen de este curso y estas lecciones (un curso sin tarjetas no tiene tarjetas para imprimir): se ven
  // apagados, con el motivo, y no se piden; si el elegido no sale (al cambiar de curso, o el que se recordaba), el primero que sí
  const unavailable = useUnavailableKinds(open ? request : null)
  const someKind = DOCUMENT_KINDS.find((k) => !unavailable?.[k])
  const switching = !!unavailable?.[kind] && !!someKind
  useEffect(() => { if (switching && someKind) setKind(someKind) }, [switching, someKind])
  const preview = usePreview(open && unavailable && !switching ? request : null)
  const [saving, setSaving] = useState<'file' | 'course' | null>(null)
  const save = async (target: 'file' | 'course'): Promise<void> => {
    if (!request) return
    setSaving(target)
    try {
      const r = await api.invoke('documents.save', { request, target, ...(format === 'pdf' && preview.token ? { token: preview.token } : {}) })
      if (!r) return
      const path = r.path
      if (target === 'course') toast.success(t('export.savedInCourse'))
      else toast.action(t('export.saved'), { label: t('export.show'), run: () => void api.invoke('documents.revealSaved', { path }).catch(() => undefined) }, path.split(/[\\/]/).pop())
      onClose()
    } catch (e) {
      toast.error(t('export.saveFailed'), e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  const set = <K extends keyof DocumentStyle>(k: K, v: DocumentStyle[K]): void => setStyle((s) => ({ ...s, [k]: v }))
  const toggle = (label: string, k: keyof DocumentStyle, disabled = false) => (
    <OptionRow key={k} label={label} disabled={disabled}><Switch checked={Boolean(style[k])} disabled={disabled} onChange={(v) => set(k, v as never)} /></OptionRow>
  )

  return (
    <Dialog open={open} onClose={onClose} size="xl" title={t('export.title')} description={t('export.subtitle')}
      footer={
        <>
          <span className="mr-auto t-footnote">{format !== 'pdf' ? t('export.previewNote', { format: format === 'docx' ? 'Word' : 'Markdown' }) : preview.pages ? t('export.pages', { count: preview.pages }) : ''}</span>
          <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="secondary" disabled={!request || !!preview.error || !!saving} loading={saving === 'course'} onClick={() => void save('course')}>{t('export.saveCourse')}</Button>
          <Button variant="primary" disabled={!request || !!preview.error || !!saving} loading={saving === 'file'} icon={<Icon name="download" size={14} />} onClick={() => void save('file')}>{t('export.saveAs')}</Button>
        </>
      }>
      <div className="grid gap-6 md:grid-cols-[minmax(0,400px)_1fr]">
        <div className="flex max-h-[min(calc(88vh-236px),560px)] flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-2">
            {DOCUMENT_KINDS.map((k) => {
              // si no sale ninguno, el motivo es el alcance (lo dice la vista previa), no el tipo
              const why = someKind ? unavailable?.[k] : undefined
              const button = (
                <button key={k} onClick={() => { if (!why) setKind(k) }} aria-pressed={kind === k} aria-disabled={why ? true : undefined}
                  className={cx('flex min-h-[44px] w-full items-center gap-2.5 rounded-[12px] border px-3 py-2 text-left transition-colors', kind === k ? 'border-accent-line bg-accent-wash' : why ? 'cursor-default border-line-soft opacity-45' : 'border-line hover:bg-fill1')}>
                  <Icon name={KIND_ICONS[k]} size={16} className={kind === k ? 'text-accent-text' : 'text-text2'} />
                  <span className={cx('t-ui leading-tight', kind === k ? 'font-semibold' : 'font-medium')}>{t(`kinds.${k}.title`)}</span>
                  {why && <span className="sr-only">. {why}</span>}
                </button>
              )
              return why ? <Tooltip key={k} label={why}>{button}</Tooltip> : button
            })}
          </div>
          <p className="t-footnote -mt-1 px-0.5">{t(`kinds.${kind}.detail`)}</p>
          <div className="rounded-[16px] bg-sunken px-4 py-1">
            {courses.length > 1 && (
              <OptionRow label={t('export.course')}><Select value={course ?? null} onChange={(v) => { setCourse(v); setPicked([]) }} options={courses.map((c) => ({ value: c.id, label: c.title }))} className="w-[200px]" /></OptionRow>
            )}
            <OptionRow label={t('export.lessons')} hint={scopeMode === 'pick' ? t('export.picked', { n: picked.length, total: skills.length }) : undefined}>
              <Select value={scopeMode} onChange={(v) => { setScopeMode(v); if (v === 'pick' && !picked.length && skills[0]) setPicked([skills[0].id]) }} className="w-[200px]"
                options={[{ value: 'all', label: t('export.scope.all') }, { value: 'done', label: t('export.scope.done') }, { value: 'pick', label: t('export.scope.pick') }]} />
            </OptionRow>
            {scopeMode === 'pick' && pack && (
              <div className="max-h-[180px] overflow-y-auto border-t-[0.5px] border-line-soft py-2">
                {(pack.units.length ? pack.units : [{ id: '_', title: '', skillIDs: skills.map((s) => s.id) }]).map((u) => (
                  <div key={u.id} className="mb-1">
                    {u.title && <div className="t-caption font-semibold text-text3 mt-1 mb-0.5">{u.title}</div>}
                    {u.skillIDs.map((id) => skills.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s).map((s) => (
                      <label key={s.id} className="flex items-center gap-2 py-1 t-ui cursor-default">
                        <input type="checkbox" className="accent-[var(--accent)]" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} />
                        <span className="truncate">{s.title}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {kind === 'guide' && [
              toggle(t('export.opt.formulas'), 'includeFormulas', !!pack && !pack.formulaSheet.length),
              toggle(t('export.opt.glossary'), 'includeGlossary', !!pack && !pack.glossary.length),
              toggle(t('export.opt.mistakes'), 'includeMistakes'),
              toggle(t('export.opt.notes'), 'includeNotes')
            ]}
            {kind === 'summary' && toggle(t('export.opt.formulasEnd'), 'includeFormulas', !!pack && !pack.formulaSheet.length)}
            {kind === 'flashcards' && (
              <>
                <OptionRow label={t('export.opt.perPage')}>
                  <SegmentedTabs size="sm" value={String(style.cardsPerPage)} onChange={(v) => set('cardsPerPage', Number(v))} items={[{ id: '6', label: '6' }, { id: '8', label: '8' }, { id: '10', label: '10' }]} />
                </OptionRow>
                <OptionRow label={t('export.opt.duplex')} hint={style.duplex ? t('export.opt.duplexOn') : t('export.opt.duplexOff')}><Switch checked={style.duplex} onChange={(v) => set('duplex', v)} /></OptionRow>
              </>
            )}
            {kind === 'exam' && (
              <>
                <OptionRow label={t('export.opt.questions')} hint={style.questionCount === undefined ? t('export.opt.asExam') : undefined}>
                  <div className="flex items-center gap-1">
                    <Select value={String(style.questionCount ?? 0)} onChange={(v) => set('questionCount', Number(v) || undefined)} className="w-[150px]"
                      options={[{ value: '0', label: t('export.opt.asExamShort') }, ...[5, 10, 15, 20, 30].map((n) => ({ value: String(n), label: String(n) }))]} />
                    <IconButton label={t('export.opt.reshuffle')} size="sm" onClick={() => set('seed', Math.floor(Math.random() * 2 ** 31))}><Icon name="refresh" size={14} /></IconButton>
                  </div>
                </OptionRow>
                {toggle(t('export.opt.answers'), 'includeAnswers')}
                {toggle(t('export.opt.solutions'), 'includeSolutions', !style.includeAnswers)}
              </>
            )}
            {kind === 'slides' && <OptionRow label={t('export.opt.handout')} hint={t('export.opt.handoutHint')}><Switch checked={style.handout} onChange={(v) => set('handout', v)} /></OptionRow>}
            <OptionRow label={t('export.paper')}>
              <SegmentedTabs size="sm" value={style.paper} onChange={(v) => set('paper', v)} items={[{ id: 'a4', label: 'A4' }, { id: 'letter', label: t('export.letter') }]} />
            </OptionRow>
            <OptionRow label={t('export.font')}>
              <SegmentedTabs size="sm" value={String(style.fontSize)} onChange={(v) => set('fontSize', Number(v))} items={[{ id: '10', label: t('export.small') }, { id: '11', label: t('export.normal') }, { id: '12.5', label: t('export.large') }]} />
            </OptionRow>
            <OptionRow label={t('export.color')} hint={style.color ? undefined : t('export.colorHint')}><Switch checked={style.color} onChange={(v) => set('color', v)} /></OptionRow>
            <OptionRow label={t('export.format')}>
              <SegmentedTabs size="sm" value={format} onChange={setFormat} items={[{ id: 'pdf', label: 'PDF' }, { id: 'docx', label: 'Word' }, { id: 'markdown', label: 'Markdown' }]} />
            </OptionRow>
          </div>
        </div>
        <PreviewPane preview={preview} />
      </div>
    </Dialog>
  )
}

function OptionRow({ label, hint, disabled, children }: { label: string; hint?: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div className={cx('flex items-center gap-3 border-t-[0.5px] border-line-soft py-2.5 first:border-t-0', disabled && 'opacity-45')}>
      <div className="min-w-0 flex-1">
        <div className="t-ui font-medium">{label}</div>
        {hint && <div className="t-caption text-text3 mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

// MARK: - Vista previa

/** Los tipos que no salen del curso y las lecciones de la petición, con el motivo (null mientras se miran). */
function useUnavailableKinds(request: DocumentRequest | null): Partial<Record<DocumentKind, string>> | null {
  const key = request ? JSON.stringify({ course: request.courseID ?? '', scope: request.scope, lang: request.lang ?? '' }) : ''
  const [state, setState] = useState<{ key: string; unavailable: Partial<Record<DocumentKind, string>> } | null>(null)
  useEffect(() => {
    if (!request) return
    let alive = true
    // si no se puede mirar, se pide la vista previa igual (y ella dirá qué pasa)
    void api.invoke('documents.kinds', { request }).then((r) => r.unavailable, () => ({}))
      .then((unavailable) => { if (alive) setState({ key, unavailable }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state?.key === key ? state.unavailable : null
}

interface Preview { busy: boolean; error?: string; token?: string; pages: number; pdf?: PDFDocumentProxy }

/** Dibuja el PDF cuando las opciones se quedan quietas un momento (el mismo que luego se guarda). */
function usePreview(request: DocumentRequest | null): Preview {
  const [state, setState] = useState<Preview>({ busy: false, pages: 0 })
  const key = request ? JSON.stringify({ ...request, format: 'pdf' }) : ''
  const seq = useRef(0)
  useEffect(() => {
    if (!request) return
    const mine = ++seq.current
    setState((s) => ({ ...s, busy: true, error: undefined }))
    const id = setTimeout(() => {
      void api.invoke('documents.renderPDF', { request: { ...request, format: 'pdf' } }).then(async (r) => {
        const pdf = await openPdf(`preview:${r.token}`, r.data)
        if (mine === seq.current) setState({ busy: false, token: r.token, pages: r.pages || pdf.numPages, pdf })
      }).catch((e: unknown) => {
        if (mine === seq.current) setState({ busy: false, pages: 0, error: e instanceof Error ? e.message : String(e) })
      })
    }, 450)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

function PreviewPane({ preview }: { preview: Preview }) {
  const { t } = useTranslation('documents')
  const [page, setPage] = useState(1)
  const [src, setSrc] = useState<string | null>(null)
  const pages = preview.pdf?.numPages ?? 0
  useEffect(() => { setPage((p) => Math.min(p, Math.max(1, pages))) }, [pages])
  useEffect(() => {
    const pdf = preview.pdf
    if (!pdf || !preview.token) { setSrc(null); return }
    let alive = true
    void pageThumbnail(pdf, `preview:${preview.token}`, Math.min(page, pdf.numPages), 400).then((s) => alive && setSrc(s)).catch(() => undefined)
    return () => { alive = false }
  }, [preview.pdf, preview.token, page])
  return (
    <div className="flex h-[min(calc(88vh-236px),560px)] min-h-[300px] flex-col items-center gap-3">
      <div className="relative grid w-full flex-1 place-items-center overflow-hidden rounded-[18px] bg-sunken p-5">
        <AnimatePresence mode="wait">
          {preview.error && !preview.busy ? (
            <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-[300px] text-center">
              <AulaMark size={40} state="paused" />
              <div className="t-headline mt-3">{t('export.failed')}</div>
              <p className="t-footnote mt-1">{preview.error}</p>
            </motion.div>
          ) : preview.busy || !preview.pdf || !src ? (
            <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center text-center">
              <AulaMark size={44} state="working" />
              <div className="t-callout text-text2 mt-3">{t('export.preparing')}</div>
            </motion.div>
          ) : (
            <motion.div key={`p${page}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <img src={src} alt="" draggable={false} className="block max-h-[min(calc(88vh-330px),480px)] w-auto max-w-full rounded-[3px] bg-white shadow-[var(--e3)]" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="flex items-center gap-2">
        <IconButton label={t('reader.prev')} size="sm" disabled={page <= 1 || preview.busy} onClick={() => setPage((p) => p - 1)}><Icon name="chevron-left" size={14} /></IconButton>
        <span className="min-w-[120px] text-center t-footnote tabular">{pages && !preview.busy ? t('reader.pageOf', { n: page, total: pages }) : ' '}</span>
        <IconButton label={t('reader.next')} size="sm" disabled={page >= pages || preview.busy} onClick={() => setPage((p) => p + 1)}><Icon name="chevron-right" size={14} /></IconButton>
      </div>
    </div>
  )
}
