// A2-P2-14: saber si un archivo que empieza por «PK» es un docx, un pptx o un epub ya no lo lee entero en el proceso principal
// (el juez midió 1,9 GB de memoria con un archivo de 1,9 GB): solo se lee su final (el directorio central).
import { closeSync, ftruncateSync, openSync, writeSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { zipEntryNames } from './core/zipArchive'
import { detectKind } from './kind'
import { tempDir, type TempDir } from './testing/files'
import { docx, p } from './testing/office'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())

/** Archivo disperso de `size` bytes que empieza por `head` (no ocupa disco). */
function sparse(name: string, size: number, head: Uint8Array, tail?: Uint8Array): string {
  const path = tmp.write(name, new Uint8Array(0))
  const fd = openSync(path, 'r+')
  ftruncateSync(fd, size)
  writeSync(fd, head, 0, head.length, 0)
  if (tail) writeSync(fd, tail, 0, tail.length, size - tail.length)
  closeSync(fd)
  return path
}

describe('A2-P2-14 · detectKind no carga el archivo', () => {
  it('1,8 GB que empiezan por «PK» y no son un ZIP: responde enseguida', () => {
    const path = sparse('fake.zip', 1_800_000_000, new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
    const t0 = performance.now()
    const kind = detectKind(path)
    expect(performance.now() - t0).toBeLessThan(300)
    expect(['unknown', 'zip']).toContain(kind)
  })

  it('un docx con 1,8 GB de relleno delante (como un autoextraíble): se reconoce leyendo solo el final', () => {
    const real = docx({ body: p('Hola') })
    const path = sparse('big.docx', 1_800_000_000, new Uint8Array([0x50, 0x4b, 0x03, 0x04]), real)
    const t0 = performance.now()
    const names = zipEntryNames(path)
    expect(performance.now() - t0).toBeLessThan(300)
    expect(names).toContain('word/document.xml')
  })

  it('los de siempre se siguen reconociendo', () => {
    expect(detectKind(tmp.write('a.docx', docx({ body: p('Hola') })))).toBe('docx')
    expect(detectKind(tmp.write('sin-extension', docx({ body: p('Hola') })))).toBe('docx')
  })
})

describe('A2-P2-13 · tope del texto total de un documento', () => {
  it('un texto enorme se corta a 10 M de caracteres con aviso; uno normal no cambia', async () => {
    const { tidyDocument, TIDY_LIMITS } = await import('./pipeline')
    const page = (n: number, len: number) => ({ number: n, text: 'a'.repeat(len), usedOCR: false, hasFigures: false })
    const big = tidyDocument({ title: 't', kind: 'text', pages: [page(1, 6_000_000), page(2, 6_000_000), page(3, 10)], metadata: {}, warnings: [] }, 'x')
    expect(big.pages.reduce((n, p) => n + p.text.length, 0)).toBe(TIDY_LIMITS.maxTotalChars)
    expect(big.pages).toHaveLength(2)
    expect(big.warnings.join(' ')).toContain('demasiado largo')
    const ok = tidyDocument({ title: 't', kind: 'text', pages: [page(1, 1000)], metadata: {}, warnings: [] }, 'x')
    expect(ok.pages[0].text.length).toBe(1000)
    expect(ok.warnings).toEqual([])
  })
})
