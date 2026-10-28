// Vigila la carpeta `Packs/` (port de DirectoryWatcher en StudyModel/Watch.swift): cuando otro proceso (el ayudante MCP de
// un agente CLI) escribe lecciones o ejercicios, la interfaz se entera. Los avisos se agrupan por curso con una espera
// corta (las escrituras atómicas son «temporal + renombrar» y llegan a ráfagas).
import { existsSync, readdirSync, watch, type FSWatcher } from 'node:fs'
import { join, sep } from 'node:path'
import { log } from '../log'

export interface PacksWatcher {
  stop(): void
}

/** ¿Es ruido (cerrojos, temporales, ocultos)? `rel` es relativa a `Packs/`. */
export function isNoise(rel: string): boolean {
  const parts = rel.split(/[\\/]/).filter(Boolean)
  return !parts.length || parts.some((p) => p.startsWith('.')) || rel.endsWith('.tmp') || rel.endsWith('.lock')
}

/**
 * Llama a `onChange(packId)` (como mucho una vez por curso cada `debounceMs`) cuando algo cambia dentro de `Packs/<id>/`.
 * Si el sistema no admite la vigilancia recursiva, vigila cada curso y su carpeta `skills/`.
 */
export function watchPacks(packsDir: string, onChange: (packId: string) => void, debounceMs = 300): PacksWatcher {
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  const watchers = new Map<string, FSWatcher>()

  const flush = (): void => {
    timer = null
    const ids = [...pending]
    pending.clear()
    for (const id of ids) {
      try { onChange(id) } catch (err) { log.warn('Aviso de cambio de curso', err) }
    }
  }
  const touched = (rel: string): void => {
    if (stopped || isNoise(rel)) return
    const id = rel.split(/[\\/]/).filter(Boolean)[0]
    if (!id) return
    pending.add(id)
    if (!timer) timer = setTimeout(flush, debounceMs)
  }

  const add = (key: string, dir: string, recursive: boolean, toRel: (f: string) => string): boolean => {
    if (watchers.has(key) || !existsSync(dir)) return true
    try {
      const w = watch(dir, { recursive, persistent: false }, (_ev, file) => {
        if (file === null || file === undefined) return
        const rel = toRel(String(file))
        touched(rel)
        if (!recursive) refresh()
      })
      w.on('error', () => { watchers.get(key)?.close(); watchers.delete(key) })
      watchers.set(key, w)
      return true
    } catch (err) {
      if (recursive) return false
      log.warn(`No se pudo vigilar ${dir}`, err)
      return true
    }
  }

  // sin vigilancia recursiva: `Packs/`, cada curso y su `skills/` (se rehace al aparecer cursos nuevos)
  const refresh = (): void => {
    if (stopped || watchers.has('*')) return
    add('.', packsDir, false, (f) => f)
    let ids: string[] = []
    try { ids = readdirSync(packsDir).filter((n) => !n.startsWith('.')) } catch { /* nada */ }
    for (const id of ids) {
      add(id, join(packsDir, id), false, (f) => `${id}${sep}${f}`)
      add(`${id}/skills`, join(packsDir, id, 'skills'), false, (f) => `${id}${sep}skills${sep}${f}`)
    }
  }

  if (!add('*', packsDir, true, (f) => f)) refresh()

  return {
    stop(): void {
      stopped = true
      if (timer) clearTimeout(timer)
      for (const w of watchers.values()) w.close()
      watchers.clear()
    }
  }
}
