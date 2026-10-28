// «Conectar con ChatGPT» con su progreso a la vista (A3-P1-2): el proceso principal avisa por 'agents.codexLogin' (descarga del
// Codex oficial, la página para iniciar sesión, el código de un solo uso) y aquí se guarda en un store, no en la tarjeta: si el
// estudiante va a otra pantalla y vuelve, sigue viendo en qué va y puede cancelar (antes el botón volvía a estar normal con el
// `codex login` vivo detrás).
import { create } from 'zustand'
import type { CodexLoginEvent } from '@shared/agents'
import { api } from '@renderer/lib/api'
import { aiClient } from '@renderer/lib/aiClient'

export type ChatGPTLoginPhase = 'idle' | 'starting' | 'downloading' | 'browser' | 'device'

export interface ChatGPTLoginView {
  phase: ChatGPTLoginPhase
  /** La página de inicio de sesión (para volver a abrirla si el navegador no se abrió o se cerró la pestaña). */
  url?: string
  /** Código de un solo uso (inicio de sesión con código). */
  code?: string
  bytesDone: number
  bytesTotal: number
}

export const IDLE_LOGIN: ChatGPTLoginView = { phase: 'idle', bytesDone: 0, bytesTotal: 0 }

/** Lo que enseña la tarjeta tras un aviso del proceso principal. Puro (con prueba). */
export function applyLoginEvent(view: ChatGPTLoginView, event: CodexLoginEvent): ChatGPTLoginView {
  if (view.phase === 'idle') return view
  switch (event.type) {
    case 'downloading':
      return { ...view, phase: 'downloading', bytesDone: Math.max(0, event.bytesDone), bytesTotal: Math.max(0, event.bytesTotal) }
    case 'waitingForBrowser':
      return { ...view, phase: 'browser', url: event.url ?? view.url, code: undefined }
    case 'deviceCode':
      return { ...view, phase: 'device', url: event.url, code: event.code }
    case 'finished':
      return view
  }
}

/** Fracción de la descarga (0–1), o null si aún no se sabe el tamaño. */
export function downloadFraction(view: ChatGPTLoginView): number | null {
  return view.bytesTotal > 0 ? Math.min(1, view.bytesDone / view.bytesTotal) : null
}

interface ChatGPTLoginState extends ChatGPTLoginView {
  /** Sube cada vez que una conexión termina bien (la tarjeta recarga aunque se haya montado otra vez). */
  connected: number
  /** Conecta y deja ChatGPT en uso. `true` si quedó conectado; los errores (salvo cancelar) van a `onError`. */
  start: (opts?: { deviceAuth?: boolean; onError?: (message: string) => void }) => Promise<boolean>
  cancel: () => void
}

let attempt = 0

export const useChatGPTLogin = create<ChatGPTLoginState>((set, get) => ({
  ...IDLE_LOGIN,
  connected: 0,
  start: async (opts = {}) => {
    const mine = ++attempt
    set({ ...IDLE_LOGIN, phase: 'starting' })
    const off = api.on('agents.codexLogin', (event) => {
      if (mine === attempt) set(applyLoginEvent(get(), event))
    })
    try {
      await api.invoke('agents.codexLogin', opts.deviceAuth ? { deviceAuth: true } : undefined)
      if (mine !== attempt) return false
      await aiClient.configure({ providerId: 'codex-cli' })
      if (mine !== attempt) return false
      set({ ...IDLE_LOGIN, connected: get().connected + 1 })
      return true
    } catch (e) {
      // otro intento (p. ej. «Usar un código») ya ocupa su sitio: este no toca nada
      if (mine !== attempt) return false
      set({ ...IDLE_LOGIN })
      if ((e as { code?: string }).code !== 'cancelled') opts.onError?.((e as Error).message)
      return false
    } finally {
      off()
    }
  },
  cancel: () => {
    attempt++
    set({ ...IDLE_LOGIN })
    void api.invoke('agents.codexLoginCancel').catch(() => {})
  }
}))
