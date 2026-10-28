// Mantener viva la sesión: cada ~25 minutos (con un desfase estable por cuenta para no ir todas a la vez) se hace una petición
// barata con la sesión, que alarga su caducidad en el servidor y detecta si se cerró. Aquí solo las decisiones (puras y
// probadas): a quién toca, cuándo despertar, qué hacer tras un fallo de red y cuándo guardar las cookies.

export interface KeepAliveAccountState {
  id: string
  /** Último estado conocido. Las que necesitan iniciar sesión no se comprueban (solo el estudiante puede arreglarlo). */
  status: 'signedIn' | 'needsSignIn' | 'checking' | 'unknown'
  /** Última comprobación (ms), con o sin éxito; null = nunca. */
  lastCheckedAt: number | null
  /** Fallos seguidos sin respuesta concluyente (red caída, 5xx…). */
  failures: number
  /** Hay una comprobación en marcha. */
  inFlight: boolean
  /** Hay una ventana de inicio de sesión abierta (no se molesta). */
  signingIn?: boolean
}

export interface KeepAliveOptions {
  /** Minutos entre comprobaciones (por defecto 25; se limita a 5…120). */
  intervalMinutes?: number
  /** Encendido (Ajustes → mantener la sesión). */
  enabled?: boolean
  /** Primer reintento tras un fallo de red (ms); se duplica hasta el intervalo. */
  retryBaseMs?: number
}

export interface KeepAlivePlan {
  /** Cuentas que hay que comprobar ya. */
  due: string[]
  /** Cuándo volver a mirar (ms desde la época), o null si no hay nada que vigilar. */
  nextWakeAt: number | null
}

const MIN = 60_000

export function keepAliveInterval(opts: KeepAliveOptions = {}): number {
  const m = Math.max(5, Math.min(120, opts.intervalMinutes ?? 25))
  return m * MIN
}

/** Desfase estable (0…10 % del intervalo) según el id: las cuentas no se comprueban todas en el mismo segundo. */
export function accountJitter(id: string, intervalMs: number): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h % 1000) / 1000 * intervalMs * 0.1
}

/** Cuándo toca la próxima comprobación de una cuenta (ms), o null si no se comprueba. */
export function nextCheckAt(a: KeepAliveAccountState, now: number, opts: KeepAliveOptions = {}): number | null {
  if (opts.enabled === false) return null
  if (a.status === 'needsSignIn' || a.signingIn) return null
  if (a.inFlight) return null
  if (a.lastCheckedAt == null) return now
  const interval = keepAliveInterval(opts)
  if (a.failures > 0) {
    // reintento con retroceso: 1, 2, 4, 8… minutos, nunca más que el intervalo
    const base = opts.retryBaseMs ?? MIN
    const wait = Math.min(interval, base * 2 ** Math.min(10, a.failures - 1))
    return a.lastCheckedAt + wait
  }
  return a.lastCheckedAt + interval + accountJitter(a.id, interval)
}

/** Qué cuentas comprobar ahora y cuándo despertar la próxima vez. */
export function planKeepAlive(accounts: KeepAliveAccountState[], now: number, opts: KeepAliveOptions = {}): KeepAlivePlan {
  const due: string[] = []
  let next: number | null = null
  for (const a of accounts) {
    const at = nextCheckAt(a, now, opts)
    if (at == null) continue
    if (at <= now) {
      due.push(a.id)
      continue
    }
    next = next == null ? at : Math.min(next, at)
  }
  return { due, nextWakeAt: next }
}

/** Resultado de una comprobación → nuevo estado de la cuenta para el planificador. */
export function applyCheckResult(
  a: KeepAliveAccountState,
  verdict: 'signedIn' | 'signedOut' | 'unknown' | 'error',
  now: number
): KeepAliveAccountState {
  switch (verdict) {
    case 'signedIn': return { ...a, status: 'signedIn', lastCheckedAt: now, failures: 0, inFlight: false }
    case 'signedOut': return { ...a, status: 'needsSignIn', lastCheckedAt: now, failures: 0, inFlight: false }
    // sin respuesta concluyente: no se cambia el estado (nunca se marca «cerrada» por un fallo de red)
    default: return { ...a, lastCheckedAt: now, failures: a.failures + 1, inFlight: false }
  }
}

/**
 * Tras volver de la suspensión o recuperar la red: las cuentas cuya última comprobación es más vieja que el intervalo (o que
 * estaban fallando) se comprueban ya.
 */
export function afterResume(accounts: KeepAliveAccountState[], now: number, opts: KeepAliveOptions = {}): KeepAliveAccountState[] {
  const interval = keepAliveInterval(opts)
  return accounts.map((a) =>
    a.status !== 'needsSignIn' && (a.failures > 0 || a.lastCheckedAt == null || now - a.lastCheckedAt >= interval)
      ? { ...a, lastCheckedAt: null, failures: 0 }
      : a
  )
}

/** ¿Toca guardar las cookies? (cada `everyMs`, por defecto 5 min, y siempre si algo cambió desde la última copia). */
export function snapshotDue(lastSnapshotAt: number | null, now: number, changedSince: boolean, everyMs = 5 * MIN): boolean {
  if (lastSnapshotAt == null) return true
  if (changedSince && now - lastSnapshotAt >= 30_000) return true
  return now - lastSnapshotAt >= everyMs
}
