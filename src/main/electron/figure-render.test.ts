import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pngChunk, pngFixture } from '@main/services/figures/testing'
import type { DrawingRenderSceneV1 } from '@shared/figuresDrawing'

const state = vi.hoisted(() => ({ windows: [] as unknown[], sessions: [] as unknown[], normalized: 'good', displayScale: 2, calibrationFailures: 0, calls: [] as string[], cleanup: vi.fn(async () => undefined) }))
vi.mock('@main/services/figures/render-assets', async original => ({ ...await original<object>(), loadFigureAssets: async () => new Map([['figure-render.html', { file: '/fixture/figure-render.html', mime: 'text/html' }], ['assets/scene.js', { file: '/fixture/assets/scene.js', mime: 'text/javascript' }]]) }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeSession extends EventEmitter {
    permissionCheck?: () => boolean
    permissionRequest?: (wc: unknown, permission: string, callback: (allowed: boolean) => void) => void
    media?: (request: unknown, callback: (streams: unknown) => void) => void
    request?: (details: { url: string; method: string; resourceType: string }, callback: (result: { cancel: boolean }) => void) => void
    protocol = { handle: vi.fn() }
    webRequest = { onBeforeRequest: (fn: FakeSession['request']) => { this.request = fn } }
    setDevicePermissionHandler = vi.fn()
    setPermissionCheckHandler(fn: FakeSession['permissionCheck']): void { this.permissionCheck = fn }
    setPermissionRequestHandler(fn: FakeSession['permissionRequest']): void { this.permissionRequest = fn }
    setDisplayMediaRequestHandler(fn: FakeSession['media']): void { this.media = fn }
    clearStorageData = state.cleanup
    clearCache = vi.fn(async () => undefined)
    closeAllConnections = vi.fn(async () => undefined)
  }
  class FakeWindow extends EventEmitter {
    destroyed = false
    width = 128; height = 128
    options: Record<string, unknown>
    captures: Array<{ rect: unknown; opts: unknown }> = []
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: async (script: string) => {
        if (script.startsWith('Boolean')) return true
        if (script.startsWith('new Promise')) { state.calls.push('paint'); return undefined }
        const match = /^window\.aulaFigureRender\.(\w+)\(([\s\S]*)\)$/.exec(script)!
        const args = JSON.parse(match[2]) as Record<string, unknown>; state.calls.push(match[1])
        if (match[1] === 'render') return { bounds: { x: -2, y: -2, width: 100, height: 80 }, layoutWidth: 100, layoutHeight: 80 }
        if (match[1] === 'resize') return { width: args.width, height: args.height }
        const native = Buffer.from(args.data as string, 'base64')
        expect(native.includes(Buffer.from('iCCP'))).toBe(true)
        const data = state.normalized === 'icc' ? native : pngFixture({ width: args.width as number, height: args.height as number })
        return { data: data.toString('base64'), width: args.width, height: args.height }
      },
      capturePage: async (rect: { width: number; height: number }, opts: unknown) => {
        state.calls.push('capture'); this.captures.push({ rect, opts })
        if (rect.width === 128 && rect.height === 128 && state.calibrationFailures > 0) { state.calibrationFailures--; throw new Error('UnknownVizError') }
        const width = rect.width * 2, height = rect.height * 2
        return { isEmpty: () => false, getSize: () => ({ width, height }), toPNG: () => pngFixture({ width, height, before: [pngChunk('iCCP', Buffer.from('private-ICC'))] }) }
      }
    })
    constructor(options: Record<string, unknown>) { super(); this.options = options; state.windows.push(this) }
    isDestroyed(): boolean { return this.destroyed }
    destroy(): void { this.destroyed = true; this.webContents.emit('destroyed') }
    async loadURL(): Promise<void> { state.calls.push('load'); this.emit('ready-to-show') }
    setContentSize(width: number, height: number): void { state.calls.push('resizeWindow'); this.width = width; this.height = height }
    getBounds(): { x: number; y: number; width: number; height: number } { return { x: 0, y: 0, width: this.width, height: this.height } }
    getContentSize(): [number, number] { return [this.width, this.height] }
  }
  const screen = Object.assign(new EventEmitter(), { getDisplayMatching: () => ({ id: 1, scaleFactor: 2 }), getAllDisplays: () => [{ id: 1, scaleFactor: state.displayScale, bounds: { x: 0, y: 0, width: 1280, height: 900 } }] })
  return { BrowserWindow: FakeWindow, screen, session: { fromPartition: (name: string, opts: unknown) => { expect(name).not.toMatch(/^persist:/); expect(opts).toEqual({ cache: false }); const session = new FakeSession(); state.sessions.push(session); return session }, get defaultSession() { throw new Error('Default session forbidden') } } }
})
class Owner extends EventEmitter { isDestroyed(): boolean { return false } }
const scene = (): DrawingRenderSceneV1 => ({ version: 1, canvas: { width: 100, height: 80 }, metrics: { pixelWidth: 100, textK: 1, unitsPerPx: 1, rootFontPx: 16 }, appearance: { theme: 'light', language: 'es', direction: 'ltr', palette: { paper: '#ffffff', text: '#000000', text2: '#111111', text3: '#222222', brick: '#aa2211', accent: '#aa2211', link: '#aa2211' } }, items: [], output: { scale: 2 } })
beforeEach(() => { vi.resetModules(); vi.stubEnv('ELECTRON_RENDERER_URL', ''); state.windows = []; state.sessions = []; state.calls = []; state.normalized = 'good'; state.displayScale = 2; state.calibrationFailures = 0; state.cleanup.mockClear() })

describe('pipeline aislado de Drawing', () => {
  it('calibra antes de crecer, normaliza ICC en entry y valida PNG limpio antes de responder', async () => {
    const { renderDrawingPng } = await import('./figure-render')
    const result = await renderDrawingPng({ jobId: 'one', scene: scene() }, new Owner())
    expect(result).toMatchObject({ width: 200, height: 160 }); expect(Buffer.from(result.data).includes(Buffer.from('iCCP'))).toBe(false)
    expect(state.calls).toEqual(['load', 'render', 'capture', 'resizeWindow', 'resize', 'capture', 'normalize'])
    const win = state.windows[0] as { destroyed: boolean; options: { show: boolean; webPreferences: Record<string, unknown> }; captures: Array<{ opts: unknown }> }
    expect(win.destroyed).toBe(true); expect(win.options.show).toBe(false)
    expect(win.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false })
    expect(win.options.webPreferences).not.toHaveProperty('preload')
    expect(win.captures.every(c => JSON.stringify(c.opts) === JSON.stringify({ stayHidden: true, stayAwake: false }))).toBe(true)
    expect(state.cleanup).toHaveBeenCalledTimes(1)
    await renderDrawingPng({ jobId: 'two', scene: scene() }, new Owner())
    expect(state.sessions).toHaveLength(1); expect(state.cleanup).toHaveBeenCalledTimes(2)
  })
  it('reintenta una sola calibración UnknownVizError tras dos frames, sin asumir DPR', async () => {
    const { renderDrawingPng } = await import('./figure-render')
    state.calibrationFailures = 1
    await expect(renderDrawingPng({ jobId: 'retry', scene: scene() }, new Owner())).resolves.toMatchObject({ width: 200, height: 160 })
    expect(state.calls).toEqual(['load', 'render', 'capture', 'paint', 'capture', 'resizeWindow', 'resize', 'capture', 'normalize'])
    state.calls = []; state.calibrationFailures = 2
    await expect(renderDrawingPng({ jobId: 'failed', scene: scene() }, new Owner())).rejects.toMatchObject({ code: 'render_failed' })
    expect(state.calls).toEqual(['load', 'render', 'capture', 'paint', 'capture'])
    expect((state.windows[1] as { destroyed: boolean }).destroyed).toBe(true)
  })
  it('rechaza DTO antes de crear ventana y no confía en la salida del normalizador', async () => {
    const { renderDrawingPng } = await import('./figure-render')
    await expect(renderDrawingPng({ jobId: 'bad', scene: { ...scene(), url: 'file:///private' } }, new Owner())).rejects.toMatchObject({ code: 'invalid_args' })
    expect(state.windows).toHaveLength(0)
    state.normalized = 'icc'
    await expect(renderDrawingPng({ jobId: 'icc', scene: scene() }, new Owner())).rejects.toMatchObject({ code: 'invalid_args' })
    expect((state.windows[0] as { destroyed: boolean }).destroyed).toBe(true)
  })
  it('sesión sólo admite entry/assets exactos; niega red, file, asset, frames, permisos y descargas', async () => {
    const { renderDrawingPng } = await import('./figure-render')
    await renderDrawingPng({ jobId: 'one', scene: scene() }, new Owner())
    const session = state.sessions[0] as EventEmitter & { request: (d: unknown, c: (r: unknown) => void) => void; permissionCheck: () => boolean; permissionRequest: (a: unknown, b: string, c: (v: boolean) => void) => void }
    for (const url of ['https://example.invalid', 'ws://localhost', 'file:///private', 'aula-asset://pack/secret/image.png', 'app://aula/index.html', 'app://aula/assets/other.js']) {
      const callback = vi.fn(); session.request({ url, method: 'GET', resourceType: 'script' }, callback); expect(callback).toHaveBeenCalledWith({ cancel: true })
    }
    const callback = vi.fn(); session.request({ url: 'app://aula/assets/scene.js', method: 'GET', resourceType: 'script' }, callback); expect(callback).toHaveBeenCalledWith({ cancel: false })
    session.request({ url: 'app://aula/figure-render.html', method: 'GET', resourceType: 'subFrame' }, callback); expect(callback).toHaveBeenLastCalledWith({ cancel: true })
    expect(session.permissionCheck()).toBe(false)
    const granted = vi.fn(); session.permissionRequest(null, 'media', granted); expect(granted).toHaveBeenCalledWith(false)
    const preventDefault = vi.fn(), cancel = vi.fn(); session.emit('will-download', { preventDefault }, { cancel }); expect(preventDefault).toHaveBeenCalled(); expect(cancel).toHaveBeenCalled()
  })
  it('no crea siquiera la superficie pequeña si la escala del display es desconocida', async () => {
    state.displayScale = 99
    const { renderDrawingPng } = await import('./figure-render')
    await expect(renderDrawingPng({ jobId: 'one', scene: scene() }, new Owner())).rejects.toMatchObject({ code: 'render_failed' })
    expect(state.windows).toHaveLength(0)
  })
  it('el servidor de desarrollo no se convierte en una excepción de red', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    const { renderDrawingPng } = await import('./figure-render')
    await expect(renderDrawingPng({ jobId: 'one', scene: scene() }, new Owner())).rejects.toMatchObject({ code: 'render_build_required' })
    expect(state.windows).toHaveLength(0)
  })
})
