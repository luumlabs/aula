// Política de energía (lado de la interfaz): junta lo que cuenta el proceso principal (¿se ve la ventana?, ¿pantalla
// bloqueada?, ¿batería?) con la última vez que el estudiante tocó la app, y fija el nivel ambiental (design/ambient.ts).
// Sin trabajo en reposo: un solo temporizador que se programa para cuando toque calmarse, nunca uno que se repite.
import type { PowerState } from '@shared/ipc/power'
import { ambientLevel, ambientLevelFor, calmAfter, setAmbientLevel } from '@renderer/design/ambient'
import { api } from './api'

let power: PowerState = { window: 'active', locked: false, battery: false }
let lastActivity = 0
let timer: ReturnType<typeof setTimeout> | null = null
let installed = false

const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

function update(): void {
  const idle = performance.now() - lastActivity
  const level = ambientLevelFor(power, pageHidden(), idle)
  setAmbientLevel(level)
  if (timer) clearTimeout(timer)
  timer = null
  // aún moviéndose: despertar justo cuando toque calmarse (si mientras tanto hubo actividad, se reprograma desde ahí)
  if (level === 'run' && !power.pinned) timer = setTimeout(update, Math.max(250, calmAfter(power) - idle + 50))
}

/** El estudiante hizo algo (o llegó una orden del menú o de la bandeja): todo vuelve a moverse. */
export function noteActivity(): void {
  lastActivity = performance.now()
  if (ambientLevel() === 'run') return
  update()
  // si llega el ratón o una tecla es que la ventana se ve: que el proceso principal lo confirme ya (sin esperar a su ronda)
  if (ambientLevel() === 'off') refresh()
}

let asking = 0
function refresh(): void {
  const now = performance.now()
  if (now - asking < 500) return
  asking = now
  api.invoke('app.powerState').then(setPower, () => undefined)
}

function setPower(next: PowerState): void {
  const wasSeen = power.window === 'active' || power.window === 'inactive'
  const seen = next.window === 'active' || next.window === 'inactive'
  // volver a la ventana (mostrarla, restaurarla, darle el foco) cuenta como actividad
  if ((seen && !wasSeen) || (next.window === 'active' && power.window !== 'active') || (power.locked && !next.locked)) lastActivity = performance.now()
  power = next
  update()
}

export function installPowerPolicy(): void {
  if (installed || typeof window === 'undefined' || !window.aula) return
  // la ventana oculta de impresión pinta con todo quieto ya; que no pause nada a medias aunque la principal esté minimizada
  if (new URLSearchParams(location.search).has('print')) return
  installed = true
  lastActivity = performance.now()
  const opts = { capture: true, passive: true } as const
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(ev, noteActivity, opts)
  document.addEventListener('visibilitychange', update)
  api.on('app.power', setPower)
  api.on('app.command', noteActivity)
  asking = performance.now()
  api.invoke('app.powerState').then(setPower, () => update())
  update()
}
