// Pruebas de `.aulapack` (port de PackZipTests de la app Swift anterior: Tests/StudyModelTests): ida y vuelta y archivos hostiles.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import { extractZip, PackZipError, zipDirectory } from './packZip'

let tmp: string
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'packzip-')) })
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const FILES = ['pack.json', 'skills/seno.json', 'skills/binario.bin', 'skills/acentos-ñ.txt']

function makeFolder(): string {
  const dir = join(tmp, 'curso')
  mkdirSync(join(dir, 'skills'), { recursive: true })
  writeFileSync(join(dir, 'pack.json'), '{"id":"curso","title":"Trigonometría"}')
  writeFileSync(join(dir, 'skills/seno.json'), 'seno coseno tangente '.repeat(4000))
  writeFileSync(join(dir, 'skills/binario.bin'), Buffer.from([0, 1, 2, 3, 255]))
  writeFileSync(join(dir, 'skills/acentos-ñ.txt'), 'ñandú — 数学')
  return dir
}

function expectSameContents(a: string, b: string): void {
  for (const rel of FILES) expect(readFileSync(join(b, rel)), rel).toEqual(readFileSync(join(a, rel)))
}

/** ZIP mínimo hecho a mano (método «stored») con un nombre de entrada dado (como `storedZip` de las pruebas de Swift). */
function storedZip(name: string, content: Buffer): Buffer {
  const le16 = (v: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff); return b }
  const le32 = (v: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b }
  const n = Buffer.from(name, 'utf8')
  const local = Buffer.concat([le32(0x04034b50), le16(20), le16(0x800), le16(0), le16(0), le16(0), le32(0), le32(content.length), le32(content.length), le16(n.length), le16(0), n, content])
  const central = Buffer.concat([
    le32(0x02014b50), le16(20), le16(20), le16(0x800), le16(0), le16(0), le16(0), le32(0), le32(content.length), le32(content.length),
    le16(n.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(0), n
  ])
  const eocd = Buffer.concat([le32(0x06054b50), le16(0), le16(0), le16(1), le16(1), le32(central.length), le32(local.length), le16(0)])
  return Buffer.concat([local, central, eocd])
}

describe('PackZip', () => {
  it('comprime con la carpeta como raíz y se extrae igual', async () => {
    const dir = makeFolder()
    const zip = join(tmp, 'coordinado.aulapack')
    await zipDirectory(dir, zip)
    const names = Object.keys((await JSZip.loadAsync(readFileSync(zip))).files)
    expect(names).toContain('curso/pack.json')
    expect(names).toContain('curso/skills/acentos-ñ.txt')
    const out = join(tmp, 'out')
    mkdirSync(out)
    await extractZip(zip, out)
    expectSameContents(dir, join(out, 'curso'))
  })

  it('el filtro decide qué entra', async () => {
    const dir = makeFolder()
    const zip = join(tmp, 'filtrado.aulapack')
    await zipDirectory(dir, zip, (rel) => !rel.endsWith('.bin'))
    const names = Object.keys((await JSZip.loadAsync(readFileSync(zip))).files)
    expect(names.some((n) => n.endsWith('.bin'))).toBe(false)
    expect(names).toContain('curso/skills/seno.json')
  })

  it('rechaza las rutas que salen de la carpeta («zip slip»)', async () => {
    for (const evil of ['../fuera.txt', 'curso/../../fuera.txt', '/etc/fuera.txt', 'C:/fuera.txt', 'curso\\..\\fuera.txt']) {
      const zip = join(tmp, 'malo.zip')
      writeFileSync(zip, storedZip(evil, Buffer.from('x')))
      const out = join(tmp, `o-${Math.random().toString(36).slice(2)}`)
      mkdirSync(out)
      await expect(extractZip(zip, out), evil).rejects.toBeInstanceOf(PackZipError)
      expect(existsSync(join(tmp, 'fuera.txt'))).toBe(false)
      expect(readdirSync(out), evil).toEqual([]) // no se escribe nada
    }
    // y un nombre normal sí entra
    const ok = join(tmp, 'bueno.zip')
    writeFileSync(ok, storedZip('curso/pack.json', Buffer.from('{}')))
    const out = join(tmp, 'ok')
    mkdirSync(out)
    await extractZip(ok, out)
    expect(readFileSync(join(out, 'curso/pack.json'), 'utf8')).toBe('{}')
  })

  it('rechaza lo que no es un ZIP', async () => {
    const f = join(tmp, 'no.aulapack')
    writeFileSync(f, 'hola')
    await expect(extractZip(f, tmp)).rejects.toMatchObject({ code: 'not_zip' })
  })

  it('con la interfaz en inglés, el error de «no es un ZIP» sale en inglés', async () => {
    const f = join(tmp, 'no.aulapack')
    writeFileSync(f, 'hola')
    setAILocale('en')
    try {
      const err = await extractZip(f, tmp).catch((e: unknown) => e as PackZipError)
      expect(err).toMatchObject({ code: 'not_zip' })
      expect((err as PackZipError).message).toMatch(/^The file isn’t a valid Aula course \(it isn’t a ZIP\)/)
    } finally {
      setAILocale('es')
    }
    const again = await extractZip(f, tmp).catch((e: unknown) => e as PackZipError)
    expect((again as PackZipError).message).toMatch(/^El archivo no es un curso de Aula válido/)
  })

  it('salta la basura de macOS y respeta los límites', async () => {
    const zip = new JSZip()
    zip.file('curso/pack.json', '{}')
    zip.file('__MACOSX/curso/._pack.json', 'x')
    zip.file('curso/.DS_Store', 'x')
    const f = join(tmp, 'mac.zip')
    writeFileSync(f, await zip.generateAsync({ type: 'nodebuffer' }))
    const out = join(tmp, 'mac')
    mkdirSync(out)
    await extractZip(f, out)
    expect(readdirSync(out)).toEqual(['curso'])
    expect(readdirSync(join(out, 'curso'))).toEqual(['pack.json'])
    // demasiadas entradas o demasiados bytes
    const out2 = join(tmp, 'lim')
    mkdirSync(out2)
    await expect(extractZip(f, out2, { maxEntries: 1, maxTotalBytes: 1e9 })).rejects.toMatchObject({ code: 'too_large' })
    const big = new JSZip()
    big.file('curso/grande.txt', 'a'.repeat(10_000))
    const fb = join(tmp, 'grande.zip')
    writeFileSync(fb, await big.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
    await expect(extractZip(fb, out2, { maxEntries: 100, maxTotalBytes: 1000 })).rejects.toMatchObject({ code: 'too_large' })
  })

  it('una bomba ZIP que miente en su tamaño se corta al descomprimir', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aula-bomb-'))
    const bomb = new JSZip()
    bomb.file('curso/pack.json', '{}')
    bomb.file('curso/ceros.bin', new Uint8Array(8 * 1024 * 1024))
    const buf = Buffer.from(await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
    // las cabeceras dicen 100 bytes (local: +22, central: +24)
    for (let i = 0; i < buf.length - 4; i++) {
      const sig = buf.readUInt32LE(i)
      if (sig === 0x04034b50 && buf.readUInt32LE(i + 22) === 8 * 1024 * 1024) buf.writeUInt32LE(100, i + 22)
      if (sig === 0x02014b50 && buf.readUInt32LE(i + 24) === 8 * 1024 * 1024) buf.writeUInt32LE(100, i + 24)
    }
    const f = join(tmp, 'bomba.aulapack')
    writeFileSync(f, buf)
    const out = join(tmp, 'out')
    mkdirSync(out)
    await expect(extractZip(f, out, { maxEntries: 100, maxTotalBytes: 256 * 1024 })).rejects.toMatchObject({ code: 'too_large' })
    rmSync(tmp, { recursive: true, force: true })
  })
})
