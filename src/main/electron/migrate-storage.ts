// Una sola vez: lo que la interfaz guardaba en localStorage cuando se cargaba por file:// (historial de la calculadora,
// temporizador, herramientas fijadas, barra lateral plegada…) pasa al origen nuevo app://aula. Son comodidades: si algo
// falla, se sigue sin ellas. La marca va dentro del perfil de Chromium (se borra con él).
import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { log } from '@main/services/log'
import { APP_ORIGIN } from './protocol'

const MARK = 'aula-storage-migrated'
const LIMIT_MS = 4000

function hidden(): BrowserWindow {
  return new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true } })
}

async function copyOnce(profileDir: string): Promise<number> {
  const tmp = join(profileDir, '.aula-migrate')
  mkdirSync(tmp, { recursive: true })
  const page = join(tmp, 'leer.html')
  writeFileSync(page, '<!doctype html><title>.</title>')
  const reader = hidden()
  const writer = hidden()
  try {
    await reader.loadURL(pathToFileURL(page).href)
    const raw = (await reader.webContents.executeJavaScript('JSON.stringify(Object.fromEntries(Object.entries(localStorage)))')) as string
    const items = JSON.parse(raw) as Record<string, string>
    const keys = Object.keys(items).filter((k) => k.startsWith('aula'))
    if (!keys.length) return 0
    // una página del origen nuevo, sin lógica de la app (el dibujante de páginas)
    await writer.loadURL(`${APP_ORIGIN}/raster.html`)
    const subset = Object.fromEntries(keys.map((k) => [k, items[k]]))
    await writer.webContents.executeJavaScript(`(() => { const s = ${JSON.stringify(subset)}; for (const [k, v] of Object.entries(s)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v) })()`)
    return keys.length
  } finally {
    reader.destroy()
    writer.destroy()
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** ¿La base de localStorage (leveldb) tiene algo del origen file://? (sus claves empiezan por «_file://»). */
function hasFileOriginStorage(profileDir: string): boolean {
  const dir = join(profileDir, 'Local Storage', 'leveldb')
  try {
    for (const f of readdirSync(dir)) {
      if (!/\.(log|ldb)$/.test(f)) continue
      const path = join(dir, f)
      if (statSync(path).size > 32 * 1024 * 1024) continue
      if (readFileSync(path).includes('_file://')) return true
    }
  } catch { /* sin carpeta */ }
  return false
}

/** Antes de abrir la ventana principal (como mucho unos segundos). */
export async function migrateFileStorage(profileDir: string): Promise<void> {
  const mark = join(profileDir, MARK)
  if (existsSync(mark)) return
  // sin nada guardado por una página file:// (perfil nuevo): nada que pasar ni ventanas ocultas que abrir
  if (!hasFileOriginStorage(profileDir)) {
    try { mkdirSync(profileDir, { recursive: true }); writeFileSync(mark, new Date().toISOString()) } catch { /* nada */ }
    return
  }
  try {
    const n = await Promise.race([copyOnce(profileDir), new Promise<number>((_, ko) => setTimeout(() => ko(new Error('tiempo agotado')), LIMIT_MS))])
    if (n) log.info(`[ventana] ${n} preferencias de la interfaz pasadas a app://aula`)
  } catch (e) {
    log.warn('[ventana] no se pudieron pasar las preferencias de la interfaz', e instanceof Error ? e.message : String(e))
  }
  try { writeFileSync(mark, new Date().toISOString()) } catch { /* nada */ }
}
