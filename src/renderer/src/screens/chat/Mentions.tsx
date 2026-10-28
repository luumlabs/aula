// Menciones con «@» (port de ChatMentionPicker / ChatMentionChip de la app Swift): el selector que aparece sobre la caja mientras se
// escribe «@…» (cursos, lecciones, ejercicios, materiales y eventos de `chat.mentionSearch`; ↑↓ ↩ Tab Esc), las fichas de lo
// mencionado (en la caja, con «×»; en el mensaje enviado, abren lo mencionado) y cómo se abre cada cosa.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import type { AssistantRef, AssistantRefKind } from '@shared/assistant/types'
import { CourseIcon, Icon, Kbd, cx, spring, type IconName } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { navigate } from '@renderer/app/router'
import { openTarget } from '@renderer/app/shell/AppCommands'
import { openCourseSource } from '@renderer/screens/documents/lib'

const KIND_ICON: Record<AssistantRefKind, IconName> = { course: 'course', lesson: 'learn', exercise: 'practice', material: 'file-text', event: 'calendar' }

/** Identidad estable de una mención (la misma que en el proceso principal). */
export const refKey = (r: AssistantRef): string => `${r.kind}:${r.courseID ?? '-'}:${r.itemID ?? '-'}`

/** Abre lo mencionado: el curso, la lección, la práctica de un ejercicio, el material en el lector o el día del calendario. */
export function openRef(r: AssistantRef): void {
  const courseID = r.courseID
  switch (r.kind) {
    case 'course':
      return courseID ? openTarget({ screen: 'course', courseID }) : undefined
    case 'lesson':
      return courseID ? openTarget({ screen: 'lesson', courseID, ...(r.itemID ? { skillID: r.itemID } : {}) }) : undefined
    case 'exercise':
      return courseID ? openTarget({ screen: 'exercise', courseID, ...(r.skillID ? { skillID: r.skillID } : {}), ...(r.itemID ? { exerciseID: r.itemID } : {}) }) : undefined
    case 'material':
      return courseID && r.itemID ? openCourseSource(courseID, r.itemID) : undefined
    case 'event':
      return navigate({ name: 'calendar', ...(r.date ? { date: r.date.slice(0, 10) } : {}) })
  }
}

/** ¿Se puede abrir? (un evento siempre: lleva al calendario) */
const canOpen = (r: AssistantRef): boolean => r.kind === 'event' || !!r.courseID

export function RefIcon({ r, size = 18 }: { r: AssistantRef; size?: number }) {
  if (r.kind === 'course' && r.icon) return <CourseIcon icon={r.icon} hue={r.hue} size={size} radius={Math.round(size / 3.5)} title={r.title} />
  return <Icon name={KIND_ICON[r.kind]} size={Math.min(16, size - 2)} className="text-text2" />
}

/** La ficha de una mención: en la caja se quita con «×»; en un mensaje enviado abre lo mencionado. */
export function MentionChip({ r, onRemove, tone = 'fill' }: { r: AssistantRef; onRemove?: () => void; tone?: 'fill' | 'surface' }) {
  const { t } = useTranslation('chat')
  const openable = !onRemove && canOpen(r)
  const label = [r.title, r.subtitle].filter(Boolean).join(' · ')
  return (
    <span data-mention={r.kind} className={cx('inline-flex max-w-[260px] items-center gap-1.5 rounded-full h-7 pl-1.5 t-ui font-medium text-text', onRemove ? 'pr-1' : 'pr-2.5', tone === 'fill' ? 'bg-fill2' : 'bg-surface border-[0.5px] border-line')}>
      <button
        type="button"
        className={cx('inline-flex min-w-0 items-center gap-1.5', openable ? 'hover:text-accent-text' : 'cursor-default')}
        onClick={openable ? () => openRef(r) : undefined}
        title={openable ? t('mention.open', { title: label }) : label}
        aria-label={t('mention.chip', { title: r.title })}
      >
        <RefIcon r={r} size={18} />
        <span className="truncate">{r.title}</span>
      </button>
      {onRemove && (
        <button type="button" className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-text3 hover:bg-fill3 hover:text-text" onClick={onRemove} aria-label={t('mention.remove', { title: r.title })}>
          <Icon name="close" size={10} />
        </button>
      )}
    </span>
  )
}

/** Lo que coincide con «@consulta» (lo del curso del tutor primero; sin lo ya mencionado). Espera un poco entre teclas. */
export function useMentionResults(query: string | null, taken: readonly AssistantRef[], courseID?: string): { results: AssistantRef[]; loading: boolean } {
  const [results, setResults] = useState<AssistantRef[]>([])
  const [loading, setLoading] = useState(false)
  const takenKey = taken.map(refKey).join('|')
  useEffect(() => {
    if (query === null) return
    let alive = true
    setLoading(true)
    const timer = setTimeout(() => {
      api
        .invoke('chat.mentionSearch', { query })
        .then((found) => {
          if (!alive) return
          const skip = new Set(takenKey ? takenKey.split('|') : [])
          let list = found.filter((r) => !skip.has(refKey(r)))
          if (courseID) list = [...list.filter((r) => r.courseID === courseID), ...list.filter((r) => r.courseID !== courseID)]
          setResults(list.slice(0, 7))
        })
        .catch(() => alive && setResults([]))
        .finally(() => alive && setLoading(false))
    }, 90)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query, takenKey, courseID])
  return { results: query === null ? [] : results, loading }
}

/** El panel sobre la caja: el icono, el nombre, de dónde es y su tipo; la fila elegida con el teclado, en el color de selección. */
export function MentionPicker({ query, results, loading, highlighted, onPick, onHover }: { query: string; results: AssistantRef[]; loading: boolean; highlighted: number; onPick: (r: AssistantRef) => void; onHover: (i: number) => void }) {
  const { t } = useTranslation('chat')
  return (
    <motion.div
      role="listbox"
      id="aula-mention-list"
      aria-label={t('mention.title')}
      className="absolute bottom-full left-0 right-0 mb-2 rounded-[18px] material-menu p-1.5 z-20"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={spring.snappy}
    >
      <div className="flex items-center gap-2 px-2.5 pt-1 pb-1.5">
        <span className="flex-1 truncate t-footnote text-text2">{query ? t('mention.resultsFor', { query }) : t('mention.hint')}</span>
        <Kbd>↑↓</Kbd>
        <Kbd>↩</Kbd>
      </div>
      {results.length === 0 ? (
        <div className="px-2.5 pb-2 t-ui text-text3">{loading ? t('mention.searching') : t('mention.none')}</div>
      ) : (
        results.map((r, i) => (
          <button
            key={refKey(r)}
            type="button"
            role="option"
            id={`aula-mention-${i}`}
            aria-selected={i === highlighted}
            // que el campo no pierda el foco al elegir con el ratón
            onMouseDown={(e) => e.preventDefault()}
            // solo si el ratón se mueve de verdad (el panel aparece bajo un ratón quieto y no debe robar la fila elegida)
            onMouseMove={(e) => (e.movementX || e.movementY) && i !== highlighted && onHover(i)}
            onClick={() => onPick(r)}
            className={cx('flex w-full items-center gap-2.5 rounded-[11px] px-2.5 py-1.5 text-left transition-colors', i === highlighted ? 'bg-selected' : 'hover:bg-fill1')}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center">
              <RefIcon r={r} size={24} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate t-ui font-medium text-text">{r.title}</span>
              {r.subtitle && <span className="block truncate t-caption text-text2">{r.subtitle}</span>}
            </span>
            <span className="shrink-0 t-caption text-text3">{t(`mention.kind.${r.kind}`)}</span>
          </button>
        ))
      )}
    </motion.div>
  )
}
