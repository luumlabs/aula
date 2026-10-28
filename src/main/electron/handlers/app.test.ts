// A6-P1-4: «Licencia» y «Licencias de terceros» de Ajustes → Acerca de abren el documento que va con la app; si el
// sistema no sabe abrir el .md (Windows sin programa), la licencia de Aula se abre en la web. Nada más se acepta.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const handlers = new Map<string, (args: unknown) => unknown>()
const openPath = vi.fn<(p: string) => Promise<string>>()
const openExternal = vi.fn<(u: string) => Promise<void>>()
const appRoot = mkdtempSync(join(tmpdir(), 'aula-legal-'))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => appRoot, getName: () => 'Aula', getVersion: () => '0.1.0', getLocale: () => 'en' },
  nativeTheme: {},
  Notification: { isSupported: () => false },
  shell: { openPath: (p: string) => openPath(p), openExternal: (u: string) => openExternal(u), showItemInFolder: vi.fn() }
}))
vi.mock('../rpc', () => ({ handle: (m: string, fn: (args: unknown) => unknown) => handlers.set(m, fn) }))
vi.mock('../window', () => ({ getMainWindow: () => null }))
vi.mock('../secrets', () => ({ secretProtection: () => 'os' }))

beforeEach(async () => {
  openPath.mockReset()
  openExternal.mockReset()
  if (!handlers.size) (await import('./app')).register()
})

const open = (args: unknown) => handlers.get('app.openLicenses')!(args) as Promise<void>

describe('app.openLicenses (A6-P1-4)', () => {
  it('abre la licencia de Aula (LICENSE.md) y el resumen de terceros (out/THIRD_PARTY_LICENSES.txt) en desarrollo', async () => {
    writeFileSync(join(appRoot, 'LICENSE.md'), 'GNU AFFERO GENERAL PUBLIC LICENSE')
    mkdirSync(join(appRoot, 'out'), { recursive: true })
    writeFileSync(join(appRoot, 'out', 'THIRD_PARTY_LICENSES.txt'), 'Aula — Copyright')
    openPath.mockResolvedValue('')
    await open({ which: 'aula' })
    await open({ which: 'third-party' })
    expect(openPath.mock.calls.map((c) => c[0])).toEqual([join(appRoot, 'LICENSE.md'), join(appRoot, 'out', 'THIRD_PARTY_LICENSES.txt')])
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('si el sistema no puede abrir la licencia, la abre en la web; el resumen de terceros da error', async () => {
    writeFileSync(join(appRoot, 'LICENSE.md'), 'GNU AFFERO GENERAL PUBLIC LICENSE')
    openPath.mockResolvedValue('No application is associated with the specified file')
    await open({ which: 'aula' })
    expect(openExternal).toHaveBeenCalledWith('https://www.gnu.org/licenses/agpl-3.0.html')
    await expect(open({ which: 'third-party' })).rejects.toThrow(/No application/)
  })

  it('rechaza cualquier otra cosa (ni rutas ni nombres de archivo)', async () => {
    for (const bad of [undefined, {}, { which: 'LICENSE.md' }, { which: '../../etc/passwd' }, { which: 1 }]) {
      await expect(open(bad)).rejects.toThrow(/Aviso legal no válido/)
    }
    expect(openPath).not.toHaveBeenCalled()
  })
})
