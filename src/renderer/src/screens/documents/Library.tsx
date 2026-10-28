// Documentos: la biblioteca del estudiante — los materiales de cada curso, los archivos que importa y los documentos que creó
// Aula — con búsqueda en el texto de todo, filtro por curso, «Recientes» con su página en miniatura y una zona para soltar
// archivos (el pixel-art del papel se enciende al pasar por encima).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { DocumentEntry, DocumentLibrary, DocumentSearchHit } from '@shared/documents'
import { AnimatedNumber, Button, Card, Chip, cx, EmptyState, Icon, IconButton, Menu, PixelIcon, ProgressBar, SectionTitle, Spinner, Stagger, StaggerItem, TextField, toast, toneForHue, useTheme, type MenuItem } from '@renderer/design'
import { api } from '@renderer/lib/api'
import i18n from '@renderer/i18n'
import { useRpc, useRpcEvent } from '@renderer/lib/useRpc'
import { fmtDate } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { boldParts, byOpened, foldKeep, kindIcon, kindLabel, openDocument } from './lib'
import { PaperSprite } from './PaperSprite'
import { Thumbnail } from './Thumbnail'
import { ExportDialog } from './export/ExportDialog'

const ALL = '__all'
const IMPORTED = '__imports'

export function Library() {
  const { t } = useTranslation('documents')
  const { data, error, reload } = useRpc('documents.library', undefined, { events: ['documents.changed', 'courses.changed'] })
  const [filter, setFilter] = useState<string>(ALL)
  const [query, setQuery] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const lib = data

  if (error && !lib) {
    return (
      <div className="grid flex-1 place-items-center">
        <EmptyState title={t('library.error')} body={error.message} action={<Button onClick={() => void reload()}>{t('retry')}</Button>} />
      </div>
    )
  }
  if (!lib) return <LibrarySkeleton />

  const courseFor = (id: string | undefined) => lib.courses.find((c) => c.id === id)
  const visible = lib.items.filter((i) => filter === ALL || (filter === IMPORTED ? i.origin === 'import' : i.courseId === filter))
  const recent = [...lib.items].filter((i) => i.opened).sort(byOpened).slice(0, 8)

  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 pt-1 pb-24">
      <Stagger className="grid grid-cols-12 gap-4" gap={0.05}>
        <StaggerItem className="col-span-12 @2xl:col-span-7 @5xl:col-span-8">
          <SearchCard lib={lib} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} />
        </StaggerItem>
        <StaggerItem className="col-span-12 @2xl:col-span-5 @5xl:col-span-4">
          <DropCard onCreate={() => setExportOpen(true)} hasCourses={lib.courses.length > 0} />
        </StaggerItem>

        {query.trim().length >= 2 && (
          <StaggerItem className="col-span-12">
            <SearchResults lib={lib} query={query} courseId={filter !== ALL && filter !== IMPORTED ? filter : undefined} />
          </StaggerItem>
        )}

        {recent.length > 0 && query.trim().length < 2 && (
          <StaggerItem className="col-span-12">
            <RecentStrip items={recent} />
          </StaggerItem>
        )}

        {lib.items.length === 0 ? (
          <StaggerItem className="col-span-12">
            <Card padded="lg">
              <EmptyState title={t('library.emptyTitle')} body={t('library.emptyBody')} action={<Button variant="primary" icon={<Icon name="upload" size={14} />} onClick={() => void pick()}>{t('library.pick')}</Button>} />
            </Card>
          </StaggerItem>
        ) : (
          <Groups items={visible} courseFor={courseFor} />
        )}
      </Stagger>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} courses={lib.courses} />
    </div>
  )
}

async function pick(): Promise<void> {
  try {
    const r = await api.invoke('documents.pick')
    if (r) reportImport(r.imported, r.failed)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

/** Avisa de lo importado (con «Abrir» si es uno solo) y de lo que no se pudo leer. */
export function reportImport(imported: DocumentEntry[], failed: { name: string; message: string }[]): void {
  if (imported.length === 1 && failed.length === 0) {
    const e = imported[0]
    toast.action(i18nT('library.importedOne', { title: e.title }), { label: i18nT('library.open'), run: () => openDocument(e.ref) })
  } else if (imported.length) toast.success(i18nT('library.imported', { count: imported.length }))
  for (const f of failed.slice(0, 3)) toast.error(i18nT('library.importFailed', { name: f.name }), f.message)
}

function i18nT(key: string, opts?: Record<string, unknown>): string {
  return i18n.t(`documents:${key}`, opts ?? {})
}

// MARK: - Buscar y filtrar

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-[52px]">
      <div className="font-serif text-[28px] leading-[30px] tabular text-text"><AnimatedNumber value={value} /></div>
      <div className="t-caption text-text3">{label}</div>
    </div>
  )
}

function SearchCard({ lib, query, setQuery, filter, setFilter }: { lib: DocumentLibrary; query: string; setQuery: (q: string) => void; filter: string; setFilter: (f: string) => void }) {
  const { t } = useTranslation('documents')
  const { dark } = useTheme()
  const imports = lib.items.filter((i) => i.origin === 'import').length
  const pages = lib.items.reduce((n, i) => n + i.pages, 0)
  const marks = lib.items.reduce((n, i) => n + i.marks, 0)
  return (
    <Card padded="lg" className="h-full">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <h1 className="t-title1">{t('library.heading')}</h1>
          <p className="t-callout text-text2 mt-1">{t('library.lead')}</p>
        </div>
        <div className="flex gap-6">
          <Stat value={lib.items.length} label={t('library.statDocs', { count: lib.items.length })} />
          <Stat value={pages} label={t('library.statPages', { count: pages })} />
          <Stat value={marks} label={t('library.statMarks', { count: marks })} />
        </div>
      </div>
      <div className="mt-5">
        <TextField value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('library.search')} icon={<Icon name="search" size={15} />}
          trailing={query ? <IconButton label={t('clear')} size="sm" onClick={() => setQuery('')}><Icon name="close" size={13} /></IconButton> : undefined} />
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Chip active={filter === ALL} onClick={() => setFilter(ALL)}>{t('library.all')}</Chip>
        {lib.courses.map((c) => {
          const tone = toneForHue(c.hue)
          const n = lib.items.filter((i) => i.courseId === c.id).length
          if (!n) return null
          return (
            <Chip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)} icon={<PixelIcon icon={c.icon} hue={c.hue} size={14} />} color={filter === c.id ? (dark ? tone.inkDark : tone.inkLight) : undefined}>
              <span className="max-w-[180px] truncate">{c.title}</span>
            </Chip>
          )
        })}
        {imports > 0 && <Chip active={filter === IMPORTED} onClick={() => setFilter(IMPORTED)} icon={<Icon name="folder" size={12} />}>{t('library.imports')}</Chip>}
      </div>
    </Card>
  )
}

function SearchResults({ lib, query, courseId }: { lib: DocumentLibrary; query: string; courseId?: string }) {
  const { t } = useTranslation('documents')
  const [hits, setHits] = useState<DocumentSearchHit[] | null>(null)
  useEffect(() => {
    const q = query.trim()
    setHits(null)
    const id = setTimeout(() => {
      void api.invoke('documents.search', { query: q, ...(courseId ? { courseId } : {}), limit: 30 }).then(setHits).catch(() => setHits([]))
    }, 260)
    return () => clearTimeout(id)
  }, [query, courseId])
  const q = foldKeep(query.trim())
  const titles = lib.items.filter((i) => foldKeep(i.title).includes(q) && (!courseId || i.courseId === courseId)).slice(0, 6)
  return (
    <Card padded="lg">
      <SectionTitle title={t('search.title')} detail={hits ? t('search.count', { count: hits.length + titles.length }) : undefined} />
      {titles.length > 0 && (
        <div className="mt-1 mb-3 flex flex-wrap gap-2">
          {titles.map((e) => (
            <button key={e.key} onClick={() => openDocument(e.ref)} className="flex items-center gap-2 rounded-full bg-fill1 hover:bg-fill2 px-3 h-8 t-ui transition-colors">
              <Icon name={kindIcon(e.kind)} size={14} className="text-text3" />
              <span className="max-w-[260px] truncate font-medium">{e.title}</span>
            </button>
          ))}
        </div>
      )}
      {!hits ? (
        <div className="flex items-center gap-2 py-6 t-callout text-text3"><Spinner size={14} /> {t('search.searching')}</div>
      ) : hits.length === 0 ? (
        <p className="t-callout text-text2 py-4">{t('search.none', { q: query.trim() })}</p>
      ) : (
        <div className="flex flex-col">
          {hits.map((h, i) => (
            <motion.button key={`${h.key}:${h.page ?? 0}:${i}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.03 }}
              onClick={() => openDocument(h.ref, h.page)} className="group text-left flex gap-4 border-t-[0.5px] border-line-soft first:border-t-0 py-3 px-1 hover:bg-fill1 rounded-[12px] transition-colors">
              <span className="w-12 shrink-0 pt-0.5 text-right">
                {h.page !== undefined && <span className="t-caption font-semibold text-accent-text tabular">{t('reader.pageShort', { n: h.page })}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block t-callout font-medium truncate">{h.title}{h.courseTitle && <span className="text-text3 font-normal"> · {h.courseTitle}</span>}</span>
                <span className="block font-serif text-[15px] leading-[23px] text-text2 mt-0.5 line-clamp-2">
                  {boldParts(h.snippet).map((p, k) => (p.bold ? <mark key={k} className="bg-accent-wash text-text rounded-[3px] px-0.5">{p.text}</mark> : <span key={k}>{p.text}</span>))}
                </span>
              </span>
              <Icon name="chevron-right" size={14} className="text-text3 mt-1 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </motion.button>
          ))}
        </div>
      )}
    </Card>
  )
}

// MARK: - Soltar archivos

function DropCard({ onCreate, hasCourses }: { onCreate: () => void; hasCourses: boolean }) {
  const { t } = useTranslation('documents')
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState<{ name: string; fraction: number } | null>(null)
  const depth = useRef(0)
  useRpcEvent('documents.importProgress', (p) => setBusy({ name: p.name, fraction: p.fraction }))

  const importPaths = async (paths: string[]): Promise<void> => {
    if (!paths.length) return
    setBusy({ name: '', fraction: 0 })
    try {
      const r = await api.invoke('documents.import', { paths })
      reportImport(r.imported, r.failed)
    } catch (e) {
      toast.error(t('library.importError'), e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  const onDrop = (files: FileList): void => {
    const paths = [...files].map((f) => { try { return api.pathForFile(f) } catch { return '' } }).filter(Boolean)
    void importPaths(paths)
  }
  return (
    <Card
      padded="lg"
      className="h-full flex flex-col"
      onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { depth.current++; setDrag(true) } }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDrag(false) }}
      onDrop={(e) => { e.preventDefault(); depth.current = 0; setDrag(false); onDrop(e.dataTransfer.files) }}
    >
      <button type="button" onClick={() => void pick()} disabled={!!busy}
        className={cx('flex-1 min-h-[120px] flex flex-col items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed px-4 py-4 text-center transition-colors', drag ? 'border-accent bg-accent-wash' : 'border-line-strong/40 hover:bg-fill1')}>
        <PaperSprite lit={drag || !!busy} size={38} />
        {busy ? (
          <>
            <span className="t-ui font-medium truncate max-w-full">{busy.name ? t('library.reading', { name: busy.name }) : t('library.readingAny')}</span>
            <ProgressBar value={busy.fraction} className="w-[160px]" />
          </>
        ) : (
          <>
            <span className="t-ui font-medium">{drag ? t('library.dropNow') : t('library.drop')}</span>
            <span className="t-footnote">{t('library.kinds')}</span>
          </>
        )}
      </button>
      {/* se reparten el ancho de la tarjeta y bajan de línea si no caben (nunca se salen) */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" className="grow basis-[150px]" icon={<Icon name="upload" size={14} />} onClick={() => void pick()} disabled={!!busy}>{t('library.pick')}</Button>
        <Button variant="secondary" className="grow basis-[150px]" icon={<Icon name="file-text" size={14} />} onClick={onCreate} disabled={!hasCourses}>{t('library.create')}</Button>
      </div>
    </Card>
  )
}

// MARK: - Recientes

function RecentStrip({ items }: { items: DocumentEntry[] }) {
  const { t } = useTranslation('documents')
  return (
    <section>
      <SectionTitle title={t('library.recent')} />
      <div className="mt-1 grid gap-4 grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4 @6xl:grid-cols-6">
        {items.slice(0, 6).map((e, i) => <DocCard key={e.key} entry={e} index={i} progress />)}
      </div>
    </section>
  )
}

// MARK: - Por curso

function Groups({ items, courseFor }: { items: DocumentEntry[]; courseFor: (id: string | undefined) => DocumentLibrary['courses'][number] | undefined }) {
  const { t } = useTranslation('documents')
  const groups = useMemo(() => {
    const m = new Map<string, DocumentEntry[]>()
    for (const i of items) {
      const k = i.origin === 'import' ? IMPORTED : i.courseId ?? IMPORTED
      m.set(k, [...(m.get(k) ?? []), i])
    }
    return [...m.entries()].sort(([a], [b]) => (a === IMPORTED ? -1 : b === IMPORTED ? 1 : 0))
  }, [items])
  if (!groups.length) {
    return (
      <StaggerItem className="col-span-12">
        <Card padded="lg"><p className="t-callout text-text2">{t('library.noneHere')}</p></Card>
      </StaggerItem>
    )
  }
  return (
    <>
      {groups.map(([k, list]) => (
        <StaggerItem key={k} className="col-span-12 mt-2">
          <GroupSection items={list} course={k === IMPORTED ? undefined : courseFor(k)} />
        </StaggerItem>
      ))}
    </>
  )
}

function GroupSection({ items, course }: { items: DocumentEntry[]; course?: DocumentLibrary['courses'][number] }) {
  const { t } = useTranslation('documents')
  const [all, setAll] = useState(false)
  const LIMIT = 10
  const shown = all ? items : items.slice(0, LIMIT)
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        {course ? <PixelIcon icon={course.icon} hue={course.hue} size={30} animation="drop" /> : <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-tile text-text2"><Icon name="folder" size={15} /></span>}
        <div className="min-w-0 flex-1">
          <h2 className="t-title2 truncate">{course?.title ?? t('library.imports')}</h2>
        </div>
        <span className="t-footnote">{t('library.count', { count: items.length })}</span>
        {course && <Button size="sm" variant="plain" iconRight={<Icon name="chevron-right" size={13} />} onClick={() => navigate({ name: 'course', id: course.id, tab: 'materials' })}>{t('library.toCourse')}</Button>}
      </div>
      <div className="grid gap-4 grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4 @6xl:grid-cols-5">
        {shown.map((e, i) => <DocCard key={e.key} entry={e} index={i} />)}
      </div>
      {items.length > LIMIT && (
        <button onClick={() => setAll((v) => !v)} className="mt-3 t-ui font-medium text-accent-text hover:underline">{all ? t('library.less') : t('library.more', { count: items.length - LIMIT })}</button>
      )}
    </section>
  )
}

/** Un documento como una burbuja: su página en miniatura que asoma del pozo, el título y lo que trae. */
function DocCard({ entry: e, index, progress }: { entry: DocumentEntry; index: number; progress?: boolean }) {
  const { t } = useTranslation('documents')
  const { dark, reducedMotion } = useTheme()
  const tone = toneForHue(e.courseHue)
  const ink = e.courseId ? (dark ? tone.inkDark : tone.inkLight) : 'var(--text3)'
  const read = e.pages > 1 && e.lastPage ? Math.min(1, e.lastPage / e.pages) : 0
  const facts = [kindLabel(e.kind), e.pages > 0 ? t('library.pages', { count: e.pages }) : ''].filter(Boolean).join(' · ')
  const menu: MenuItem[] = [
    { label: t('library.open'), icon: <Icon name="book" size={14} />, onSelect: () => openDocument(e.ref, e.lastPage) },
    ...(e.hasFile ? [{ label: t('reader.reveal'), icon: <Icon name="folder-open" size={14} />, onSelect: () => void api.invoke('documents.reveal', { ref: e.ref }).catch(() => toast.warning(t('reader.revealFailed'))) }] : []),
    ...(e.origin !== 'source' ? [{ label: t('library.remove'), icon: <Icon name="trash" size={14} />, danger: true, separatorBefore: true, onSelect: () => void api.invoke('documents.remove', { ref: e.ref }).then(() => toast.success(t('library.removed'))).catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err))) }] : [])
  ]
  return (
    <Card enterAnim interactive padded={false} className="group/doc overflow-hidden" onClick={() => openDocument(e.ref, e.lastPage)}>
      <div className="relative h-[138px] overflow-hidden bg-sunken" style={{ backgroundImage: e.courseId ? `linear-gradient(color-mix(in oklab, ${ink} ${dark ? 10 : 6}%, transparent), color-mix(in oklab, ${ink} ${dark ? 10 : 6}%, transparent))` : undefined }}>
        <motion.div
          className="absolute left-1/2 top-[22px] -translate-x-1/2"
          initial={reducedMotion ? false : { y: 26, opacity: 0, rotate: index % 2 ? 1.2 : -1.2 }}
          animate={{ y: 0, opacity: 1, rotate: index % 2 ? 1.2 : -1.2 }}
          whileHover={reducedMotion ? undefined : { y: -6, rotate: 0 }}
          transition={{ delay: 0.06 + Math.min(index, 10) * 0.04, type: 'spring', stiffness: 170, damping: 20 }}
        >
          <Thumbnail entry={e} width={96} page={progress ? e.lastPage ?? 1 : 1} />
        </motion.div>
        <div className="absolute left-2.5 top-2.5 flex gap-1">
          {e.origin === 'saved' && <span className="inline-flex items-center gap-1 rounded-full bg-surface/95 px-2 py-0.5 t-caption font-medium text-accent-text shadow-[var(--e1)]"><Icon name="aula" size={11} />{t('library.byAula')}</span>}
          {e.marks > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-surface/95 px-2 py-0.5 t-caption font-medium text-text2 shadow-[var(--e1)]"><span className="h-2 w-2 rounded-full" style={{ background: 'rgb(250 214 89)' }} />{e.marks}</span>}
        </div>
        <span onClick={(ev) => ev.stopPropagation()} className="absolute right-2 top-2 opacity-0 transition-opacity group-hover/doc:opacity-100 focus-within:opacity-100">
          <Menu items={menu} trigger={(open) => <IconButton label={t('library.options')} size="sm" variant="raised" onClick={open}><Icon name="more" size={14} /></IconButton>} />
        </span>
      </div>
      <div className="px-3.5 pt-3 pb-3.5">
        <div className="t-callout font-medium leading-[19px] line-clamp-2 min-h-[38px]">{e.title}</div>
        <div className="mt-1 t-caption text-text3 truncate">
          {e.status === 'processing' ? <span className="inline-flex items-center gap-1"><Spinner size={10} /> {t('library.processing')}</span> : progress ? e.courseTitle ?? t('library.importedShort') : facts}
          {e.status === 'failed' && <span className="text-danger"> · {t('library.failed')}</span>}
        </div>
        {progress && (
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar value={read} color={ink} className="flex-1" />
            {e.lastPage && e.pages > 1 ? <span className="t-caption tabular text-text3">{t('reader.pageShort', { n: e.lastPage })}</span> : null}
          </div>
        )}
      </div>
    </Card>
  )
}

function LibrarySkeleton() {
  return (
    <div className="flex-1 grid grid-cols-12 gap-4 px-6 pt-1 content-start">
      <div className="col-span-8 h-[220px] skeleton rounded-[22px]" />
      <div className="col-span-4 h-[220px] skeleton rounded-[22px]" />
      <div className="col-span-12 h-[210px] skeleton rounded-[22px]" />
      <div className="col-span-6 h-[300px] skeleton rounded-[22px]" />
      <div className="col-span-6 h-[300px] skeleton rounded-[22px]" />
    </div>
  )
}
