// El navegador de Aula en vivo, a la vista: la ventana del Mac donde el estudiante tiene su plataforma, imagen a imagen, y
// manejada desde aquí con el ratón, el teclado o el dedo (también desde su iPad o su iPhone). Arriba, atrás y recargar;
// abajo, de quién es el turno: «Que Aula lo revise» le pasa la página a Aula (que solo la lee) y «Tomar el control» la
// recupera. Para iniciar sesión, «Ya he iniciado sesión» lo comprueba y cierra.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { LiveInput } from '@shared/live/types'
import { AulaMark, Button, Icon, IconButton, Spinner, cx, toast } from '@renderer/design'
import { api, isAulaError } from '@renderer/lib/api'
import { hideLive, useLive, wireLive } from '@renderer/lib/live'
import { useCompact } from './CompactTabs'

/** El campo de escribir de los dispositivos guarda siempre este carácter: así borrar con el campo «vacío» también avisa. */
const SENTINEL = '​'
const NAMED_KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

export function LivePanel() {
  const state = useLive((s) => s.state)
  useEffect(() => wireLive(), [])
  return <AnimatePresence>{state && <Panel key={state.id} />}</AnimatePresence>
}

function Panel() {
  const { t } = useTranslation()
  const state = useLive((s) => s.state)!
  const focus = useLive((s) => s.focus)
  const fields = useLive((s) => s.fields)
  const compact = useCompact()
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  const [frame, setFrame] = useState<{ url: string; w: number; h: number } | null>(null)
  const [busy, setBusy] = useState<'give' | 'take' | 'confirm' | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const typing = useRef<HTMLInputElement>(null)
  const id = state.id
  const mine = state.holder === 'student'
  // el `controlId` de ahora, sin volver a montar los manejadores cada vez que cambia
  const control = useRef(state.controlId)
  control.current = state.controlId
  const holder = useRef(state.holder)
  holder.current = state.holder

  // ── la página toma el tamaño de quien la mira (un teléfono ve la versión de teléfono)
  useEffect(() => {
    const el = stage.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const fit = (): void => {
      const r = el.getBoundingClientRect()
      if (r.width < 200 || r.height < 200) return
      void api.invoke('live.viewport', { id, width: Math.round(r.width), height: Math.round(r.height) }).catch(() => {})
    }
    fit()
    const ro = new ResizeObserver(() => { if (timer) clearTimeout(timer); timer = setTimeout(fit, 250) })
    ro.observe(el)
    return () => { ro.disconnect(); if (timer) clearTimeout(timer) }
  }, [id])

  // ── las imágenes: se pide la siguiente cuando llega la anterior (la red marca el ritmo), y nada con la app oculta
  useEffect(() => {
    let alive = true
    let seq = -1
    let last: string | null = null
    const loop = async (): Promise<void> => {
      while (alive) {
        if (document.hidden) { await new Promise((r) => setTimeout(r, 500)); continue }
        const maxWidth = Math.min(1400, Math.round((stage.current?.clientWidth ?? 900) * Math.min(2, window.devicePixelRatio || 1)))
        try {
          const f = await api.invoke('live.frame', { id, after: seq, maxWidth })
          if (!alive) return
          if (f) {
            seq = f.seq
            const blob = await (await fetch(`data:${f.mime};base64,${f.data}`)).blob()
            const url = URL.createObjectURL(blob)
            setFrame({ url, w: f.w, h: f.h })
            if (last) URL.revokeObjectURL(last)
            last = url
          }
        } catch (e) {
          if (!alive) return
          // la ventana se cerró en el Mac (o se perdió la conexión): se avisa una vez y se cierra el panel
          if (isAulaError(e) && e.code === 'not_found') { hideLive(); return }
          await new Promise((r) => setTimeout(r, 1200))
        }
      }
    }
    void loop()
    return () => { alive = false; if (last) URL.revokeObjectURL(last) }
  }, [id])

  // ── lo que hace el estudiante se manda en orden y por lotes
  const queue = useRef<LiveInput[]>([])
  const sending = useRef(false)
  const flush = useCallback(async (): Promise<void> => {
    if (sending.current) return
    sending.current = true
    try {
      while (queue.current.length) {
        const events = queue.current.splice(0, 24)
        await api.invoke('live.input', { id, controlId: control.current, events }).catch(() => { /* el turno cambió: se descarta */ })
      }
    } finally { sending.current = false }
  }, [id])
  const send = useCallback((...events: LiveInput[]): void => {
    if (holder.current !== 'student') return
    queue.current.push(...events)
    void flush()
  }, [flush])

  /** Punto de la imagen (fracción 0–1) bajo el cursor o el dedo; null fuera de ella. */
  const pointOf = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const r = img.current?.getBoundingClientRect()
    if (!r || !r.width || !r.height) return null
    const x = (clientX - r.left) / r.width
    const y = (clientY - r.top) / r.height
    return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y }
  }

  // un dedo: tocar es pulsar; arrastrar es desplazar la página
  const drag = useRef<{ x: number; y: number; moved: boolean; at: number } | null>(null)
  const lastTap = useRef(0)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (!mine) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false, at: Date.now() }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || e.pointerType === 'mouse') return
    const dx = d.x - e.clientX
    const dy = d.y - e.clientY
    if (!d.moved && Math.hypot(dx, dy) < 9) return
    d.moved = true
    const p = pointOf(e.clientX, e.clientY)
    if (p) send({ type: 'wheel', x: p.x, y: p.y, dx: Math.round(dx), dy: Math.round(dy) })
    d.x = e.clientX
    d.y = e.clientY
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved || !mine) return
    const p = pointOf(e.clientX, e.clientY)
    if (!p) return
    const double = Date.now() - lastTap.current < 320
    lastTap.current = Date.now()
    send({ type: 'tap', x: p.x, y: p.y, ...(double ? { count: 2 } : {}) })
    // lo que se escribe pasa por un campo propio (acentos, pegar, el teclado del dispositivo). En un dispositivo solo se
    // enfoca al tocar un campo de la página (y en este mismo gesto, o el sistema no saca el teclado); si no, se suelta
    const onField = fields.some(([fx, fy, fw, fh]) => p.x >= fx - 0.01 && p.x <= fx + fw + 0.01 && p.y >= fy - 0.01 && p.y <= fy + fh + 0.01)
    if (!touch || onField) typing.current?.focus({ preventScroll: true })
    else typing.current?.blur()
  }
  const onWheel = (e: WheelEvent<HTMLDivElement>): void => {
    const p = pointOf(e.clientX, e.clientY)
    if (p) send({ type: 'wheel', x: p.x, y: p.y, dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) })
  }

  // las teclas con nombre y los atajos (⌘A, ⌘C…) se mandan como teclas; el texto llega por el campo (onTyped)
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (!mine) return
    const mods = { ...(e.shiftKey ? { shift: true } : {}), ...(e.altKey ? { alt: true } : {}), ...(e.ctrlKey ? { ctrl: true } : {}), ...(e.metaKey ? { meta: true } : {}) }
    if (NAMED_KEYS.has(e.key)) { e.preventDefault(); send({ type: 'key', key: e.key, ...mods }); return }
    // pegar se deja pasar: el texto pegado entra en el campo y sale por onTyped
    if ((e.metaKey || e.ctrlKey) && [...e.key].length === 1 && e.key.toLowerCase() !== 'v') { e.preventDefault(); send({ type: 'key', key: e.key, ...mods }) }
  }

  // el campo de escribir no guarda nada: lo escrito se manda a la página y se borra
  const onTyped = (): void => {
    const el = typing.current
    if (!el) return
    const value = el.value
    if (!value.includes(SENTINEL)) send({ type: 'key', key: 'Backspace' })
    const added = value.replace(SENTINEL, '')
    if (added) send({ type: 'text', text: added })
    el.value = SENTINEL
  }

  const act = async (what: 'give' | 'take' | 'confirm'): Promise<void> => {
    setBusy(what)
    try {
      if (what === 'give') useLive.setState({ state: await api.invoke('live.give', { id }) })
      else if (what === 'take') useLive.setState({ state: await api.invoke('live.take', { id }) })
      else {
        const r = await api.invoke('live.confirmSignIn', { id })
        if (r.signedIn) { toast.success(t('live.signedIn', { name: r.account?.label ?? '' })); void api.invoke('live.close', { id }).catch(() => {}); hideLive() }
        else toast.info(t('live.notSignedIn'))
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  const nav = (action: 'back' | 'reload'): void => { void api.invoke('live.navigate', { id, controlId: control.current, action }).catch(() => {}) }

  let host = ''
  try { host = state.url ? new URL(state.url).host : '' } catch { /* aún sin dirección */ }
  const showTyping = touch && mine && focus?.editable === true

  return (
    <motion.div className="fixed inset-0 z-[70] flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} role="dialog" aria-modal="true" aria-label={t('live.title')}>
      {!compact && <button type="button" aria-label={t('live.close')} className="absolute inset-0 bg-black/20 dark:bg-black/45" onClick={hideLive} />}
      <motion.div
        initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
        className={cx('relative flex min-h-0 flex-col bg-raised', compact ? 'h-full w-full' : 'm-auto h-[min(92vh,900px)] w-[min(94vw,1240px)] overflow-hidden rounded-[22px] border-[0.5px] border-line shadow-[var(--e3)]')}
        style={compact ? { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}
      >
        {/* arriba: atrás, recargar, dónde estamos, cerrar */}
        <div className="flex h-12 shrink-0 items-center gap-1 border-b-[0.5px] border-line-soft px-2">
          <IconButton size="sm" label={t('nav.back')} disabled={!mine || !state.canGoBack} onClick={() => nav('back')}><Icon name="chevron-left" size={17} /></IconButton>
          <IconButton size="sm" label={t('live.reload')} disabled={!mine} onClick={() => nav('reload')}><Icon name="refresh" size={15} /></IconButton>
          <div className="mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-full bg-fill1 px-3 h-8">
            {state.loading ? <Spinner size={12} /> : <Icon name="lock" size={12} className="shrink-0 text-text3" />}
            <span className="truncate t-ui text-text2">{host || t('live.opening')}</span>
          </div>
          <IconButton size="sm" label={t('live.close')} onClick={hideLive}><Icon name="close" size={16} /></IconButton>
        </div>

        {/* lo que Aula le dijo al pasarle la página */}
        {state.note && mine && (
          <div className="flex shrink-0 items-start gap-2.5 border-b-[0.5px] border-line-soft bg-accent-wash px-4 py-2.5">
            <AulaMark size={18} state="idle" />
            <p className="t-callout text-text">{state.note}</p>
          </div>
        )}

        {/* la página */}
        <div
          ref={stage}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { drag.current = null }}
          onWheel={onWheel}
          className={cx('relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-sunken outline-none', mine ? 'cursor-default' : 'cursor-not-allowed')}
        >
          {frame ? (
            <img ref={img} src={frame.url} alt="" draggable={false} className="absolute left-1/2 top-0 max-h-full max-w-full -translate-x-1/2" style={{ aspectRatio: `${frame.w} / ${frame.h}` }} />
          ) : (
            <div className="grid h-full place-items-center text-text3"><Spinner size={20} /></div>
          )}
          {/* con el turno de Aula, la página se ve pero no se toca */}
          {!mine && (
            <div className="absolute inset-0 grid place-items-center bg-paper/55">
              <div className="mx-6 flex max-w-sm flex-col items-center gap-3 rounded-[18px] bg-raised px-6 py-5 text-center shadow-[var(--e2)]">
                <AulaMark size={34} state="thinking" />
                <p className="t-callout font-medium">{t('live.aulaLooking')}</p>
                <p className="t-ui text-text2">{t('live.aulaLookingHint')}</p>
              </div>
            </div>
          )}
        </div>

        {/* el campo por el que pasa lo escrito (va directo a la página; aquí no se guarda). Con ratón y teclado no se ve;
            en un dispositivo es la barra que acompaña al teclado mientras se escribe en un campo de la página */}
        <div className={showTyping ? 'flex shrink-0 items-center gap-2 border-t-[0.5px] border-line-soft px-3 py-2' : 'pointer-events-none absolute left-0 top-0 h-px w-px overflow-hidden opacity-0'}>
          {showTyping && <Icon name="edit" size={15} className="text-text3" />}
          <input
            ref={typing}
            defaultValue={SENTINEL}
            onInput={onTyped}
            onKeyDown={onKeyDown}
            type={focus?.kind === 'password' ? 'password' : 'text'}
            inputMode={focus?.kind === 'number' || focus?.kind === 'code' ? 'numeric' : focus?.kind === 'email' ? 'email' : focus?.kind === 'url' ? 'url' : focus?.kind === 'tel' ? 'tel' : undefined}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            aria-label={t('live.typeHere')} placeholder={t('live.typeHere')} tabIndex={-1}
            className="h-9 min-w-0 flex-1 rounded-[10px] bg-field border-[0.5px] border-line px-3 t-callout outline-none"
          />
        </div>

        {/* abajo: de quién es el turno */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t-[0.5px] border-line-soft px-3 py-2.5">
          <span className="t-ui text-text2">{mine ? t(state.purpose === 'signin' ? 'live.signInHint' : 'live.yourTurn') : t('live.aulaTurn')}</span>
          <div className="flex items-center gap-2">
            {mine && state.purpose === 'signin' && <Button variant="primary" loading={busy === 'confirm'} onClick={() => void act('confirm')}>{t('live.confirmSignIn')}</Button>}
            {mine && state.purpose !== 'signin' && <Button variant="primary" loading={busy === 'give'} icon={<Icon name="eye" size={14} />} onClick={() => void act('give')}>{t('live.give')}</Button>}
            {!mine && <Button variant="primary" loading={busy === 'take'} icon={<Icon name="hand" size={14} />} onClick={() => void act('take')}>{t('live.take')}</Button>}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
