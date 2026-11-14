// Marcar y preguntar al tutor. Una capa que se monta UNA vez alrededor de cada bloque visual (diagrama, dibujo, figura
// rotulada, mapa, estructura): con la pluma de ladrillo se rodea o se subraya, con el marcador se resalta y con «Nota» se
// escribe al lado; después, «Preguntar al tutor» manda la pregunta con lo marcado contado en palabras (las partes con
// nombre que tocan las marcas, las notas y dónde están). Cada bloque solo pone en sus partes `data-ask-part` y
// `data-ask-label` (ver dom.ts). Solo donde hay tutor (la lección y la práctica; nunca en el simulacro): `ctx.onAskTutor`.
// Puntero, táctil y teclado (← → elige una parte, Intro la rodea, N le pone una nota, ⌘Z deshace, Esc cierra). Las
// marcas se guardan en fracciones de lo que se amplía, así que siguen al zoom; al enviarse, se desvanecen.
// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: viewer/src/annotate.ts (createAnnotator) y
// viewer/src/scene-view.ts (drawbar y ask), reescrito como componente de React con el estilo de Aula.
import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Button, Icon, IconButton, SegmentedTabs, TextField, cx, useTheme } from '@renderer/design'
import type { Block } from '@shared/schema/blocks'
import type { AskFrom, BlockContext } from '../types'
import { barAnchor, collectTargets, findCanvas, findSurface, headSlot, keyboardTargets, unionBox } from './dom'
import { MarkerGlyph, PenGlyph } from './glyphs'
import {
  clampInto, cleanText, composeMarkMessage, isPageKey, loopAround, MARK_LIMITS, MARK_STYLE, marksCenter, marksOf, nearestTarget, ringLabelTop, strokePath, summarizeMarks, whereOf,
  type AskedBlock, type Box, type Mark, type MarkTarget, type MarkTool, type Pt, type Stroke
} from './marks'

/** Los bloques que se pueden marcar (los demás pasan tal cual). `structure` llega como tipo propio o como desconocido. */
const ASKABLE: ReadonlySet<string> = new Set(['diagram', 'drawing', 'labeled', 'map', 'structure'])

export const blockKind = (b: Block): string => (b.type === 'unknown' ? b.rawType : b.type)

/** Bloques que en el enunciado de un ejercicio sin resolver esconden su título (una molécula: su nombre es la respuesta). */
const TITLE_HIDDEN_IN_PROMPT: ReadonlySet<string> = new Set(['structure'])

/** Lo que el mensaje cuenta del bloque: su tipo, su título (o su texto alternativo) y su pie. */
export function blockInfo(b: Block, inPrompt = false): AskedBlock {
  const o = b as unknown as Record<string, unknown>
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
  const kind = blockKind(b)
  // lo que la figura no enseña en pantalla tampoco va en el mensaje (si no, el estudiante vería la respuesta en el chat)
  const title = inPrompt && TITLE_HIDDEN_IN_PROMPT.has(kind) ? undefined : (s(o.title) ?? s(o.alt))
  return { kind, title, caption: s(o.caption) }
}

// MARK: Contrato con los bloques

export interface AskControl {
  open: boolean
  start: () => void
  stop: () => void
}

interface AskApi {
  control: AskControl
  /** El bloque pone su propio botón (o lo apaga en un modo, p. ej. en una práctica): el botón de la esquina no se pinta. */
  claim: (enabled: boolean) => () => void
}

const AskContext = createContext<AskApi | null>(null)

/**
 * Para un bloque que pone el botón de marcar en su propia barra (o que lo apaga mientras se practica): devuelve el control
 * (o null si aquí no se puede preguntar o el bloque lo apaga).
 */
export function useAskTrigger(enabled: boolean): AskControl | null {
  const api = useContext(AskContext)
  const claim = api?.claim
  useEffect(() => claim?.(enabled), [claim, enabled])
  return api && enabled ? api.control : null
}

/** El envoltorio de cada bloque (en `SafeBlockView`): sin tutor, en papel o en bloques no visuales, nada. */
export function AskLayer({ block, ctx, children }: { block: Block; ctx: BlockContext; children: ReactNode }) {
  const onAsk = ctx.onAskTutor
  if (!onAsk || ctx.mode === 'print' || !ASKABLE.has(blockKind(block))) return <>{children}</>
  return (
    <AskHost block={block} ctx={ctx} onAsk={onAsk}>
      {children}
    </AskHost>
  )
}

// MARK: La capa

interface Slots {
  root: HTMLElement
  canvas: HTMLElement
  layer: HTMLDivElement
  /** El hueco del botón «Marcar» en la cabecera del bloque (o null: va en una esquina del lienzo). */
  head: HTMLElement | null
}

/** Lo que se amplía, en píxeles de la capa (para dibujar las marcas guardadas en fracciones). */
interface Frame {
  x: number
  y: number
  w: number
  h: number
}

interface KbFocus {
  id: string
  name: string
  k: number
  n: number
  /** Caja de la parte en fracciones de lo que se amplía. */
  box: Box
}

const UNIT: Box = { x: 0, y: 0, width: 1, height: 1 }

function AskHost({ block, ctx, onAsk, children }: { block: Block; ctx: BlockContext; onAsk: NonNullable<BlockContext['onAskTutor']>; children: ReactNode }) {
  const { t, i18n } = useTranslation('visual')
  const { reducedMotion } = useTheme()
  const host = useRef<HTMLDivElement>(null)
  const [slots, setSlots] = useState<Slots | null>(null)
  const [open, setOpen] = useState(false)
  const [claimed, setClaimed] = useState<boolean | null>(null)
  const [tool, setTool] = useState<MarkTool>('pen')
  const [marks, setMarks] = useState<Mark[]>([])
  const [question, setQuestion] = useState('')
  const [fading, setFading] = useState<number | null>(null)
  const [frame, setFrame] = useState<Frame | null>(null)
  // `seq`: cada nota nueva es un campo nuevo (el anterior se cierra al pulsar en otro sitio y ya no admite nada)
  const [noteAt, setNoteAtState] = useState<(Pt & { seq: number }) | null>(null)
  const noteSeq = useRef(0)
  const setNoteAt = useCallback((p: Pt | null) => setNoteAtState(p ? { x: p.x, y: p.y, seq: ++noteSeq.current } : null), [])
  const [kb, setKb] = useState<KbFocus | null>(null)
  const [announce, setAnnounce] = useState('')
  /** Se buscó una parte con el teclado y la figura no tiene ninguna con nombre (se dice en la zona de marcar). */
  const [noParts, setNoParts] = useState(false)
  const [preview, setPreview] = useState<string[]>([])
  const [barEl, setBarEl] = useState<{ el: HTMLDivElement; outside: boolean } | null>(null)
  const surfaceRef = useRef<Element | null>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const livePath = useRef<SVGPathElement>(null)
  const live = useRef<{ kind: Stroke['kind']; points: Pt[]; id: number; last: Pt } | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const focusTrigger = useRef(false)
  const fadeToken = useRef(0)
  const hintId = useId()

  // el lienzo del bloque y, dentro, la capa (se vuelve a buscar si el bloque cambia: carga perezosa, medidas, otro lienzo)
  useLayoutEffect(() => {
    const h = host.current
    if (!h) return
    let raf = 0
    let cur: (Slots & { restore?: () => void }) | null = null
    const detach = (): void => {
      if (!cur) return
      cur.layer.remove()
      cur.head?.remove()
      cur.restore?.()
      cur = null
    }
    const attach = (): void => {
      raf = 0
      const root = h.firstElementChild
      const canvas = root instanceof HTMLElement ? findCanvas(root, cur?.layer) : null
      const headAt = root instanceof HTMLElement && canvas ? headSlot(root, canvas) : null
      const same = cur && canvas === cur.canvas && cur.layer.parentElement === canvas && root === cur.root
      if (same && cur && canvas && (cur.head ? cur.head.parentElement === headAt : headAt === null)) {
        // la capa va la última del lienzo (sin z-index, se pinta encima por orden): lo que el bloque añade después (la figura
        // al medirse, unos marcadores) quedaría encima; se vuelve a poner al final, sin perder el foco ni un trazo a medias
        if (canvas.lastElementChild !== cur.layer) {
          // con un trazo a medias o una nota escribiéndose, se espera (moverla soltaría el puntero o cerraría la nota)
          const focused = document.activeElement
          if (live.current || (focused instanceof HTMLInputElement && cur.layer.contains(focused))) {
            raf = requestAnimationFrame(attach)
            return
          }
          const back = focused instanceof HTMLElement && cur.layer.contains(focused) ? focused : null
          canvas.appendChild(cur.layer)
          back?.focus({ preventScroll: true })
        }
        return
      }
      detach()
      surfaceRef.current = null
      if (!canvas || !(root instanceof HTMLElement)) {
        setSlots(null)
        return
      }
      const layer = document.createElement('div')
      layer.setAttribute('data-ask-layer', '')
      // sin z-index: así el marcador se multiplica con la figura (un z-index la aislaría)
      layer.className = 'absolute inset-0 pointer-events-none'
      // el marco de «marcando» sigue las esquinas del lienzo; uno de esquinas rectas (un dibujo) lo lleva algo redondeado
      layer.style.borderRadius = parseFloat(getComputedStyle(canvas).borderTopLeftRadius) > 0 ? 'inherit' : '12px'
      let restore: (() => void) | undefined
      if (getComputedStyle(canvas).position === 'static') {
        const prev = canvas.style.position
        canvas.style.position = 'relative'
        restore = () => (canvas.style.position = prev)
      }
      canvas.appendChild(layer)
      let head: HTMLElement | null = null
      if (headAt) {
        head = document.createElement('span')
        head.setAttribute('data-ask-head', '')
        head.className = 'inline-flex'
        headAt.appendChild(head)
      }
      cur = { root, canvas, layer, head, restore }
      setSlots({ root, canvas, layer, head })
    }
    attach()
    const mo = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(attach)
    })
    mo.observe(h, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      cancelAnimationFrame(raf)
      detach()
    }
  }, [])

  const surfaceOf = useCallback((): Element | null => {
    if (!slots) return null
    let el = surfaceRef.current
    if (!el || !el.isConnected || !slots.canvas.contains(el)) {
      el = findSurface(slots.canvas, slots.layer)
      surfaceRef.current = el
    }
    return el
  }, [slots])

  /** Punto de la pantalla → fracciones de lo que se amplía (y al revés). */
  const toFrac = useCallback((x: number, y: number): Pt | null => {
    const r = surfaceOf()?.getBoundingClientRect()
    if (!r || !(r.width > 0) || !(r.height > 0)) return null
    return { x: (x - r.left) / r.width, y: (y - r.top) / r.height }
  }, [surfaceOf])
  const toClient = useCallback((p: Pt): Pt => {
    const r = surfaceOf()?.getBoundingClientRect()
    return r ? { x: r.left + p.x * r.width, y: r.top + p.y * r.height } : p
  }, [surfaceOf])

  const active = open || marks.length > 0
  // mientras hay marcas, se sigue a lo que se amplía y se mueve (un fotograma cada vez, sin pintar si no cambia)
  useLayoutEffect(() => {
    if (!slots || !active) return
    let raf = 0
    const tick = (): void => {
      const surf = surfaceOf()
      if (surf) {
        const lr = slots.layer.getBoundingClientRect()
        const sr = surf.getBoundingClientRect()
        const f = { x: sr.left - lr.left, y: sr.top - lr.top, w: sr.width, h: sr.height }
        setFrame((p) => (p && Math.abs(p.x - f.x) < 0.25 && Math.abs(p.y - f.y) < 0.25 && Math.abs(p.w - f.w) < 0.25 && Math.abs(p.h - f.h) < 0.25 ? p : f))
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [slots, active, surfaceOf])

  // sin nada que siga al zoom (las marcas se quedarían donde estaban), el zoom con la rueda espera a que se cierre
  useEffect(() => {
    if (!slots || !active) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const surf = surfaceOf()
      if (surf && surf !== slots.canvas) return
      e.preventDefault()
      e.stopPropagation()
    }
    slots.layer.addEventListener('wheel', onWheel, { passive: false })
    return () => slots.layer.removeEventListener('wheel', onWheel)
  }, [slots, active, surfaceOf])

  // MARK: abrir y cerrar

  const start = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    fadeToken.current++
    setFading(null)
    setMarks([])
    setKb(null)
    setNoteAt(null)
    setPreview([])
    setNoParts(false)
    setOpen(true)
    ctx.onInteract?.(block.id, 'ask-mark')
  }, [ctx, block.id, setNoteAt])

  /** Cierra el modo de marcar; las marcas se desvanecen (despacio al enviarse) y se borran. */
  const dismiss = useCallback((sent: boolean) => {
    setOpen(false)
    setNoteAt(null)
    setKb(null)
    live.current = null
    // el foco vuelve al botón que lo abrió (el de la esquina se vuelve a pintar al cerrar)
    const back = returnFocus.current
    if (back?.isConnected) back.focus({ preventScroll: true })
    else focusTrigger.current = true
    const ms = reducedMotion ? 0 : sent ? 700 : 260
    const token = ++fadeToken.current
    setFading(ms)
    window.setTimeout(() => {
      if (fadeToken.current !== token) return
      setMarks([])
      setFading(null)
    }, ms)
  }, [reducedMotion, setNoteAt])

  const claim = useCallback((enabled: boolean) => {
    setClaimed(enabled)
    return () => setClaimed(null)
  }, [])
  // el bloque lo apaga (otra pestaña, una práctica): se cierra
  useEffect(() => {
    if (open && claimed === false) dismiss(false)
  }, [open, claimed, dismiss])

  const control = useMemo<AskControl>(() => ({ open, start, stop: () => dismiss(false) }), [open, start, dismiss])
  const api = useMemo<AskApi>(() => ({ control, claim }), [control, claim])

  // la barra va justo debajo del lienzo (dentro del bloque); en una figura con role="img", después del bloque
  useLayoutEffect(() => {
    if (!open || !slots) return
    const el = document.createElement('div')
    el.setAttribute('data-ask-bar', '')
    const anchor = slots.root.getAttribute('role') === 'img' ? null : barAnchor(slots.root, slots.canvas)
    if (anchor) anchor.after(el)
    else host.current?.appendChild(el)
    setBarEl({ el, outside: !anchor })
    return () => {
      el.remove()
      setBarEl(null)
    }
  }, [open, slots])

  useEffect(() => {
    if (open || !focusTrigger.current) return
    focusTrigger.current = false
    trigger.current?.focus({ preventScroll: true })
  }, [open])

  // al abrir: el foco a la zona de marcar (Esc y el teclado funcionan ya) y la barra a la vista
  useEffect(() => {
    if (!open) return
    overlay.current?.focus({ preventScroll: true })
    barEl?.el.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [open, barEl, reducedMotion])

  // MARK: dibujar

  const loc = (p: Pt): Pt => (frame ? { x: frame.x + p.x * frame.w, y: frame.y + p.y * frame.h } : p)

  const drawLive = (): void => {
    const l = live.current
    livePath.current?.setAttribute('d', l ? strokePath(l.points.map(loc)) : '')
  }

  const addMark = (m: Mark): void => setMarks((cur) => [...cur, m].slice(-MARK_LIMITS.marks))

  /** Las partes que hay ahora mismo bajo el lienzo (en coordenadas de pantalla). */
  const targetsNow = (): MarkTarget[] => (slots ? collectTargets(slots.root, slots.canvas, slots.layer) : [])

  // lo que toca se decide al acabar el trazo (en un dibujo que se mueve, lo que se vio al marcar, no lo que haya al enviar)
  const finishStroke = (): void => {
    const l = live.current
    live.current = null
    livePath.current?.setAttribute('d', '')
    if (!l || !l.points.length) return
    const ids = slots ? marksOf({ kind: l.kind, points: l.points.map(toClient) }, targetsNow()).map((t) => t.id) : undefined
    addMark({ kind: l.kind, points: l.points, ...(ids ? { ids } : {}) })
  }

  const onDown = (e: RPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.currentTarget.focus({ preventScroll: true })
    setKb(null)
    setNoParts(false)
    const p = toFrac(e.clientX, e.clientY)
    if (!p) return
    if (tool === 'note') {
      setNoteAt(p)
      return
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // sin captura también se dibuja (dentro del lienzo)
    }
    live.current = { kind: tool, points: [p], id: e.pointerId, last: { x: e.clientX, y: e.clientY } }
    drawLive()
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>): void => {
    const l = live.current
    if (!l || l.id !== e.pointerId) return
    if (Math.hypot(e.clientX - l.last.x, e.clientY - l.last.y) < 1.5) return
    const p = toFrac(e.clientX, e.clientY)
    if (!p) return
    l.points.push(p)
    l.last = { x: e.clientX, y: e.clientY }
    if (l.points.length >= MARK_LIMITS.points) finishStroke()
    else drawLive()
  }
  const onUp = (e: RPointerEvent<HTMLDivElement>): void => {
    if (live.current?.id === e.pointerId) finishStroke()
  }

  const undo = (): void => setMarks((m) => m.slice(0, -1))
  const clearAll = (): void => {
    setMarks([])
    setKb(null)
  }

  const commitNote = (text: string, at: Pt): void => {
    setNoteAt(null)
    const clean = cleanText(text, MARK_LIMITS.noteChars)
    if (clean) {
      const near = slots ? nearestTarget(toClient(at), targetsNow()) : undefined
      addMark({ kind: 'note', x: at.x, y: at.y, text: clean, ...(slots ? { ids: near ? [near.id] : [] } : {}) })
    }
    overlay.current?.focus({ preventScroll: true })
  }

  // MARK: teclado

  const fracBox = (b: Box): Box | null => {
    const a = toFrac(b.x, b.y), c = toFrac(b.x + b.width, b.y + b.height)
    return a && c ? { x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y } : null
  }

  const moveKb = (key: string): void => {
    if (!slots) return
    const list = keyboardTargets(slots.root, slots.canvas, slots.layer)
    if (!list.length) {
      setNoParts(true)
      setAnnounce(t('ask.noParts'))
      return
    }
    const cur = kb ? list.findIndex((x) => x.id === kb.id) : -1
    const fwd = key === 'ArrowRight' || key === 'ArrowDown'
    const i = key === 'Home' ? 0 : key === 'End' ? list.length - 1 : cur < 0 ? (fwd ? 0 : list.length - 1) : (cur + (fwd ? 1 : -1) + list.length) % list.length
    const target = list[i]
    const box = fracBox(unionBox(target))
    if (!box) return
    setKb({ id: target.id, name: target.name, k: i + 1, n: list.length, box })
    setAnnounce(t('ask.partOf', { name: target.name, k: i + 1, n: list.length }))
  }

  const markKb = (): void => {
    if (!kb) return
    const a = toClient({ x: kb.box.x, y: kb.box.y }), c = toClient({ x: kb.box.x + kb.box.width, y: kb.box.y + kb.box.height })
    const b: Box = { x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y }
    const kind: Stroke['kind'] = tool === 'marker' ? 'marker' : 'pen'
    const pts = kind === 'pen'
      ? loopAround(b, 5)
      : Array.from({ length: 12 }, (_, i) => ({ x: b.x - 4 + ((b.width + 8) * i) / 11, y: b.y + b.height / 2 }))
    const points = pts.map((p) => toFrac(p.x, p.y)).filter((p): p is Pt => p !== null)
    addMark({ kind, points, ids: [kb.id] })
    setAnnounce(t('ask.markedOne', { name: kb.name }))
  }

  const onKey = (e: RKeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return
    const mod = e.metaKey || e.ctrlKey
    // lo que tomaría un atajo de la página (espacio pasa de página, Intro comprueba el ejercicio…) se queda aquí
    if (isPageKey(e)) e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      dismiss(false)
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      undo()
    } else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      moveKb(e.key)
    } else if ((e.key === 'Enter' || e.key === ' ') && kb) {
      e.preventDefault()
      if (tool === 'note') setNoteAt({ x: kb.box.x + kb.box.width, y: kb.box.y + kb.box.height / 2 })
      else markKb()
    } else if ((e.key === 'n' || e.key === 'N') && !mod) {
      e.preventDefault()
      setNoteAt(kb ? { x: kb.box.x + kb.box.width, y: kb.box.y + kb.box.height / 2 } : { x: 0.5, y: 0.5 })
    } else if (isPageKey(e)) {
      // sin parte elegida, Intro y espacio no hacen nada (y el espacio no desplaza la página)
      e.preventDefault()
    }
  }

  const onBarKey = (e: RKeyboardEvent<HTMLDivElement>): void => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
    // los botones de la barra hacen lo suyo (espacio pulsa una herramienta), pero la página no pasa ni se comprueba nada
    if (isPageKey(e)) e.stopPropagation()
    if (e.key === 'Escape' && !typing) {
      e.preventDefault()
      dismiss(false)
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault()
      undo()
    }
  }

  // MARK: preguntar

  /** Lo marcado en palabras, con las partes que hay ahora mismo bajo las marcas. */
  const summarize = useCallback(() => {
    if (!slots) return null
    const targets = collectTargets(slots.root, slots.canvas, slots.layer)
    const client: Mark[] = marks.map((m) => (m.kind === 'note' ? { ...m, ...toClient(m) } : { ...m, points: m.points.map(toClient) }))
    return summarizeMarks(targets, client)
  }, [slots, marks, toClient])

  // lo que ya se reconoce, debajo de las herramientas: así se ve que el tutor sabrá qué es
  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      const s = summarize()
      setPreview(s ? s.marked.map((m) => m.name) : [])
    })
    return () => cancelAnimationFrame(raf)
  }, [open, summarize])

  const canSend = marks.length > 0 || question.trim().length > 0
  const send = (): void => {
    if (!canSend) return
    const summary = summarize()
    if (!summary) return
    const r = surfaceOf()?.getBoundingClientRect()
    const surfBox: Box = r ? { x: r.left, y: r.top, width: r.width, height: r.height } : UNIT
    const c = marksCenter(marks)
    const message = composeMarkMessage({
      question,
      block: blockInfo(block, ctx.inPrompt === true),
      summary,
      where: c ? whereOf(c, UNIT) : undefined,
      whereOfPoint: (p) => whereOf(p, surfBox),
      t: (k, v) => t(k, v),
      lang: i18n.language
    })
    // una figura del enunciado de un ejercicio: el tutor sabe cuál es (y, si está sin resolver, ayuda sin resolverlo)
    const from: AskFrom | undefined = ctx.exerciseId ? { exerciseId: ctx.exerciseId, unsolved: ctx.inPrompt === true } : undefined
    onAsk(block.id, message, from)
    ctx.onInteract?.(block.id, 'ask-tutor')
    setQuestion('')
    dismiss(true)
  }

  // MARK: pintar

  const strokeProps = (kind: Stroke['kind']) =>
    kind === 'pen'
      ? { fill: 'none', stroke: 'var(--pigment-brick)', strokeWidth: MARK_STYLE.pen.width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
      : { fill: 'none', stroke: 'var(--pigment-brick)', strokeWidth: MARK_STYLE.marker.width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className: 'opacity-[0.24] mix-blend-multiply dark:opacity-[0.32] dark:mix-blend-normal' }

  const showMarks = (open || marks.length > 0) && frame !== null
  const fadeMs = fading ?? 0
  const layerView = slots
    ? createPortal(
        <>
          {showMarks && (
            <div className="absolute inset-0 pointer-events-none" style={{ opacity: fading !== null ? 0 : 1, transition: fadeMs ? `opacity ${fadeMs}ms ease` : undefined }}>
              <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
                {marks.map((m, i) => (m.kind === 'note' ? null : <path key={i} d={strokePath(m.points.map(loc))} {...strokeProps(m.kind)} />))}
                <path ref={livePath} d="" {...strokeProps(tool === 'marker' ? 'marker' : 'pen')} />
              </svg>
              {marks.map((m, i) => (m.kind === 'note' ? <NoteChip key={i} at={loc(m)} text={m.text} width={slots.layer.clientWidth} height={slots.layer.clientHeight} /> : null))}
              {open && kb && <KbRing box={kb.box} frame={frame} name={kb.name} width={slots.layer.clientWidth} height={slots.layer.clientHeight} />}
            </div>
          )}
          {open && (
            <div
              ref={overlay}
              role="application"
              aria-roledescription={t('ask.surfaceRole')}
              aria-label={t('ask.surface')}
              aria-describedby={hintId}
              tabIndex={0}
              data-ask-overlay=""
              className={cx('absolute inset-0 pointer-events-auto touch-none select-none outline-none [border-radius:inherit]', tool === 'note' ? 'cursor-text' : 'cursor-crosshair')}
              style={{ boxShadow: 'inset 0 0 0 1.5px var(--accent-line)' }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onKeyDown={onKey}
            >
              {(noParts || (marks.length === 0 && !kb)) && (
                <motion.span
                  className="pointer-events-none absolute left-2.5 top-2 inline-flex max-w-[min(360px,calc(100%-20px))] items-center gap-1.5 rounded-[12px] border-[0.5px] border-line bg-raised/85 px-2.5 py-1 t-caption font-medium text-text2 shadow-[var(--e1)] backdrop-blur-md"
                  initial={reducedMotion ? false : { opacity: 0, y: -3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <span className="text-[color:var(--pigment-brick)]">{tool === 'marker' ? <MarkerGlyph size={12} /> : tool === 'note' ? <Icon name="note" size={12} /> : <PenGlyph size={12} />}</span>
                  {noParts ? t('ask.noParts') : t(`ask.start${tool === 'note' ? 'Note' : tool === 'marker' ? 'Marker' : 'Pen'}`)}
                </motion.span>
              )}
            </div>
          )}
          {open && noteAt && frame && (
            <NoteInput
              key={noteAt.seq}
              at={loc(noteAt)}
              width={slots.layer.clientWidth}
              height={slots.layer.clientHeight}
              placeholder={t('ask.notePlaceholder')}
              label={t('ask.note')}
              onDone={(text) => commitNote(text, { x: noteAt.x, y: noteAt.y })}
              onCancel={() => {
                setNoteAt(null)
                overlay.current?.focus({ preventScroll: true })
              }}
            />
          )}
          {!open && claimed === null && !slots.head && (
            <div className="absolute right-2 bottom-2 pointer-events-auto">
              <button
                ref={trigger}
                type="button"
                onClick={start}
                title={t('ask.start')}
                aria-label={t('ask.start')}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border-[0.5px] border-line bg-raised/85 px-2.5 t-caption font-semibold text-text2 shadow-[var(--e1)] backdrop-blur-md outline-none transition-colors hover:text-text focus-visible:shadow-[0_0_0_3px_var(--accent-wash)]"
              >
                <PenGlyph size={13} />
                {t('ask.startShort')}
              </button>
            </div>
          )}
        </>,
        slots.layer
      )
    : null

  // el botón «Marcar» en la cabecera del bloque (junto a sus otras acciones): se queda, pulsado mientras se marca
  const headTrigger =
    slots?.head && claimed === null
      ? createPortal(
          <Button
            ref={trigger}
            size="sm"
            variant="ghost"
            icon={<PenGlyph size={13} />}
            aria-pressed={open}
            aria-label={t('ask.start')}
            title={t('ask.start')}
            className={cx(open && 'bg-fill2 text-text')}
            onClick={open ? () => dismiss(false) : start}
          >
            {t('ask.startShort')}
          </Button>,
          slots.head
        )
      : null

  const bar =
    open && barEl
      ? createPortal(
          <motion.div
            role="group"
            aria-label={t('ask.title')}
            className={cx('flex flex-col gap-2.5 rounded-[16px] border-[0.5px] border-line bg-surface px-3 py-2.5 shadow-[var(--e1)]', barEl.outside && 'mt-3')}
            initial={reducedMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
            onKeyDown={onBarKey}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <SegmentedTabs
                size="sm"
                value={tool}
                onChange={(v) => {
                  setTool(v)
                  overlay.current?.focus({ preventScroll: true })
                }}
                items={[
                  { id: 'pen', label: t('ask.pen'), icon: <PenGlyph size={13} /> },
                  { id: 'marker', label: t('ask.marker'), icon: <MarkerGlyph size={13} /> },
                  { id: 'note', label: t('ask.note'), icon: <Icon name="note" size={13} /> }
                ]}
              />
              <span aria-hidden className="mx-0.5 h-4 w-px bg-line" />
              <IconButton size="sm" label={t('ask.undo')} onClick={undo} disabled={!marks.length}>
                <Icon name="undo" size={14} />
              </IconButton>
              <IconButton size="sm" label={t('ask.clear')} onClick={clearAll} disabled={!marks.length}>
                <Icon name="trash" size={14} />
              </IconButton>
              <span className="flex-1" />
              <IconButton size="sm" label={t('ask.close')} onClick={() => dismiss(false)}>
                <Icon name="close" size={14} />
              </IconButton>
            </div>
            {preview.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="t-caption text-text3">{t('ask.recognized')}</span>
                {preview.map((n, i) => (
                  <span key={`${i}:${n}`} className="inline-flex h-6 max-w-[220px] items-center truncate rounded-full bg-accent-wash px-2.5 t-caption font-medium text-accent-text">
                    {n}
                  </span>
                ))}
              </div>
            )}
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
            >
              <TextField
                className="min-w-[200px] flex-1"
                value={question}
                maxLength={MARK_LIMITS.question}
                placeholder={t('ask.askPlaceholder')}
                aria-label={t('ask.askPlaceholder')}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    e.currentTarget.blur()
                    overlay.current?.focus({ preventScroll: true })
                  }
                }}
              />
              <Button type="submit" variant="primary" icon={<Icon name="tutor" size={14} />} disabled={!canSend}>
                {t('ask.ask')}
              </Button>
            </form>
            <p id={hintId} className="t-caption m-0 text-text3">
              {t('ask.hint', { mod: /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl' })}
            </p>
            <span className="sr-only" aria-live="polite">
              {announce}
            </span>
          </motion.div>,
          barEl.el
        )
      : null

  return (
    <AskContext.Provider value={api}>
      <div ref={host} data-ask-host="">
        {children}
      </div>
      {layerView}
      {headTrigger}
      {bar}
    </AskContext.Provider>
  )
}

/** Una nota escrita sobre la figura: serif en cursiva y ladrillo, sobre un poco de papel para leerse encima de una foto. */
function NoteChip({ at, text, width, height }: { at: Pt; text: string; width: number; height: number }) {
  const flip = at.x > width - 200
  return (
    <span
      className="absolute max-w-[220px] rounded-[7px] border-[0.5px] border-line bg-raised/90 px-1.5 py-0.5 font-serif text-[15px] italic leading-[19px] text-[color:var(--pigment-brick)] shadow-[var(--e1)]"
      // centrada en su punto, pero sin salirse por arriba ni por abajo (el lienzo la cortaría)
      style={{ left: at.x, top: clampInto(at.y - 12, 24, height, 2) + 12, transform: `translate(${flip ? '-100%' : '0'}, -50%)` }}
    >
      {text}
    </span>
  )
}

/** El campo de una nota, donde se pulsó: Intro la deja, Esc la descarta y salir del campo también la deja. */
function NoteInput({ at, width, height, placeholder, label, onDone, onCancel }: { at: Pt; width: number; height: number; placeholder: string; label: string; onDone: (text: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  // después del toque: si no, el navegador devuelve el foco a la zona de marcar
  useEffect(() => {
    const id = window.setTimeout(() => ref.current?.focus({ preventScroll: true }))
    return () => window.clearTimeout(id)
  }, [])
  const finish = (keep: boolean): void => {
    if (done.current) return
    done.current = true
    if (keep) onDone(ref.current?.value ?? '')
    else onCancel()
  }
  const left = Math.max(4, Math.min(at.x, width - 214))
  const top = clampInto(at.y - 16, 32, height)
  return (
    <input
      ref={ref}
      aria-label={label}
      placeholder={placeholder}
      maxLength={MARK_LIMITS.noteChars}
      className="pointer-events-auto absolute h-8 w-[210px] rounded-[9px] border-[0.5px] border-accent-line bg-field px-2.5 font-serif text-[15px] italic text-[color:var(--pigment-brick)] shadow-[var(--e2)] outline-none placeholder:not-italic placeholder:font-sans placeholder:text-[13px] placeholder:text-text3 focus:shadow-[0_0_0_3px_var(--accent-wash)]"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true)
        if (e.key === 'Escape') finish(false)
      }}
      onBlur={() => finish(true)}
    />
  )
}

/** La parte elegida con el teclado: un recuadro discontinuo de ladrillo con su nombre. */
function KbRing({ box, frame, name, width, height }: { box: Box; frame: Frame; name: string; width: number; height: number }) {
  const x = frame.x + box.x * frame.w - 5, y = frame.y + box.y * frame.h - 5
  const w = box.width * frame.w + 10, h = box.height * frame.h + 10
  // el nombre, encima del recuadro; pegado al borde de arriba, debajo (el lienzo recorta lo que sale)
  const left = Math.max(4, Math.min(x, width - 60))
  return (
    <>
      <span className="absolute rounded-[10px]" style={{ left: x, top: y, width: w, height: h, outline: '1.5px dashed var(--accent)', outlineOffset: 0 }} />
      <span
        className="absolute truncate whitespace-nowrap rounded-full bg-accent px-2 py-[1px] t-caption font-semibold text-on-accent"
        style={{ left, top: ringLabelTop(y, h, height), maxWidth: Math.max(60, width - left - 4) }}
      >
        {name}
      </span>
    </>
  )
}
