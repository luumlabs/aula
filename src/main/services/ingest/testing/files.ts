// Solo para pruebas: carpetas temporales, PNG mínimos y recogida del progreso.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as zlib from 'node:zlib'
import { crc32 } from '../core/zipArchive'

export interface TempDir {
  path: string
  write(name: string, data: string | Uint8Array): string
  cleanup(): void
}

export function tempDir(prefix = 'aula-ingest-'): TempDir {
  const path = mkdtempSync(join(tmpdir(), prefix))
  return {
    path,
    write(name, data) {
      const file = join(path, name)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, data)
      return file
    },
    cleanup() { rmSync(path, { recursive: true, force: true }) }
  }
}

/** PNG en escala de grises de `width` × `height` (relleno con `fill`). */
export function png(width: number, height: number, fill = 255): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)])
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc((width + 1) * height, fill)
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', new Uint8Array())]))
}

/** Recoge los avisos de progreso de una lectura. */
export class ProgressLog {
  readonly items: Array<[number, string]> = []
  readonly callback = (f: number, m: string): void => { this.items.push([f, m]) }
  get fractions(): number[] { return this.items.map((i) => i[0]) }
  get messages(): string[] { return this.items.map((i) => i[1]) }
}
