// Esquema implícito de una URL base de IA (port de AICore/ProviderURLScheme.swift). Solo se llama cuando la dirección aún
// no lleva esquema. Analiza la autoridad tal cual se escribió: el usuario, la contraseña, el puerto, la ruta, la consulta y el
// fragmento no eligen HTTP, y una IPv4 abreviada o con ceros iniciales («127.1», «0127.0.0.1») no cuenta como local.

/** Host de la autoridad de una dirección sin esquema (sin usuario ni puerto); `null` si no hay. */
function authorityHost(address: string): string | null {
  let end = address.length
  for (const sep of ['/', '?', '#']) {
    const i = address.indexOf(sep)
    if (i >= 0 && i < end) end = i
  }
  let authority = address.slice(0, end)
  const at = authority.lastIndexOf('@')
  if (at >= 0) authority = authority.slice(at + 1)
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')
    return close > 0 ? authority.slice(0, close + 1) : null
  }
  const colon = authority.lastIndexOf(':')
  if (colon >= 0) authority = authority.slice(0, colon)
  return authority || null
}

export function defaultScheme(schemelessAddress: string): 'http' | 'https' {
  const host = authorityHost(schemelessAddress)?.toLowerCase()
  if (!host) return 'https'
  const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (h === 'localhost' || h === 'localhost.' || h === '::1') return 'http'

  // sufijo de dominio completo «.local»
  const labels = h.split('.')
  if (labels.length >= 2 && labels[labels.length - 1] === 'local' && labels.slice(0, -1).every((l) => l.length > 0)) return 'http'

  // solo IPv4 decimal canónica de cuatro octetos
  if (labels.length !== 4) return 'https'
  const octets: number[] = []
  for (const part of labels) {
    if (!part || part.length > 3 || (part.length > 1 && part[0] === '0') || !/^[0-9]+$/.test(part)) return 'https'
    const v = Number(part)
    if (v > 255) return 'https'
    octets.push(v)
  }
  return octets[0] === 127 || octets.every((o) => o === 0) ? 'http' : 'https'
}
