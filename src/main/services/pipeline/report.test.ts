// Notas del informe sobre la investigación en internet (el curso C del juez citaba Wikipedia sin ninguna fuente guardada).
import { describe, expect, it } from 'vitest'
import { countWebCall, researchNote, WEB_TOOLS } from './report'

describe('researchNote', () => {
  it('creación sin materiales y con las búsquedas fallidas: lo dice, con el motivo en llano', () => {
    let web = countWebCall(undefined, false, '{"error":"Could not save the page: No pude conectar: fetch failed","ok":false}')
    web = countWebCall(web, false, '{"error":"Search failed: No pude conectar: fetch failed","ok":false}')
    expect(web).toEqual({ ok: 0, failed: 2, firstError: 'Could not save the page: No pude conectar: fetch failed' })
    const note = researchNote({ allowWeb: true, mode: 'create', sources: 0, webSources: 0, web })
    expect(note).toBe('La búsqueda en internet falló (no se pudo conectar con internet): no se guardó ninguna fuente, así que las lecciones se basan en lo que Aula ya sabe y sus citas no remiten a ningún material guardado.')
  })

  it('creación sin materiales en la que nadie guardó fuentes (sin fallos): aviso más suave', () => {
    expect(researchNote({ allowWeb: true, mode: 'create', sources: 0, webSources: 0, web: { ok: 3, failed: 0 } })).toContain('No se guardó ninguna fuente de internet')
  })

  it('con fuentes guardadas, o sin permiso para internet, no hay aviso', () => {
    expect(researchNote({ allowWeb: true, mode: 'create', sources: 2, webSources: 2, web: { ok: 4, failed: 1 } })).toBeUndefined()
    expect(researchNote({ allowWeb: false, mode: 'create', sources: 0, webSources: 0 })).toBeUndefined()
  })

  it('con materiales propios pero internet caído del todo: se avisa de que no se usó', () => {
    const note = researchNote({ allowWeb: true, mode: 'extend', sources: 3, webSources: 0, web: { ok: 0, failed: 2, firstError: 'La página tardó demasiado en responder.' } })
    expect(note).toContain('las páginas tardaron demasiado en responder')
    expect(note).toContain('se usaron tus materiales')
  })

  it('cuenta las herramientas de internet de Aula y las de Claude Code', () => {
    for (const t of ['web_search', 'fetch_url', 'save_web_source', 'search_wikipedia', 'WebSearch', 'WebFetch']) expect(WEB_TOOLS.has(t)).toBe(true)
    expect(WEB_TOOLS.has('search_sources')).toBe(false)
    expect(countWebCall({ ok: 1, failed: 0 }, true, '')).toEqual({ ok: 2, failed: 0 })
  })
})
