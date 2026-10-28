// Textos para el usuario (port de LocalizationTests.swift): en español por defecto, números de página sin separador de
// miles, avisos que son frases completas y partes dañadas citadas por su nombre.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { locationLabel } from '@shared/ingest'
import { ZipArchive } from './core/zipArchive'
import { acceptLanguage } from './extract/web'
import { format } from './messages'
import { readDocument, tidyDocument } from './pipeline'
import { tempDir, type TempDir } from './testing/files'
import { docx, p, xlsx } from './testing/office'
import { ZipForge } from './testing/zipForge'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())

function replacing(data: Uint8Array, name: string, text: string): Uint8Array {
  const zip = new ZipArchive(data)
  const forge = new ZipForge()
  for (const n of zip.fileNames) forge.add(n, n === name ? text : (zip.read(n) as Uint8Array))
  return forge.build()
}

describe('Textos para el usuario', () => {
  it('etiquetas de ubicación sin separador de miles', () => {
    expect(locationLabel('pdf', 1234)).toBe('p. 1234')
    expect(locationLabel('image', 7)).toBe('p. 7')
    expect(locationLabel('docx', 12)).toBe('p. 12')
    expect(locationLabel('pptx', 2048)).toBe('diapositiva 2048')
    expect(locationLabel('xlsx', 2)).toBe('hoja 2')
    expect(locationLabel('epub', 15)).toBe('cap. 15')
    expect(locationLabel('text', 1)).toBe('p. 1')
  })

  it('Accept-Language según el idioma de la interfaz', () => {
    expect(acceptLanguage('zh-Hans')).toBe('zh-Hans,zh;q=0.9,en;q=0.8')
    expect(acceptLanguage('en-GB')).toBe('en-GB,en;q=0.8')
    expect(acceptLanguage('pt_BR')).toBe('pt-BR,pt;q=0.9,en;q=0.8')
  })

  it('marcadores %@, %lld y posicionales', () => {
    expect(format('%@ de %@', ['a', 'b'])).toBe('a de b')
    expect(format('%2$@ antes que %1$@', ['a', 'b'])).toBe('b antes que a')
    expect(format('%lld %% hecho', [50])).toBe('50 % hecho')
  })

  it('el resumen de avisos ocultos es una frase completa', () => {
    const tidy = tidyDocument({ title: 'x', kind: 'text', pages: [], metadata: {}, warnings: Array.from({ length: 40 }, (_, i) => `Aviso ${i + 1}.`) }, 'x')
    expect(tidy.warnings).toHaveLength(30)
    expect(tidy.warnings[29]).toBe('Hay 11 avisos más parecidos que no se muestran.')
  })

  it('una parte dañada se cita por su nombre', async () => {
    const entity = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
    const doc = await readDocument(tmp.write('estilos.docx', replacing(docx({ body: p('Texto del documento.'), styles: '' }), 'word/styles.xml', entity)))
    expect(doc.pages[0].text).toBe('Texto del documento.')
    expect(doc.warnings).toContain('No se pudo leer «los estilos»: contiene definiciones de entidades, que no se permiten por seguridad')
  })

  it('los avisos de entidades de Excel son frases completas', async () => {
    const header = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]>'
    let data = xlsx([{ name: 'Datos', rowsXML: '' }], ['uno'])
    data = replacing(data, 'xl/sharedStrings.xml', header + '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>&a;</t></si></sst>')
    data = replacing(data, 'xl/worksheets/sheet1.xml', header + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>')
    const doc = await readDocument(tmp.write('entidades.xlsx', data))
    expect(doc.warnings).toContain('Se omitieron los textos compartidos: contienen definiciones de entidades XML, que no se permiten por seguridad.')
    expect(doc.warnings).toContain('Se omitió la hoja «Datos»: contiene definiciones de entidades XML, que no se permiten por seguridad.')
  })
})
