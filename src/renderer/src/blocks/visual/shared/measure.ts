// Medida de textos con la letra de la interfaz (canvas 2D): la disposición de los diagramas reserva lo que de verdad ocupa
// cada etiqueta. Antes de que cargue la letra, se vuelve a medir cuando está lista.
import { useEffect, useState } from 'react'
import { estimateMeasure, type Measure } from '../lib/diagramLayout'

let ctx: CanvasRenderingContext2D | null | undefined

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx
  ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  return ctx
}

function family(): string {
  if (typeof document === 'undefined') return 'sans-serif'
  return getComputedStyle(document.body).fontFamily || 'sans-serif'
}

export const canvasMeasure: Measure = (text, size, bold) => {
  const c = context()
  if (!c) return estimateMeasure(text, size, bold)
  c.font = `${bold ? 600 : 400} ${size}px ${family()}`
  return c.measureText(text).width
}

/** Cambia cuando las letras terminan de cargar (para volver a medir). */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(() => typeof document === 'undefined' || document.fonts?.status === 'loaded')
  useEffect(() => {
    if (ready || typeof document === 'undefined' || !document.fonts) return
    let alive = true
    void document.fonts.ready.then(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [ready])
  return ready
}
