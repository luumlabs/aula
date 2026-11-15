import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import '@renderer/i18n'
import { FigureExportAction } from './FigureExportAction'

afterEach(() => vi.unstubAllGlobals())

describe('acción de exportación', () => {
  it('oculta el guardado nativo en una sesión remota sin capturar la figura', () => {
    vi.stubGlobal('window', { aula: { remote: true } })
    const capture = vi.fn()
    expect(renderToStaticMarkup(<FigureExportAction kind="structure" captureSvg={capture} />)).toBe('')
    expect(capture).not.toHaveBeenCalled()
  })
  it('ofrece un botón identificado, con estado de menú, en escritorio', () => {
    const html = renderToStaticMarkup(<FigureExportAction kind="structure" captureSvg={vi.fn()} />)
    expect(html).toContain('data-figure-export="structure"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-busy="false"')
  })
})
