// Paleta de comandos (⌘K): ir a cualquier sitio, abrir un curso o una herramienta, buscar dentro de tus cursos (lecciones,
// ejercicios, glosario, fórmulas y materiales) o preguntar a Aula. El filtro y el orden son nuestros: primero lo que coincide
// de verdad, después lo de tus cursos y «Pregúntale a Aula» siempre al final (elegido solo si no hay nada más).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { quoted } from '@renderer/lib/format'
import { CourseIcon, spring, Kbd, Icon, AulaMark, Spinner, useTabTrap, type IconName } from '@renderer/design'
import { api } from '@renderer/lib/api'
import type { LibraryHit } from '@shared/ipc/search'
import { openCourseSource } from '@renderer/screens/documents/lib'
import { navigate } from '../router'
import { ASK_VALUE, filterCommands, focusSnippet, paletteValues, splitGroups, type ScoredGroup } from './paletteOrder'
import { useCourses } from '@renderer/lib/courses'

export interface PaletteCommand {
  id: string
  group: 'navigate' | 'courses' | 'tools' | 'actions'
  label: string
  keywords?: string[]
  icon?: ReactNode
  hint?: string
  run: () => void
}

type Provider = () => PaletteCommand[]

interface PaletteState {
  isOpen: boolean
  query: string
  providers: Map<string, Provider>
  open: () => void
  close: () => void
  setQuery: (q: string) => void
}

export const usePalette = create<PaletteState>((set) => ({
  isOpen: false,
  query: '',
  providers: new Map(),
  open: () => set({ isOpen: true, query: '' }),
  close: () => set({ isOpen: false }),
  setQuery: (q) => set({ query: q })
}))

/** Las pantallas y herramientas registran sus comandos aquí (devuelve la función para quitarlos). */
export function registerCommands(id: string, provider: Provider): () => void {
  const map = new Map(usePalette.getState().providers)
  map.set(id, provider)
  usePalette.setState({ providers: map })
  return () => {
    const m = new Map(usePalette.getState().providers)
    m.delete(id)
    usePalette.setState({ providers: m })
  }
}

/** Espera tras la última tecla antes de buscar en los cursos, y cuántos resultados enseñar. */
const SEARCH_DEBOUNCE_MS = 160
const MAX_HITS = 12

/** Busca en todos los cursos (con espera entre teclas); si aún se están indexando cursos, vuelve a preguntar. */
function useLibrarySearch(query: string, open: boolean): { hits: LibraryHit[]; searching: boolean } {
  const [state, setState] = useState<{ hits: LibraryHit[]; searching: boolean }>({ hits: [], searching: false })
  useEffect(() => {
    const q = query.trim()
    if (!open || q.length < 2) {
      setState({ hits: [], searching: false })
      return
    }
    let alive = true
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    setState((s) => ({ ...s, searching: true }))
    const run = async (): Promise<void> => {
      try {
        const r = await api.invoke('search.query', { q, limit: MAX_HITS })
        if (!alive) return
        setState({ hits: r.hits, searching: r.pending > 0 })
        if (r.pending > 0 && tries++ < 10) timer = setTimeout(() => void run(), 600)
      } catch {
        if (alive) setState({ hits: [], searching: false })
      }
    }
    timer = setTimeout(() => void run(), SEARCH_DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query, open])
  return state
}

const HIT_ICON: Record<LibraryHit['kind'], IconName> = { lesson: 'learn', exercise: 'practice', glossary: 'reference', formula: 'reference', material: 'file-text' }

/** Abre cada resultado donde se entiende: la lección, la práctica del tema, la referencia o el material en su página. */
function openHit(h: LibraryHit): void {
  switch (h.kind) {
    case 'lesson':
      return navigate({ name: 'study', id: h.courseID, mode: 'learn', skill: h.skillID })
    case 'exercise':
      return navigate({ name: 'study', id: h.courseID, mode: 'practice', skill: h.skillID })
    case 'glossary':
    case 'formula':
      return navigate({ name: 'course', id: h.courseID, tab: 'reference' })
    case 'material':
      if (h.sourceID) return openCourseSource(h.courseID, h.sourceID, h.page)
      return navigate({ name: 'course', id: h.courseID, tab: 'materials' })
  }
}

export function CommandPalette() {
  const { t } = useTranslation(['common', 'palette'])
  const { isOpen, close, query, setQuery, providers } = usePalette()
  const courses = useCourses((s) => s.courses)
  const { hits, searching } = useLibrarySearch(query, isOpen)
  const [selected, setSelected] = useState('')
  // la selección sigue al primer resultado mientras la persona no se mueva con el teclado
  const autoSelect = useRef(true)
  // Tab no sale de ⌘K a la barra lateral de detrás (A4-P2-11)
  const layer = useRef<HTMLDivElement>(null)
  useTabTrap(layer, isOpen)

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const s = usePalette.getState()
        if (s.isOpen) s.close()
        else s.open()
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  const commands = useMemo(() => {
    const list: PaletteCommand[] = []
    for (const p of providers.values()) list.push(...p())
    for (const c of courses)
      list.push({ id: `course:${c.id}`, group: 'courses', label: c.title, hint: c.subject, keywords: [c.subject], icon: <CourseIcon icon={c.icon} hue={c.hue} size={24} title={c.title} radius={7} />, run: () => navigate({ name: 'course', id: c.id }) })
    return list
  }, [providers, courses])

  const q = query.trim()
  const { strong, weak } = useMemo(() => splitGroups(filterCommands(commands, query), query), [commands, query])
  const showAsk = q.length > 2
  // el orden en pantalla, que es también el de las flechas
  const values = useMemo(() => paletteValues(strong, hits.map((h) => h.id), weak, showAsk), [strong, weak, hits, showAsk])
  const valuesKey = values.join('\n')

  useEffect(() => {
    autoSelect.current = true
  }, [query, isOpen])
  useEffect(() => {
    if (autoSelect.current || !values.includes(selected)) setSelected(values[0] ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey])

  const run = (fn: () => void) => {
    close()
    setTimeout(fn, 10)
  }

  const groupView = (g: ScoredGroup<PaletteCommand>) => (
    <Command.Group key={g.group} heading={t(`search.groups.${g.group}`)} className="aula-cmd-group">
      {g.items.map((c) => (
        <Item key={c.id} value={`cmd:${c.id}`} icon={c.icon} label={c.label} hint={c.hint} onSelect={() => run(c.run)} />
      ))}
    </Command.Group>
  )

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div ref={layer} role="dialog" aria-modal="true" aria-label={t('search.placeholder')} className="fixed inset-0 z-[85] flex items-start justify-center pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/10 dark:bg-black/35" onClick={close} />
          <motion.div className="relative w-[min(680px,92vw)]" initial={{ y: -16, scale: 0.97, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: -10, scale: 0.98, opacity: 0 }} transition={spring.smooth}>
            <Command
              label="Aula"
              shouldFilter={false}
              value={selected}
              onValueChange={setSelected}
              className="material-menu rounded-[18px] overflow-hidden"
              loop
              onKeyDown={(e) => {
                if (e.key === 'Escape') close()
                if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(e.key) || (e.ctrlKey && (e.key === 'n' || e.key === 'p' || e.key === 'j' || e.key === 'k'))) autoSelect.current = false
              }}
            >
              <div className="flex items-center gap-3 px-4 h-14 border-b-[0.5px] border-line">
                <Icon name="search" size={18} className="text-text3" />
                <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder={t('search.placeholder')} className="flex-1 bg-transparent outline-none text-[16px] placeholder:text-text3" />
                {searching && <Spinner size={12} />}
                <Kbd>esc</Kbd>
              </div>
              <Command.List className="max-h-[56vh] overflow-auto p-1.5">
                {values.length === 0 && <div className="py-10 text-center text-text3">{searching ? t('palette:searching') : t('search.empty')}</div>}
                {strong.map(groupView)}
                {hits.length > 0 && (
                  <Command.Group heading={t('palette:inCourses')} className="aula-cmd-group">
                    {hits.map((h) => (
                      <HitItem key={h.id} hit={h} onSelect={() => run(() => openHit(h))} />
                    ))}
                  </Command.Group>
                )}
                {weak.map(groupView)}
                {showAsk && (
                  <Command.Group heading={t('search.groups.actions')} className="aula-cmd-group">
                    <Item value={ASK_VALUE} icon={<AulaMark size={17} />} label={`${t('orb.ask')}: ${quoted(q)}`} onSelect={() => run(() => navigate({ name: 'chat', prompt: q }))} />
                  </Command.Group>
                )}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Item({ value, icon, label, hint, onSelect }: { value: string; icon?: ReactNode; label: string; hint?: string; onSelect: () => void }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="group flex items-center gap-3 rounded-[10px] px-2.5 h-10 cursor-default data-[selected=true]:bg-selected">
      <span className="w-6 grid place-items-center text-text2">{icon}</span>
      <span className="flex-1 min-w-0 truncate t-callout">{label}</span>
      {hint && <span className="t-ui text-text3 truncate max-w-[220px]">{hint}</span>}
      <span className="text-text3 opacity-0 group-data-[selected=true]:opacity-100 t-caption">↩</span>
    </Command.Item>
  )
}

/** Un resultado de dentro de los cursos: qué es y dónde está, y el trozo de texto con lo buscado resaltado. */
function HitItem({ hit, onSelect }: { hit: LibraryHit; onSelect: () => void }) {
  const { t } = useTranslation('palette')
  const where = [t(`kinds.${hit.kind}`), hit.page ? t('page', { page: hit.page }) : null, hit.courseTitle].filter(Boolean).join(' · ')
  return (
    <Command.Item value={`hit:${hit.id}`} onSelect={onSelect} className="group flex items-start gap-3 rounded-[10px] px-2.5 py-2 cursor-default data-[selected=true]:bg-selected">
      <span className="w-6 h-5 grid place-items-center text-text2 shrink-0">
        <Icon name={HIT_ICON[hit.kind]} size={16} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-3">
          <span className="flex-1 min-w-0 truncate t-callout">{hit.title}</span>
          <span className="t-ui text-text3 truncate max-w-[260px]">{where}</span>
        </span>
        <span className="block t-ui text-text2 truncate mt-0.5">
          <Snippet text={hit.snippet} />
        </span>
      </span>
      <span className="text-text3 opacity-0 group-data-[selected=true]:opacity-100 t-caption self-center">↩</span>
    </Command.Item>
  )
}

/** El fragmento con las coincidencias (`**…**`) resaltadas, empezando cerca de la primera para que se vea en una línea. */
function Snippet({ text }: { text: string }) {
  const parts = focusSnippet(text).split('**')
  return (
    <>
      {parts.map((p, i) => {
        const s = p.replace(/∗/g, '*')
        return i % 2 === 1 ? (
          <mark key={i} className="bg-accent-wash text-text font-semibold rounded-[3px] px-[1px]">
            {s}
          </mark>
        ) : (
          <span key={i}>{s}</span>
        )
      })}
    </>
  )
}
