// Recargar la interfaz si se cae, pero no en bucle.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { on: () => undefined } }))

describe('recuperación de la ventana', () => {
  it('recarga como mucho 3 veces por minuto y vuelve a poder pasado ese tiempo', async () => {
    const { shouldReload } = await import('./recovery')
    const h: number[] = []
    expect([0, 1000, 2000, 3000].map((t) => shouldReload(h, t))).toEqual([true, true, true, false])
    expect(shouldReload(h, 61_500)).toBe(true)
  })
})
