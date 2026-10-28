// A6-P1-4: el panel «Acerca de» de macOS lleva el copyright y el aviso de la licencia, en el idioma del menú.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, Menu: {}, shell: {} }))
vi.mock('@main/services/settings', () => ({ getSettings: () => ({ general: { language: 'en' } }), onSettingsChange: () => undefined }))
vi.mock('./rpc', () => ({ emit: () => undefined }))
vi.mock('./window', () => ({ getMainWindow: () => null }))
vi.mock('./visibility', () => ({ reveal: () => undefined }))

describe('panel Acerca de (A6-P1-4)', () => {
  it('copyright, AGPL v3 y sin garantía, en inglés y en español', async () => {
    const { aboutCopyright } = await import('./menu')
    expect(aboutCopyright('en')).toBe('Copyright © 2026 Luum Labs\nFree software under the GNU AGPL v3 · No warranty')
    expect(aboutCopyright('es')).toBe('Copyright © 2026 Luum Labs\nSoftware libre con la licencia GNU AGPL v3 · Sin ninguna garantía')
  })
})
