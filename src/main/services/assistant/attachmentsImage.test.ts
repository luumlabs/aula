// A2-P2-15: una imagen adjunta al chat con muchísimos píxeles (17 000 × 17 000 en 281 KB) ya no se decodifica en el proceso
// principal: se mira su cabecera antes. Las fotos normales (también las de 48 Mpx de un móvil) se siguen reduciendo como siempre.
import { writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tempDir, png, type TempDir } from '../ingest/testing/files'
import { imageTooLargeToDecode } from './attachments'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())

/** Solo la firma y la cabecera IHDR de un PNG de `w` × `h` (lo que lee `imageInfo`). */
function pngHeader(w: number, h: number): Uint8Array {
  const real = Buffer.from(png(1, 1))
  // la cabecera IHDR va en los bytes 16..23 (ancho y alto)
  real.writeUInt32BE(w, 16)
  real.writeUInt32BE(h, 20)
  return real
}

describe('A2-P2-15 · imágenes del chat sin límite de píxeles', () => {
  it('la bomba de 17 000 × 17 000 no se decodifica; una de 8064 × 6048 (48 Mpx), sí', () => {
    const bomb = tmp.write('bomb.png', pngHeader(17_000, 17_000))
    const phone = tmp.write('phone.png', pngHeader(8064, 6048))
    expect(imageTooLargeToDecode(bomb)).toBe(true)
    expect(imageTooLargeToDecode(phone)).toBe(false)
  })

  it('si no se sabe leer la cabecera, no se bloquea (lo decide quien la abre)', () => {
    const odd = tmp.write('odd.png', new Uint8Array([1, 2, 3]))
    writeFileSync(odd, 'no es una imagen')
    expect(imageTooLargeToDecode(odd)).toBe(false)
    expect(imageTooLargeToDecode(tmp.write('missing-dir.png', new Uint8Array(0)))).toBe(false)
  })
})
