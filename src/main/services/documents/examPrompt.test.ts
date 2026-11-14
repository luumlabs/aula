// Examen en Markdown y Word: una molécula del enunciado no da la respuesta (ni su nombre, ni su fórmula, ni sus grupos).
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { defaultDocumentStyle, type DocumentItem, type DocumentPlan } from '@shared/documents'
import { decodeBlock, decodeExercise, type Block } from '@shared/schema'
import { renderDocx } from './docx'
import { renderMarkdown } from './markdown'
import { printWords } from './words'

const molecule = (): Block =>
  decodeBlock({
    id: 'm', type: 'structure', smiles: 'CC(=O)Oc1ccccc1C(=O)O', title: 'Aspirina',
    groups: [{ atoms: [1, 2, 3], label: 'Éster' }], steps: [{ md: 'Primero el anillo de benceno' }]
  })!

function planWith(items: DocumentItem[]): DocumentPlan {
  return {
    request: { kind: 'exam', scope: { skillIDs: [], unitIDs: [], onlyDone: false }, style: defaultDocumentStyle(), format: 'markdown', lang: 'es' },
    title: 'Examen', hue: 20, contentLanguage: 'es', lang: 'es', created: '2026-11-13T00:00:00.000Z', notice: 'Aviso', words: printWords('es'),
    sections: [{ id: 's', role: 'questions', title: 'Preguntas', toc: false, newPage: false, priority: 0, items }]
  }
}

function examPlan(): DocumentPlan {
  const exercise = decodeExercise({
    id: 'e1', prompt: [{ type: 'text', md: '¿Cómo se llama esta molécula?' }, { id: 'm', type: 'structure', smiles: 'CC(=O)Oc1ccccc1C(=O)O', title: 'Aspirina', groups: [{ atoms: [1, 2, 3], label: 'Éster' }], steps: [{ md: 'Primero el anillo de benceno' }] }],
    answer: { kind: 'short', accepted: ['aspirina'] }
  })!
  expect(exercise.prompt.some((b) => b.type === 'structure')).toBe(true)
  return planWith([{ type: 'question', question: { number: 1, exercise, points: 1, optionOrder: [], skillTitle: 'Química' } }])
}

async function docxText(plan: DocumentPlan): Promise<string> {
  const zip = await JSZip.loadAsync(await renderDocx(plan))
  const xml = await zip.file('word/document.xml')!.async('string')
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(' ')
}

describe('Examen: molécula en el enunciado', () => {
  it('Markdown: queda la SMILES; no el nombre, la fórmula, los grupos ni el recorrido', () => {
    const md = renderMarkdown(examPlan(), 'img').text
    expect(md).toContain('CC(=O)Oc1ccccc1C(=O)O')
    expect(md).not.toContain('Aspirina')
    expect(md).not.toContain('\\ce{')
    expect(md).not.toContain('Éster')
    expect(md).not.toContain('anillo de benceno')
  })

  it('Word: lo mismo', async () => {
    const text = await docxText(examPlan())
    expect(text).toContain('CC(=O)Oc1ccccc1C(=O)O')
    expect(text).not.toContain('Aspirina')
    expect(text).not.toContain('Éster')
    expect(text).not.toContain('anillo de benceno')
  })

  it('fuera de un examen la molécula se describe entera', () => {
    const md = renderMarkdown(planWith([{ type: 'block', block: molecule() }]), 'img').text
    expect(md).toContain('Aspirina')
    expect(md).toContain('Éster')
    expect(md).toContain('anillo de benceno')
  })
})
