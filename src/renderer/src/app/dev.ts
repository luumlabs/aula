// Ganchos de desarrollo (capturas automáticas): solo existen fuera de la app empaquetada.
import { create } from 'zustand'
import { navigate, type Route } from './router'
import { noteActivity } from '@renderer/lib/power'
import { openLive } from '@renderer/lib/live'
import type { LivePurpose, LiveState } from '@shared/live/types'

interface DevState {
  theme: 'light' | 'dark' | null
}
export const useDev = create<DevState>(() => ({ theme: null }))

declare global {
  interface Window {
    __aula?: { navigate: (r: Route) => void; setTheme: (t: 'light' | 'dark') => void; openLive: (opts: { accountId?: string | null; url?: string; purpose?: LivePurpose }) => Promise<LiveState> }
  }
}

export function installDevHooks(): void {
  window.__aula = {
    navigate: (r) => {
      noteActivity()
      navigate(r)
    },
    setTheme: (t) => useDev.setState({ theme: t }),
    // abre el navegador en vivo (para las capturas y las pruebas de la app)
    openLive: (opts) => openLive(opts)
  }
}
