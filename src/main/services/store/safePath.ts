// Rutas seguras (port de SafePath en StudyModel/Store.swift): los ids y nombres de archivo que vienen de un curso (importado,
// dañado o hecho a mano) se usan como rutas y nunca deben salir de su carpeta («../..», «/Users/…», enlaces simbólicos).
import { realpathSync } from 'node:fs'
import { dirname, basename, join, resolve, sep } from 'node:path'
import { Hashing } from '@engine/base/ids'

/** Ruta real (resolviendo enlaces) aunque el final aún no exista. */
function realish(p: string): string {
  const abs = resolve(p)
  try {
    return realpathSync(abs)
  } catch {
    const parent = dirname(abs)
    if (parent === abs) return abs
    return join(realish(parent), basename(abs))
  }
}

export const SafePath = {
  /** ¿Sirve como UN componente de ruta? No vacío, sin «/», «\» ni NUL y distinto de «.» y «..». */
  isComponent(s: string): boolean {
    if (!s || Buffer.byteLength(s, 'utf8') > 255 || s === '.' || s === '..') return false
    return !/[/\\\0]/.test(s)
  },
  /** El mismo texto si es un componente seguro; si no, un nombre estable y seguro derivado de él. */
  component(s: string): string {
    return SafePath.isComponent(s) ? s : 'invalid-' + Hashing.stableID(s)
  },
  /** ¿`path` queda dentro de `directory` (estrictamente) una vez resueltos «..» y enlaces simbólicos? */
  isInside(path: string, directory: string): boolean {
    const u = realish(path)
    let d = realish(directory)
    if (!d.endsWith(sep)) d += sep
    return u.startsWith(d)
  }
}
