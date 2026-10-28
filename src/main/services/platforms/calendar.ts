// Enlace privado del calendario (.ics) de cada cuenta: se guarda en el almacén cifrado (`platform.calendar.<id>`) y la cuenta
// solo lleva la referencia. Lo lee el motor del calendario (nunca sale del proceso principal ni va al registro).
import type { PlatformAccount } from '@shared/settings/platforms'
import { platformSecretKeys } from '@shared/settings/platforms'
import { SecretMask } from '@engine/platforms'
import { secrets } from '../secrets'
import { log } from '../log'
import { updateAccount } from './accounts'

/** El enlace guardado de la cuenta, o null. */
export function platformCalendarURL(account: Pick<PlatformAccount, 'id' | 'calendarSecretRef'>): string | null {
  return secrets().get(account.calendarSecretRef ?? platformSecretKeys.calendar(account.id))
}

/** Guarda el enlace (ya validado por quien llama) y apunta la referencia en la cuenta. */
export function savePlatformCalendarURL(account: Pick<PlatformAccount, 'id'>, url: string): PlatformAccount {
  const key = platformSecretKeys.calendar(account.id)
  secrets().set(key, url)
  log.info(`[platforms] calendario conectado (${account.id}: ${SecretMask.url(url)})`)
  return updateAccount(account.id, { calendarSecretRef: key })
}

export function forgetPlatformCalendar(account: Pick<PlatformAccount, 'id' | 'calendarSecretRef'>): PlatformAccount {
  secrets().delete(platformSecretKeys.calendar(account.id))
  if (account.calendarSecretRef) secrets().delete(account.calendarSecretRef)
  return updateAccount(account.id, { calendarSecretRef: undefined })
}
