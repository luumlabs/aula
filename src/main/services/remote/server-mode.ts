// Aula como servidor: sin ventana, en un ordenador o un contenedor Linux siempre encendido, y la persona que la instala la usa
// desde sus dispositivos (iPad, iPhone, Android) por SU red privada de Tailscale (la de su cuenta, no la de nadie más). Se
// pide con `--server` o AULA_SERVER=1. Sin Electron.

/** El nombre por defecto del servidor en la red de Tailscale. */
export const SERVER_HOSTNAME = 'aula-server'

/** Los nombres que usan las apps de los dispositivos para sí mismas: nunca puede llamarse así un equipo con Aula. */
export const DEVICE_HOSTNAMES: readonly string[] = ['aula-ipad', 'aula-iphone', 'aula-android']

/** ¿Se lanzó Aula como servidor? */
export function isServerMode(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.AULA_SERVER ?? '').trim().toLowerCase()
  return argv.includes('--server') || v === '1' || v === 'true' || v === 'yes'
}

/**
 * El nombre de este servidor en la red de Tailscale: AULA_TAILNET_HOSTNAME si vale, si no «aula-server». Tiene que empezar
 * por «aula-» (así las apps de los dispositivos lo encuentran solas) y ser una etiqueta DNS corta; nunca el de un dispositivo.
 */
export function serverHostname(value: string | undefined = process.env.AULA_TAILNET_HOSTNAME): string {
  const name = (value ?? '').trim().toLowerCase()
  if (!/^aula-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(name)) return SERVER_HOSTNAME
  return isDeviceHostname(name) ? SERVER_HOSTNAME : name
}

/** ¿Es el nombre que se da a sí misma la app de un dispositivo («aula-ipad», o «aula-ipad-2» si ya estaba cogido)? */
export function isDeviceHostname(name: string): boolean {
  const n = name.toLowerCase()
  return DEVICE_HOSTNAMES.some((d) => n === d || new RegExp(`^${d}-\\d+$`).test(n))
}

/**
 * ¿Es un equipo con Aula, visto desde un dispositivo? Su nombre en la red empieza por «aula-» y no es el de un dispositivo
 * («aula-mac», «aula-server», «aula-casa»…). Las apps del iPhone, el iPad y Android siguen esta misma regla.
 */
export function isAulaHostname(name: string): boolean {
  const n = name.toLowerCase()
  return /^aula-[a-z0-9-]+$/.test(n) && !isDeviceHostname(n)
}
