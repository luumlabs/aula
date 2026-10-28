// Capturas de la interfaz de actualizaciones (Ajustes → Acerca de y el aviso de la barra lateral) en cada estado.
// La app de desarrollo no busca versiones: el estado se le manda desde el proceso principal como lo haría updates.ts.
//   npm run build && node scripts/dev/shots-updates.mjs <carpeta de salida> [carpeta del proyecto=.]
import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const out = resolve(process.argv[2] || 'shots-updates')
const project = resolve(process.argv[3] || '.')
mkdirSync(out, { recursive: true })

const notes = `<!-- lang:en -->
# Aula 0.1.1

A quick fix release.

## What's new
- **Updates on Mac** install themselves and reopen Aula.
- The chat shows what Aula is doing, step by step.

## Install
| System | Download |
| --- | --- |
<!-- lang:es -->
# Aula 0.1.1

Una versión de arreglos rápidos.

## Lo nuevo
- **Las actualizaciones en Mac** se instalan solas y vuelven a abrir Aula.
- El chat enseña lo que hace Aula, paso a paso.

## Instalar
| Sistema | Descarga |
| --- | --- |
`

const states = {
  descargando: { status: 'downloading', version: '0.1.1', progress: 0.42, notes },
  lista: { status: 'ready', version: '0.1.1', notes },
  'sin-conexion': { status: 'error', error: 'offline', errorStage: 'check' },
  'fallo-instalar': { status: 'error', error: 'install', errorStage: 'install', version: '0.1.1' },
  'firma-no-valida': { status: 'error', error: 'signature', errorStage: 'download', version: '0.1.1' },
  'mover-a-aplicaciones': { status: 'available', version: '0.1.1', blocked: 'translocated', notes },
  // A1-P1-3 / P1-6 / P2-18: el aviso «sin instalar» de la barra lateral y sus explicaciones
  'sin-instalar-firma': { status: 'available', version: '0.1.1', blocked: 'failedBefore', error: 'signature' },
  'solo-lectura': { status: 'available', version: '0.1.1', blocked: 'readOnly', notes },
  deb: { status: 'available', version: '0.1.1', blocked: 'package', notes },
  'macos-antiguo': { status: 'error', error: 'system', errorStage: 'download', version: '0.1.1' },
  'sin-conexion-descarga': { status: 'error', error: 'offline', errorStage: 'download', version: '0.1.1' },
  actualizada: { status: 'upToDate', updatedFrom: '0.1.0' }
}

for (const theme of ['light', 'dark']) {
  for (const lang of ['es', 'en']) {
    const home = mkdtempSync(join(tmpdir(), 'aula-upd-shots-'))
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: lang, name: 'Boris', theme } }))
    const app = await electron.launch({ args: [project, '--no-sandbox'], env: { ...process.env, AULA_HOME: home, AULA_DEMO: '1' } })
    const win = await app.firstWindow()
    await win.setViewportSize({ width: 1440, height: 900 })
    win.on('pageerror', (e) => console.error('[pageerror]', e.message))
    await win.waitForTimeout(1800)
    await win.evaluate(() => window.__aula.navigate({ name: 'settings' }))
    await win.waitForTimeout(1500)
    for (const [name, state] of Object.entries(states)) {
      if (lang === 'en' && !['lista', 'fallo-instalar', 'sin-instalar-firma', 'deb'].includes(name)) continue
      await app.evaluate(({ BrowserWindow }, s) => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('aula:event', 'updates.changed', s)
      }, state)
      await win.waitForTimeout(500)
      // la tarjeta «Acerca de» a la vista
      const card = win.locator('[data-settings-section="about"]').first()
      await card.scrollIntoViewIfNeeded()
      await win.waitForTimeout(500)
      await win.screenshot({ path: join(out, `${name}-${lang}-${theme}.png`) })
      if (name === 'lista' && lang === 'es') {
        const btn = win.getByRole('button', { name: lang === 'es' ? 'Notas de la versión' : 'What’s new', exact: true }).last()
        await btn.click()
        await win.waitForTimeout(700)
        await win.screenshot({ path: join(out, `novedades-${lang}-${theme}.png`) })
        await win.keyboard.press('Escape')
        await win.waitForTimeout(400)
      }
    }
    await app.close()
  }
}
console.log('capturas en', out)
