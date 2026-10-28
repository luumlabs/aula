// Ajustes de plataformas de estudio. Dueño: dominio «platforms» (src/main/services/platforms + src/main/electron/browser).
export type PlatformKind = 'canvas' | 'moodle' | 'blackboard' | 'classroom' | 'brightspace' | 'schoology' | 'teams' | 'sakai' | 'itslearning' | 'openedx' | 'other'

export const PLATFORM_KINDS: readonly PlatformKind[] = [
  'canvas', 'moodle', 'blackboard', 'classroom', 'brightspace', 'schoology', 'teams', 'sakai', 'itslearning', 'openedx', 'other'
]

/** Último estado conocido de la sesión (se guarda para mostrarlo al arrancar mientras se comprueba). */
export type PlatformSessionState = 'signedIn' | 'needsSignIn' | 'unknown'

export interface PlatformAccount {
  id: string
  kind: PlatformKind
  /** Nombre que ve el estudiante («Canvas · Universidad X»). */
  label: string
  /** Dirección base (https://campus.universidad.edu). */
  baseURL: string
  /** Clave en el almacén de secretos del enlace privado del calendario .ics (`platform.calendar.<id>`). Nunca el enlace. */
  calendarSecretRef?: string
  /** Modo token de Canvas (opcional): clave del token en secretos (`platform.canvasToken.<id>`). Sin token se usa la sesión. */
  tokenSecretRef?: string
  /** Lo que el estudiante quiere que la IA sepa («los temas del examen están en Avisos»). */
  notes?: string
  /** Último estado conocido de la sesión. */
  lastState?: PlatformSessionState
  /** Última vez que se comprobó que la sesión sigue viva. */
  lastCheckedAt?: string
  lastSignedInAt?: string
  createdAt?: string
}

export interface PlatformSettings {
  accounts: PlatformAccount[]
  /** Mantener la sesión abierta (refrescarla en segundo plano y guardar las cookies de sesión). Encendido por defecto. */
  keepSignedIn: boolean
  /** Cada cuántos minutos se refresca la sesión en segundo plano (20–30 recomendado). */
  keepAliveMinutes: number
  /** Días que se conservan las cookies de sesión guardadas (sin caducidad del servidor). */
  sessionCookieDays: number
}

export function defaultPlatformSettings(): PlatformSettings {
  return { accounts: [], keepSignedIn: true, keepAliveMinutes: 25, sessionCookieDays: 30 }
}

/** Claves del almacén de secretos de una cuenta (nunca se muestran ni se registran sus valores). */
export const platformSecretKeys = {
  cookies: (accountId: string) => `platform.cookies.${accountId}`,
  calendar: (accountId: string) => `platform.calendar.${accountId}`,
  canvasToken: (accountId: string) => `platform.canvasToken.${accountId}`
}
