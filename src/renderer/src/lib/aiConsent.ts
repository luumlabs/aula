// El aviso de la IA de terceros en un dispositivo: el estado de la hoja (app/shell/AIConsent.tsx) y el vigilante de las
// llamadas (aiConsentGuard.ts), que se instala solo en un dispositivo. La ventana del Mac no cambia.
import { create } from 'zustand'
import i18n from '@renderer/i18n'
import type { AIConsentState } from '@shared/ipc/ai'
import { AI_CONSENT_DECLINED } from '@shared/ai/consent'
import { api, installInvokeGuard } from './api'
import { isDeviceDemo, isStoreShots } from './demo'
import { createAIConsentGuard } from './aiConsentGuard'

interface AIConsentSheet {
  /** Lo que se enseña ahora (null: la hoja está cerrada). */
  asking: AIConsentState | null
  demo: boolean
  answer: ((ok: boolean) => void) | null
}

export const useAIConsent = create<AIConsentSheet>(() => ({ asking: null, demo: false, answer: null }))

function ask(state: AIConsentState, demo: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    useAIConsent.setState({
      asking: state,
      demo,
      answer: (ok) => {
        useAIConsent.setState({ asking: null, answer: null })
        resolve(ok)
      }
    })
  })
}

function declined(): Error {
  return Object.assign(new Error(i18n.t('common:aiConsent.declined')), { name: 'AulaError', code: AI_CONSENT_DECLINED })
}

/** ¿El estudiante canceló el aviso? (no se mandó nada: no es un fallo que haya que enseñar como tal) */
export function isConsentDeclined(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === AI_CONSENT_DECLINED
}

let installed: ReturnType<typeof createAIConsentGuard> | null = null

/** Solo en un dispositivo, antes de pintar nada: ninguna pantalla manda nada a la IA sin el aviso. */
export function installAIConsent(): void {
  if (!api.remote || installed) return
  const g = createAIConsentGuard({
    demo: () => isDeviceDemo(api.remote),
    demoSeen: isStoreShots,
    fetch: () => api.invoke('ai.consent'),
    accept: (ids) => api.invoke('ai.acceptConsent', { ids }),
    ask,
    declined
  })
  installed = g
  installInvokeGuard(g)
  // otra IA en el Mac (o elegida desde otro dispositivo): se vuelve a mirar
  try { api.on('ai.changed', () => g.forget()) } catch { /* sin puente todavía */ }
}

/** Pregunta ya, antes de enseñar nada (el chat: si se cancela, el texto vuelve a la caja sin parpadeos). Lanza si se cancela. */
export async function askAIConsent(method: string, args?: unknown): Promise<void> {
  if (installed) await installed.before(method, args)
}
