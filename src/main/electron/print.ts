// PDF de los documentos que crea Aula: la vista de impresión de la interfaz (screens/documents/print, con los mismos bloques
// de las lecciones en `mode: 'print'`) en una ventana oculta, y `printToPDF` de Chromium. La ventana no tiene acceso al RPC
// (no es de confianza): el plan se le pasa con `executeJavaScript` y ella avisa cuando ha terminado de dibujar. Se reutiliza
// un rato (la vista previa de la hoja de exportar pide varios PDF seguidos) y se cierra sola.
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { DocumentPlan } from '@shared/documents'
import { EVENT_CHANNEL } from '@shared/ipc'
import { AulaError } from '@main/services/errors'
import { log } from '@main/services/log'
import { appURL, getMainWindow } from './window'
import { tr } from '@shared/ai/i18n'

const IDLE_MS = 90_000
const BOOT_TIMEOUT_MS = 30_000
const RENDER_TIMEOUT_MS = 45_000

let win: BrowserWindow | null = null
let booting: Promise<BrowserWindow> | null = null
let idle: ReturnType<typeof setTimeout> | null = null
let queue: Promise<unknown> = Promise.resolve()

function destroy(): void {
  if (idle) clearTimeout(idle)
  idle = null
  booting = null
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Crea la ventana oculta con la interfaz y espera a que la vista de impresión esté lista para recibir un plan. */
async function boot(): Promise<BrowserWindow> {
  const w = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  win = w
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.on('closed', () => { if (win === w) win = null })
  // la ventana principal se cierra: la oculta no debe dejar la app abierta
  getMainWindow()?.once('closed', destroy)
  await w.loadURL(appURL('index.html', { print: '1' }))
  // la interfaz arranca en Inicio: se le pide ir a Documentos (que, con ?print=1, monta la vista de impresión)
  const started = Date.now()
  while (Date.now() - started < BOOT_TIMEOUT_MS) {
    if (w.isDestroyed()) break
    const ready = await w.webContents.executeJavaScript('Boolean(window.__aulaPrint)').catch(() => false)
    if (ready) return w
    w.webContents.send(EVENT_CHANNEL, 'app.command', { command: 'goDocuments' })
    await sleep(250)
  }
  destroy()
  throw new AulaError('print_failed', tr('No se pudo preparar la vista de impresión.', 'The print preview couldn’t be prepared.'))
}

async function printWindow(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed() && !booting) return win
  booting ??= boot().finally(() => { booting = null })
  return booting
}

/** Cuántas páginas tiene un PDF (los objetos «/Type /Page»). */
export function pdfPageCount(data: Uint8Array): number {
  const s = Buffer.from(data).toString('latin1')
  return (s.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

async function render(plan: DocumentPlan): Promise<{ data: Uint8Array; pages: number }> {
  const w = await printWindow()
  if (idle) clearTimeout(idle)
  try {
    const job = JSON.stringify(plan)
    const outcome = await Promise.race([
      w.webContents.executeJavaScript(`window.__aulaPrint.render(${job})`) as Promise<{ ok: boolean; error?: string }>,
      sleep(RENDER_TIMEOUT_MS).then(() => ({ ok: false, error: 'timeout' }))
    ])
    if (!outcome?.ok) throw new AulaError('print_failed', tr(`No se pudo dibujar el documento (${outcome?.error ?? '?'}).`, `Couldn’t draw the document (${outcome?.error ?? '?'}).`))
    const style = plan.request.style
    const footer = `Aula · ${plan.title}${plan.courseTitle && plan.courseTitle !== plan.title ? ` · ${plan.courseTitle}` : ''}`
    const buf = await w.webContents.printToPDF({
      pageSize: style.paper === 'letter' ? 'Letter' : 'A4',
      // las diapositivas (sin folleto), una por página apaisada
      landscape: plan.request.kind === 'slides' && !style.handout,
      printBackground: true,
      margins: { top: 0.7, bottom: 0.75, left: 0.75, right: 0.75 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-family: Georgia, 'Times New Roman', serif; font-size: 7.5px; color: #8a847e; width: 100%; padding: 0 0.75in; display: flex; justify-content: space-between;"><span>${escapeHTML(footer)}</span><span class="pageNumber"></span></div>`,
      generateDocumentOutline: true,
      generateTaggedPDF: true
    })
    const data = new Uint8Array(buf)
    return { data, pages: pdfPageCount(data) }
  } catch (err) {
    log.warn('[print] el PDF falló', err)
    destroy()
    throw err instanceof AulaError ? err : new AulaError('print_failed', tr('No se pudo componer el PDF.', 'Couldn’t put the PDF together.'))
  } finally {
    if (win && !win.isDestroyed()) idle = setTimeout(destroy, IDLE_MS)
  }
}

/** Dibuja el plan en PDF (uno detrás de otro: hay una sola ventana de impresión). */
export function printPlanToPDF(plan: DocumentPlan): Promise<{ data: Uint8Array; pages: number }> {
  const next = queue.then(() => render(plan), () => render(plan))
  queue = next.catch(() => undefined)
  return next
}

app.on('before-quit', destroy)
