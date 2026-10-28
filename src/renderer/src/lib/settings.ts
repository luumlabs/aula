// Ajustes en la interfaz: copia viva de settings.json (se actualiza con el evento 'settings.changed').
import { create } from 'zustand'
import type { AppSettings, SettingsPatch } from '@shared/settings'
import { api } from './api'

interface SettingsState {
  settings: AppSettings | null
  load: () => Promise<void>
  update: (patch: SettingsPatch) => Promise<void>
}

export const useSettings = create<SettingsState>((set) => ({
  settings: null,
  load: async () => {
    const s = await api.invoke('settings.get')
    set({ settings: s })
  },
  update: async (patch) => {
    const s = await api.invoke('settings.update', patch)
    set({ settings: s })
  }
}))

let wired = false
export function wireSettings(): void {
  if (wired) return
  wired = true
  api.on('settings.changed', (s) => useSettings.setState({ settings: s }))
  void useSettings.getState().load()
}
