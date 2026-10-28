// Nuevo curso: una sola página, sin asistente de pasos. Qué quieres estudiar (y cuándo), tus materiales (arrastrar,
// pegar o traerlos de tu plataforma) y, si quieres, más detalles. Un botón y el equipo de Aula se pone a trabajar.
// Lo escrito es un borrador (draftStore): no se pierde al ir a otra pantalla ni al cerrar Aula (A3-P1-3).
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Card, Chip, Companion, ConfirmDialog, Icon, Select, Spinner, Switch, TextArea, TextField, cx, spring, toast, pixelBurst } from '@renderer/design'
import type { CreateRequest, GenerationDepth, MaterialView } from '@shared/generation/types'
import { CourseLanguages } from '@engine/base/language'
import { useRoute, navigate } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { api } from '@renderer/lib/api'
import { useRpc } from '@renderer/lib/useRpc'
import { useSettings } from '@renderer/lib/settings'
import { isDemo } from '@renderer/lib/demo'
import { formFromPrefill, hasDraftContent, useCreateDraft, type LessonMode, type PendingMaterial } from './draftStore'

const LEVELS = ['school', 'highschool', 'university', 'official', 'language', 'hobby'] as const
type DraftResult = { draftId: string; materials: MaterialView[] }
const LESSON_MODES: LessonMode[] = ['stepByStep', 'explore', 'read']
/** Los idiomas en los que Aula escribe cursos, cada uno con su propio nombre. */
const COURSE_LANGUAGES = CourseLanguages.all.map((l) => ({ value: l.id, label: l.nativeName }))

export default function CreateScreen() {
  const { t, i18n } = useTranslation('create')
  useScreenTitle(t('title'))
  const route = useRoute()
  const prefill = route.name === 'create' ? route.prefill : undefined
  const settings = useSettings((s) => s.settings)
  const draft = useCreateDraft()
  const { title, date, level, topics, examNotes, more, depth, verify, lessonMode, pickedLanguage, draftId, materials, gather, pending } = draft
  const set = draft.set
  const setTitle = (v: string) => set({ title: v })
  const setDate = (v: string) => set({ date: v })
  const setLevel = (v: string | null) => set({ level: v })
  const setTopics = (v: string) => set({ topics: v })
  const setExamNotes = (v: string) => set({ examNotes: v })
  const setMore = (f: (v: boolean) => boolean) => set({ more: f(useCreateDraft.getState().more) })
  const setDepth = (v: GenerationDepth) => set({ depth: v })
  const web = draft.web ?? settings?.data.webSearch ?? true
  const setWeb = (v: boolean) => set({ web: v })
  const setVerify = (v: boolean) => set({ verify: v })
  const setLessonMode = (v: LessonMode) => set({ lessonMode: v })
  // el idioma del curso sigue al de la interfaz hasta que la persona elige otro
  const setPickedLanguage = (v: string | null) => set({ pickedLanguage: v })
  const language = pickedLanguage ?? CourseLanguages.find(i18n.language)?.id ?? 'es'
  const setMaterials = (list: MaterialView[]) => set({ materials: list })
  const official = useMemo(() => new Set(draft.official), [draft.official])
  const setGather = (v: string | null) => set({ gather: v })
  const setPending = (p: PendingMaterial) => set({ pending: p })
  const [busy, setBusy] = useState(false)
  const [prefillConflict, setPrefillConflict] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const filled = hasDraftContent(draft, materials)
  const { data: platforms } = useRpc('platforms.list', undefined)
  const { data: aiStatus } = useRpc('ai.status' as never, undefined as never)
  const ready = (aiStatus as { ready?: boolean } | undefined)?.ready ?? isDemo()
  const signedPlatforms = (platforms ?? []).filter((p) => p.status === 'signedIn')

  useEffect(
    () =>
      api.on('create.material', ({ draftId: d, material }) => {
        if (d !== useCreateDraft.getState().draftId) return
        set({ materials: useCreateDraft.getState().materials.map((m) => (m.id === material.id ? material : m)) })
      }),
    [set]
  )
  // al volver (o tras cerrar Aula): los materiales del borrador, con lo que se leyó mientras tanto
  useEffect(() => {
    const id = useCreateDraft.getState().draftId
    if (!id || isDemo()) return
    let alive = true
    api
      .invoke('create.draft', { draftId: id })
      .then((list) => alive && set({ materials: list }))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [set])
  // una propuesta nueva de la ruta (desde el calendario, el chat…): si ya hay un borrador con algo, se pregunta antes de pisarlo
  const prefillKey = prefill ? JSON.stringify(prefill) : undefined
  useEffect(() => {
    if (!prefill || !prefillKey || prefillKey === useCreateDraft.getState().prefillKey) return
    const st = useCreateDraft.getState()
    if (hasDraftContent(st, st.materials)) setPrefillConflict(prefillKey)
    else st.reset(formFromPrefill(prefill, prefillKey))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillKey])
  /** Empezar de cero: el borrador del proceso principal (lo leído) también se borra. */
  const discard = (next?: Parameters<typeof draft.reset>[0]) => {
    const id = useCreateDraft.getState().draftId
    if (id && !isDemo()) void api.invoke('create.discardDraft', { draftId: id }).catch(() => undefined)
    useCreateDraft.getState().reset(next)
  }

  const addResult = (r: DraftResult) => {
    set({ draftId: r.draftId, materials: r.materials })
  }
  /** Añade lo pegado o escrito (texto o enlace) y lo quita del campo. */
  const addPending = async (): Promise<DraftResult | null> => {
    const value = pending.value.trim()
    if (pending.mode === 'none' || !value) return null
    const r = pending.mode === 'text' ? await api.invoke('create.addText', { text: value, draftId }) : await api.invoke('create.addURL', { url: value, draftId })
    addResult(r)
    setPending({ mode: 'none', value: '' })
    return r
  }
  const addFiles = async (paths: string[]) => {
    if (!paths.length) return
    try {
      addResult(await api.invoke('create.addFiles', { paths, draftId }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const start = async (el: HTMLElement) => {
    if (!title.trim()) return toast.warning(t('needTitle'))
    setBusy(true)
    // lo pegado sin pulsar «Añadir» también cuenta (antes se perdía y el curso salía sin materiales)
    let staged: DraftResult = { draftId: draftId ?? '', materials }
    try {
      staged = (await addPending()) ?? staged
    } catch (e) {
      setBusy(false)
      return toast.error((e as Error).message)
    }
    const request: CreateRequest = {
      title: title.trim(),
      level: level ? t(`levels.${level}`) : undefined,
      language,
      examDate: date ? new Date(`${date}T09:00:00`).toISOString() : undefined,
      topics: topics.trim() || undefined,
      examNotes: examNotes.trim() || undefined,
      // los que aún se están leyendo también: el proceso principal espera a que terminen antes de crear el curso
      materialIds: staged.materials.filter((m) => m.status !== 'failed').map((m) => m.id),
      officialIds: [...official],
      depth,
      lessonMode,
      allowWeb: web,
      verify,
      gather: gather ? { accountId: gather === 'auto' ? signedPlatforms[0]?.id ?? '' : gather } : undefined,
      eventId: useCreateDraft.getState().eventId ?? prefill?.eventId
    }
    try {
      const r = await api.invoke('create.start', { draftId: staged.draftId || undefined, request })
      pixelBurst(el)
      // el borrador ya es un curso: la próxima vez, el formulario vacío
      useCreateDraft.getState().reset(emptyAfterStart(prefillKey))
      navigate({ name: 'run', id: r.runId })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-24">
      <div className="mx-auto max-w-[1080px] grid grid-cols-12 gap-4">
        <Card padded="lg" className="col-span-12" enterAnim>
          <div className="flex items-start gap-5">
            <div className="hidden @3xl:block pt-1">
              <Companion role="planner" size={56} working={!!title} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="t-title1">{t('heading')}</h1>
              <p className="t-callout text-text2 mt-1">{t('subheading')}</p>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('titlePlaceholder')}
                className="mt-5 w-full bg-transparent font-serif text-[28px] leading-9 outline-none placeholder:text-text3 border-b-[1.5px] border-line focus:border-accent pb-2 transition-colors"
              />
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                <label className="flex items-center gap-2 t-ui text-text2">
                  <Icon name="calendar" size={15} />
                  {t('examDate')}
                  <input type="date" aria-label={t('examDate')} value={date} onChange={(e) => setDate(e.target.value)} className="h-8 rounded-[8px] bg-field border-[0.5px] border-line px-2 t-ui text-text outline-none" />
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="t-ui text-text2 mr-1">{t('level')}</span>
                  {LEVELS.map((l) => (
                    <Chip key={l} active={level === l} onClick={() => setLevel(level === l ? null : l)}>
                      {t(`levels.${l}`)}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card>

        <div className="col-span-12 @4xl:col-span-7 flex flex-col">
          <Materials materials={materials} official={official} onToggleOfficial={(id) => set({ official: official.has(id) ? draft.official.filter((x) => x !== id) : [...draft.official, id] })} onFiles={(p) => void addFiles(p)} pending={pending} onPending={setPending} onAddPending={async () => void (await addPending())} onRemove={async (id) => { if (draftId) setMaterials(await api.invoke('create.removeMaterial', { draftId, materialId: id })) }} />
          {signedPlatforms.length > 0 && (
            <Card padded="sm" className="mt-4">
              <div className="flex items-center gap-3">
                <Companion role="gatherer" size={40} working={!!gather} />
                <div className="flex-1 min-w-0">
                  <div className="t-callout font-medium">{t('fromPlatform', { platform: signedPlatforms[0].label })}</div>
                  <div className="t-ui text-text3">{t('fromPlatformHint')}</div>
                </div>
                <Switch checked={!!gather} onChange={(v) => setGather(v ? signedPlatforms[0].id : null)} label={t('fromPlatform', { platform: signedPlatforms[0].label })} />
              </div>
            </Card>
          )}
        </div>

        <div className="col-span-12 @4xl:col-span-5 flex flex-col gap-4">
          <Card padded="lg">
            <div className="t-headline">{t('depth')}</div>
            <div className="mt-3 flex flex-col gap-2">
              {(['quick', 'standard', 'deep'] as GenerationDepth[]).map((d) => (
                <motion.button key={d} whileTap={{ scale: 0.98 }} onClick={() => setDepth(d)} className={cx('relative text-left rounded-[14px] p-3 border-[0.5px] transition-colors', depth === d ? 'border-accent-line bg-accent-wash' : 'border-line hover:bg-fill1')}>
                  <div className="flex items-center justify-between">
                    <span className="t-callout font-semibold">{t(`depths.${d}.title`)}</span>
                    {depth === d && <Icon name="check" size={15} className="text-accent-text" />}
                  </div>
                  <div className="t-ui text-text2 mt-0.5">{t(`depths.${d}.body`)}</div>
                </motion.button>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex items-center justify-between gap-3 t-callout">
                {t('web')}
                <Switch checked={web} onChange={setWeb} size="sm" label={t('web')} />
              </label>
              <label className="flex items-center justify-between gap-3 t-callout">
                {t('verify')}
                <Switch checked={verify} onChange={setVerify} size="sm" label={t('verify')} />
              </label>
            </div>
          </Card>
          <Card padded="lg">
            <button className="flex w-full items-center justify-between t-headline" onClick={() => setMore((v) => !v)}>
              {t('more')}
              <Icon name="chevron-down" size={15} className={cx('text-text3 transition-transform', more && 'rotate-180')} />
            </button>
            <AnimatePresence initial={false}>
              {more && (
                <motion.div className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.smooth}>
                  <div className="flex flex-col gap-3 pt-4">
                    <TextArea label={t('topics')} rows={3} autoGrow value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={t('topicsPlaceholder')} />
                    <TextArea label={t('examNotes')} rows={2} autoGrow value={examNotes} onChange={(e) => setExamNotes(e.target.value)} placeholder={t('examNotesPlaceholder')} />
                    <LessonModePicker value={lessonMode} onChange={setLessonMode} />
                    <Select label={t('courseLanguage')} value={language} onChange={setPickedLanguage} options={COURSE_LANGUAGES} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </div>

        <div className="col-span-12 flex flex-col items-center gap-3 mt-2">
          {!ready && (
            <div className="flex items-center gap-3 t-callout text-text2">
              {t('noAI')} · {t('noAIBody')}
              <Button size="sm" variant="plain" onClick={() => navigate({ name: 'settings' })}>
                {t('chooseAI')}
              </Button>
            </div>
          )}
          <Button variant="primary" size="xl" className="min-w-[240px]" loading={busy} disabled={!title.trim() || !ready} onClick={(e) => void start(e.currentTarget)} icon={<Icon name="create" size={18} />}>
            {busy ? t('creating') : t('create')}
          </Button>
          {filled && !busy && (
            <Button size="sm" variant="plain" data-testid="create-discard" onClick={() => setConfirmDiscard(true)}>
              {t('draft.discard')}
            </Button>
          )}
        </div>
        <ConfirmDialog
          open={confirmDiscard}
          onClose={() => setConfirmDiscard(false)}
          onConfirm={() => discard()}
          title={t('draft.discardTitle')}
          description={t('draft.discardBody')}
          confirmLabel={t('draft.discardConfirm')}
          cancelLabel={t('draft.keep')}
          danger
        />
        <ConfirmDialog
          open={prefillConflict !== null}
          onClose={() => {
            // seguir con el borrador: esta propuesta ya no vuelve a preguntar
            if (prefillConflict) set({ prefillKey: prefillConflict })
            setPrefillConflict(null)
          }}
          onConfirm={() => {
            if (prefill && prefillConflict) discard(formFromPrefill(prefill, prefillConflict))
            setPrefillConflict(null)
          }}
          title={t('draft.replaceTitle')}
          description={title.trim() ? t('draft.replaceBody', { title: title.trim() }) : t('draft.replaceBodyUntitled')}
          confirmLabel={t('draft.replaceConfirm')}
          cancelLabel={t('draft.keep')}
        />
      </div>
    </div>
  )
}

/** Cómo serán las lecciones: paso a paso (por defecto), explorar o solo leer; una línea cada una. */
function LessonModePicker({ value, onChange }: { value: LessonMode; onChange: (m: LessonMode) => void }) {
  const { t } = useTranslation('create')
  return (
    <div>
      <span className="block t-ui font-medium text-text2 mb-1.5">{t('lessonMode')}</span>
      <div role="radiogroup" aria-label={t('lessonMode')} className="flex flex-col gap-1.5">
        {LESSON_MODES.map((m) => (
          <motion.button
            key={m}
            role="radio"
            aria-checked={value === m}
            whileTap={{ scale: 0.98 }}
            onClick={() => onChange(m)}
            className={cx('flex items-center gap-3 rounded-[12px] px-3 py-2 text-left border-[0.5px] transition-colors', value === m ? 'border-accent-line bg-accent-wash' : 'border-line hover:bg-fill1')}
          >
            <span className="flex-1 min-w-0">
              <span className="t-callout font-semibold">{t(`lessonModes.${m}.title`)}</span>
              <span className="t-ui text-text2"> · {t(`lessonModes.${m}.body`)}</span>
            </span>
            {value === m && <Icon name="check" size={15} className="text-accent-text shrink-0" />}
          </motion.button>
        ))}
      </div>
    </div>
  )
}

function Materials({ materials, official, onToggleOfficial, onFiles, pending, onPending, onAddPending, onRemove }: { materials: MaterialView[]; official: Set<string>; onToggleOfficial: (id: string) => void; onFiles: (paths: string[]) => void; pending: PendingMaterial; onPending: (p: PendingMaterial) => void; onAddPending: () => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  const { t } = useTranslation('create')
  const [drag, setDrag] = useState(false)
  const { mode, value } = pending
  const setMode = (m: PendingMaterial['mode']) => onPending({ mode: m, value })
  const setValue = (v: string) => onPending({ mode, value: v })
  const picker = useRef<HTMLInputElement>(null)
  const filesToPaths = (list: FileList | null) => (list ? Array.from(list).map((f) => { try { return api.pathForFile(f) } catch { return '' } }).filter(Boolean) : [])
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    onFiles(filesToPaths(e.dataTransfer.files))
  }
  return (
    // la zona para soltar crece con la tarjeta (así no queda un hueco vacío junto a «Más detalles» abierto)
    <Card padded="lg" className="flex-1 flex flex-col">
      <div className="t-headline">{t('materials')}</div>
      <div className="t-ui text-text3 mt-0.5">{t('materialsHint')}</div>
      <motion.div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={drop}
        animate={{ scale: drag ? 1.01 : 1 }}
        className={cx('mt-4 flex-1 min-h-[180px] grid place-items-center rounded-[18px] border-[1.5px] border-dashed p-7 text-center transition-colors', drag ? 'border-accent bg-accent-wash' : 'border-line-strong/40 bg-sunken')}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-1.5">
            {['libro', 'sobre', 'nota'].map((id, i) => (
              <motion.div key={id} animate={drag ? { y: [0, -6, 0] } : { y: 0 }} transition={{ duration: 0.6, repeat: drag ? Infinity : 0, delay: i * 0.1 }}>
                <Companion id={id} size={36} working={drag} />
              </motion.div>
            ))}
          </div>
          <div className="t-callout text-text2">{t('drop')}</div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="md" icon={<Icon name="folder-open" size={15} />} onClick={() => picker.current?.click()}>
              {t('browse')}
            </Button>
            <Button size="md" variant="ghost" icon={<Icon name="note" size={15} />} onClick={() => setMode(mode === 'text' ? 'none' : 'text')}>
              {t('pasteText')}
            </Button>
            <Button size="md" variant="ghost" icon={<Icon name="link" size={15} />} onClick={() => setMode(mode === 'url' ? 'none' : 'url')}>
              {t('addLink')}
            </Button>
          </div>
          <input ref={picker} type="file" multiple hidden onChange={(e) => onFiles(filesToPaths(e.target.files))} />
        </div>
      </motion.div>
      <AnimatePresence>
        {mode !== 'none' && (
          <motion.div className="mt-3 flex items-end gap-2" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="flex-1">
              {mode === 'text' ? <TextArea rows={3} autoGrow value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('textPlaceholder')} /> : <TextField value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('linkPlaceholder')} />}
            </div>
            <Button
              size="lg"
              variant="secondary"
              aria-label={mode === 'text' ? t('addText') : t('addLinkNow')}
              icon={<Icon name="plus" size={16} />}
              disabled={!value.trim()}
              onClick={async () => {
                try {
                  await onAddPending()
                } catch (e) {
                  toast.error((e as Error).message)
                }
              }}
            >
              {t('add')}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-3 flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {materials.map((m) => (
            <motion.div key={m.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -10 }} className="flex items-center gap-3 rounded-[12px] px-2 py-2 hover:bg-fill1">
              <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-tile text-text2">{m.status === 'processing' ? <Spinner size={12} /> : <Icon name={m.kind === 'image' ? 'image' : 'file-text'} size={15} />}</span>
              <div className="min-w-0 flex-1">
                <div className="t-callout truncate">{m.title}</div>
                <div className={cx('t-ui', m.status === 'failed' ? 'text-danger' : 'text-text3')}>{m.status === 'processing' ? t('reading') : m.status === 'failed' ? m.error : t('pages', { count: m.pages })}</div>
              </div>
              <Chip active={official.has(m.id)} onClick={() => onToggleOfficial(m.id)}>
                {t('official')}
              </Chip>
              <button className="grid place-items-center w-7 h-7 rounded-[8px] text-text3 hover:text-text hover:bg-fill2" onClick={() => void onRemove(m.id)} aria-label="×">
                <Icon name="close" size={13} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Card>
  )
}

/** Tras empezar a crear el curso: el formulario vacío (la propuesta de la ruta ya está usada: volver atrás no la repite). */
function emptyAfterStart(prefillKey: string | undefined) {
  return { ...formFromPrefill({}, prefillKey ?? ''), prefillKey }
}
