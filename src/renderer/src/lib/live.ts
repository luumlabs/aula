// El navegador de Aula en vivo, desde la interfaz: qué ventana se está viendo y cómo abrirla. El panel (app/shell/LivePanel)
// la pinta; aquí vive solo el estado, para que la abran el chat, Novedades o Ajustes.
import { create } from 'zustand'
import type { LiveFocus, LivePurpose, LiveState } from '@shared/live/types'
import { api } from './api'

interface LiveStore {
  /** La ventana abierta en el panel (null: panel cerrado). */
  state: LiveState | null
  /** El campo en el que quedó el cursor tras el último toque. */
  focus: LiveFocus | null
  /** Dónde están los campos de escribir de la página (fracciones). */
  fields: [number, number, number, number][]
}

export const useLive = create<LiveStore>(() => ({ state: null, focus: null, fields: [] }))

/** Abre (o trae) el navegador en vivo de una plataforma y lo enseña. */
export async function openLive(opts: { accountId?: string | null; url?: string; purpose?: LivePurpose }): Promise<LiveState> {
  const state = await api.invoke('live.open', opts)
  useLive.setState({ state, focus: null, fields: [] })
  return state
}

/** Enseña una ventana que ya está abierta (la que Aula puso en el chat). false si ya no existe. */
export async function showLive(id: string): Promise<boolean> {
  const state = await api.invoke('live.state', { id }).catch(() => null)
  if (!state) return false
  useLive.setState({ state, focus: null, fields: [] })
  return true
}

/** Cierra el panel (la ventana sigue abierta en el Mac un rato, con la sesión guardada). */
export function hideLive(): void {
  useLive.setState({ state: null, focus: null, fields: [] })
}

/**
 * Iniciar sesión en una plataforma desde aquí mismo (un dispositivo no puede usar la ventana del Mac): abre su página en
 * el navegador en vivo. Sin cuenta, la primera que lo necesite. false si no hay ninguna plataforma.
 */
export async function signInHere(accountId?: string): Promise<boolean> {
  let id = accountId
  if (!id) {
    const accounts = await api.invoke('platforms.list').catch(() => [])
    id = (accounts.find((a) => a.status !== 'signedIn') ?? accounts[0])?.id
  }
  if (!id) return false
  await openLive({ accountId: id, purpose: 'signin' })
  return true
}

let wired = false
/** Sigue los cambios de la ventana que se está viendo (quién la maneja, a dónde navegó, si se cerró). */
export function wireLive(): void {
  if (wired) return
  wired = true
  api.on('live.changed', (next) => { if (useLive.getState().state?.id === next.id) useLive.setState({ state: next }) })
  api.on('live.closed', ({ id }) => { if (useLive.getState().state?.id === id) hideLive() })
  api.on('live.focus', (focus) => { if (useLive.getState().state?.id === focus.id) useLive.setState({ focus }) })
  api.on('live.fields', (f) => { if (useLive.getState().state?.id === f.id) useLive.setState({ fields: f.rects }) })
}
