// Vista de impresión en la ventana oculta (src/main/electron/print.ts): recibe el plan con `window.__aulaPrint.render(plan)`,
// lo dibuja fuera de la app (todo lo demás queda oculto), siempre en claro, y responde cuando las fuentes, las imágenes y los
// bloques que se cargan aparte (diagramas, figuras…) ya están: entonces el proceso principal pide el PDF.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DocumentPlan } from '@shared/documents'
import { useDev } from '@renderer/app/dev'
import { setLanguage } from '@renderer/i18n'
import { PrintDocument } from './PrintDocument'

declare global {
  interface Window {
    __aulaPrint?: { render: (plan: DocumentPlan) => Promise<{ ok: boolean; error?: string }> }
  }
}

/** ¿Esta ventana es la de impresión? */
export function isPrintWindow(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('print') === '1'
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

/** Espera a que no quede nada por cargar (bloques perezosos, imágenes, fuentes de KaTeX) y la página esté quieta. */
async function settled(root: HTMLElement): Promise<void> {
  const start = Date.now()
  let quiet = 0
  while (Date.now() - start < 25_000) {
    await frame()
    await document.fonts.ready
    const busy = root.querySelector('[aria-busy="true"], .skeleton')
    const images = [...root.querySelectorAll('img')].filter((i) => !i.complete)
    quiet = busy || images.length ? 0 : quiet + 1
    if (quiet >= 3) break
    await sleep(120)
  }
  await document.fonts.ready
  await frame()
  await sleep(120)
}

export function PrintRoot() {
  const [job, setJob] = useState<{ plan: DocumentPlan; seq: number } | null>(null)
  const done = useRef<((r: { ok: boolean; error?: string }) => void) | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    useDev.setState({ theme: 'light' })
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('aula-printing', 'reduce-motion')
    let seq = 0
    window.__aulaPrint = {
      render: (plan) => new Promise((resolve) => {
        done.current = resolve
        setLanguage(plan.lang)
        // el título del PDF (sus metadatos) es el del documento
        document.title = plan.title + (plan.courseTitle && plan.courseTitle !== plan.title ? ` · ${plan.courseTitle}` : '')
        setJob({ plan, seq: ++seq })
      })
    }
    return () => {
      delete window.__aulaPrint
      document.documentElement.classList.remove('aula-printing')
    }
  }, [])

  useEffect(() => {
    const el = root.current
    if (!job || !el) return
    let alive = true
    settled(el)
      .then(() => alive && done.current?.({ ok: true }))
      .catch((e: unknown) => alive && done.current?.({ ok: false, error: String((e as Error)?.message ?? e) }))
    return () => { alive = false }
  }, [job])

  return createPortal(
    <div id="aula-print" ref={root}>
      {job && <PrintDocument key={job.seq} plan={job.plan} />}
    </div>,
    document.body
  )
}
