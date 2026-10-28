// Ganchos de desarrollo (capturas automáticas): solo existen fuera de la app empaquetada.
import { create } from 'zustand'
import { navigate, type Route } from './router'
import { noteActivity } from '@renderer/lib/power'

interface DevState {
  theme: 'light' | 'dark' | null
}
export const useDev = create<DevState>(() => ({ theme: null }))

declare global {
  interface Window {
    __aula?: { navigate: (r: Route) => void; setTheme: (t: 'light' | 'dark') => void }
  }
}

export function installDevHooks(): void {
  window.__aula = {
    navigate: (r) => {
      noteActivity()
      navigate(r)
    },
    setTheme: (t) => useDev.setState({ theme: t })
  }
}
