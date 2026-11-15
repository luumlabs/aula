import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SaveDialogOptions, SaveDialogReturnValue } from 'electron'
import type { RpcContext } from '../rpc'
import { setAILocale } from '@shared/ai/i18n'

const handlers = new Map<string, (args: unknown, ctx: RpcContext) => unknown>()
const dialog = vi.fn<(parent: unknown, options: SaveDialogOptions) => Promise<SaveDialogReturnValue>>()
const reveal = vi.fn()
let dir: string
let parent: { isDestroyed: () => boolean } | null
vi.mock('electron', () => ({
  app: { getPath: () => dir },
  BrowserWindow: { fromWebContents: () => parent },
  dialog: { showSaveDialog: (p: unknown, o: SaveDialogOptions) => dialog(p, o) },
  shell: { showItemInFolder: (p: string) => reveal(p) }
}))
vi.mock('../rpc', () => ({ handle: (m: string, fn: (args: unknown, ctx: RpcContext) => unknown) => handlers.set(m, fn) }))

class Sender extends EventEmitter {
  destroyed = false
  isDestroyed(): boolean { return this.destroyed }
  destroy(): void { this.destroyed = true; this.emit('destroyed') }
}
const context = (sender: Sender, remote = false): RpcContext => ({ sender: sender as unknown as RpcContext['sender'], ...(remote ? { remote: { deviceId: 'fixture' } } : {}) })
const args = { format: 'svg', suggestedName: 'Estructura', svg: { width: 20, height: 10, viewBox: [0, 0, 20, 10], children: [] } }
const call = async (method: string, value: unknown, ctx: RpcContext) => handlers.get(method)!(value, ctx)
let sender: Sender

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'aula-figure-handler-'))
  sender = new Sender(); parent = { isDestroyed: () => false }
  setAILocale('es'); vi.stubEnv('AULA_SERVER', '0')
  dialog.mockReset(); reveal.mockReset(); handlers.clear()
  ;(await import('./figures')).register()
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); setAILocale('es') })

describe('IPC de figuras y diálogo nativo', () => {
  it('cancela sin escribir, con formato y ruta sugeridos por main', async () => {
    dialog.mockResolvedValue({ canceled: true, filePath: join(dir, 'ignorada.svg') })
    expect(await call('figures.save', args, context(sender))).toBeNull()
    expect(dialog).toHaveBeenCalledWith(parent, expect.objectContaining({ title: 'Guardar figura', defaultPath: join(dir, 'Estructura.svg'), filters: [{ name: 'SVG', extensions: ['svg'] }] }))
    expect(readdirSync(dir)).toEqual([])
    await expect(call('figures.revealSaved', { path: join(dir, 'ignorada.svg') }, context(sender))).rejects.toMatchObject({ code: 'forbidden' })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('guarda en la ruta elegida y sólo el mismo emisor puede revelarla', async () => {
    const path = join(dir, 'elegida.svg')
    setAILocale('en')
    dialog.mockResolvedValue({ canceled: false, filePath: path })
    expect(await call('figures.save', args, context(sender))).toEqual({ path })
    expect(dialog.mock.calls[0][1].title).toBe('Save figure')
    expect(readFileSync(path, 'utf8')).toMatch(/^<svg/)
    await call('figures.revealSaved', { path }, context(sender))
    expect(reveal).toHaveBeenCalledExactlyOnceWith(path)
    await expect(call('figures.revealSaved', { path }, context(new Sender()))).rejects.toMatchObject({ code: 'forbidden' })
    // El evento también elimina el permiso, independientemente del estado que informe el objeto.
    sender.emit('destroyed')
    await expect(call('figures.revealSaved', { path }, context(sender))).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('niega remoto, servidor, emisor destruido y ausencia de ventana antes de dialogar o revelar', async () => {
    const denied = async (ctx: RpcContext) => {
      await expect(call('figures.save', args, ctx)).rejects.toMatchObject({ code: 'forbidden' })
      await expect(call('figures.renderDrawingPng', { jobId: 'one', scene: {} }, ctx)).rejects.toMatchObject({ code: 'forbidden' })
      await expect(call('figures.cancelRender', { jobId: 'one' }, ctx)).rejects.toMatchObject({ code: 'forbidden' })
      await expect(call('figures.revealSaved', { path: '/no.svg' }, ctx)).rejects.toMatchObject({ code: 'forbidden' })
    }
    await denied(context(sender, true))
    vi.stubEnv('AULA_SERVER', '1'); await denied(context(sender)); vi.stubEnv('AULA_SERVER', '0')
    const destroyed = new Sender(); destroyed.destroy(); await denied(context(destroyed))
    await denied({ sender: undefined } as unknown as RpcContext)
    parent = null; await denied(context(sender))
    expect(dialog).not.toHaveBeenCalled(); expect(reveal).not.toHaveBeenCalled()
    expect(readdirSync(dir)).toEqual([])
  })

  it('no escribe si la ventana se cierra mientras espera al diálogo', async () => {
    dialog.mockImplementation(async () => { sender.destroy(); return { canceled: false, filePath: join(dir, 'no.svg') } })
    expect(await call('figures.save', args, context(sender))).toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })

  it('rechaza entradas activas y ruta arbitraria sin abrir el diálogo', async () => {
    await expect(call('figures.save', { ...args, path: join(dir, 'no.svg') }, context(sender))).rejects.toMatchObject({ code: 'invalid_args' })
    await expect(call('figures.save', { ...args, svg: { ...args.svg, children: [{ tag: 'script' }] } }, context(sender))).rejects.toMatchObject({ code: 'invalid_args' })
    expect(dialog).not.toHaveBeenCalled()
  })
})
