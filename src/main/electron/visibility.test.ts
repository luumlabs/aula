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

describe('pantalla completa con AULA_HIDDEN («Presentar» unas diapositivas la enseñaba)', () => {
  function screenWindow() {
    const calls: string[] = []
    const on: Record<string, () => void> = {}
    let full = false
    const win = {
      isDestroyed: () => false,
      isFullScreen: () => full,
      setFullScreenable: (v: boolean) => calls.push(`fullscreenable:${v}`),
      setFullScreen: (v: boolean) => { full = v; calls.push(`fullscreen:${v}`) },
      hide: () => calls.push('hide'),
      on: (ev: string, fn: () => void) => { on[ev] = fn },
      webContents: { on: (ev: string, fn: () => void) => { on[ev] = fn } }
    }
    return { win: win as unknown as BrowserWindow, calls, on, enter: () => { full = true } }
  }

  it('cada ventana nueva queda sin pantalla completa y, si algo la pone o la enseña, vuelve a esconderse', async () => {
    const v = await load(true)
    let created: ((e: unknown, w: BrowserWindow) => void) | undefined
    v.guardHiddenWindows({ on: ((ev: string, fn: (e: unknown, w: BrowserWindow) => void) => { if (ev === 'browser-window-created') created = fn }) as never })
    const { win, calls, on, enter } = screenWindow()
    created?.({}, win)
    expect(calls).toEqual(['fullscreenable:false'])
    enter()
    on['enter-html-full-screen']()
    expect(calls).toEqual(['fullscreenable:false', 'fullscreen:false', 'hide'])
    on['show']()
    expect(calls.at(-1)).toBe('hide')
  })

  it('sin AULA_HIDDEN no se toca nada: la presentación a pantalla completa funciona', async () => {
    const v = await load(false)
    const on = vi.fn()
    v.guardHiddenWindows({ on } as never)
    expect(on).not.toHaveBeenCalled()
  })
})
