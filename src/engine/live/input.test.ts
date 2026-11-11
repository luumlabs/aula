import { describe, expect, it } from 'vitest'
import { clampViewport, fieldKind, frameSize, isPrivateField, MAX_EVENTS, MAX_TEXT, sanitizeLiveInput, toPoint } from './input'

describe('lo que llega del dispositivo para el navegador en vivo', () => {
  it('deja pasar toques, rueda, texto y teclas bien formados', () => {
    expect(sanitizeLiveInput([{ type: 'tap', x: 0.5, y: 0.25 }, { type: 'tap', x: 0.1, y: 0.9, count: 2 }, { type: 'wheel', x: 0.5, y: 0.5, dx: 0, dy: 120 }, { type: 'text', text: 'hola' }, { type: 'key', key: 'Enter' }, { type: 'key', key: 'a', meta: true }]))
      .toEqual([{ type: 'tap', x: 0.5, y: 0.25 }, { type: 'tap', x: 0.1, y: 0.9, count: 2 }, { type: 'wheel', x: 0.5, y: 0.5, dx: 0, dy: 120 }, { type: 'text', text: 'hola' }, { type: 'key', key: 'Enter' }, { type: 'key', key: 'a', meta: true }])
  })
  it('acota las posiciones y descarta lo que no entiende', () => {
    expect(sanitizeLiveInput([{ type: 'tap', x: 3, y: -1 }])).toEqual([{ type: 'tap', x: 1, y: 0 }])
    expect(sanitizeLiveInput([{ type: 'tap', x: 'a', y: 0 }, { type: 'wheel', x: 0.5, y: 0.5, dx: 0, dy: 0 }, { type: 'key', key: 'F13' }, { type: 'key', key: 'ab' }, { type: 'run', cmd: 'rm' }, null, 7, { type: 'text', text: '' }])).toEqual([])
    expect(sanitizeLiveInput({ type: 'tap' })).toEqual([])
    expect(sanitizeLiveInput([{ type: 'wheel', x: 0.5, y: 0.5, dx: 1e9, dy: -1e9 }])).toEqual([{ type: 'wheel', x: 0.5, y: 0.5, dx: 2400, dy: -2400 }])
  })
  it('limita cuánto se manda de una vez y quita los caracteres de control del texto', () => {
    expect(sanitizeLiveInput(Array.from({ length: 100 }, () => ({ type: 'key', key: 'a' })))).toHaveLength(MAX_EVENTS)
    const [t] = sanitizeLiveInput([{ type: 'text', text: 'a\u0000b\nc' + 'x'.repeat(MAX_TEXT) }])
    expect(t).toMatchObject({ type: 'text' })
    expect((t as { text: string }).text.startsWith('abc')).toBe(true)
    expect((t as { text: string }).text).toHaveLength(MAX_TEXT)
  })
  it('pasa de fracción a punto dentro de la página', () => {
    expect(toPoint(0.5, 0.5, { width: 1000, height: 700 })).toEqual({ x: 500, y: 350 })
    expect(toPoint(1, 1, { width: 1000, height: 700 })).toEqual({ x: 999, y: 699 })
    expect(toPoint(0, 0, { width: 390, height: 700 })).toEqual({ x: 0, y: 0 })
  })
  it('acota el tamaño de la página y el de la imagen', () => {
    expect(clampViewport(390, 760)).toEqual({ width: 390, height: 760 })
    expect(clampViewport(50, 99999)).toEqual({ width: 320, height: 1600 })
    expect(clampViewport('x', undefined)).toEqual({ width: 1100, height: 760 })
    expect(frameSize({ width: 1100, height: 760 }, 550)).toEqual({ w: 550, h: 380 })
    expect(frameSize({ width: 390, height: 700 }, 1000)).toEqual({ w: 390, h: 700 }) // nunca se amplía
  })
  it('elige el teclado del campo y reconoce los que Aula no debe leer', () => {
    expect(fieldKind('password', '', '')).toBe('password')
    expect(fieldKind('text', '', 'one-time-code')).toBe('code')
    expect(fieldKind('text', '', 'username')).toBe('email')
    expect(fieldKind('text', 'numeric', '')).toBe('number')
    expect(fieldKind('text', '', '')).toBe('text')
    expect(isPrivateField('password', '', 'pwd')).toBe(true)
    expect(isPrivateField('text', 'cc-number', 'card')).toBe(true)
    expect(isPrivateField('text', 'one-time-code', 'code')).toBe(true)
    expect(isPrivateField('hidden', '', 'csrf')).toBe(true)
    expect(isPrivateField('text', '', 'respuesta_3')).toBe(false)
    expect(isPrivateField('textarea', '', 'essay')).toBe(false)
  })
})
