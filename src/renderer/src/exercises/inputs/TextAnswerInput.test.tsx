import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { AnswerOf } from '@shared/schema/exercises'
import '@renderer/i18n'
import { initialDraft } from '../model'

// el tooltip de la tecla √π abre un portal en `document` (aquí no hay DOM): se deja el botón tal cual. Y la pantalla, con
// ratón y teclado o solo con el dedo, la elige cada prueba
const device = vi.hoisted(() => ({ touch: false }))
vi.mock('@renderer/design', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@renderer/design')>()
  return { ...mod, Tooltip: ({ children }: { children: ReactNode }) => children, useTouchOnly: () => device.touch }
})

import { TextAnswerInput } from './TextAnswerInput'

type Typed = AnswerOf<'short'> | AnswerOf<'numeric'> | AnswerOf<'expression'> | AnswerOf<'chem'>

const SHORT: AnswerOf<'short'> = { kind: 'short', accepted: ['osmosis'], keywords: [], typoTolerance: true, aiGrade: false }
const NUMERIC: AnswerOf<'numeric'> = { kind: 'numeric', value: '2', alternatives: [], absTol: 1e-6, relTol: 1e-6, form: 'any', unitMode: 'ignore', angle: 'radians' }
const EXPRESSION: AnswerOf<'expression'> = { kind: 'expression', expected: '1 + sin(x)', domainMin: -1, domainMax: 1, form: 'any', forbidden: [], angle: 'radians' }
const CHEM: AnswerOf<'chem'> = { kind: 'chem', mode: 'formula', expected: 'H2O' }

function render(answer: Typed, opts: { text?: string; locked?: boolean } = {}): string {
  const draft = { ...initialDraft({ id: 'x1', answer }), text: opts.text ?? '' }
  return renderToStaticMarkup(
    <TextAnswerInput
      answer={answer}
      draft={draft}
      set={() => undefined}
      locked={opts.locked ?? false}
      reveal="none"
      exerciseId="x1"
      lang="en"
      ctx={{ packId: null, language: 'en', assetUrl: (p) => p, mode: 'lesson' }}
      onSubmit={() => undefined}
      autoFocus={false}
      active={false}
      exam={false}
    />
  )
}

const tag = (html: string, name: string): string => html.match(new RegExp(`<${name}\\b[^>]*>`))?.[0] ?? ''

describe('respuesta corta de varias líneas', () => {
  it('es un campo que crece: un textarea de una línea, sin asa para estirarlo, marcado como campo de respuesta', () => {
    const html = render(SHORT)
    const area = tag(html, 'textarea')
    expect(area).not.toBe('')
    expect(html).not.toMatch(/<input\b/)
    expect(area).toContain('rows="1"')
    expect(area).toContain('resize-none')
    expect(area).toContain('data-answer-field=""')
    expect(area).toContain('dir="auto"')
  })

  it('Intro sigue comprobando: la tecla del teclado de la pantalla dice «OK», no «salto de línea»', () => {
    expect(tag(render(SHORT), 'textarea')).toMatch(/enterKeyHint="done"/i)
  })

  it('el lector de pantalla sabe que es de varias líneas, cómo se llama y que Mayús+Intro empieza otra línea', () => {
    const html = render(SHORT)
    const area = tag(html, 'textarea')
    expect(area).toContain('aria-multiline="true"')
    expect(area).toMatch(/aria-label="(Your answer|Tu respuesta)"/)
    const id = area.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(id).toBeTruthy()
    // solo lo que siempre es verdad: Intro no siempre comprueba (en el simulacro pasa a la siguiente; tras un fallo, reintenta)
    const hint = html.match(new RegExp(`<span id="${id}"[^>]*>([^<]*)<`))
    expect(hint?.[1]).toMatch(/^(Shift\+Enter starts a new line\.|Mayús\+Intro empieza una línea nueva\.)$/)
    // oculta: se lee como descripción del campo, pero no se repite al recorrer la página ni se copia al seleccionar
    expect(hint?.[0]).toContain('hidden=""')
    expect(hint?.[0]).not.toContain('sr-only')
  })

  it('con el dedo no hay Mayús+Intro (Intro comprueba, como en el chat): el campo no lo promete', () => {
    device.touch = true
    try {
      const html = render(SHORT)
      expect(tag(html, 'textarea')).not.toContain('aria-describedby')
      expect(html).not.toMatch(/Shift\+Enter|Mayús\+Intro/)
    } finally {
      device.touch = false
    }
  })

  it('lo escrito (o pegado) con saltos de línea se conserva tal cual', () => {
    expect(render(SHORT, { text: 'does not\nexist' })).toContain('>does not\nexist</textarea>')
  })

  it('ya comprobada y cerrada: de solo lectura y sin la pista de las teclas', () => {
    const area = tag(render(SHORT, { text: 'osmosis', locked: true }), 'textarea')
    expect(area).toMatch(/readOnly=""/i)
    expect(area).not.toContain('aria-describedby')
  })
})

describe('las respuestas de matemáticas y química', () => {
  it('siguen en una línea (un input, Intro comprueba), con su teclado de símbolos', () => {
    for (const answer of [NUMERIC, EXPRESSION, CHEM]) {
      const html = render(answer)
      expect(html, answer.kind).not.toMatch(/<textarea\b/)
      const input = tag(html, 'input')
      expect(input, answer.kind).toContain('data-answer-field=""')
      expect(input, answer.kind).toMatch(/enterKeyHint="done"/i)
      expect(input, answer.kind).not.toContain('aria-multiline')
      expect(html, answer.kind).toContain('√π')
    }
  })
})
