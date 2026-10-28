// Estado de las actualizaciones de Aula (se actualiza solo con 'updates.changed') y qué se le dice al estudiante.
import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/ipc/updates'
import { api } from './api'

export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  useEffect(() => {
    let alive = true
    api
      .invoke('updates.state')
      .then((s) => alive && setState(s))
      .catch(() => alive && setState({ status: 'unsupported' }))
    const off = api.on('updates.changed', (s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

export type UpdateAction = 'check' | 'restart' | 'download' | 'retry'

export interface UpdateView {
  /** Clave del espacio de nombres `updates` (null = no decir nada). */
  message: string | null
  params: Record<string, string | number>
  tone: 'quiet' | 'accent' | 'warning'
  /** Botón principal y, si hace falta, uno secundario. */
  primary: UpdateAction
  secondary?: UpdateAction
  /** 0…1 mientras descarga. */
  progress?: number
  /** Hay notas de la versión nueva que enseñar. */
  hasNotes: boolean
}

/**
 * Qué se enseña en Ajustes → Acerca de. Los fallos de una búsqueda automática (sin conexión…) solo se cuentan si el
 * estudiante pulsó «Buscar»; los de descarga o instalación, siempre (afectan a su copia).
 * Una versión SIN FIRMA VÁLIDA nunca ofrece «Descargar» ni enseña notas (A1-P1-6): podría ser de quien tomó la cuenta de
 * GitHub del proyecto, así que no se manda a bajarla a mano.
 */
export function updateView(s: UpdateState, asked: boolean, current: string): UpdateView {
  const version = s.version ?? ''
  const unverified = s.error === 'signature' && (s.status === 'error' || (s.status === 'available' && s.blocked === 'failedBefore'))
  const base = { params: { version, current, from: s.updatedFrom ?? '' }, hasNotes: Boolean(s.notes && s.version) && !unverified }
  switch (s.status) {
    case 'checking':
      return { ...base, message: 'status.checking', tone: 'quiet', primary: 'check' }
    case 'downloading': {
      const p = s.progress ?? 0
      return { ...base, message: p >= 1 ? 'status.verifying' : 'status.downloading', params: { ...base.params, percent: Math.round(p * 100) }, tone: 'quiet', primary: 'check', progress: p }
    }
    case 'ready':
      return { ...base, message: 'status.ready', tone: 'accent', primary: 'restart' }
    case 'available':
      if (unverified) return { ...base, message: 'error.signature', tone: 'warning', primary: 'check' }
      if (s.blocked === 'failedBefore' && s.error === 'system') return { ...base, message: 'error.system', tone: 'warning', primary: 'check' }
      return { ...base, message: `available.${s.blocked ?? 'readOnly'}`, tone: 'warning', primary: 'download', secondary: s.blocked === 'failedBefore' ? 'retry' : undefined }
    case 'error': {
      const shown = asked || s.errorStage !== 'check'
      if (!shown) return { ...base, message: s.updatedFrom ? 'status.updatedFrom' : null, tone: 'quiet', primary: 'check' }
      if (unverified) return { ...base, message: 'error.signature', tone: 'warning', primary: 'check' }
      const manual = s.error === 'install' || s.error === 'corrupt' || s.error === 'permission'
      // sin conexión a mitad de descarga no es «no se pudo buscar» (A1-P2-18a)
      const message = s.error === 'offline' && s.errorStage === 'download' ? 'error.offlineDownload' : `error.${s.error ?? 'unknown'}`
      return { ...base, message, tone: 'warning', primary: manual ? 'download' : 'check', secondary: manual ? 'retry' : undefined }
    }
    case 'upToDate':
      if (asked) return { ...base, message: 'status.upToDate', tone: 'quiet', primary: 'check' }
      return { ...base, message: s.updatedFrom ? 'status.updatedFrom' : null, tone: 'quiet', primary: 'check' }
    case 'unsupported':
      return { ...base, message: asked ? `unsupported.${s.blocked === 'dev' || s.blocked === 'package' ? s.blocked : 'other'}` : null, tone: 'quiet', primary: 'check' }
    default:
      return { ...base, message: s.updatedFrom ? 'status.updatedFrom' : null, tone: 'quiet', primary: 'check' }
  }
}

/** El aviso de la barra lateral: «lista» (reiniciar), «sin instalar» (hay que hacer algo: ver por qué en Ajustes) o
 *  «disponible» (la .deb: se descarga e instala a mano). null = nada que avisar. A1-P1-3. */
export interface UpdateNoticeView {
  kind: 'ready' | 'manual' | 'download'
  version: string
}

/** Códigos que piden algo al estudiante (una descarga dañada se reintenta sola; sin conexión, también). */
const NEEDS_STUDENT = new Set(['install', 'signature', 'permission', 'disk', 'system'])

export function updateNotice(s: UpdateState): UpdateNoticeView | null {
  const version = s.version ?? ''
  if (s.status === 'ready') return { kind: 'ready', version }
  if (!version) return null
  if (s.status === 'available') {
    if (s.blocked === 'package') return { kind: 'download', version }
    if (s.blocked === 'translocated' || s.blocked === 'readOnly' || s.blocked === 'failedBefore') return { kind: 'manual', version }
    return null
  }
  if (s.status === 'error' && s.errorStage && s.errorStage !== 'check' && s.error && NEEDS_STUDENT.has(s.error)) return { kind: 'manual', version }
  return null
}

/** Clave para «no volver a avisar de esto» (por versión y tipo de aviso). */
export const noticeKey = (n: UpdateNoticeView): string => `${n.kind}:${n.version}`

