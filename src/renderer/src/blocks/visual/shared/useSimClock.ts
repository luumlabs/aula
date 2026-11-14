// Reloj de una animación (dibujos que se mueven): pasa el tiempo entre `lo` y `hi` a la velocidad elegida, con bucle o
// parando al final. Solo pide fotogramas mientras corre, se ve en pantalla y la ventana no está oculta; con «Reducir
// movimiento» no arranca solo (el botón de reproducir sigue funcionando). Misma lógica que el reloj de las simulaciones.
import { useCallback, useEffect, useRef, useState } from 'react'
import { SimulationClock } from '../lib/simulation'

/** ¿La ventana se ve? (oculta o minimizada: nada de fotogramas). */
export function usePageVisible(): boolean {
  const [shown, setShown] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    if (typeof document === 'undefined') return
    const update = (): void => setShown(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return shown
}

export interface SimClock {
  now: number
  playing: boolean
  rate: number
  loop: boolean
  toggle: () => void
  scrub: (v: number) => void
  setRate: (r: number) => void
  toggleLoop: () => void
  pause: () => void
  reset: () => void
}

export function useSimClock({ lo, hi, speed, loops, autoplay, onScreen }: { lo: number; hi: number; speed: number; loops: boolean; autoplay: boolean; onScreen: boolean }): SimClock {
  const [playing, setPlaying] = useState(autoplay)
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState(loops)
  const [time, setTime] = useState(() => SimulationClock.initial(lo))
  const clock = useRef({ start: 0, t0: time })
  const pageShown = usePageVisible()
  const now = Math.min(Math.max(time, lo), hi)
  const s = speed > 0 && Number.isFinite(speed) ? speed : 1

  useEffect(() => {
    if (!playing || !onScreen || !pageShown || !(hi > lo)) return
    clock.current = { start: performance.now(), t0: now >= hi - 1e-9 && !loop ? lo : now }
    let raf = 0
    const tick = (ms: number): void => {
      const tt = SimulationClock.time(clock.current.t0, (ms - clock.current.start) / 1000, s * rate, lo, hi, loop)
      setTime(tt)
      // sin bucle, al llegar al final se para de verdad
      if (!loop && tt >= hi - 1e-9) { setPlaying(false); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, onScreen, pageShown, lo, hi, s, rate, loop]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && now >= hi - 1e-9) setTime(lo)
      return !p
    })
  }, [now, lo, hi])
  const scrub = useCallback((v: number) => { setPlaying(false); setTime(v) }, [])
  const pause = useCallback(() => setPlaying(false), [])
  const reset = useCallback(() => { setPlaying(false); setTime(SimulationClock.initial(lo)) }, [lo])
  const toggleLoop = useCallback(() => setLoop((v) => !v), [])
  return { now, playing, rate, loop, toggle, scrub, setRate, toggleLoop, pause, reset }
}
