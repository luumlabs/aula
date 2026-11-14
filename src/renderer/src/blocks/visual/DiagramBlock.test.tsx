import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import '@renderer/i18n'
import { StepScrubber } from './DiagramBlock'

describe('barra de pasos del diagrama', () => {
  it('arrastrarla no selecciona el texto de la lección (la columna de estudio se selecciona) ni desplaza en táctil', () => {
    const html = renderToStaticMarkup(<StepScrubber n={4} step={1} onGo={() => undefined} />)
    const slider = /<div role="slider"[^>]*>/.exec(html)?.[0] ?? ''
    expect(slider).toMatch(/\bselect-none\b/)
    expect(slider).toMatch(/\btouch-none\b/)
  })
})
