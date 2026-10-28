// Estado de la sesión de cada cuenta mientras la app está abierta (comprobando / iniciada / hay que iniciarla) y los avisos
// que lo cambian. El estado conocido se guarda también en la cuenta (`lastState`) para mostrarlo al arrancar.
import { EventEmitter } from 'node:events'
import type { PlatformAccount } from '@shared/settings/platforms'
import type { PlatformAccountView, PlatformStatus } from '@shared/platforms/types'
import { platformSecretKeys } from '@shared/settings/platforms'
import { accountDisplayName, platformInfo } from '@engine/platforms'
import { secrets } from '../secrets'
import { tr } from '@shared/ai/i18n'

export interface RuntimeStatus {
  status: PlatformStatus
  detail?: string
  signingIn: boolean
}

export type PlatformEventMap = {
  status: [PlatformAccountView]
  signedIn: [PlatformAccountView]
}

class StatusStore {
  private map = new Map<string, RuntimeStatus>()
  readonly events = new EventEmitter()

  get(id: string): RuntimeStatus | undefined {
    return this.map.get(id)
  }

  set(id: string, patch: Partial<RuntimeStatus>): RuntimeStatus {
    const prev = this.map.get(id) ?? { status: 'unknown', signingIn: false }
    const next = { ...prev, ...patch }
    this.map.set(id, next)
    return next
  }

  delete(id: string): void {
    this.map.delete(id)
  }

  clear(): void {
    this.map.clear()
  }
}

export const platformStatus = new StatusStore()

/** Estado efectivo: el de esta ejecución o, si aún no se comprobó, el último guardado. */
export function effectiveStatus(a: PlatformAccount): RuntimeStatus {
  const rt = platformStatus.get(a.id)
  if (rt) return rt
  return { status: a.lastState === 'signedIn' ? 'signedIn' : a.lastState === 'needsSignIn' ? 'needsSignIn' : 'unknown', signingIn: false }
}

export function hasCalendar(a: PlatformAccount): boolean {
  const key = a.calendarSecretRef ?? platformSecretKeys.calendar(a.id)
  return !!secrets().get(key)
}

/** La cuenta tal como la ve la interfaz (sin secretos). */
export function accountView(a: PlatformAccount): PlatformAccountView {
  const rt = effectiveStatus(a)
  return {
    id: a.id,
    kind: a.kind,
    label: accountDisplayName(a),
    baseURL: a.baseURL,
    kindName: platformInfo(a.kind).displayName,
    status: rt.status,
    ...(rt.detail ? { statusDetail: rt.detail } : {}),
    ...(a.lastCheckedAt ? { lastCheckedAt: a.lastCheckedAt } : {}),
    ...(a.lastSignedInAt ? { lastSignedInAt: a.lastSignedInAt } : {}),
    calendarConnected: hasCalendar(a),
    tokenMode: !!a.tokenSecretRef,
    signingIn: rt.signingIn,
    ...(a.notes ? { notes: a.notes } : {})
  }
}

/** Texto breve para el estudiante según el motivo técnico de una comprobación. */
export function statusDetail(status: PlatformStatus): string | undefined {
  switch (status) {
    case 'needsSignIn': return tr('La sesión se cerró: inicia sesión de nuevo (solo una vez).', 'Your session ended: sign in again (just once).')
    case 'checking': return tr('Comprobando la sesión…', 'Checking your session…')
    case 'signedIn': return undefined
    default: return undefined
  }
}
