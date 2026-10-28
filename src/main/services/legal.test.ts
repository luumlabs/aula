// A6-P1-4 / A6-P2-11: los avisos legales que lleva la app (dónde están y qué dice el resumen de licencias).
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { legalFallbackURL, legalFilePath } from './legal'
import { AULA_COPYRIGHT, isLegalDoc, sourceCodeURL } from '@shared/legal'
import { AULA_NOTICE, renderLicenses, withoutCopyrightLines } from '../../../scripts/build/third-party-licenses'

describe('documentos legales de la app (A6-P1-4)', () => {
  const ctx = { resourcesPath: '/App/Contents/Resources', appPath: '/proyecto' }
  it('empaquetada, todos en Resources; en desarrollo, la licencia en la raíz y el resumen de terceros en out/', () => {
    expect(legalFilePath('aula', { ...ctx, isPackaged: true })).toBe(join('/App/Contents/Resources', 'LICENSE.md'))
    expect(legalFilePath('third-party', { ...ctx, isPackaged: true })).toBe(join('/App/Contents/Resources', 'THIRD_PARTY_LICENSES.txt'))
    expect(legalFilePath('aula', { ...ctx, isPackaged: false })).toBe(join('/proyecto', 'LICENSE.md'))
    expect(legalFilePath('third-party', { ...ctx, isPackaged: false })).toBe(join('/proyecto', 'out', 'THIRD_PARTY_LICENSES.txt'))
  })
  it('la licencia de Aula tiene copia en la web por si el sistema no sabe abrir un .md; la de terceros no', () => {
    expect(legalFallbackURL('aula')).toBe('https://www.gnu.org/licenses/agpl-3.0.html')
    expect(legalFallbackURL('third-party')).toBeUndefined()
  })
  it('solo se aceptan los dos documentos', () => {
    expect(isLegalDoc('aula')).toBe(true)
    expect(isLegalDoc('third-party')).toBe(true)
    for (const x of ['', 'LICENSE.md', '../etc/passwd', undefined, null, 1, {}]) expect(isLegalDoc(x)).toBe(false)
  })
  it('el código de esta versión es su etiqueta; una versión rara lleva al repositorio', () => {
    expect(sourceCodeURL('0.1.0')).toBe('https://github.com/luumlabs/aula/tree/v0.1.0')
    expect(sourceCodeURL('0.2.0-beta.1')).toBe('https://github.com/luumlabs/aula/tree/v0.2.0-beta.1')
    expect(sourceCodeURL('')).toBe('https://github.com/luumlabs/aula')
    expect(sourceCodeURL('../x')).toBe('https://github.com/luumlabs/aula')
  })
})

describe('THIRD_PARTY_LICENSES.txt', () => {
  const pkg = (o: Partial<Parameters<typeof renderLicenses>[0][number]>) => ({ name: 'p', version: '1.0.0', license: 'MIT', text: 'MIT text', source: 'file' as const, ...o })

  it('empieza por la licencia de la propia Aula: copyright, AGPL v3, sin garantía, LICENSE.md, NOTICE.md y el código (A6-P1-4)', () => {
    const out = renderLicenses([pkg({})])
    expect(out.startsWith(AULA_NOTICE)).toBe(true)
    expect(AULA_NOTICE).toContain(AULA_COPYRIGHT)
    expect(AULA_NOTICE).toMatch(/GNU Affero General Public\s+License, version 3 only/)
    expect(AULA_NOTICE).toMatch(/ABSOLUTELY\s+NO WARRANTY/)
    expect(AULA_NOTICE).toMatch(/LICENSE\.md/)
    expect(AULA_NOTICE).toMatch(/NOTICE\.md/)
    expect(AULA_NOTICE).toContain('https://github.com/luumlabs/aula')
  })

  it('un paquete sin texto toma el estándar de su licencia SIN el copyright de otro, con el suyo si lo hay (A6-P2-11)', () => {
    const readability = pkg({ name: '@mozilla/readability', license: 'Apache-2.0', text: 'Copyright (c) 2010 Arc90 Inc\n\nLicensed under the Apache License, Version 2.0' })
    const full = pkg({ name: 'pdfjs-dist', license: 'Apache-2.0', text: 'Apache License\nVersion 2.0, January 2004\nTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION' })
    const mediapipe = pkg({ name: '@mediapipe/tasks-vision', license: 'Apache-2.0', text: 'Apache-2.0 — https://spdx.org/licenses/Apache-2.0.html', source: 'missing', author: 'mediapipe@google.com' })
    const other = pkg({ name: 'a-missing', license: 'Apache-2.0', text: 'Apache-2.0', source: 'missing', author: 'Ana <ana@x.dev>' })
    const out = renderLicenses([readability, full, mediapipe, other])
    const section = (name: string, next: string) => { const s = out.slice(out.indexOf(`${name} 1.0.0 · Apache-2.0`)); return s.slice(0, s.indexOf(next)) }
    const mp = section('@mediapipe/tasks-vision', '@mozilla/readability 1.0.0')
    // el texto completo (el más largo), no el aviso corto de readability, y sin su «Arc90»
    expect(mp).toMatch(/TERMS AND CONDITIONS/)
    expect(mp).not.toMatch(/Arc90/)
    expect(mp).toMatch(/Copyright The MediaPipe Authors\./)
    expect(section('a-missing', 'pdfjs-dist 1.0.0')).toMatch(/Copyright: Ana <ana@x\.dev> \(from its package\.json\)/)
    expect(withoutCopyrightLines('Copyright (c) X\n(c) Y\n© Z\nThe text')).toBe('The text')
  })

  it('tesseract.js-core lleva los avisos de lo que va compilado en su WebAssembly (Leptonica y compañía, A6-P2-11)', () => {
    const out = renderLicenses([pkg({ name: 'tesseract.js-core', license: 'Apache-2.0', text: 'Apache License 2.0' })])
    for (const lib of ['Leptonica (BSD-2-Clause)', 'Independent JPEG Group', 'Sam Leffler', 'libwebp (BSD-3-Clause)', 'giflib', 'zlib']) expect(out).toContain(lib)
    // una sola vez aunque el paquete salga en dos compilaciones
    expect(renderLicenses([pkg({ name: 'tesseract.js-core', license: 'Apache-2.0', text: 'Apache' }), pkg({ name: 'tesseract.js-core', license: 'Apache-2.0', text: 'Apache' })]).match(/Libraries compiled into this package/g)).toHaveLength(1)
  })
})
