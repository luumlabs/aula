// Resuelve el icono guardado en un curso a un sprite existente. Si el curso trae un nombre antiguo o inventado,
// se busca por palabras clave del título/asignatura. El catálogo completo (con palabras clave) vive en el esquema
// compartido; aquí basta con un respaldo seguro para pintar algo siempre.
import { SPRITES } from './sprites'

const known = new Set(SPRITES.map((s) => s.id))
type Resolver = (icon: string, hint: string) => string
let external: Resolver | null = null

/** El esquema (CourseIconCatalog portado) puede instalar su resolución completa. */
export function setIconResolver(fn: Resolver): void {
  external = fn
}

export function resolveIconId(icon: string, hint = ''): string {
  if (known.has(icon)) return icon
  if (external) {
    const r = external(icon, hint)
    if (known.has(r)) return r
  }
  return 'study'
}

export const ICON_IDS = [...known]
