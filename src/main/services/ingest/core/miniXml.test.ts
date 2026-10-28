import { describe, expect, it } from 'vitest'
import { relationships, relsPath, resolvePart } from '../extract/ooxml'
import { rels } from '../testing/office'
import { ZipForge } from '../testing/zipForge'
import { parseXml } from './miniXml'
import { ZipArchive } from './zipArchive'

const parse = (s: string, maxNodes = 4_000_000, maxDepth = 256) => parseXml(new Uint8Array(Buffer.from(s, 'utf8')), { maxNodes, maxDepth })

describe('MiniXML', () => {
  it('quita los prefijos de espacio de nombres', () => {
    const r = parse('<w:document xmlns:w="urn:w" xmlns:r="urn:r"><w:body><w:p w:val="x" r:id="rId7"><w:t xml:space="preserve"> hola </w:t></w:p></w:body></w:document>')
    expect(r.error).toBeNull()
    expect(r.root?.name).toBe('document')
    const p = r.root?.child('body')?.child('p')
    expect(p?.attr('val')).toBe('x')
    expect(p?.attr('id')).toBe('rId7')
    expect(p?.child('t')?.text).toBe(' hola ')
    expect(p?.child('t')?.attr('space')).toBe('preserve')
  })

  it('prefijos distintos dan el mismo árbol', () => {
    for (const s of ['<a:x xmlns:a="urn:n"><a:y>1</a:y></a:x>', '<ns0:x xmlns:ns0="urn:n"><ns0:y>1</ns0:y></ns0:x>', '<x xmlns="urn:n"><y>1</y></x>']) {
      expect(parse(s).root?.child('y')?.text).toBe('1')
    }
  })

  it('entidades y CDATA', () => {
    const root = parse('<a><b>1 &lt; 2 &amp; &#241;</b><c><![CDATA[<raw> & text]]></c></a>').root
    expect(root?.child('b')?.text).toBe('1 < 2 & ñ')
    expect(root?.child('c')?.text).toBe('<raw> & text')
  })

  it('ayudantes de descendientes', () => {
    const root = parse('<a><b><c>1</c></b><c>2</c><d><c>3</c></d></a>').root
    expect(root?.descendants('c').map((n) => n.text)).toEqual(['1', '2', '3'])
    expect(root?.firstDescendant('c')?.text).toBe('1')
    expect(root?.firstDescendant('z')).toBeNull()
    expect(root?.childrenNamed('c')).toHaveLength(1)
    expect(root?.allText).toBe('123')
  })

  it('XML cortado: árbol parcial con error', () => {
    const r = parse('<doc><p>uno</p><p>dos</p><p>tre')
    expect(r.error).not.toBeNull()
    expect(r.root?.childrenNamed('p')).toHaveLength(3)
    expect(r.root?.childrenNamed('p')[0].text).toBe('uno')
  })

  it('XML sin raíz', () => {
    const r = parse('esto no es xml')
    expect(r.root).toBeNull()
    expect(r.error).not.toBeNull()
    expect(parseXml(new Uint8Array()).root).toBeNull()
  })

  it('rechaza las declaraciones de entidades (bombas y XXE)', () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>'
    const r = parse(bomb)
    expect(r.root).toBeNull()
    expect(r.error).not.toBeNull()
    expect(parse('<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d>&x;</d>').root).toBeNull()
  })

  it('un DOCTYPE sin entidades sirve', () => {
    expect(parse('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"><html><body>ok</body></html>').root?.name).toBe('html')
  })

  it('límites de profundidad y de nodos', () => {
    const deep = '<a>'.repeat(400) + 'x' + '</a>'.repeat(400)
    const r = parse(deep, 4_000_000, 100)
    expect(r.error).not.toBeNull()
    expect(r.root).not.toBeNull()
    expect(parse(deep, 4_000_000, 500).error).toBeNull()
    const wide = '<r>' + '<i/>'.repeat(5000) + '</r>'
    expect(parse(wide, 1000).error).not.toBeNull()
    expect(parse(wide).error).toBeNull()
  })

  it('BOM y espacios', () => {
    const data = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('<?xml version="1.0"?>\n  <r><x>1</x></r>')])
    expect(parseXml(data).root?.child('x')?.text).toBe('1')
  })

  it('un documento grande es rápido', () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => `<w:p><w:r><w:t>Párrafo número ${i} con algo de texto</w:t></w:r></w:p>`).join('')
    const t0 = performance.now()
    const r = parse('<w:document xmlns:w="urn:w"><w:body>' + rows + '</w:body></w:document>')
    expect(r.root?.child('body')?.children).toHaveLength(20_000)
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})

describe('OPC', () => {
  it('resuelve rutas', () => {
    expect(resolvePart('../media/a.png', 'ppt/slides/slide1.xml')).toBe('ppt/media/a.png')
    expect(resolvePart('slides/slide1.xml', 'ppt/presentation.xml')).toBe('ppt/slides/slide1.xml')
    expect(resolvePart('/word/document.xml', 'x/y.xml')).toBe('word/document.xml')
    expect(resolvePart('word/document.xml', '')).toBe('word/document.xml')
    expect(resolvePart('../../../x.xml', 'a/b.xml')).toBe('x.xml')
    expect(resolvePart('cap%C3%ADtulo%201.xhtml', 'OEBPS/content.opf')).toBe('OEBPS/capítulo 1.xhtml')
    expect(resolvePart('c1.xhtml#sec2', 'OEBPS/nav.xhtml')).toBe('OEBPS/c1.xhtml')
    expect(resolvePart('./a/./b.xml', 'p/q.xml')).toBe('p/a/b.xml')
    expect(relsPath('ppt/slides/slide1.xml')).toBe('ppt/slides/_rels/slide1.xml.rels')
    expect(relsPath('doc.xml')).toBe('_rels/doc.xml.rels')
  })

  it('relaciones', () => {
    const r = rels([{ id: 'rId1', type: 't/slide', target: 'slides/slide1.xml' }, { id: 'rId2', type: 't/hyperlink', target: 'https://example.com', external: true }])
    const zip = new ZipArchive(new ZipForge({ 'ppt/_rels/presentation.xml.rels': r }).build())
    const list = relationships('ppt/presentation.xml', zip)
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ target: 'ppt/slides/slide1.xml', isExternal: false })
    expect(list[1]).toMatchObject({ target: 'https://example.com', isExternal: true })
    expect(relationships('nada.xml', zip)).toEqual([])
  })
})
