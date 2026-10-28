import { describe, expect, it } from 'vitest'
import { isAulaError, unwrap } from './api'

describe('unwrap', () => {
  it('devuelve el valor', () => {
    expect(unwrap({ ok: true, value: 3 })).toBe(3)
  })
  it('lanza un Error con el código y los detalles', () => {
    try {
      unwrap({ ok: false, error: { message: 'No existe', code: 'not_found', details: { id: 'x' } } })
      expect.unreachable()
    } catch (e) {
      expect(isAulaError(e)).toBe(true)
      expect((e as { code: string }).code).toBe('not_found')
      expect((e as Error).message).toBe('No existe')
      expect((e as { details: unknown }).details).toEqual({ id: 'x' })
    }
  })
  it('un sobre roto es un error interno', () => {
    expect(() => unwrap(undefined as never)).toThrow(/no válida/)
  })
})
