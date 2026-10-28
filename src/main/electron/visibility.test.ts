// FIX2 · AULA_HIDDEN: lanzada así, ninguna ventana se enseña nunca (ni al activar la app); al iniciar sesión, solo la primera.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

async function load(hidden: boolean): Promise<typeof import('./visibility')> {
  vi.resetModules()
  if (hidden) process.env.AULA_HIDDEN = '1'
  else delete process.env.AULA_HIDDEN
  return import('./visibility')
}

function fakeWindow(minimized = false) {
  const calls: string[] = []
  const win = {
    isDestroyed: () => false,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus')
  }
  return { win: win as unknown as BrowserWindow, calls }
}

const before = process.env.AULA_HIDDEN
afterEach(() => {
  if (before === undefined) delete process.env.AULA_HIDDEN
  else process.env.AULA_HIDDEN = before
})

describe('visibilidad de las ventanas', () => {
  it('con AULA_HIDDEN al lanzar: nunca se enseña nada, ni la primera ventana ni las siguientes', async () => {
    const v = await load(true)
    expect(v.windowsAlwaysHidden()).toBe(true)
    expect(v.showWhenReady()).toBe(false)
    expect(v.showWhenReady()).toBe(false)
    const { win, calls } = fakeWindow(true)
    expect(v.reveal(win)).toBe(false)
    expect(calls).toEqual([])
  })

  it('poner AULA_HIDDEN después de cargar (como hacía el modo «al iniciar sesión») no cambia nada', async () => {
    const v = await load(false)
    process.env.AULA_HIDDEN = '1'
    expect(v.windowsAlwaysHidden()).toBe(false)
    const { win, calls } = fakeWindow()
    expect(v.reveal(win)).toBe(true)
    expect(calls).toEqual(['show', 'focus'])
  })

  it('al iniciar sesión con «siempre activa»: solo la primera ventana empieza escondida y luego se puede enseñar', async () => {
    const v = await load(false)
    v.startHiddenAtLogin()
    expect(v.showWhenReady()).toBe(false)
    expect(v.showWhenReady()).toBe(true)
    const { win, calls } = fakeWindow(true)
    expect(v.reveal(win, { focus: false })).toBe(true)
    expect(calls).toEqual(['restore', 'show'])
  })

  it('sin AULA_HIDDEN: la ventana se enseña; una destruida o ninguna, no', async () => {
    const v = await load(false)
    expect(v.showWhenReady()).toBe(true)
    expect(v.reveal(null)).toBe(false)
    expect(v.reveal({ isDestroyed: () => true } as unknown as BrowserWindow)).toBe(false)
  })
})
