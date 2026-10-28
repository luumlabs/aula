// Materiales: las fuentes del curso (apuntes, libro, exámenes de repaso, web…) con su tipo, páginas y procedencia; abrir el
// original, leer el texto que extrajo Aula (por páginas) y añadir más: se leen al instante y pasan al curso en cuanto están
// leídos (aunque se salga de la pestaña); «Ampliar el curso con ellos» es un paso opcional (J2-7).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { Pack, SourceChunk, SourceMeta } from '@shared/schema'
import { decodeSourceChunk } from '@shared/schema'
import type { MaterialView } from '@shared/generation/types'
import { Button, Card, cx, Drawer, EmptyState, Icon, SectionTitle, Spinner, Stagger, StaggerItem, TextField, toast, type IconName } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { api } from '@renderer/lib/api'
import { isDemo } from '@renderer/lib/demo'
import { fmtDate } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { openCourseSource } from '@renderer/screens/documents/lib'
import { useInk } from '@renderer/screens/study/kit'
import { searchKey } from '@renderer/screens/study/tabs'
import { ResearchNote } from './ResearchNote'

const invoke = api.invoke as unknown as (m: string, a?: unknown) => Promise<unknown>
const demoChunks = import.meta.glob<unknown>('../../../../../resources/demo-course/Packs/*/sources/*/chunks.json', { import: 'default' })

const KIND_ICON: Record<string, IconName> = { pdf: 'file-text', docx: 'file-text', doc: 'file-text', pptx: 'layers', ppt: 'layers', image: 'image', web: 'globe', url: 'globe', text: 'note', canvas: 'browser', video: 'video', audio: 'audio', epub: 'book' }
const TRUST_TONE: Record<string, string> = { official: 'var(--accent-text)', book: 'var(--text2)', notes: 'var(--text2)', web: 'var(--text2)', canvas: 'var(--text2)', other: 'var(--text3)' }

/** Lee el texto extraído de un material (`sources/<id>/chunks.json`), en orden. */
async function loadChunks(packId: string, sourceId: string): Promise<SourceChunk[]> {
  let raw: unknown
  const demo = Object.entries(demoChunks).find(([p]) => p.includes(`/Packs/${packId}/sources/${sourceId}/`))
  if (demo && isDemo()) raw = await demo[1]()
  else {
    const res = await fetch(`aula-asset://pack/${encodeURIComponent(packId)}/sources/${encodeURIComponent(sourceId)}/chunks.json`)
    if (!res.ok) throw new Error(String(res.status))
    raw = await res.json()
  }
  const list = Array.isArray(raw) ? raw : []
  return list.map(decodeSourceChunk).filter((c): c is SourceChunk => !!c).sort((a, b) => a.ordinal - b.ordinal)
}

/** Los fragmentos agrupados por página (los que no la tienen, juntos al principio). */
export function chunksByPage(chunks: SourceChunk[]): { page?: number; chunks: SourceChunk[] }[] {
  const out: { page?: number; chunks: SourceChunk[] }[] = []
  for (const c of chunks) {
    const last = out[out.length - 1]
    if (last && last.page === c.page) last.chunks.push(c)
    else out.push({ page: c.page, chunks: [c] })
  }
  return out
}

export function MaterialsTab({ pack }: { pack: Pack }) {
  const { t } = useTranslation('study')
  const ink = useInk(pack)
  const [reading, setReading] = useState<SourceMeta | null>(null)
  const [added, setAdded] = useState<MaterialView[]>([])
  const [draftId, setDraftId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [drag, setDrag] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const sources = pack.sources
  const saved = useMemo(() => new Set(sources.map((x) => x.id)), [sources])

  useEffect(() => {
    if (!draftId) return
    return api.on('create.material', (e) => {
      if (e.draftId !== draftId) return
      setAdded((list) => (list.some((m) => m.id === e.material.id) ? list.map((m) => (m.id === e.material.id ? e.material : m)) : [...list, e.material]))
    })
  }, [draftId])

  const addPaths = async (paths: string[]): Promise<void> => {
    if (!paths.length) return
    setAdding(true)
    try {
      const r = (await invoke('create.addFiles', { paths, draftId: draftId ?? undefined })) as { draftId: string; materials: MaterialView[] }
      setDraftId(r.draftId)
      setAdded(r.materials)
      // al curso en cuanto se lean (lo hace el proceso principal, también si nos vamos de aquí)
      await invoke('create.attachToCourse', { packId: pack.id, draftId: r.draftId }).catch(() => undefined)
    } catch {
      toast.error(t('tab.materials.addFailed'))
    } finally {
      setAdding(false)
    }
  }
  const addFiles = (files: FileList | null): void => {
    if (!files?.length) return
    const paths = [...files].map((f) => {
      try {
        return api.pathForFile(f)
      } catch {
        return ''
      }
    }).filter(Boolean)
    void addPaths(paths)
  }
  const useForCourse = async (): Promise<void> => {
    const titles = added.filter((m) => m.status === 'ready').map((m) => `«${m.title}»`).join(', ')
    try {
      const r = (await invoke('generation.extend', { packId: pack.id, instruction: t('tab.materials.extendInstruction', { titles, draft: draftId ?? '' }) })) as { runId: string }
      navigate({ name: 'run', id: r.runId })
    } catch {
      navigate({ name: 'chat', prompt: t('tab.materials.extendInstruction', { titles, draft: draftId ?? '' }) })
    }
  }
  const openOriginal = async (s: SourceMeta): Promise<void> => {
    try {
      if (s.url && /^https?:/i.test(s.url)) return void (await api.invoke('app.openExternal', { url: s.url }))
      // el original se abre en el lector de Aula (PDF con marcas, Aula al lado)
      openCourseSource(pack.id, s.id)
    } catch {
      toast.warning(t('tab.materials.openFailed'))
    }
  }

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDrag(true)
        }
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        addFiles(e.dataTransfer.files)
      }}
      className="relative"
    >
      <Stagger className="grid grid-cols-12 gap-4" gap={0.05}>
        <StaggerItem className="col-span-12 @5xl:col-span-8">
          <Card padded="lg" className="h-full">
            <SectionTitle title={t('tab.materials.title')} detail={t('tab.materials.count', { count: sources.length })} />
            {sources.length === 0 ? (
              <>
                <p className="t-callout text-text2 mt-2">{t('tab.materials.none')}</p>
                <ResearchNote packId={pack.id} />
              </>
            ) : (
              <div className="mt-2 flex flex-col">
                {sources.map((s, i) => (
                  <motion.div key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.04 }} className="group flex items-center gap-3.5 border-t-[0.5px] border-line-soft py-3 first:border-t-0">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-tile text-text2">
                      <Icon name={KIND_ICON[s.kind.toLowerCase()] ?? 'file'} size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block t-callout font-medium truncate">{s.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1 t-footnote">
                        <span className="uppercase tracking-wide">{s.kind}</span>
                        {s.pages > 0 && <span>· {t('tab.materials.pages', { count: s.pages })}</span>}
                        <span>· <span style={{ color: TRUST_TONE[s.trust] }}>{t(`tab.materials.trust.${s.trust}`)}</span></span>
                        <span>· {fmtDate(s.addedAt, { day: 'numeric', month: 'short' })}</span>
                        {s.status === 'processing' && <span className="inline-flex items-center gap-1 text-text2">· <Spinner size={10} /> {t('tab.materials.reading')}</span>}
                        {s.status === 'failed' && <span className="text-danger">· {t('tab.materials.failed')}</span>}
                        {s.warnings.length > 0 && <span className="text-warning">· {s.warnings[0]}</span>}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Button size="sm" variant="secondary" icon={<Icon name="book" size={13} />} disabled={s.status !== 'ready'} onClick={() => setReading(s)}>{t('tab.materials.read')}</Button>
                      {(s.filename || s.url) && (
                        <Button size="sm" variant="ghost" icon={<Icon name={s.url ? 'external' : 'folder-open'} size={13} />} onClick={() => void openOriginal(s)}>{t('tab.materials.original')}</Button>
                      )}
                    </span>
                  </motion.div>
                ))}
              </div>
            )}
          </Card>
        </StaggerItem>

        <StaggerItem className="col-span-12 @5xl:col-span-4">
          <Card padded="lg" mark={ink} className="flex h-full flex-col">
            <h2 className="t-title2">{t('tab.materials.addTitle')}</h2>
            <p className="t-callout text-text2 mt-1">{t('tab.materials.addBody')}</p>
            <button
              type="button"
              onClick={() => file.current?.click()}
              className={cx('mt-4 flex flex-col items-center gap-2 rounded-[18px] border-[1.5px] border-dashed px-4 py-7 text-center transition-colors', drag ? 'border-accent bg-accent-wash' : 'border-line-strong/40 hover:bg-fill1')}
            >
              {adding ? <Spinner size={18} /> : <Icon name="upload" size={22} className="text-text2" />}
              <span className="t-ui font-medium">{t('tab.materials.drop')}</span>
              <span className="t-footnote">{t('tab.materials.kinds')}</span>
            </button>
            <input ref={file} type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
            <AnimatePresence initial={false}>
              {added.length > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4 flex flex-col gap-1.5">
                  {added.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 t-callout">
                      {m.status === 'processing' ? <Spinner size={12} /> : <Icon name={m.status === 'ready' ? 'check-circle' : 'alert-circle'} size={14} className={m.status === 'ready' ? 'text-success' : 'text-danger'} />}
                      <span className="min-w-0 flex-1 truncate">{m.title}</span>
                      {saved.has(m.id) ? (
                        <span className="t-footnote text-success">{t('tab.materials.saved')}</span>
                      ) : (
                        m.pages > 0 && <span className="t-footnote">{t('tab.materials.pages', { count: m.pages })}</span>
                      )}
                    </div>
                  ))}
                  <Button className="mt-2" variant="primary" disabled={!added.some((m) => m.status === 'ready')} onClick={() => void useForCourse()}>{t('tab.materials.use')}</Button>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </StaggerItem>
      </Stagger>
      <ReaderDrawer pack={pack} source={reading} onClose={() => setReading(null)} />
    </div>
  )
}

/** El texto que leyó Aula de un material, por páginas, con búsqueda. */
function ReaderDrawer({ pack, source, onClose }: { pack: Pack; source: SourceMeta | null; onClose: () => void }) {
  const { t } = useTranslation('study')
  const [chunks, setChunks] = useState<SourceChunk[] | null>(null)
  const [error, setError] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!source) return
    setChunks(null)
    setError(false)
    setQ('')
    loadChunks(pack.id, source.id).then(setChunks).catch(() => setError(true))
  }, [pack.id, source])
  const key = searchKey(q.trim())
  const pages = useMemo(() => chunksByPage((chunks ?? []).filter((c) => !key || searchKey(`${c.heading ?? ''} ${c.text}`).includes(key))), [chunks, key])
  return (
    <Drawer open={!!source} onClose={onClose} width={560} title={source?.title}>
      <div className="flex flex-col gap-4 px-5 pb-8">
        <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('tab.materials.search')} icon={<Icon name="search" size={15} />} />
        {error ? (
          <EmptyState title={t('tab.materials.noText')} body={t('tab.materials.noTextBody')} />
        ) : !chunks ? (
          <div className="grid place-items-center py-10 text-text3"><Spinner size={16} /></div>
        ) : pages.length === 0 ? (
          <p className="t-callout text-text2">{key ? t('tab.materials.notFound', { q }) : t('tab.materials.empty')}</p>
        ) : (
          pages.map((p, i) => (
            <section key={i} className="flex flex-col gap-2">
              {p.page !== undefined && <div className="t-eyebrow">{t('tab.materials.page', { n: p.page })}</div>}
              {p.chunks.map((c) => (
                <div key={c.id}>
                  {c.heading && <div className="t-headline mb-1">{c.heading}</div>}
                  <div className="font-serif text-[16px] leading-[26px] text-text selectable"><RichText text={c.text} /></div>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </Drawer>
  )
}
