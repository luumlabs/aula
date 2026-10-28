// Ajustes de Aula (settings.json). Pocos, sencillos y con valores por defecto que funcionan sin tocar nada.
// Cada sección vive en su archivo; el dueño de cada dominio la amplía.
import type { AISettings } from './ai'
import type { PlatformSettings } from './platforms'
import { defaultAISettings } from './ai'
import { defaultPlatformSettings } from './platforms'

export type ThemeMode = 'system' | 'light' | 'dark'
export type AppLanguageCode = 'system' | 'es' | 'en'

export interface GeneralSettings {
  /** Idioma de la interfaz ('system' = el del sistema si es es/en; si no, inglés). */
  language: AppLanguageCode
  theme: ThemeMode
  /** Movimiento: 'full' (por defecto), 'reduced' (sin flotantes ni fondo animado). 'system' sigue a macOS/Windows. */
  motion: 'system' | 'full' | 'reduced'
  /** Tamaño del texto (1 = normal). */
  textScale: number
  /** Recordatorio diario para estudiar y aviso el día antes de cada examen. */
  reminders: boolean
  reminderTime: string // 'HH:mm'
  /** Nombre con el que Aula saluda (opcional). */
  name: string
}

export interface PersistentSettings {
  /** «Aula siempre activa»: sigue en la bandeja al cerrar, revisa la plataforma y avisa. Apagado por defecto. */
  enabled: boolean
  style: 'quiet' | 'balanced' | 'attentive'
  openAtLogin: boolean
  quietHours: { from: string; to: string } | null
}

export interface DataSettings {
  /** Memoria: Aula recuerda tus preferencias, exámenes y lo que te cuesta. */
  memory: boolean
  /** Búsqueda web para crear cursos y responder. */
  webSearch: boolean
  autoUpdate: boolean
}

export interface AppSettings {
  version: 2
  onboarded: boolean
  general: GeneralSettings
  ai: AISettings
  platforms: PlatformSettings
  persistent: PersistentSettings
  data: DataSettings
}

export function defaultSettings(): AppSettings {
  return {
    version: 2,
    onboarded: false,
    general: { language: 'system', theme: 'system', motion: 'system', textScale: 1, reminders: true, reminderTime: '18:00', name: '' },
    ai: defaultAISettings(),
    platforms: defaultPlatformSettings(),
    persistent: { enabled: false, style: 'balanced', openAtLogin: false, quietHours: { from: '22:00', to: '08:00' } },
    data: { memory: true, webSearch: true, autoUpdate: true }
  }
}

/** Parche parcial y profundo de los ajustes (lo que manda la interfaz al cambiar algo). */
export type SettingsPatch = { [K in keyof AppSettings]?: AppSettings[K] extends object ? Partial<AppSettings[K]> : AppSettings[K] }
