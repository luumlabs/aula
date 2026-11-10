// Desde un dispositivo (iPad, iPhone) la página puede recargarse sola: al volver de segundo plano la app nativa abre un
// túnel nuevo, y en el navegador el estudiante puede refrescar. Para volver a la misma pantalla, la ruta se apunta en el
// fragmento de la dirección («#…») y se lee al arrancar. Solo rutas conocidas y con campos sencillos: la dirección la
// puede escribir cualquiera.
import type { Route } from './router'

/** Pantallas a las que se puede volver (las de desarrollo y las que dependen de algo en marcha, no). */
const RESTORABLE: ReadonlySet<Route['name']> = new Set(['home', 'course', 'study', 'calendar', 'chat', 'tools', 'documents', 'inbox', 'stats'])
const TEXT_FIELDS = ['id', 'tab', 'skill', 'mode', 'date', 'view', 'conversation', 'tool', 'doc'] as const

export function routeToHash(route: Route): string {
  return RESTORABLE.has(route.name) ? '#' + encodeURIComponent(JSON.stringify(route)) : ''
}

export function routeFromHash(hash: string): Route | null {
  if (!hash.startsWith('#') || hash.length > 1200) return null
  let raw: unknown
  try {
    raw = JSON.parse(decodeURIComponent(hash.slice(1)))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (typeof o.name !== 'string' || !RESTORABLE.has(o.name as Route['name'])) return null
  // solo los campos de texto corto de las rutas (nada de «prompt» ni de objetos: eso no se restaura)
  const out: Record<string, string> = { name: o.name }
  for (const key of TEXT_FIELDS) {
    const v = o[key]
    if (v === undefined) continue
    if (typeof v !== 'string' || v.length > 200 || !/^[\w .:@+-]+$/.test(v)) return null
    out[key] = v
  }
  if ((out.name === 'course' || out.name === 'study') && !out.id) return null
  if (out.name === 'study' && !out.mode) return null
  return out as unknown as Route
}
