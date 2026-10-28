// Texto de la caja con menciones: dónde empieza la «@» que se está escribiendo y cómo se quita al elegir (puro, con pruebas).

/** La consulta tras la «@» que se está escribiendo justo antes del cursor (null = no se está mencionando nada). Como en la app
 * Swift: la «@» va al principio o tras un espacio o un signo de apertura, y la consulta no empieza por espacio ni pasa de 40 letras. */
export function mentionQueryAt(text: string, caret: number): { at: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  const prev = at > 0 ? before[at - 1] : ''
  if (prev && !/[\s(«"“¿¡]/.test(prev)) return null
  const query = before.slice(at + 1)
  if (query.length > 40 || query.includes('\n') || query.startsWith(' ')) return null
  return { at, query }
}

/** Quita «@consulta» del texto al elegir (y deja un solo espacio donde estaba). */
export function removeMentionQuery(text: string, at: number, caret: number): { text: string; caret: number } {
  const head = text.slice(0, at)
  const tail = text.slice(caret)
  const joined = head.endsWith(' ') && tail.startsWith(' ') ? head + tail.slice(1) : head + tail
  return { text: joined, caret: head.length }
}

/** Escribe «@» en el cursor para abrir el selector (con un espacio delante si hace falta). */
export function insertAt(text: string, caret: number): { text: string; caret: number } {
  const head = text.slice(0, caret)
  const lead = head && !/\s$/.test(head) ? ' ' : ''
  return { text: `${head}${lead}@${text.slice(caret)}`, caret: head.length + lead.length + 1 }
}
