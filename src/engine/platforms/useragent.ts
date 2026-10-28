// Agente de usuario de Chrome «normal» para las sesiones de las plataformas: sin las marcas `Electron/x` ni `Aula/x`, que hacen
// que Google o Microsoft bloqueen el inicio de sesión («este navegador o esta app no son seguros»).

/** Quita de un agente de usuario las marcas de Electron y de la app (y las de otras apps de Electron). */
export function chromeUserAgent(ua: string, appNames: string[] = ['Aula']): string {
  let out = ua
  out = out.replace(/\s*Electron\/[^\s]+/gi, '')
  for (const name of appNames) {
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`\\s*${safe}\\/[^\\s]+`, 'gi'), '')
  }
  out = out.replace(/\s{2,}/g, ' ').trim()
  // Chrome publica solo la versión mayor (Chrome/146.0.0.0): se hace igual para no destacar
  out = out.replace(/Chrome\/(\d+)\.[\d.]+/, 'Chrome/$1.0.0.0')
  return out
}

/** Idiomas aceptados a partir del de la app (es → «es-ES,es;q=0.9,en;q=0.8»). */
export function acceptLanguages(locale: string): string {
  const l = (locale || 'en').replace('_', '-')
  const base = l.split('-')[0].toLowerCase()
  const parts = [l]
  if (base !== l) parts.push(`${base};q=0.9`)
  if (base !== 'en') parts.push('en;q=0.8')
  return parts.join(',')
}
