// Una grabación (audio o vídeo) en el lector: el reproductor arriba y, debajo, la transcripción por tramos con su minuto.
// La transcripción sigue a la reproducción (el tramo que suena queda marcado y a la vista) y cada tramo es un botón: pulsarlo
// salta a ese momento. Una cita de una lección («Clase 3 · 41:20») abre el lector ya en su minuto.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentEntry, DocumentPageText } from '@shared/documents'
import { timecode } from '@shared/ingest'
import { cx, Icon } from '@renderer/design'
import { useReader } from './store'

interface Span { number: number; start: number; end: number }

/** Los tiempos de cada tramo (los guarda la ingesta en `pages.json`, junto al material). */
function useSpans(entry: DocumentEntry): Span[] | null {
  const [spans, setSpans] = useState<Span[] | null>(null)
  const ref = entry.ref
  const url = ref.kind === 'source' ? `aula-asset://pack/${encodeURIComponent(ref.packId)}/sources/${encodeURIComponent(ref.sourceId)}/pages.json` : null
  useEffect(() => {
    if (!url) { setSpans([]); return }
    let alive = true
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((raw: { pages?: Array<{ number?: unknown; start?: unknown; end?: unknown }> } | null) => {
        if (!alive) return
        const out: Span[] = []
        for (const p of raw?.pages ?? []) if (typeof p.number === 'number' && typeof p.start === 'number') out.push({ number: p.number, start: p.start, end: typeof p.end === 'number' ? p.end : p.start })
        setSpans(out)
      })
      .catch(() => alive && setSpans([]))
    return () => { alive = false }
  }, [url])
  return spans
}

/** El tramo que suena en el segundo `t` (el último que ya empezó). */
export function spanAt(spans: readonly { start: number }[], t: number): number {
  let lo = 0
  let hi = spans.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (spans[mid].start <= t) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found
}

export function MediaView({ entry, pages, initialTime }: { entry: DocumentEntry; pages: DocumentPageText[]; initialTime?: number }) {
  const { t } = useTranslation('documents')
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const spans = useSpans(entry)
  const jump = useReader((s) => s.jump)
  const set = useReader((s) => s.set)
  const [active, setActive] = useState(-1)
  const [failed, setFailed] = useState(false)
  const video = entry.kind === 'video'
  const startOf = useMemo(() => new Map((spans ?? []).map((s) => [s.number, s.start])), [spans])
  // cuándo tocó el estudiante la lista por última vez: mientras la mira, no se le mueve
  const touched = useRef(0)

  useEffect(() => { set({ pageCount: pages.length, scale: 1 }) }, [pages.length, set])

  const seek = (seconds: number, play = true): void => {
    const el = media.current
    if (!el) return
    el.currentTime = Math.max(0, seconds)
    if (play) void el.play().catch(() => undefined)
  }

  // saltar a un tramo (el índice, la búsqueda, «volver donde lo dejé»)
  useEffect(() => {
    if (!jump || !spans) return
    const start = startOf.get(jump.page)
    if (start !== undefined && media.current && Math.abs(media.current.currentTime - start) > 1.5) seek(start, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.seq, spans])

  // una cita abre la grabación en su minuto
  useEffect(() => {
    if (initialTime === undefined) return
    const el = media.current
    if (!el) return
    const go = (): void => seek(initialTime)
    if (el.readyState >= 1) go()
    else el.addEventListener('loadedmetadata', go, { once: true })
    return () => el.removeEventListener('loadedmetadata', go)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTime, entry.fileUrl])

  const onTime = (): void => {
    if (!spans || !media.current) return
    const i = spanAt(spans, media.current.currentTime)
    if (i === active) return
    setActive(i)
    if (i >= 0) set({ page: spans[i].number })
  }

  // el tramo que suena, a la vista (salvo que el estudiante esté leyendo por su cuenta)
  useEffect(() => {
    if (active < 0 || !spans || Date.now() - touched.current < 4000) return
    const row = list.current?.querySelector<HTMLElement>(`[data-page="${spans[active].number}"]`)
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active, spans])

  const activeNumber = active >= 0 && spans ? spans[active].number : -1
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cx('shrink-0 border-b-[0.5px] border-line-soft bg-surface', video ? 'p-3' : 'px-5 py-4')}>
        {failed ? (
          <div className="flex items-center gap-2 t-ui text-text2"><Icon name="help" size={15} />{t('media.cannotPlay')}</div>
        ) : video ? (
          <video ref={media} src={entry.fileUrl} controls preload="metadata" onTimeUpdate={onTime} onError={() => setFailed(true)} className="mx-auto block max-h-[42vh] w-full rounded-[14px] bg-black" />
        ) : (
          <audio ref={media} src={entry.fileUrl} controls preload="metadata" onTimeUpdate={onTime} onError={() => setFailed(true)} className="block w-full" />
        )}
      </div>
      <div ref={list} onWheel={() => { touched.current = Date.now() }} onPointerDown={() => { touched.current = Date.now() }} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-[760px] flex-col gap-1">
          <div className="t-eyebrow px-3 pb-1">{t('media.transcript')}</div>
          {pages.map((p) => {
            const start = startOf.get(p.number)
            const on = p.number === activeNumber
            return (
              <button
                key={p.number}
                type="button"
                data-page={p.number}
                disabled={start === undefined || failed}
                onClick={() => start !== undefined && seek(start)}
                title={start !== undefined ? t('media.playFrom', { time: timecode(start) }) : undefined}
                className={cx('group flex w-full items-baseline gap-3 rounded-[12px] px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-line', on ? 'bg-accent-wash' : 'hover:bg-fill1')}
              >
                <span className={cx('w-[52px] shrink-0 text-right font-serif tabular text-[14px]', on ? 'text-accent-text' : 'text-text3 group-hover:text-text2')}>{start !== undefined ? timecode(start) : '·'}</span>
                <span className={cx('t-reading text-[17px] leading-[26px]', on ? 'text-text' : 'text-text2')}>{p.text}</span>
              </button>
            )
          })}
          {pages.length === 0 && <p className="t-ui text-text3 px-3">{t('media.empty')}</p>}
        </div>
      </div>
    </div>
  )
}
