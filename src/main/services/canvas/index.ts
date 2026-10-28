// Canvas sin token: cliente REST sobre la sesión del navegador de Aula (o sobre un token, si el estudiante lo prefiere), texto
// de HTML a Markdown y conexión automática del calendario privado.
import type { PlatformAccount } from '@shared/settings/platforms'
import { platformSecretKeys } from '@shared/settings/platforms'
import { SecretMask } from '@engine/platforms'
import { canvasToken, updateAccount } from '../platforms/accounts'
import { createNodeHttpFetch, type HttpFetch } from '../platforms/http'
import { secrets } from '../secrets'
import { log } from '../log'
import { tr } from '@shared/ai/i18n'
import { CanvasClient, type CanvasClientOptions } from './client'
import { CanvasError } from './errors'

export * from './client'
export * from './errors'
export * from './models'
export { htmlToMarkdown, htmlToPlainText, looksLikeHTML, latexFromEquationSrc } from './text/markdown'
export { decodeEntities } from './text/entities'
export { parseHTML } from './text/parser'

/**
 * Cliente de Canvas para una cuenta: con su token si tiene (modo token: `fetch` de Node, sin cookies) o con la sesión del
 * navegador de Aula (`sessionFetch`, el `fetchWithSession` de PlatformBrowser).
 */
export function canvasClientFor(account: PlatformAccount, sessionFetch: HttpFetch, extra: Partial<CanvasClientOptions> = {}): CanvasClient {
  if (account.kind !== 'canvas') throw new CanvasError('invalid_args', tr('Esa plataforma no es un Canvas.', 'That platform isn’t Canvas.'))
  const token = canvasToken(account)
  return new CanvasClient({
    baseURL: account.baseURL,
    fetch: token ? createNodeHttpFetch() : sessionFetch,
    token,
    onWarning: (m) => log.info(m),
    ...extra
  })
}

/**
 * Conecta el calendario privado de Canvas (Perfil → `calendar.ics`) con la sesión: el enlace va al almacén cifrado
 * (`platform.calendar.<id>`) y la cuenta solo guarda la referencia. Devuelve true si quedó conectado.
 */
export async function connectCanvasCalendar(account: PlatformAccount, client: CanvasClient): Promise<boolean> {
  const url = await client.calendarFeedURL()
  if (!url) return false
  const key = platformSecretKeys.calendar(account.id)
  secrets().set(key, url)
  updateAccount(account.id, { calendarSecretRef: key })
  log.info(`[platforms] calendario de Canvas conectado (${SecretMask.url(url)})`)
  return true
}
