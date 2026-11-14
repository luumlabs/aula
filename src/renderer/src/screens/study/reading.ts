// La columna de lectura de los modos de estudio: su texto se selecciona y Escape primero suelta lo seleccionado. (El idioma
// del curso lo declara el texto del curso, no la columna: lib/contentLanguage.ts.)

/** Escape con texto seleccionado: lo suelta y nada más (la segunda pulsación ya sale). */
export function dropSelection(sel: Pick<Selection, 'isCollapsed' | 'removeAllRanges'> | null | undefined): boolean {
  if (!sel || sel.isCollapsed) return false
  sel.removeAllRanges()
  return true
}
