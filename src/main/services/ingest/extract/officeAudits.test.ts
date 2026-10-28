// Hallazgos de auditoría de la app Swift (MJ-ING-002 y MJ-ING-005), con las mismas pruebas.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDocument } from '../pipeline'
import { tempDir, type TempDir } from '../testing/files'
import { docx, pptx } from '../testing/office'
import { excelDate } from './xlsx'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())

const sup = (t: string): string => `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`
const sub = (t: string): string => `<w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`
const run = (t: string): string => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`

describe('MJ-ING-002: superíndices y subíndices de Office', () => {
  it('Word conserva superíndices y subíndices', async () => {
    const doc = await readDocument(tmp.write('scripts.docx', docx({ body: `<w:p>${run('x')}${sup('2')}${run(' + y')}${sub('1')}</w:p>` })))
    expect(doc.pages[0].text).toContain('x^2 + y_1')
  })

  it('agrupa los runs seguidos y un run de solo espacios no deja marca', async () => {
    const body = `<w:p>${run('H')}${sub('2')}${run('SO')}${sub('3')}${sub('(')}${sub('aq')}${sub(')')}${run(' y P1')}${sub(' ')}${run(' / 100')}</w:p>`
    const text = (await readDocument(tmp.write('runs.docx', docx({ body })))).pages[0].text
    expect(text).toContain('H_2SO_{3(aq)}')
    expect(text).not.toContain('P1_')
    expect(text).toContain('P1 / 100')
  })

  it('un enlace que termina en superíndice no lo pierde', async () => {
    const body = `<w:p>${run('x')}<w:hyperlink>${sup('2')}</w:hyperlink></w:p>`
    expect((await readDocument(tmp.write('enlace.docx', docx({ body })))).pages[0].text).toContain('x^2')
  })

  it('PowerPoint conserva la línea base', async () => {
    const para = '<a:p><a:r><a:t>x</a:t></a:r><a:r><a:rPr baseline="30000"/><a:t>2</a:t></a:r><a:r><a:t xml:space="preserve"> + y</a:t></a:r><a:r><a:rPr baseline="-25000"/><a:t>1</a:t></a:r></a:p>'
    const shape = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Forma"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${para}</p:txBody></p:sp>`
    expect((await readDocument(tmp.write('scripts.pptx', pptx([{ shapes: shape }])))).pages[0].text).toContain('x^2 + y_1')
  })
})

describe('MJ-ING-005: fechas de Excel antes de marzo de 1900', () => {
  it('conservan su día', () => {
    expect(excelDate(1, false)).toBe('1900-01-01')
    expect(excelDate(31, false)).toBe('1900-01-31')
    expect(excelDate(59, false)).toBe('1900-02-28')
    expect(excelDate(2, false)).toBe('1900-01-02')
    expect(excelDate(61, false)).toBe('1900-03-01')
    expect(excelDate(62, false)).toBe('1900-03-02')
    expect(excelDate(60, false)).toBe('1900-02-28')
  })

  it('las fechas modernas no cambian', () => {
    expect(excelDate(25569, false)).toBe('1970-01-01')
    expect(excelDate(45000, false)?.slice(0, 10)).toBe('2023-03-15')
    expect(excelDate(0.5, true)).toBe('12:00')
    expect(excelDate(24107, true)).toBe('1970-01-01')
  })
})
