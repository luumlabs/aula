// El resaltado sin coste al abrir una pantalla: highlight.js se carga aparte la primera vez que hace falta y cada tarjeta se
// colorea cuando se acerca a la vista (un simulacro con veinte bloques de código no los resalta todos de golpe al entrar).
import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { CodeLanguage } from '@engine/content/codeLanguages'
import type { Highlighted } from './highlighter'

type Highlighter = typeof import('./highlighter')

let loaded: Highlighter | undefined
let loading: Promise<Highlighter> | undefined

/** Carga highlight.js con sus gramáticas (una sola vez; si falla, la próxima tarjeta lo vuelve a intentar). */
export function loadHighlighter(): Promise<Highlighter> {
  loading ??= import('./highlighter').then(
    (m) => (loaded = m),
    (err: unknown) => {
      loading = undefined
      throw err
    }
  )
  return loading
}

// Un solo vigía para todas las tarjetas: avisa cuando una está a menos de ~una pantalla de la vista (también dentro de las
// columnas que se desplazan: `scrollMargin`).
const watchers = new Map<Element, () => void>()
let observer: IntersectionObserver | undefined

function unwatch(el: Element): void {
  watchers.delete(el)
  observer?.unobserve(el)
}

function watch(el: Element, near: () => void): () => void {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const cb = watchers.get(e.target)
        unwatch(e.target)
        cb?.()
      }
    },
    { rootMargin: '600px 0px', scrollMargin: '600px 0px' } as IntersectionObserverInit
  )
  watchers.set(el, near)
  observer.observe(el)
  return () => unwatch(el)
}

/** La ventana oculta que hace los PDF: allí todo se colorea ya (no hay desplazamiento que esperar). */
const printing = (): boolean => typeof document !== 'undefined' && document.documentElement.classList.contains('aula-printing')

/** ¿Está el elemento cerca de la vista? Una vez que sí, se queda en sí. Sin IntersectionObserver (pruebas), siempre. */
export function useNearView(ref: RefObject<Element | null>, eager: boolean): boolean {
  const [near, setNear] = useState(() => eager || typeof IntersectionObserver === 'undefined' || printing())
  useEffect(() => {
    if (near || eager) return
    const el = ref.current
    return el ? watch(el, () => setNear(true)) : undefined
  }, [near, eager, ref])
  return near || eager
}

export interface HighlightState {
  /** El código coloreado; undefined si aún no toca, si no hay nada que colorear o si no se pudo cargar. */
  result?: Highlighted
  /** Se está cargando highlight.js para colorearlo. */
  pending: boolean
}

/** Colorea `code` cuando `wanted` (cerca de la vista y con algo que colorear). `live`: llega por partes. */
export function useHighlight(code: string, language: CodeLanguage | undefined, wanted: boolean, live: boolean): HighlightState {
  const [failed, setFailed] = useState(false)
  const [, setReady] = useState(loaded !== undefined)
  const engine = loaded
  useEffect(() => {
    if (!wanted || engine || failed) return
    let alive = true
    loadHighlighter().then(
      () => alive && setReady(true),
      () => alive && setFailed(true)
    )
    return () => {
      alive = false
    }
  }, [wanted, engine, failed])
  const result = useMemo(() => (wanted && engine ? engine.highlight(code, language, live) : undefined), [wanted, engine, code, language, live])
  return { result, pending: wanted && !engine && !failed }
}
