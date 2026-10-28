// A2-P1-4 y A2-P2-12: un `.aulapack` con cientos de miles (o millones) de entradas se rechaza ANTES de que JSZip monte su índice
// (en el proceso principal, 6 M de entradas dejaban a V8 sin memoria), también si el final del ZIP miente sobre cuántas hay; y
// una bomba zip se escribe al disco por trozos, sin juntar la entrada entera en memoria.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { countCentralRecords, DEFAULT_ZIP_LIMITS, extractZip } from './packZip'

let tmp: string
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'packzip-hostile-')) })
afterEach(() => { vi.restoreAllMocks(); rmSync(tmp, { recursive: true, force: true }) })

/** ZIP «stored» de `n` archivos vacíos, hecho a mano (rápido aunque sean cientos de miles). `declared`: lo que dice el EOCD. */
function manyEntriesZip(n: number, declared = n): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (let i = 0; i < n; i++) {
    const name = Buffer.from(`c/f${i}`)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(name.length, 26)
    locals.push(lh, name)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42)
    centrals.push(ch, name)
    offset += 30 + name.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Math.min(declared, 0xffff), 8); eocd.writeUInt16LE(Math.min(declared, 0xffff), 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

describe('A2-P1-4 · .aulapack con muchísimas entradas', () => {
  it('300 000 entradas: rechazo enseguida y sin llamar a JSZip', async () => {
    const f = join(tmp, 'many.aulapack')
    writeFileSync(f, manyEntriesZip(300_000, 0xffff))
    const load = vi.spyOn(JSZip, 'loadAsync')
    const t0 = performance.now()
    await expect(extractZip(f, join(tmp, 'out'))).rejects.toMatchObject({ code: 'too_large' })
    expect(load).not.toHaveBeenCalled()
    expect(performance.now() - t0).toBeLessThan(3000)
  })

  it('el EOCD miente («1 entrada») pero el directorio central trae 25 000: se cuentan las firmas de verdad', async () => {
    const f = join(tmp, 'liar.aulapack')
    writeFileSync(f, manyEntriesZip(DEFAULT_ZIP_LIMITS.maxEntries + 5000, 1))
    const load = vi.spyOn(JSZip, 'loadAsync')
    await expect(extractZip(f, join(tmp, 'out'))).rejects.toMatchObject({ code: 'too_large' })
    expect(load).not.toHaveBeenCalled()
  })

  it('el recuento por trozos encuentra las firmas partidas entre dos trozos y para en el tope', async () => {
    const f = join(tmp, 'x.zip')
    // 8 MiB − 2 bytes de relleno: la tercera firma queda partida entre el primer y el segundo trozo de lectura
    writeFileSync(f, Buffer.concat([Buffer.from('PK\x01\x02PK\x01\x02', 'latin1'), Buffer.alloc(8 * 1024 * 1024 - 10), Buffer.from('PK\x01\x02', 'latin1')]))
    expect(await countCentralRecords(f, 100)).toBe(3)
    expect(await countCentralRecords(f, 1)).toBe(2)
  })

  it('un curso normal se sigue importando (el tope no molesta)', async () => {
    const f = join(tmp, 'ok.aulapack')
    writeFileSync(f, manyEntriesZip(50))
    mkdirSync(join(tmp, 'out'))
    await extractZip(f, join(tmp, 'out'))
    expect(readdirSync(join(tmp, 'out', 'c'))).toHaveLength(50)
  })
})

describe('A2-P2-12 · bomba zip: al disco por trozos', () => {
  it('una entrada que se pasa del tope se corta sin dejar el temporal ni el archivo', async () => {
    const zip = new JSZip()
    zip.file('c/pack.json', '{}')
    zip.file('c/assets/bomb.bin', new Uint8Array(4 * 1024 * 1024))
    const f = join(tmp, 'bomb.aulapack')
    writeFileSync(f, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
    const out = join(tmp, 'out')
    mkdirSync(out)
    await expect(extractZip(f, out, { maxEntries: 100, maxTotalBytes: 1024 * 1024 })).rejects.toMatchObject({ code: 'too_large' })
    const left = existsSync(join(out, 'c', 'assets')) ? readdirSync(join(out, 'c', 'assets')) : []
    expect(left).toEqual([])
  })
})

describe('A2-P2-19 · nombres de entradas de Windows', () => {
  const names = ['c/pack.json', 'c/assets/foto.png:evil', 'c/assets/CON', 'c/assets/nul.txt', 'c/assets/a.', 'c/assets/b ']
  async function packWith(list: string[]): Promise<string> {
    const zip = new JSZip()
    for (const n of list) zip.file(n, 'x')
    const f = join(tmp, 'names.aulapack')
    writeFileSync(f, await zip.generateAsync({ type: 'nodebuffer' }))
    return f
  }

  it('en Windows, flujos NTFS, dispositivos y puntos o espacios finales se escriben con nombres inofensivos', async () => {
    const out = join(tmp, 'out')
    mkdirSync(out)
    await extractZip(await packWith(names), out, { ...DEFAULT_ZIP_LIMITS, windowsNames: true })
    expect(readdirSync(join(out, 'c', 'assets')).sort()).toEqual(['_CON', '_nul.txt', 'a_', 'b_', 'foto.png_evil'])
  })

  it('«pack.json» y «PACK.JSON» a la vez: se rechaza (antes ganaba el último sin avisar)', async () => {
    const out = join(tmp, 'out')
    mkdirSync(out)
    await expect(extractZip(await packWith(['c/pack.json', 'c/PACK.JSON']), out)).rejects.toMatchObject({ code: 'unsafe_path' })
  })
})
