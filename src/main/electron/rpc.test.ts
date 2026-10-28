// El canal de las rutas soltadas o elegidas solo escucha al marco principal de la ventana de la app.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const listeners = new Map<string, (e: unknown, ...args: unknown[]) => void>()
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { on: (ch: string, fn: (e: unknown, ...args: unknown[]) => void) => listeners.set(ch, fn), handle: vi.fn() }
}))

let file = ''
beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'aula-rpc-'))
  const { setDataRoot } = await import('@main/services/paths')
  setDataRoot(join(base, 'Aula'))
  file = join(base, 'apuntes.pdf')
  writeFileSync(file, 'pdf')
})

function sender(id: number) {
  const mainFrame = { processId: 1, routingId: 7, url: 'app://aula/index.html' }
  return { id, mainFrame, once: vi.fn() }
}

describe('aula:file-grant', () => {
  it('apunta la ruta solo si viene de la ventana de la app (y no de un iframe ni de otra ventana)', async () => {
    const { installRpc, trustWebContents, setTrustedPage } = await import('./rpc')
    const { userFiles } = await import('@main/services/userFiles')
    const { FILE_GRANT_CHANNEL } = await import('@shared/ipc/contract')
    installRpc()
    setTrustedPage((url) => url.startsWith('app://aula/'))
    const grant = listeners.get(FILE_GRANT_CHANNEL)!
    const app = sender(1)
    trustWebContents(app as never)
    const call = (e: Record<string, unknown>) => { grant(e, file); return e.returnValue }

    expect(call({ sender: sender(2), senderFrame: sender(2).mainFrame })).toBe(false) // otra ventana (navegador de plataformas, impresión)
    expect(call({ sender: app, senderFrame: { processId: 1, routingId: 9, url: 'app://aula/index.html' } })).toBe(false) // un iframe
    expect(userFiles.allows(file)).toBe(false)
    expect(call({ sender: app, senderFrame: app.mainFrame })).toBe(true)
    expect(userFiles.allows(file)).toBe(true)
    expect(() => userFiles.check([file])).not.toThrow()
  })
})
