import { describe, expect, it } from 'vitest'
import { decodeEntities, ENTITY_TABLE } from './htmlEntities'
import { decodeHTML, decodeText, encodingLabel, looksLikeText, sniffHTMLCharset } from './textDecoding'

const sample = 'Canción, año, niño: ¿qué tal? Fórmula: sen²θ + cos²θ = 1 — «ok»'
const u8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'utf8'))
const cat = (...parts: Array<Uint8Array | number[]>): Uint8Array => new Uint8Array(parts.flatMap((p) => Array.from(p)))
const utf16be = (s: string): Uint8Array => { const le = Buffer.from(s, 'utf16le'); const be = Buffer.alloc(le.length); for (let i = 0; i < le.length; i += 2) { be[i] = le[i + 1]; be[i + 1] = le[i] } return be }

describe('TextDecoding', () => {
  it('UTF-8 con y sin BOM', () => {
    expect(decodeText(u8(sample))).toEqual({ text: sample, encodingName: 'UTF-8' })
    const bom = decodeText(cat([0xef, 0xbb, 0xbf], u8(sample)))
    expect(bom.text).toBe(sample)
  })

  it('UTF-16 con BOM y sin él', () => {
    const le = decodeText(cat([0xff, 0xfe], Buffer.from(sample, 'utf16le')))
    const be = decodeText(cat([0xfe, 0xff], utf16be(sample)))
    expect(le).toEqual({ text: sample, encodingName: 'UTF-16LE' })
    expect(be).toEqual({ text: sample, encodingName: 'UTF-16BE' })
    const ascii = 'Hola mundo, esto es una prueba larga de texto sin marca de orden de bytes.'
    expect(decodeText(new Uint8Array(Buffer.from(ascii, 'utf16le'))).text).toBe(ascii)
    expect(decodeText(utf16be(ascii)).text).toBe(ascii)
  })

  it('UTF-32 con BOM', () => {
    const cps = Array.from('Hola ñ', (c) => c.codePointAt(0) ?? 0)
    const data = cat([0xff, 0xfe, 0, 0], cps.flatMap((v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, 0]))
    expect(decodeText(data).text).toBe('Hola ñ')
  })

  it('Latin-1 y Windows-1252', () => {
    expect(decodeText(new Uint8Array([0x43, 0x61, 0x6e, 0x63, 0x69, 0xf3, 0x6e, 0x20, 0x61, 0xf1, 0x6f]))).toEqual({ text: 'Canción año', encodingName: 'Windows-1252' })
    expect(decodeText(new Uint8Array([0x93, 0x48, 0x6f, 0x6c, 0x61, 0x94, 0x20, 0x96, 0x20, 0x80, 0x35])).text).toBe('“Hola” – €5')
    const odd = decodeText(new Uint8Array([0x41, 0x81, 0x42])).text
    expect(Array.from(odd)).toHaveLength(3)
    expect(odd.startsWith('A') && odd.endsWith('B')).toBe(true)
  })

  it('normaliza los saltos de línea y quita los NUL', () => {
    expect(decodeText(u8('a\r\nb\rc\nd\0e')).text).toBe('a\nb\nc\nde')
  })

  it('acepta un UTF-8 cortado al final, pero no uno inválido en medio', () => {
    expect(decodeText(cat(u8('Canción larga de texto'), [0xc3]))).toEqual({ text: 'Canción larga de texto', encodingName: 'UTF-8' })
    expect(decodeText(new Uint8Array([0x61, 0xe9, 0x62, 0xe9, 0x63, 0x20, 0x20, 0x20, 0x20, 0x20])).text.slice(0, 5)).toBe('aébéc')
  })

  it('vacío', () => {
    expect(decodeText(new Uint8Array()).text).toBe('')
  })

  it('usa la codificación preferida cuando no es UTF-8', () => {
    const sjis = new Uint8Array([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd])
    expect(decodeText(sjis, 'shift_jis').text).toBe('こんにちは')
  })

  it('HTML: un UTF-8 válido gana a una declaración equivocada; meta charset', () => {
    expect(decodeHTML(u8('<p>niño</p>'), 'iso-8859-1').text).toBe('<p>niño</p>')
    const latin = new Uint8Array(Buffer.from('<html><head><meta charset="iso-8859-1"></head><body>niño</body></html>', 'latin1'))
    expect(sniffHTMLCharset(latin)).toBe('iso-8859-1')
    expect(decodeHTML(latin).text).toContain('niño')
    const old = cat(Buffer.from('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=windows-1252"><body>', 'latin1'), [0x93, 0x78, 0x94], Buffer.from('</body>', 'latin1'))
    expect(sniffHTMLCharset(old)).toBe('windows-1252')
    expect(decodeHTML(old).text).toContain('“x”')
    expect(sniffHTMLCharset(u8('<?xml version="1.0" encoding="UTF-8"?><html/>'))).toBe('UTF-8')
    expect(sniffHTMLCharset(u8('<html></html>'))).toBeNull()
  })

  it('nombres IANA', () => {
    expect(encodingLabel('UTF-8')).toBe('utf-8')
    expect(encodingLabel('latin1')).not.toBeNull()
    expect(encodingLabel('windows-1252')).toBe('windows-1252')
    expect(encodingLabel('no-existe-xyz')).toBeNull()
  })

  it('¿parece texto?', () => {
    expect(looksLikeText(u8('Hola mundo'))).toBe(true)
    expect(looksLikeText(new Uint8Array())).toBe(true)
    expect(looksLikeText(new Uint8Array([0, 1, 2, 3, 0, 5, 6, 7]))).toBe(false)
    expect(looksLikeText(new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 256)))).toBe(false)
  })
})

describe('HTMLEntities', () => {
  it('entidades con nombre y numéricas', () => {
    expect(decodeEntities('a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;')).toBe('a & b < c > d "e" \'f\'')
    expect(decodeEntities('ni&ntilde;o &aacute;&eacute;&iacute;&oacute;&uacute; &Ntilde; &iquest;qu&eacute;?')).toBe('niño áéíóú Ñ ¿qué?')
    expect(decodeEntities('&#241; &#xF1; &#x3C0; &#960;')).toBe('ñ ñ π π')
    expect(decodeEntities('&alpha;&beta;&gamma; &Omega; &sum; &radic; &infin; &le; &ge; &ne; &pi;')).toBe('αβγ Ω ∑ √ ∞ ≤ ≥ ≠ π')
    expect(decodeEntities('&nbsp;&mdash;&ndash;&hellip;&euro;&copy;&deg;&plusmn;&times;&divide;')).toBe(' —–…€©°±×÷')
    expect(decodeEntities('&#150; &#147;x&#148;')).toBe('– “x”')
  })

  it('las entidades malas se conservan', () => {
    expect(decodeEntities('AT&T y R&D & &noexiste; &#xZZ; &#99999999; &')).toBe('AT&T y R&D & &noexiste; &#xZZ; � &')
    expect(decodeEntities('sin entidades')).toBe('sin entidades')
    expect(decodeEntities('&#0;')).toBe('�')
    expect(decodeEntities('&#xD800;')).toBe('�')
  })

  it('tabla de entidades', () => {
    expect(ENTITY_TABLE.size).toBeGreaterThan(250)
    expect(ENTITY_TABLE.get('Agrave')).toBe('À')
    expect(ENTITY_TABLE.get('yuml')).toBe('ÿ')
    expect(ENTITY_TABLE.get('Sigma')).toBe('Σ')
    expect(ENTITY_TABLE.get('omega')).toBe('ω')
  })
})
