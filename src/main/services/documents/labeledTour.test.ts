import { describe, expect, it } from 'vitest'
import { decodeBlock } from '@shared/schema'
import { interactive } from './markdown'

describe('una figura con recorrido guiado en Markdown', () => {
  it('lista sus partes y, después, los pasos numerados', () => {
    const b = decodeBlock({ type: 'labeled', title: 'El corazón', asset: 'h.png', alt: 'corazón', parts: [{ id: 'ao', name: 'Aorta', x: 0.5, y: 0.2 }], steps: [{ title: 'Sale', md: 'Por la aorta.', parts: ['ao'] }, 'Vuelve.'] })!
    const md = interactive(b, 'es')
    expect(md).toContain('- Aorta')
    expect(md).toContain('1. **Sale** — Por la aorta.\n2. Vuelve.')
  })
})
