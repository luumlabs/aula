// Aula como servidor: sin ventana, en un ordenador o un contenedor Linux siempre encendido, y la persona que la instala la usa
// desde sus dispositivos (iPad, iPhone, Android) por SU red privada de Tailscale (la de su cuenta, no la de nadie más). Se
// pide con `--server` o AULA_SERVER=1. Sin Electron.

/** El nombre por defecto del servidor en la red de Tailscale. */
export const SERVER_HOSTNAME = 'aula-server'

/** Los nombres que usan las apps de los dispositivos para sí mismas (con «-2», «-3»… si ya estaba cogido): nunca puede
 *  llamarse así un equipo con Aula. «aula-device» es el de la app de iPhone/iPad cuando no sabe qué aparato es. */
export const DEVICE_HOSTNAMES: readonly string[] = ['aula-ipad', 'aula-iphone', 'aula-android', 'aula-device']

/** Una etiqueta DNS: como mucho 63 caracteres. */
const MAX_LABEL = 63
const AULA_LABEL = /^aula-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const DEVICE_LABEL = new RegExp(`^(?:${DEVICE_HOSTNAMES.join('|')})(?:-[0-9]+)?$`)

/** ¿Se lanzó Aula como servidor? */
export function isServerMode(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.AULA_SERVER ?? '').trim().toLowerCase()
  return argv.includes('--server') || v === '1' || v === 'true' || v === 'yes'
}

/**
 * La primera etiqueta de un nombre de la red («aula-mac.tail1234.ts.net.» → «aula-mac») en minúsculas ASCII, o «» si lleva
 * algo que no es ASCII (pasarlo a minúsculas sin más convertiría la «K» de Kelvin en una «k» y dejaría pasar un nombre que
 * imita a otro). La misma regla en las apps de los dispositivos (native/tsnet/client, native/ios/Aula/Tailnet/AulaHosts.swift).
 */
export function hostLabel(name: string): string {
  const label = name.split('.')[0] ?? ''
  return /[^\x00-\x7f]/.test(label) ? '' : label.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

/**
 * El nombre de este servidor en la red de Tailscale: AULA_TAILNET_HOSTNAME si es UNA etiqueta DNS y el de un equipo con
 * Aula (`isAulaHostname`: empieza por «aula-», es una etiqueta válida y no es el de un dispositivo); si no, «aula-server».
 * Un valor con puntos («aula-casa.lan») no se recorta a su primera etiqueta: se ignora, como dice docs/SERVER.md.
 */
export function serverHostname(value: string | undefined = process.env.AULA_TAILNET_HOSTNAME): string {
  const raw = (value ?? '').trim()
  if (raw.includes('.')) return SERVER_HOSTNAME
  const name = hostLabel(raw)
  return isAulaHostname(name) ? name : SERVER_HOSTNAME
}

/** ¿Es el nombre que se da a sí misma la app de un dispositivo («aula-ipad», o «aula-ipad-2» si ya estaba cogido)? */
export function isDeviceHostname(name: string): boolean {
  return DEVICE_LABEL.test(hostLabel(name))
}

/**
 * ¿Es un equipo con Aula, visto desde un dispositivo? La primera etiqueta de su nombre en la red, en minúsculas ASCII,
 * es «aula-» y letras, cifras o guiones (sin acabar en guion, 63 caracteres como mucho) y no es la de un dispositivo
 * («aula-mac», «aula-server», «aula-casa»…). Las apps del iPhone, el iPad y Android siguen esta misma regla.
 */
export function isAulaHostname(name: string): boolean {
  const n = hostLabel(name)
  return n.length <= MAX_LABEL && AULA_LABEL.test(n) && !DEVICE_LABEL.test(n)
}

/** Lo que necesita `installServerCrashHandlers` (se le pasa: así se prueba sin Electron). */
export interface ServerCrashDeps {
  /** El proceso: sus eventos `uncaughtException` y `unhandledRejection`. */
  process: Pick<NodeJS.EventEmitter, 'on'>
  /** La salida estándar y la de errores: si se cierran (una tubería rota), Aula sigue; su registro está en main.log. */
  streams?: readonly Pick<NodeJS.EventEmitter, 'on'>[]
  log: (message: string, err: unknown) => void
  stderr: (text: string) => void
  exit: (code: number) => void
}

/**
 * Aula como servidor: un error que nadie captura se apunta (en el registro y en la salida de errores) y el proceso termina,
 * para que Docker o systemd lo vuelvan a arrancar limpio. Sin esto, Electron enseña un diálogo que en un servidor nadie ve
 * ni puede cerrar, y Aula se queda parada para siempre. Una promesa rechazada sin capturar solo se apunta.
 */
export function installServerCrashHandlers(d: ServerCrashDeps): void {
  let failing = false
  d.process.on('uncaughtException', (err: unknown) => {
    if (failing) return
    failing = true
    try { d.log('[servidor] excepción sin capturar', err) } catch { /* sin registro */ }
    try { d.stderr(`Aula · excepción sin capturar (uncaught exception): ${describeError(err)}\n`) } catch { /* sin salida */ }
    d.exit(1)
  })
  d.process.on('unhandledRejection', (reason: unknown) => {
    try { d.log('[servidor] promesa rechazada sin capturar', reason) } catch { /* sin registro */ }
  })
  for (const s of d.streams ?? []) s.on('error', () => { /* la consola se cerró: Aula sigue */ })
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.stack ?? `${err.name}: ${err.message}` : String(err)
}
