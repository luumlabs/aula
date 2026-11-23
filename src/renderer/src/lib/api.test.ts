import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, installInvokeGuard, isAulaError, unwrap, type InvokeGuard } from './api'

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

describe('invoke con un vigilante (el aviso de la IA en un dispositivo)', () => {
  const g = globalThis as unknown as { window?: unknown }
  const had = 'window' in g
  const before = g.window
  afterEach(() => {
    installInvokeGuard(null)
    if (had) g.window = before
    else delete g.window
  })
  const bridge = (...answers: unknown[]) => {
    const invoke = vi.fn(async () => answers.shift())
    g.window = { aula: { invoke, on: vi.fn(), platform: 'web' } }
    return invoke
  }

  it('pregunta antes de mandar, con el método y los argumentos', async () => {
    const invoke = bridge({ ok: true, value: 1 })
    const guard: InvokeGuard = { before: vi.fn(async () => {}), recover: vi.fn(async () => false) }
    installInvokeGuard(guard)
    expect(await api.invoke('courses.list')).toBe(1)
    expect(guard.before).toHaveBeenCalledWith('courses.list', undefined)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it("si el Mac pide el aviso y se arregla, reintenta una vez", async () => {
    const invoke = bridge({ ok: false, error: { message: 'acepta', code: 'ai_consent' } }, { ok: true, value: 'hecho' })
    installInvokeGuard({ before: async () => {}, recover: async (_m, _a, err) => err.code === 'ai_consent' })
    expect(await api.invoke('chat.suggestions' as never)).toBe('hecho')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('si el vigilante lanza, no se manda nada', async () => {
    const invoke = bridge({ ok: true, value: 1 })
    installInvokeGuard({ before: async () => { throw new Error('cancelado') }, recover: async () => false })
    await expect(api.invoke('courses.list')).rejects.toThrow('cancelado')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('sin vigilante, como siempre', async () => {
    const invoke = bridge({ ok: false, error: { message: 'no', code: 'ai_consent' } })
    await expect(api.invoke('courses.list')).rejects.toMatchObject({ code: 'ai_consent' })
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
