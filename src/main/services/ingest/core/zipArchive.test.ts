import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isIngestError, type IngestErrorKind } from '../errors'
import { PartName } from '../extract/ooxml'
import { readDocument } from '../pipeline'
import { tempDir, type TempDir } from '../testing/files'
import { docx, listP, p, pptx, sp, xlsx } from '../testing/office'
import { bytes, ZipForge, type ForgeEntry } from '../testing/zipForge'
import { ZipArchive, zipLimits } from './zipArchive'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())

const text = (d: Uint8Array | null): string | undefined => (d ? Buffer.from(d).toString('utf8') : undefined)
const limits = (entries = 5_000, total = 200 * 1024 * 1024) => zipLimits(entries, total)
function throwsKind(fn: () => unknown, kind: IngestErrorKind): void {
  let error: unknown = null
  try { fn() } catch (e) { error = e }
  expect(isIngestError(error, kind), String(error)).toBe(true)
}
const forgeWith = (...entries: ForgeEntry[]): ZipForge => { const f = new ZipForge(); f.entries.push(...entries); return f }

function indexOf(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer
    return i
  }
  return -1
}

/** Rehace el paquete con entradas «stored» y cambia textos por otros de la misma longitud (el CRC queda viejo). */
function corrupting(pkg: Uint8Array, changes: Array<[string, string]>): Uint8Array {
  const source = new ZipArchive(pkg)
  const forge = new ZipForge()
  for (const name of source.fileNames) forge.add(name, source.read(name) as Uint8Array, 'stored')
  const data = forge.build()
  for (const [needle, replacement] of changes) {
    expect(Buffer.byteLength(needle)).toBe(Buffer.byteLength(replacement))
    const at = indexOf(data, bytes(needle))
    expect(at, `no está «${needle}»`).toBeGreaterThanOrEqual(0)
    data.set(bytes(replacement), at)
  }
  return data
}

describe('ZipArchive: lectura', () => {
  it('lee un ZIP hecho por otra herramienta (JSZip)', async () => {
    const big = new Uint8Array(100_000).fill(0x41)
    const z = new JSZip()
    z.file('a.txt', 'Hola ñandú')
    z.file('dir/b.txt', big)
    z.file('dir/sub/c.bin', new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 251)))
    const data = await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const zip = ZipArchive.open(tmp.write('out.zip', data))
    expect(new Set(zip.fileNames)).toEqual(new Set(['a.txt', 'dir/b.txt', 'dir/sub/c.bin']))
    expect(text(zip.read('a.txt'))).toBe('Hola ñandú')
    expect(Buffer.from(zip.read('dir/b.txt') as Uint8Array).equals(Buffer.from(big))).toBe(true)
    expect(zip.read('dir/sub/c.bin')?.length).toBe(300)
    expect(zip.read('no-existe.txt')).toBeNull()
  })

  it('stored, deflate y vacío', () => {
    const f = new ZipForge().add('stored.txt', 'sin comprimir', 'stored').add('deflated.txt', 'abc '.repeat(5000)).add('vacio.txt', '')
    const zip = new ZipArchive(f.build())
    expect(text(zip.read('stored.txt'))).toBe('sin comprimir')
    expect(zip.read('deflated.txt')?.length).toBe(20_000)
    expect(zip.read('vacio.txt')?.length).toBe(0)
  })

  it('nombres normalizados y sin distinguir mayúsculas', () => {
    const zip = new ZipArchive(new ZipForge().add('Word\\Document.XML', 'x').add('/inicio/slash.txt', 'y').build())
    expect(zip.entry('word/document.xml')).not.toBeNull()
    expect(zip.entry('Word/Document.XML')).not.toBeNull()
    expect(zip.entry('inicio/slash.txt')).not.toBeNull()
    expect(zip.entry('./inicio/slash.txt')).not.toBeNull()
  })

  it('nombres UTF-8, carpetas, prefijos y ZIP64', () => {
    expect(text(new ZipArchive(forgeWith({ name: 'capítulo-ñ.txt', data: bytes('ok'), flags: 0x800 }).build()).read('capítulo-ñ.txt'))).toBe('ok')
    const dirs = new ZipArchive(new ZipForge().add('carpeta/', new Uint8Array(), 'stored').add('carpeta/a.txt', 'a').build())
    expect(dirs.fileNames).toEqual(['carpeta/a.txt'])
    expect(dirs.entry('carpeta/')).toBeNull()
    const inner = new ZipForge({ 'a.txt': 'dentro de un trozo' }).build()
    const padded = new Uint8Array(10 + inner.length)
    padded.set(inner, 10)
    expect(text(new ZipArchive(padded.subarray(10)).read('a.txt'))).toBe('dentro de un trozo')
    const sfx = new ZipForge({ 'a.txt': 'con prefijo' })
    sfx.prefix = new Uint8Array(3000).fill(0x90)
    expect(text(new ZipArchive(sfx.build()).read('a.txt'))).toBe('con prefijo')
    const z64 = new ZipForge({ 'a.txt': 'zip64 funciona', 'b/c.txt': 'z'.repeat(9000) })
    z64.useZip64 = true
    const zip = new ZipArchive(z64.build())
    expect(text(zip.read('a.txt'))).toBe('zip64 funciona')
    expect(zip.read('b/c.txt')?.length).toBe(9000)
  })

  it('lectura de un prefijo', () => {
    const big = 'línea de relleno\n'.repeat(50_000)
    const zip = new ZipArchive(new ZipForge().add('grande.txt', big).add('grande-stored.txt', big, 'stored').build())
    const a = zip.readPrefix('grande.txt', 1000)
    expect(a?.data.length).toBe(1000)
    expect(a?.truncated).toBe(true)
    expect(text(a?.data ?? null)?.slice(0, 15)).toBe('línea de rellen')
    const b = zip.readPrefix('grande-stored.txt', 500)
    expect(b?.data.length).toBe(500)
    expect(b?.truncated).toBe(true)
    const c = zip.readPrefix('grande.txt', 100_000_000)
    expect(c?.truncated).toBe(false)
    expect(c?.data.length).toBe(Buffer.byteLength(big))
  })
})

describe('ZipArchive: límites (bombas zip)', () => {
  it('demasiadas entradas', () => {
    const f = new ZipForge()
    for (let i = 0; i < 60; i++) f.add(`f${i}.txt`, 'x')
    let msg = ''
    try { new ZipArchive(f.build(), limits(50)) } catch (e) { msg = (e as Error).message; expect(isIngestError(e, 'archiveLimit')).toBe(true) }
    expect(msg).toContain('60')
    expect(() => new ZipArchive(f.build(), limits(60))).not.toThrow()
  })

  it('el límite por defecto son 5000 entradas', () => {
    const f = new ZipForge()
    for (let i = 0; i < 5001; i++) f.add(`f${i}.txt`, 'x', 'stored')
    throwsKind(() => new ZipArchive(f.build()), 'archiveLimit')
    f.entries.pop()
    expect(() => new ZipArchive(f.build())).not.toThrow()
  })

  it('el registro final miente sobre el número de entradas', () => {
    const f = new ZipForge({ 'a.txt': '1', 'b.txt': '2' })
    f.declaredEntryCount = 40_000
    throwsKind(() => new ZipArchive(f.build()), 'archiveLimit')
  })

  it('tamaños declarados por encima del límite', () => {
    const one = forgeWith({ name: 'enorme.bin', data: bytes('pequeño'), declaredUncompressed: 300 * 1024 * 1024 })
    throwsKind(() => new ZipArchive(one.build()), 'archiveLimit')
    expect(() => new ZipArchive(one.build(), limits(5000, 400 * 1024 * 1024))).not.toThrow()
    const many = new ZipForge()
    for (let i = 0; i < 10; i++) many.entries.push({ name: `p${i}.bin`, data: bytes('x'), declaredUncompressed: 30 * 1024 * 1024 })
    throwsKind(() => new ZipArchive(many.build(), limits(5000, 200 * 1024 * 1024)), 'archiveLimit')
  })

  it('una bomba real se para antes de reservar memoria', () => {
    const archive = new ZipForge().add('ceros.bin', new Uint8Array(20 * 1024 * 1024)).add('leeme.txt', 'hola').build()
    expect(archive.length).toBeLessThan(200_000)
    throwsKind(() => new ZipArchive(archive, limits(5000, 8 * 1024 * 1024)), 'archiveLimit')
    const zip = new ZipArchive(archive, limits(5000, 100 * 1024 * 1024))
    throwsKind(() => zip.read('ceros.bin', 1024 * 1024), 'archiveLimit')
    expect(text(zip.read('leeme.txt'))).toBe('hola')
  })

  it('tamaños mentirosos al descomprimir', () => {
    throwsKind(() => new ZipArchive(forgeWith({ name: 'miente.bin', data: new Uint8Array(1024 * 1024), declaredUncompressed: 100 }).build()).read('miente.bin'), 'archiveLimit')
    throwsKind(() => new ZipArchive(forgeWith({ name: 'miente.txt', data: bytes('corto'), declaredUncompressed: 5000 }).build()).read('miente.txt'), 'corrupt')
  })
})

describe('ZipArchive: archivos dañados', () => {
  it('no es un ZIP / está cortado', () => {
    throwsKind(() => new ZipArchive(bytes('esto no es un zip')), 'corrupt')
    throwsKind(() => new ZipArchive(new Uint8Array()), 'corrupt')
    throwsKind(() => new ZipArchive(new Uint8Array(500)), 'corrupt')
    const full = new ZipForge({ 'a.txt': 'dato '.repeat(1000), 'b.txt': 'otro' }).build()
    for (const cut of [full.length - 1, full.length - 10, Math.floor(full.length / 2), 30]) expect(() => new ZipArchive(full.subarray(0, cut)), `corte en ${cut}`).toThrow()
  })

  it('datos comprimidos dañados, cabecera local rota, cifrado y método desconocido', () => {
    const garbage = new Uint8Array(Array.from({ length: 80 }, (_, i) => (i * 37 + 11) % 256))
    throwsKind(() => new ZipArchive(forgeWith({ name: 'malo.txt', data: new Uint8Array(1000).fill(0x42), rawPayload: garbage }).build()).read('malo.txt'), 'corrupt')
    const broken = new ZipForge({ 'a.txt': 'hola' }).build()
    broken[0] = 0
    throwsKind(() => new ZipArchive(broken).read('a.txt'), 'corrupt')
    throwsKind(() => new ZipArchive(forgeWith({ name: 'secreto.txt', data: bytes('x'), flags: 1 }).build()).read('secreto.txt'), 'passwordProtected')
    throwsKind(() => new ZipArchive(forgeWith({ name: 'lzma.txt', data: bytes('x'), methodCode: 14 }).build()).read('lzma.txt'), 'unsupportedType')
  })

  it('los nombres con «..» nunca apuntan a otras entradas', () => {
    const zip = new ZipArchive(new ZipForge().add('../../etc/passwd', 'no deberías verme').add('ok.txt', 'bien').build())
    expect(zip.entry('etc/passwd')).toBeNull()
    expect(text(zip.read('ok.txt'))).toBe('bien')
  })

  it('basura aleatoria y cortes nunca rompen nada', () => {
    const good = new ZipForge({ 'a.txt': 'hola '.repeat(300), 'b.txt': 'adiós' }).build()
    let seed = 12345
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    for (let k = 0; k < 300; k++) {
      const data = good.slice()
      for (let j = 0; j < 1 + rnd(12); j++) data[rnd(data.length)] = rnd(256)
      let zip: ZipArchive | null = null
      try { zip = new ZipArchive(data) } catch { zip = null }
      for (const name of zip?.fileNames ?? []) { try { zip?.read(name) } catch { /* error controlado */ } }
    }
    for (let cut = 0; cut < good.length; cut += 7) {
      let zip: ZipArchive | null = null
      try { zip = new ZipArchive(good.subarray(0, cut)) } catch { zip = null }
      for (const name of zip?.fileNames ?? []) { try { zip?.read(name) } catch { /* error controlado */ } }
    }
  })
})

describe('ZipArchive: CRC', () => {
  const corruptedStored = (): Uint8Array => corrupting(new ZipForge().add('datos.txt', 'DATO-BUENO '.repeat(50), 'stored').build(), [['DATO-BUENO', 'DATO-MALO!']])

  it('una lectura completa rechaza un CRC incorrecto; un prefijo sigue funcionando', () => {
    expect(() => new ZipArchive(corruptedStored()).read('datos.txt')).toThrow()
    const prefix = new ZipArchive(corruptedStored()).readPrefix('datos.txt', 10)
    expect(prefix?.data.length).toBe(10)
    expect(prefix?.truncated).toBe(true)
  })

  it('los ZIP sanos se siguen leyendo', () => {
    const zip = new ZipArchive(new ZipForge().add('stored.txt', 'sin comprimir', 'stored').add('deflated.txt', 'abc '.repeat(5000)).build())
    expect(text(zip.read('stored.txt'))).toBe('sin comprimir')
    expect(zip.read('deflated.txt')?.length).toBe(20_000)
    expect(zip.readPrefix('deflated.txt', 4)?.data.length).toBe(4)
  })

  it('las cadenas compartidas dañadas de un Excel avisan en vez de perderse en silencio', async () => {
    const book = xlsx([{ name: 'Hoja', rowsXML: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' }], ['texto compartido'])
    const doc = await readDocument(tmp.write('sharedStrings-crc.xlsx', corrupting(book, [['texto compartido', 'texto manipulado']])))
    expect(doc.warnings.some((w) => w.includes('puede estar dañado')), JSON.stringify(doc.warnings)).toBe(true)
  })

  const word = (): Uint8Array => docx({
    styles: '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>',
    numbering: '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
    footnotes: '<w:footnote w:id="1"><w:p><w:r><w:t>Nota al pie importante</w:t></w:r></w:p></w:footnote>',
    body: p('La fotosíntesis convierte la luz en energía química.', 'Heading1') + listP('Primer paso', 1)
  })

  it('partes auxiliares dañadas de Word: aviso y el texto se importa', async () => {
    const styles = await readDocument(tmp.write('estilos-crc.docx', corrupting(word(), [['heading 1', 'HEADING 9']])))
    expect(styles.pages.map((x) => x.text).join('\n')).toContain('La fotosíntesis convierte la luz')
    expect(styles.warnings.some((w) => w.includes(PartName.styles))).toBe(true)
    const numbering = await readDocument(tmp.write('numeracion-crc.docx', corrupting(word(), [['lvlText', 'lvlTEXT'], ['Nota al pie', 'NOTA AL PIE']])))
    expect(numbering.pages.map((x) => x.text).join('\n')).toContain('Primer paso')
    expect(numbering.warnings.some((w) => w.includes(PartName.numbering))).toBe(true)
    expect(numbering.warnings.some((w) => w.includes(PartName.notes))).toBe(true)
    await expect(readDocument(tmp.write('documento-crc.docx', corrupting(word(), [['La fotosíntesis', 'LA FOTOSÍNTESIS']])))).rejects.toThrow()
  })

  it('partes dañadas de PowerPoint: se conservan las diapositivas', async () => {
    const deck = pptx([
      { shapes: sp(['Célula'], 'title') + sp(['La membrana controla el paso']), notes: 'Recordar el transporte activo' },
      { shapes: sp(['Mitocondria'], 'title') }
    ])
    const doc = await readDocument(tmp.write('presentacion-crc.pptx', corrupting(deck, [['sldIdLst', 'SLDIDLST'], ['Recordar el transporte', 'RECORDAR EL TRANSPORTE']])))
    const all = doc.pages.map((x) => x.text).join('\n')
    expect(all).toContain('La membrana controla el paso')
    expect(all).toContain('Mitocondria')
    expect(doc.warnings.some((w) => w.includes(PartName.presentation))).toBe(true)
    expect(doc.warnings.some((w) => w.includes(PartName.notes))).toBe(true)
    const two = pptx([{ shapes: sp(['Uno'], 'title') + sp(['Texto de la primera']) }, { shapes: sp(['Dos'], 'title') + sp(['Texto de la segunda']) }])
    const one = await readDocument(tmp.write('diapositiva-crc.pptx', corrupting(two, [['Texto de la primera', 'TEXTO DE LA PRIMERA']])))
    expect(one.pages.map((x) => x.text).join('')).toContain('Texto de la segunda')
    expect(one.warnings.some((w) => w.includes('1'))).toBe(true)
  })
})
