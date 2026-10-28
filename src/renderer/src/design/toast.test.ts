import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast, useToasts } from './Toast'

afterEach(() => {
  for (const t of useToasts.getState().items) useToasts.getState().dismiss(t.id)
  vi.useRealTimers()
})

describe('avisos (J1-14)', () => {
  it('el mismo aviso no se apila: se queda uno y dura un poco más', () => {
    vi.useFakeTimers()
    const a = toast.error('No se guardó: parece una clave')
    vi.advanceTimersByTime(5000)
    const b = toast.error('No se guardó: parece una clave')
    expect(b).toBe(a)
    expect(useToasts.getState().items).toHaveLength(1)
    // el temporizador se reinicia con el segundo intento
    vi.advanceTimersByTime(5000)
    expect(useToasts.getState().items).toHaveLength(1)
    vi.advanceTimersByTime(2500)
    expect(useToasts.getState().items).toHaveLength(0)
  })

  it('avisos distintos sí se apilan (hasta cuatro)', () => {
    for (let i = 0; i < 6; i++) toast.info(`Aviso ${i}`)
    expect(useToasts.getState().items.map((t) => t.title)).toEqual(['Aviso 2', 'Aviso 3', 'Aviso 4', 'Aviso 5'])
  })
})
