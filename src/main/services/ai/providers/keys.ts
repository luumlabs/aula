// Lectura y validación de la clave de API de un proveedor (port de ProviderKeys.swift y MiMoKeys).
import { tr } from '@shared/ai/i18n'
import { invalidKeyCharactersMessage, validateAPIKey } from '@shared/ai/apiKey'
import type { SecretStore } from '../../secrets'
import { AIError } from '../errors'
import { hostOf, isLocalOrPrivateHost } from '../http/endpoints'
import type { ProviderConfig } from './config'

/** «Falta la clave de API de <proveedor>…». */
export function missingKeyError(config: Pick<ProviderConfig, 'label'>): AIError {
  const name = config.label
  return new AIError('missingKey', tr(
    `Falta la clave de API de ${name}. Ve a los ajustes de IA de Aula, pégala en el proveedor «${name}» y vuelve a intentarlo.`,
    `Missing ${name} API key. Go to Aula's AI settings, paste it under the "${name}" provider, and try again.`
  ), { code: 'ai_missing_key' })
}

/** El almacén de claves falló al leer (no es lo mismo que «falta»). */
export function unreadableSecretError(config: Pick<ProviderConfig, 'label'>, err: unknown): AIError {
  // el llavero no deja abrir el almacén: el mensaje ya lo explica (y la barra lateral ofrece «Reintentar»)
  if (err && typeof err === 'object' && (err as { code?: unknown }).code === 'secrets_locked') {
    return new AIError('other', (err as Error).message, { code: 'ai_secrets' })
  }
  const reason = err instanceof Error ? err.message.replace(/\.+$/, '') : String(err)
  const name = config.label
  return new AIError('other', tr(
    `No pude leer el almacén de claves (${reason}), así que no puedo usar la clave de ${name}. No hace falta volver a pegarla: inténtalo de nuevo en un momento.`,
    `I couldn't read the key store (${reason}), so I can't use the ${name} key. You don't need to paste it again: try again in a moment.`
  ), { code: 'ai_secrets' })
}

/**
 * La clave ya limpia, o `null` si el proveedor no la usa (o es un servidor local/privado sin clave guardada).
 * Lanza `missingKey` si falta o tiene caracteres que HTTP no admite.
 */
export function resolveKey(config: ProviderConfig, secrets: SecretStore): string | null {
  const ref = config.secretRef
  if (!ref) return null
  let raw: string | null
  try {
    raw = secrets.get(ref)
  } catch (err) {
    throw unreadableSecretError(config, err)
  }
  const v = validateAPIKey(raw ?? '')
  if (v.ok) return v.key
  if (v.problem === 'empty') {
    // un servidor de este ordenador o de la red de casa (LM Studio, llama-server, vLLM…) casi nunca pide clave
    if (isLocalOrPrivateHost(hostOf(config.baseURL))) return null
    // el llavero no deja leer el almacén: la clave puede estar ahí (no es lo mismo que «falta»)
    if (secrets.locked?.()) throw unreadableSecretError(config, new Error('keychain locked'))
    throw missingKeyError(config)
  }
  throw new AIError('missingKey', invalidKeyCharactersMessage(config.label), { code: 'ai_missing_key' })
}

/** ¿Hay clave guardada? (sin validarla). `false` si no hace falta. */
export function hasStoredKey(config: ProviderConfig, secrets: SecretStore): boolean {
  if (!config.secretRef) return false
  try {
    return !!secrets.get(config.secretRef)?.trim()
  } catch {
    return false
  }
}

/** ¿Este proveedor necesita una clave para funcionar? */
export function needsKey(config: ProviderConfig): boolean {
  return !!config.secretRef && !isLocalOrPrivateHost(hostOf(config.baseURL))
}

/**
 * MiMo tiene dos tipos de clave y cada una solo vale con su dirección: las de pago por uso empiezan por `sk-`
 * (`https://api.xiaomimimo.com/v1`) y las del Token Plan por `tp-`/`ttp-` (`https://token-plan-<región>.xiaomimimo.com/v1`).
 */
export const MIMO_PAY_AS_YOU_GO_URL = 'https://api.xiaomimimo.com/v1'

export function mimoMismatchHint(host: string | undefined, key: string | null): string | undefined {
  const h = host?.toLowerCase()
  if (!h || !h.endsWith('xiaomimimo.com') || !key) return undefined
  const tokenPlanHost = h.startsWith('token-plan')
  if (tokenPlanHost && key.startsWith('sk-')) {
    return tr(
      `Tu clave empieza por «sk-» (pago por uso), pero la dirección es la del Token Plan: cámbiala por ${MIMO_PAY_AS_YOU_GO_URL} en «Dirección del servicio».`,
      `Your key starts with “sk-” (pay-as-you-go), but the address is the Token Plan one: change it to ${MIMO_PAY_AS_YOU_GO_URL} in “Service address”.`
    )
  }
  if (!tokenPlanHost && (key.startsWith('tp-') || key.startsWith('ttp-'))) {
    const prefix = key.startsWith('ttp-') ? 'ttp-' : 'tp-'
    return tr(
      `Tu clave empieza por «${prefix}» (Token Plan), pero la dirección es la de pago por uso: pon en «Dirección del servicio» la del Token Plan que muestra tu consola de MiMo (por ejemplo https://token-plan-sgp.xiaomimimo.com/v1).`,
      `Your key starts with “${prefix}” (Token Plan), but the address is the pay-as-you-go one: enter the Token Plan address shown in your MiMo console in “Service address” (for example, https://token-plan-sgp.xiaomimimo.com/v1).`
    )
  }
  return undefined
}
