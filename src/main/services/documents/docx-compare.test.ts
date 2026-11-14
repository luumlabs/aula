// Word: la fila clave de una comparación va en negrita, como en Markdown (y destacada en la app).
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { defaultDocumentStyle, type DocumentPlan } from '@shared/documents'
import { decodeBlock, type Block } from '@shared/schema'
import { renderDocx } from './docx'
import { printWords } from './words'

function planWith(block: Block): DocumentPlan {
  return {
    request: { kind: 'summary', scope: { skillIDs: [], unitIDs: [], onlyDone: false }, style: defaultDocumentStyle(), format: 'docx', lang: 'es' },
    title: 'Prueba', hue: 20, contentLanguage: 'es', lang: 'es', created: '2026-11-13T00:00:00.000Z', notice: 'Aviso', words: printWords('es'),
    sections: [{ id: 's', role: 'content', title: 'Sección', toc: false, newPage: false, priority: 0, items: [{ type: 'block', block }] }]
  }
}

/** Los runs de Word (`<w:r>…</w:r>`) con su texto y si van en negrita. */
async function runs(block: Block): Promise<Array<{ text: string; bold: boolean }>> {
  const zip = await JSZip.loadAsync(await renderDocx(planWith(block)))
  const xml = await zip.file('word/document.xml')!.async('string')
  return [...xml.matchAll(/<w:r>(.*?)<\/w:r>/gs)].map((m) => ({ text: [...m[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''), bold: /<w:b\/>|<w:b w:val="true"\/>/.test(m[1]) }))
}

describe('Word: comparar', () => {
  it('la fila con `tone: "key"` en negrita; las demás no', async () => {
    const block = decodeBlock({ id: 'c', type: 'compare', leftTitle: 'Mitosis', rightTitle: 'Meiosis', rows: [{ label: 'Hijas', left: 'Dos', right: 'Cuatro', tone: 'key' }, { label: 'ADN', left: 'Se copia', right: 'Se copia una vez', tone: 'same' }] })!
    const r = await runs(block)
    const find = (text: string): { text: string; bold: boolean } | undefined => r.find((x) => x.text === text)
    for (const t of ['Hijas', 'Dos', 'Cuatro']) expect(find(t)?.bold, t).toBe(true)
    for (const t of ['ADN', 'Se copia', 'Se copia una vez']) expect(find(t)?.bold, t).toBe(false)
    // sin asteriscos sueltos
    expect(r.some((x) => x.text.includes('**'))).toBe(false)
  })

  it('una celda de la fila clave que ya trae negrita o cursiva sale en negrita, sin asteriscos sueltos', async () => {
    const block = decodeBlock({ id: 'c', type: 'compare', leftTitle: 'A', rightTitle: 'B', rows: [{ label: 'Clave', left: 'un **sí** claro', right: '*quizá*', tone: 'key' }, { label: 'Otra', left: 'x', right: 'y' }] })!
    const r = await runs(block)
    expect(r.some((x) => x.text.includes('*'))).toBe(false)
    for (const t of ['un ', 'sí', ' claro', 'quizá']) expect(r.find((x) => x.text === t)?.bold, t).toBe(true)
    expect(r.find((x) => x.text === 'x')?.bold).toBe(false)
  })
})
