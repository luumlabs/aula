import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { figureAssetName, loadFigureAssets } from './render-assets'
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'aula-figure-assets-')); mkdirSync(join(root, 'assets')); writeFileSync(join(root, 'figure-render.html'), '<html></html>'); writeFileSync(join(root, 'assets', 'scene.js'), 'void 0') })
afterEach(() => rmSync(root, { force: true, recursive: true }))
function manifest(files: string[]): void { writeFileSync(join(root, 'figure-render-assets.json'), JSON.stringify({ version: 1, files })) }
describe('allowlist de recursos empaquetados', () => {
  it('sólo enumera la entrada y sus recursos con MIME cerrado', async () => {
    manifest(['figure-render.html', 'assets/scene.js'])
    const files = await loadFigureAssets(root)
    expect([...files.keys()]).toEqual(['figure-render.html', 'assets/scene.js'])
    expect(files.get('assets/scene.js')?.mime).toBe('text/javascript; charset=utf-8')
    expect(files.has('index.html')).toBe(false)
  })
  it.each(['file:///private', 'app://elsewhere/figure-render.html', 'app://user@aula/figure-render.html', 'app://aula:99/figure-render.html', 'app://aula/figure-render.html?path=secret', 'app://aula/assets/%2fetc', 'app://aula/assets/scene.js#x'])('niega dirección no canónica %s', url => {
    expect(figureAssetName(url)).toBeNull()
  })
  it('un manifiesto no autoriza otras páginas, tipos, rutas ni enlaces fuera del root', async () => {
    for (const extra of ['index.html', 'assets/data.json', '../secret.js', 'assets/../figure-render.html']) {
      manifest(['figure-render.html', extra]); await expect(loadFigureAssets(root)).rejects.toThrow()
    }
    const outside = mkdtempSync(join(tmpdir(), 'aula-figure-outside-'))
    try {
      writeFileSync(join(outside, 'secret.js'), 'secret')
      symlinkSync(join(outside, 'secret.js'), join(root, 'assets', 'outside.js'))
      manifest(['figure-render.html', 'assets/outside.js'])
      await expect(loadFigureAssets(root)).rejects.toThrow('Invalid figure asset path')
    } finally { rmSync(outside, { force: true, recursive: true }) }
  })
})
