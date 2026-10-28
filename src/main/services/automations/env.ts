// Lo que la app pone a disposición de las automatizaciones (AutomationEnvironment de AutomationRunner.swift). El proceso
// principal lo arma con los servicios de verdad (y con lo de Electron que inyecta su manejador: el navegador de plataformas,
// las notificaciones y el chat); las pruebas, con falsos. Nada de `electron` aquí.
import type { AssistantMessage } from '@shared/assistant/types'
import type { HomeSummary } from '@shared/ipc/home'
import type { PackSummary } from '@shared/schema/library'
import type { AutomationNotice } from '@shared/automations'
import type { ChatModel } from '../ai'
import type { RoutineEvent } from './routines'

/** Una cuenta de plataforma de estudio (sin secretos). */
export interface AutomationPlatformAccount {
  id: string
  label: string
  kind: string
  url: string
}

/** Una página leída (texto para la IA, ya con su valla de «no confiable»). */
export interface AutomationPlatformPage {
  url: string
  title: string
  needsLogin: boolean
  text: string
  nextOffset: number | null
}

/** El navegador de plataformas en SOLO LECTURA (nunca pulsa, escribe, descarga ni abre la ventana de inicio de sesión). */
export interface AutomationPlatforms {
  accounts(): AutomationPlatformAccount[]
  /** `null` = se puede usar; si no, por qué no. */
  readiness(): string | null
  read(url: string, opts: { tab: string; offset?: number; signal?: AbortSignal }): Promise<AutomationPlatformPage>
  links(url: string, opts: { tab: string; signal?: AbortSignal }): Promise<AutomationPlatformPage>
  /** Cierra la pestaña de la revisión (al terminar). */
  closeTab(tab: string): void
}

/** El chat de Aula: cada novedad deja un mensaje en «Novedades de Aula» (o en la conversación del seguimiento). */
export interface InboxChatSink {
  /** Devuelve el id del mensaje guardado (si no, se usa el que traía). */
  postSystemMessage(threadId: string, message: AssistantMessage): Promise<string | undefined | void> | string | undefined | void
}

export interface AutomationEnvironment {
  /** Zona del estudiante (la del sistema, ahora: si cambia, las horas siguen siendo las locales). */
  timeZone(): string
  /** Eventos del calendario de Aula entre dos fechas (plataformas, cursos y propios). */
  events(from: Date, to: Date): Promise<RoutineEvent[]>
  packs(): PackSummary[]
  packIDForEvent(eventID: string): string | undefined
  /** El resumen de Inicio (plan de hoy, exámenes, pendientes); `null` si no se puede calcular. */
  studySummary(): Promise<HomeSummary | null>
  /** La IA de Aula; `null` = no hay ninguna lista. */
  model(): Promise<ChatModel | null>
  language(): 'es' | 'en'
  platforms(): AutomationPlatforms | null
  chat(): InboxChatSink | null
  /** Publica una notificación del sistema (ya decidida: nivel, sonido, grupo). */
  notify(n: AutomationNotice): void
  /** Quita las notificaciones de entradas que ya se leyeron, archivaron o pospusieron. */
  withdraw(entryIDs: string[]): void
}
