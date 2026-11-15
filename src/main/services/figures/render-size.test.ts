import { describe, expect, it } from 'vitest'
import { drawingCaptureSize, privatePngSize } from './render-size'
import { pngChunk, pngFixture } from './testing'
import { canonicalizeFigurePng } from './png'

describe('superficies físicas y PNG intermedio privado', () => {
  it.each([1, 1.25, 1.5, 2, 3, 8])('acota captura y salida con escala física %s conservando encuadre', physical => {
    const bounds = { x: -100, y: -50, width: 10000, height: 7000 }, size = drawingCaptureSize(bounds, 2, physical)
    expect(Math.ceil(size.width * physical)).toBeLessThanOrEqual(4096)
    expect(Math.ceil(size.height * physical)).toBeLessThanOrEqual(4096)
    expect(size.outputWidth * size.outputHeight).toBeLessThanOrEqual(16 * 1024 * 1024)
    expect(bounds.width * size.scale).toBeLessThanOrEqual(size.width + .001)
    expect(bounds.height * size.scale).toBeLessThanOrEqual(size.height + .001)
  })
  it('rechaza escalas desconocidas, bounds imposibles y dimensiones nativas excesivas', () => {
    for (const scale of [0, NaN, Infinity, 9]) expect(() => drawingCaptureSize({ x: 0, y: 0, width: 100, height: 100 }, 2, scale)).toThrow()
    expect(() => drawingCaptureSize({ x: 0, y: 0, width: 1000000, height: 100 }, 2, 2)).toThrow()
    expect(() => privatePngSize(pngFixture({ width: 4097, height: 1 }))).toThrow()
  })
  it('ICC sólo es un intermedio nativo; el guardado sigue rechazándolo', async () => {
    const native = pngFixture({ before: [pngChunk('iCCP', Buffer.from('private capture ICC'))] })
    expect(privatePngSize(native)).toEqual({ width: 2, height: 2 })
    await expect(canonicalizeFigurePng(native)).rejects.toThrow()
    const normalized = pngFixture()
    await expect(canonicalizeFigurePng(normalized)).resolves.toEqual(normalized)
  })
})
