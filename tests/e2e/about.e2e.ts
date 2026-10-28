// A6-P1-4: Ajustes → Acerca de enseña los avisos legales de la AGPL (copyright, que es software libre sin garantía, cómo
// ver la licencia y dónde está el código de esta versión), en inglés y en español. No se pulsan los enlaces: abrirían
// programas del sistema; el proceso principal sí rechaza cualquier documento que no sea uno de los dos.
import { test, expect } from 'playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { go, launch } from './helpers'

function homeIn(language: 'en' | 'es'): string {
  const home = mkdtempSync(join(tmpdir(), 'aula-e2e-'))
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language, name: 'Maya' } }))
  return home
}

const TEXTS = {
  en: { license: /Free software: you can share and change it under the GNU AGPL v3\. It comes with absolutely no warranty\./, links: ['License', 'Source code', 'Third-party licenses'] },
  es: { license: /Software libre: puedes compartirlo y modificarlo con la licencia GNU AGPL v3\. No tiene ninguna garantía\./, links: ['Licencia', 'Código fuente', 'Licencias de terceros'] }
} as const

for (const lang of ['en', 'es'] as const) {
  test(`Acerca de: avisos legales (${lang})`, async () => {
    const { app, page } = await launch({ home: homeIn(lang) })
    try {
      await go(page, { name: 'settings' })
      const legal = page.getByTestId('about-legal')
      await legal.scrollIntoViewIfNeeded()
      await expect(legal).toContainText('Copyright © 2026 Luum Labs')
      await expect(legal).toContainText(TEXTS[lang].license)
      for (const name of TEXTS[lang].links) await expect(legal.getByRole('button', { name, exact: true })).toBeVisible()
      // solo los dos documentos: nada de rutas
      const refused = (await page.evaluate(`window.aula.invoke('app.openLicenses', { which: '../../etc/passwd' })`)) as { ok: boolean; error?: { message: string } }
      expect(refused.ok).toBe(false)
      expect(refused.error?.message).toMatch(/Aviso legal no válido/)
    } finally {
      await app.close()
    }
  })
}
