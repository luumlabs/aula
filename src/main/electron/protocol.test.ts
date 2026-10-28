// aula-asset:// nunca sale de assets/ y sources/ de un curso (ni de la carpeta de documentos).
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({ net: { fetch: vi.fn() }, protocol: { handle: vi.fn() } }))

let root = ''
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'aula-proto-'))
  const { setDataRoot } = await import('@main/services/paths')
  setDataRoot(root)
  mkdirSync(join(root, 'Packs', 'curso', 'assets'), { recursive: true })
  mkdirSync(join(root, 'Packs', 'curso', 'sources', 's1'), { recursive: true })
  writeFileSync(join(root, 'Packs', 'curso', 'assets', 'fig.png'), 'x')
  writeFileSync(join(root, 'settings.json'), '{}')
  symlinkSync(join(root, 'settings.json'), join(root, 'Packs', 'curso', 'assets', 'trampa.png'))
})

describe('resolveAssetUrl', () => {
  it('sirve recursos y materiales del curso', async () => {
    const { resolveAssetUrl } = await import('./protocol')
    expect(resolveAssetUrl('aula-asset://pack/curso/fig.png')).toMatch(/Packs[\\/]curso[\\/]assets[\\/]fig\.png$/)
    expect(resolveAssetUrl('aula-asset://pack/curso/assets/fig.png')).toMatch(/assets[\\/]fig\.png$/)
    expect(resolveAssetUrl('aula-asset://pack/curso/sources/s1/chunks.json')).toMatch(/sources[\\/]s1[\\/]chunks\.json$/)
    // una ruta antigua con carpeta: el recurso por su nombre
    expect(resolveAssetUrl('aula-asset://pack/curso/images/fig.png')).toMatch(/assets[\\/]fig\.png$/)
  })
  it('no sale de la carpeta del curso', async () => {
    const { resolveAssetUrl } = await import('./protocol')
    for (const url of [
      'aula-asset://pack/..%2Fsettings.json',
      'aula-asset://pack/../settings.json',
      'aula-asset://pack/curso/..%2F..%2Fsettings.json',
      'aula-asset://pack/curso/assets/..%2F..%2F..%2Fsettings.json',
      'aula-asset://pack/%2E%2E/settings.json',
      'aula-asset://pack/curso/sources/..%5C..%5Csettings.json',
      'aula-asset://other/settings.json'
    ])
      expect(resolveAssetUrl(url), url).toBeNull()
    // pack.json y progress.json no son recursos: se buscan (y no existen) en assets/
    expect(resolveAssetUrl('aula-asset://pack/curso/progress.json')).toMatch(/assets[\\/]progress\.json$/)
  })
  it('un enlace simbólico que apunta fuera no se sigue', async () => {
    const { resolveAssetUrl } = await import('./protocol')
    expect(resolveAssetUrl('aula-asset://pack/curso/assets/trampa.png')).toBeNull()
  })
})

// J3-2: la interfaz va por app://aula y solo sirve out/renderer (nada del disco fuera de esa carpeta).
describe('resolveAppUrl', () => {
  it('sirve las páginas y recursos de la interfaz', async () => {
    const { resolveAppUrl } = await import('./protocol')
    const r = join(root, 'renderer')
    expect(resolveAppUrl('app://aula/index.html?demo=1#x', r)).toBe(join(r, 'index.html'))
    expect(resolveAppUrl('app://aula/', r)).toBe(join(r, 'index.html'))
    expect(resolveAppUrl('app://aula/assets/pdf.worker-abc.mjs', r)).toBe(join(r, 'assets', 'pdf.worker-abc.mjs'))
    expect(resolveAppUrl('app://aula/assets/KaTeX_Main-Regular.woff2', r)).toBe(join(r, 'assets', 'KaTeX_Main-Regular.woff2'))
  })
  it('no sale de la carpeta de la interfaz ni acepta otros hosts o esquemas', async () => {
    const { resolveAppUrl } = await import('./protocol')
    const r = join(root, 'renderer')
    for (const url of [
      'app://aula/..%2Fsettings.json', 'app://aula/assets/..%2F..%2Fsettings.json',
      'app://aula/assets/..%5C..%5Csettings.json', 'app://aula/C:%5CWindows',
      'app://otro/index.html', 'app://aula:8080/index.html', 'app://u:p@aula/index.html', 'file:///etc/hosts',
      'aula-asset://pack/curso/fig.png', 'app://aula/%00', 'nada'
    ]) {
      expect(resolveAppUrl(url, r), url).toBeNull()
    }
    // «..» sin codificar lo resuelve el propio analizador de URL: se queda dentro
    expect(resolveAppUrl('app://aula/../../settings.json', r)).toBe(join(r, 'settings.json'))
    expect(resolveAppUrl('app://aula/%2E%2E/settings.json', r)).toBe(join(r, 'settings.json'))
  })
  it('tipos MIME correctos para módulos, fuentes y wasm (los exige Chromium)', async () => {
    const { mimeFor } = await import('./protocol')
    expect(mimeFor('a/pdf.worker.mjs')).toMatch(/^text\/javascript/)
    expect(mimeFor('a/index.js')).toMatch(/^text\/javascript/)
    expect(mimeFor('a/x.woff2')).toBe('font/woff2')
    expect(mimeFor('a/x.wasm')).toBe('application/wasm')
    expect(mimeFor('a/index.html')).toMatch(/^text\/html/)
    expect(mimeFor('a/raro.xyz')).toBe('application/octet-stream')
  })
  it('la CSP de las páginas no admite file: ni orígenes remotos', async () => {
    const { APP_CSP } = await import('./protocol')
    expect(APP_CSP).not.toMatch(/file:|https?:|\*/)
    expect(APP_CSP).toContain("frame-ancestors 'none'")
    expect(APP_CSP).toContain("connect-src 'self' aula-asset: data: blob:")
  })
})
