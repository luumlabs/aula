// Tipos de las plataformas de estudio que ven la interfaz y las herramientas de la IA (sin secretos nunca).
import type { PlatformKind } from '../settings/platforms'

/** Estado de la sesión en este momento: comprobando, iniciada o hace falta iniciarla. */
export type PlatformStatus = 'signedIn' | 'needsSignIn' | 'checking' | 'unknown'

/** Una cuenta tal como la ve la interfaz. */
export interface PlatformAccountView {
  id: string
  kind: PlatformKind
  label: string
  baseURL: string
  /** Nombre de la plataforma («Canvas», «Moodle»… u «Otra página»). */
  kindName: string
  status: PlatformStatus
  /** Motivo breve del estado (español), p. ej. «La sesión caducó». */
  statusDetail?: string
  lastCheckedAt?: string
  lastSignedInAt?: string
  /** ¿Tiene el calendario privado conectado? (el enlace nunca sale del proceso principal). */
  calendarConnected: boolean
  /** ¿Usa token de Canvas en vez de la sesión? */
  tokenMode: boolean
  /** ¿Hay una ventana de inicio de sesión abierta? */
  signingIn: boolean
  notes?: string
}

/** Resultado de sondear una dirección sin sesión (para proponer el tipo y el nombre). */
export interface PlatformProbeResult {
  url: string
  finalURL: string
  kind: PlatformKind | null
  confidence: 'high' | 'medium' | 'low' | null
  title?: string
  httpStatus?: number
  /** Aviso (p. ej. Edmodo cerró). */
  notice?: string
  /** Error en español si no se pudo abrir. */
  error?: string
}

/** Curso de la plataforma («crear un curso desde mi plataforma»). */
export interface PlatformCourse {
  id: string
  accountId: string
  kind: PlatformKind
  name: string
  code?: string
  term?: string
  url: string
}

/** Qué pide permiso. */
export type ApprovalAction = 'click' | 'navigate' | 'download' | 'submit'

/** Petición de permiso al estudiante (la muestra la interfaz; sin respuesta a tiempo = denegado). */
export interface PlatformApprovalRequest {
  id: string
  accountId: string | null
  action: ApprovalAction
  /** Texto del botón o del enlace. */
  label: string
  url?: string
  pageURL?: string
  /** Categoría de peligro (submit, assessment, delete, message…), o 'unknown' si solo no es de lectura. */
  category: string
  /** Por qué se pregunta, en el idioma de la interfaz (lo elige el proceso principal con tr() al pedir permiso). */
  reason: string
  createdAt: string
  expiresAt: string
}

/** Resolución de una petición (también la emite el evento al decidir o caducar). */
export interface PlatformApprovalResolution {
  id: string
  allowed: boolean
  /** 'user' = decidió el estudiante; 'timeout' = nadie contestó; 'cancelled' = ya no hacía falta. */
  by: 'user' | 'timeout' | 'cancelled'
}
