import { afterEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ openExternal: vi.fn(), appOn: vi.fn(), powerOn: vi.fn(), getUpdater: vi.fn() }))
vi.mock('electron', () => ({
  app: { isPackaged: true, on: calls.appOn, once: calls.appOn, getVersion: () => '0.1.4', quit: vi.fn() },
  powerMonitor: { on: calls.powerOn },
  shell: { openExternal: calls.openExternal }
}))
vi.mock('electron-updater', () => ({ default: { get autoUpdater() { calls.getUpdater(); throw new Error('unexpected GitHub updater') } } }))
vi.mock('./rpc', () => ({ emit: vi.fn() }))
vi.mock('./window', () => ({ getMainWindow: () => null }))

const originalMas = Object.getOwnPropertyDescriptor(process, 'mas')
afterEach(() => {
  if (originalMas) Object.defineProperty(process, 'mas', originalMas)
  else Reflect.deleteProperty(process, 'mas')
  vi.resetModules()
  vi.clearAllMocks()
})

describe('App Store updates', () => {
  it('never initializes the GitHub updater or opens its download page', async () => {
    Object.defineProperty(process, 'mas', { value: true, configurable: true })
    const updates = await import('./updates')
    updates.startUpdates()
    expect(updates.updateState()).toEqual({ status: 'unsupported', blocked: 'appStore' })
    expect(await updates.checkForUpdates()).toEqual({ status: 'unsupported', blocked: 'appStore' })
    updates.installUpdate()
    updates.openDownloadPage()
    expect(calls.getUpdater).not.toHaveBeenCalled()
    expect(calls.openExternal).not.toHaveBeenCalled()
    expect(calls.appOn).not.toHaveBeenCalled()
    expect(calls.powerOn).not.toHaveBeenCalled()
  })
})
