// Movimiento ambiental y energía: un único nivel para toda la interfaz.
//  · run   — la ventana se ve y alguien la usa: todo se mueve.
//  · calm  — se ve, pero nadie la toca desde hace un rato: lo DECORATIVO se queda quieto (tarjetas que flotan, la luz tras el
//            cristal, el reposo del pixel art, puntos que laten…); lo que Aula está haciendo (el chat escribiendo, un curso
//            creándose, el temporizador) sigue. Al mover el ratón o pulsar una tecla vuelve a «run».
//  · off   — la ventana no se ve (minimizada, oculta en la bandeja, pantalla bloqueada): no se mueve nada.
// El nivel lo fija lib/power.ts con lo que cuenta el proceso principal; aquí solo está el estado, la regla y los ganchos.
// En <html data-ambient="calm|off"> lo leen las animaciones CSS (ambient.css).
import { useSyncExternalStore } from 'react'
import type { PowerState } from '@shared/ipc/power'
import './ambient.css'

export type AmbientLevel = 'run' | 'calm' | 'off'
/** decor: adorno (se para en calm); activity: muestra algo que pasa ahora (solo se para cuando la ventana no se ve). */
export type AmbientKind = 'decor' | 'activity'

/** Tiempo sin tocar la app tras el que lo decorativo se queda quieto. */
export const CALM_AFTER_MS = 45_000
/** Con batería, antes. */
export const CALM_AFTER_BATTERY_MS = 25_000
/** Con la ventana a la vista pero sin foco (otra app delante), antes aún. */
export const CALM_AFTER_UNFOCUSED_MS = 15_000

/** La regla, pura: el nivel para un estado de la ventana y el tiempo desde la última interacción. */
export function ambientLevelFor(power: PowerState, pageHidden: boolean, idleMs: number): AmbientLevel {
  if (power.pinned) return 'run'
  if (power.locked || pageHidden || power.window === 'minimized' || power.window === 'hidden') return 'off'
  return idleMs >= calmAfter(power) ? 'calm' : 'run'
}

export function calmAfter(power: PowerState): number {
  if (power.window === 'inactive') return CALM_AFTER_UNFOCUSED_MS
  return power.battery ? CALM_AFTER_BATTERY_MS : CALM_AFTER_MS
}

/** ¿Se mueve algo de este tipo con este nivel? */
export function ambientAllows(level: AmbientLevel, kind: AmbientKind = 'decor'): boolean {
  return level === 'run' || (level === 'calm' && kind === 'activity')
}

// ——— estado compartido ———
let level: AmbientLevel = 'run'
const subs = new Set<(l: AmbientLevel) => void>()

export function ambientLevel(): AmbientLevel {
  return level
}

export function setAmbientLevel(next: AmbientLevel): void {
  if (next === level) return
  const prev = level
  level = next
  if (typeof document !== 'undefined') {
    if (next === 'run') delete document.documentElement.dataset.ambient
    else document.documentElement.dataset.ambient = next
  }
  if (next === 'off') pauseLoops()
  else if (prev === 'off') resumeLoops()
  for (const fn of [...subs]) fn(next)
}

// Con la ventana sin ver, los BUCLES de animaciones web (motion con `repeat: Infinity`, WAAPI) se pausan aquí; nunca una
// animación que termina (entradas, salidas, respuestas a una acción). Las CSS las pausa ambient.css: un pause() desde aquí
// les quitaría para siempre el control de `animation-play-state`.
const swept: Animation[] = []
function pauseLoops(): void {
  if (typeof document === 'undefined' || typeof document.getAnimations !== 'function') return
  for (const a of document.getAnimations()) {
    if ((typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation) || (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition)) continue
    if (a.playState !== 'running' || a.effect?.getTiming().iterations !== Infinity) continue
    try {
      a.pause()
      swept.push(a)
    } catch {
      /* ya cancelada */
    }
  }
}
function resumeLoops(): void {
  for (const a of swept.splice(0)) {
    try {
      if (a.playState === 'paused') a.play()
    } catch {
      /* ya cancelada */
    }
  }
}

export function onAmbientChange(fn: (l: AmbientLevel) => void): () => void {
  subs.add(fn)
  return () => subs.delete(fn)
}

/** ¿Puede moverse ahora algo de este tipo? Se vuelve a pintar al cambiar. */
export function useAmbient(kind: AmbientKind = 'decor'): boolean {
  const l = useSyncExternalStore(onAmbientChange, ambientLevel, ambientLevel)
  return ambientAllows(l, kind)
}

/** Pausa y reanuda unas animaciones web (WAAPI) con el nivel. Devuelve la función que deja de seguirlas. */
export function trackAnimations(anims: Animation[], kind: AmbientKind = 'decor'): () => void {
  const apply = (l: AmbientLevel) => {
    const run = ambientAllows(l, kind)
    for (const a of anims) {
      try {
        if (run && a.playState === 'paused') a.play()
        else if (!run && a.playState === 'running') a.pause()
      } catch {
        /* animación ya cancelada */
      }
    }
  }
  apply(level)
  return onAmbientChange(apply)
}
