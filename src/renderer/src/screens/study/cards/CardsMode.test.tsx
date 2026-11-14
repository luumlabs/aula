import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Flashcard } from '@shared/schema'
import { FlipCard } from './CardsMode'

const CARD: Flashcard = { id: 'c1', kind: 'basic', front: '¿Capital de Francia?', back: 'París', tags: [] }

/** Las dos caras (frente y dorso), en el orden en que se pintan. */
function faces(flipped: boolean): string[] {
  const html = renderToStaticMarkup(<FlipCard card={CARD} flipped={flipped} onFlip={() => undefined} ink="var(--accent)" assetUrl={(a) => a} />)
  return [...html.matchAll(/<div [^>]*backface-visibility:hidden[^>]*>/g)].map((m) => m[0])
}

const isHidden = (tag: string): boolean => /\sinert=""/.test(tag) && /aria-hidden="true"/.test(tag) && /\bselect-none\b/.test(tag)
const isShown = (tag: string): boolean => !/\sinert/.test(tag) && !/aria-hidden/.test(tag) && !/\bselect-none\b/.test(tag)

describe('tarjeta que se gira', () => {
  it('sin girar, el dorso (la respuesta) no se selecciona ni se copia ni lo lee el lector de pantalla', () => {
    const [front, back] = faces(false)
    expect(isShown(front)).toBe(true)
    expect(isHidden(back)).toBe(true)
  })
  it('girada, al revés: el frente queda fuera', () => {
    const [front, back] = faces(true)
    expect(isHidden(front)).toBe(true)
    expect(isShown(back)).toBe(true)
  })
})
