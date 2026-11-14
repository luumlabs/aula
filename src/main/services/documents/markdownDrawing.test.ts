// Un dibujo paso a paso exportado a Markdown lleva sus pasos numerados bajo la descripción.
import { describe, expect, it } from 'vitest'
import type { Block } from '@shared/schema'
import type { DocumentPlan } from '@shared/documents'
import { block } from './markdown'

const ctx = { plan: {} as DocumentPlan, folder: 'f', lang: 'es' as const, asset: () => undefined }

describe('Markdown: dibujos', () => {
  it('los pasos van numerados; sin pasos, solo la descripción', () => {
    const d: Block = { id: 'd', type: 'drawing', width: 400, height: 300, title: 'Ángulo inscrito', items: [], steps: [{ title: 'El arco', md: 'Fijamos $AB$.' }, { md: 'Desde $P$.' }] }
    const [text] = block(d, ctx)
    expect(text).toContain('Ángulo inscrito')
    expect(text).toContain('1. **El arco**: Fijamos $AB$.\n2. Desde $P$.')
    const [plain] = block({ ...d, steps: undefined }, ctx)
    expect(plain).not.toContain('1.')
  })
})
