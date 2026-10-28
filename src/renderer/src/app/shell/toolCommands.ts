// Las herramientas en la paleta (⌘K): se registran una sola vez desde el armazón, no desde la pantalla Herramientas
// (antes solo existían mientras esa pantalla estaba abierta: J2-6).
import { TOOLS } from '@renderer/tools/registry'
import type { Filterable } from './paletteOrder'

export interface ToolCommandSpec extends Filterable {
  toolId: string
  hint: string
}

/** Una entrada por herramienta, con su nombre y descripción en el idioma de la interfaz y sus palabras de búsqueda (es y en). */
export function toolCommandSpecs(name: (id: string) => string, desc: (id: string) => string): ToolCommandSpec[] {
  return TOOLS.map((x) => ({ id: `tool:${x.id}`, group: 'tools', label: name(x.id), hint: desc(x.id), keywords: [x.id, ...x.keywords], toolId: x.id }))
}
