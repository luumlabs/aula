import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { EventEmitter } from 'node:events'
import type { NotificationConstructorOptions } from 'electron'

interface FakeNotice extends EventEmitter {
  options: NotificationConstructorOptions
  show: Mock<() => void>
  close: Mock<() => void>
}

const fake = vi.hoisted(() => ({
  supported: true,
  notices: [] as FakeNotice[],
  show: vi.fn<(notice: FakeNotice) => void>(),
  warn: vi.fn()
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Notification extends EventEmitter {
    static isSupported() { return fake.supported }
    show: Mock<() => void> = vi.fn((): void => { fake.show(this) })
    close: Mock<() => void> = vi.fn((): void => { this.emit('close') })
    constructor(public options: NotificationConstructorOptions) {
      super()
      fake.notices.push(this)
    }
  }
  return { Notification, app: { focus: vi.fn(), setBadgeCount: vi.fn() } }
})
vi.mock('@main/services/log', () => ({ log: { warn: fake.warn } }))
vi.mock('./window', () => ({ getMainWindow: () => null }))
vi.mock('./visibility', () => ({ reveal: () => false }))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  fake.supported = true
  fake.notices = []
  fake.show.mockReset()
  fake.warn.mockReset()
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('prueba de notificaciones', () => {
  it('distingue soporte del permiso: sin soporte no intenta enviar', async () => {
    fake.supported = false
    const { testNotification } = await import('./notifications')
    await expect(testNotification()).resolves.toBe('unsupported')
    expect(fake.notices).toHaveLength(0)
  })

  it('espera el evento del sistema y evita solicitudes simultáneas duplicadas', async () => {
    const { testNotification } = await import('./notifications')
    const result = testNotification()
    expect(testNotification()).toBe(result)
    expect(fake.notices).toHaveLength(1)
    expect(fake.notices[0].show).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
    fake.notices[0].emit('show')
    await expect(result).resolves.toBe('sent')
    expect(vi.getTimerCount()).toBe(0)
    expect(fake.notices[0].listenerCount('show')).toBe(0)
  })

  it('un sistema que no confirma la entrega no se presenta como éxito', async () => {
    const { testNotification } = await import('./notifications')
    const result = testNotification()
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(result).resolves.toBe('unconfirmed')
    expect(fake.notices[0].listenerCount('show')).toBe(0)
    // El aviso sigue retenido, por si el usuario responde después al diálogo de permiso.
    const next = testNotification()
    expect(fake.notices[0].close).toHaveBeenCalledOnce()
    fake.notices[1].emit('show')
    await expect(next).resolves.toBe('sent')
  })

  it('devuelve un fallo y libera el aviso cuando el sistema lo rechaza', async () => {
    const { testNotification } = await import('./notifications')
    const result = testNotification()
    fake.notices[0].emit('failed', {}, 'Not allowed')
    await expect(result).resolves.toBe('failed')
    expect(fake.warn).toHaveBeenCalledWith('Notificación', 'Not allowed')
    expect(vi.getTimerCount()).toBe(0)
    const next = testNotification()
    expect(fake.notices[0].close).not.toHaveBeenCalled()
    fake.notices[1].emit('show')
    await expect(next).resolves.toBe('sent')
  })

  it('captura un fallo síncrono de la API y permite reintentar', async () => {
    fake.show.mockImplementationOnce(() => { throw new Error('Native error') })
    const { testNotification } = await import('./notifications')
    await expect(testNotification()).resolves.toBe('failed')
    expect(fake.warn).toHaveBeenCalledWith('Notificación de prueba', expect.any(Error))
    expect(vi.getTimerCount()).toBe(0)
    const next = testNotification()
    fake.notices[1].emit('show')
    await expect(next).resolves.toBe('sent')
  })

  it('cerrar antes de la confirmación termina la espera sin afirmar entrega', async () => {
    const { testNotification } = await import('./notifications')
    const result = testNotification()
    fake.notices[0].close()
    await expect(result).resolves.toBe('unconfirmed')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('avisos de la interfaz', () => {
  it('retiene el aviso y reemplaza el anterior; un fallo tardío no borra el nuevo', async () => {
    const { postAppNotice } = await import('./notifications')
    postAppNotice('Primero')
    postAppNotice('Segundo')
    expect(fake.notices[0].close).toHaveBeenCalledOnce()
    fake.notices[0].emit('failed', {}, 'Late failure')
    postAppNotice('Tercero')
    expect(fake.notices[1].close).toHaveBeenCalledOnce()
    expect(fake.notices[2].options.body).toBe('Tercero')
  })

  it('libera los avisos cerrados y registra los fallos síncronos', async () => {
    const { postAppNotice } = await import('./notifications')
    postAppNotice('Primero')
    fake.notices[0].emit('close')
    postAppNotice('Segundo')
    expect(fake.notices[0].close).not.toHaveBeenCalled()
    fake.show.mockImplementationOnce(() => { throw new Error('Unavailable') })
    expect(() => postAppNotice('Tercero')).not.toThrow()
    expect(fake.warn).toHaveBeenCalledWith('Notificación', expect.any(Error))
  })
})
