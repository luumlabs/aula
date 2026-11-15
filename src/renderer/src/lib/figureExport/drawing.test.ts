import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DrawingRenderSceneV1 } from '@shared/figuresDrawing'
import { captureDrawingPng } from './drawing'
import { api } from '@renderer/lib/api'
vi.mock('@renderer/lib/api', () => ({ api: { invoke: vi.fn() } }))
afterEach(() => vi.mocked(api.invoke).mockReset())
const scene: DrawingRenderSceneV1 = { version: 1, canvas: { width: 100, height: 100 }, metrics: { pixelWidth: 100, textK: 1, unitsPerPx: 1, rootFontPx: 15 }, appearance: { theme: 'light', language: 'es', direction: 'ltr', palette: { paper: '#ffffff', text: '#000000', text2: '#000000', text3: '#000000', brick: '#ff0000', accent: '#ff0000', link: '#ff0000' } }, items: [], output: { scale: 2 } }
describe('ciclo de captura Drawing', () => {
  it('entrega PNG y retira el listener de cancelación al terminar', async () => {
    const signal = new AbortController()
    const data = new Uint8Array([1, 2, 3])
    vi.mocked(api.invoke).mockResolvedValue({ data, width: 100, height: 100 })
    expect(await captureDrawingPng(scene, signal.signal)).toBe(data)
    signal.abort()
    expect(api.invoke).toHaveBeenCalledTimes(1)
    expect(api.invoke).toHaveBeenCalledWith('figures.renderDrawingPng', { scene, jobId: expect.any(String) })
  })
  it('cancelar durante captura libera el job y no espera una respuesta tardía', async () => {
    const controller = new AbortController()
    vi.mocked(api.invoke).mockImplementation((method) => method === 'figures.renderDrawingPng' ? new Promise(() => undefined) : Promise.resolve(undefined))
    const result = captureDrawingPng(scene, controller.signal)
    const jobId = (vi.mocked(api.invoke).mock.calls[0][1] as { jobId: string }).jobId
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(api.invoke).toHaveBeenCalledWith('figures.cancelRender', { jobId })
    expect(api.invoke).toHaveBeenCalledTimes(2)
  })
  it('una señal ya cancelada no inicia ningún IPC', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(captureDrawingPng(scene, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(api.invoke).not.toHaveBeenCalled()
  })
  it('un fallo cancela ese job y permite un intento nuevo', async () => {
    vi.mocked(api.invoke).mockRejectedValueOnce(new Error('resource failed')).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ data: new Uint8Array([4]), width: 100, height: 100 })
    await expect(captureDrawingPng(scene, new AbortController().signal)).rejects.toThrow('resource failed')
    expect(await captureDrawingPng(scene, new AbortController().signal)).toEqual(new Uint8Array([4]))
    const calls = vi.mocked(api.invoke).mock.calls
    expect((calls[0][1] as { jobId: string }).jobId).not.toBe((calls[2][1] as { jobId: string }).jobId)
  })
})
