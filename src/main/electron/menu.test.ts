// A6-P1-4: el panel «Acerca de» de macOS lleva el copyright y el aviso de la licencia, en el idioma del menú. Y Ayuda →
// «Apoyar a Aula…» lleva a Ajustes → Acerca de, sin abrir la web.
import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'

const { emit, shell } = vi.hoisted(() => ({ emit: vi.fn(), shell: { openExternal: vi.fn(), openPath: vi.fn() } }))
vi.mock('electron', () => ({ app: {}, Menu: {}, shell }))
vi.mock('@main/services/settings', () => ({ getSettings: () => ({ general: { language: 'en' } }), onSettingsChange: () => undefined }))
vi.mock('./rpc', () => ({ emit }))
vi.mock('./window', () => ({ getMainWindow: () => null }))
vi.mock('./visibility', () => ({ reveal: () => undefined }))

describe('menú de la app', () => {
  it('en macOS lleva los Servicios del sistema (sobre el texto seleccionado); en Windows y Linux no hay menú Aula', async () => {
    const { buildMenuTemplate } = await import('./menu')
    const appMenu = (platform: NodeJS.Platform, lang: 'es' | 'en') => {
      const first = buildMenuTemplate(lang, platform, false)[0]
      return Array.isArray(first.submenu) ? first.submenu : []
    }
    expect(appMenu('darwin', 'es').find((i) => i.role === 'services')?.label).toBe('Servicios')
    expect(appMenu('darwin', 'en').find((i) => i.role === 'services')?.label).toBe('Services')
    for (const platform of ['win32', 'linux'] as const) {
      const all = buildMenuTemplate('es', platform, false).flatMap((m) => (Array.isArray(m.submenu) ? m.submenu : []))
      expect(all.some((i) => i.role === 'services')).toBe(false)
    }
  })
})

describe('panel Acerca de (A6-P1-4)', () => {
  it('copyright, AGPL v3 y sin garantía, en inglés y en español', async () => {
    const { aboutCopyright } = await import('./menu')
    expect(aboutCopyright('en')).toBe('Copyright © 2026 Luum Labs\nFree software under the GNU AGPL v3 · No warranty')
    expect(aboutCopyright('es')).toBe('Copyright © 2026 Luum Labs\nSoftware libre con la licencia GNU AGPL v3 · Sin ninguna garantía')
  })
})

describe('Ayuda → «Apoyar a Aula…»', () => {
  it('en cada sistema e idioma, lo último del menú Ayuda; lleva a la sección de la app, no a la web', async () => {
    const { buildMenuTemplate } = await import('./menu')
    const labels = { es: 'Apoyar a Aula…', en: 'Support Aula…' } as const
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      for (const lang of ['es', 'en'] as const) {
        const help = buildMenuTemplate(lang, platform, false).find((m) => m.role === 'help')
        const items: MenuItemConstructorOptions[] = Array.isArray(help?.submenu) ? help.submenu : []
        const item = items.at(-1)
        expect(item?.label).toBe(labels[lang])
        expect(items.at(-2)?.type).toBe('separator')
        emit.mockClear()
        shell.openExternal.mockClear()
        item?.click?.({} as never, undefined, {} as never)
        expect(emit).toHaveBeenCalledWith('app.command', { command: 'support' })
        expect(shell.openExternal).not.toHaveBeenCalled()
      }
    }
  })
})
