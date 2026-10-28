// Notas del informe de una ejecución que no son de una habilidad: qué pasó con la investigación en internet. Sin ellas, un
// curso podía citar «(Fuente: Wikipedia…)» sin ninguna fuente guardada y sin que nadie lo dijera. Puro (salvo `tr`).
import type { WebToolTotals } from '@engine/pipeline'
import { tr } from '@shared/ai/i18n'

/** Herramientas de internet de los agentes: las de Aula y las propias de Claude Code. */
export const WEB_TOOLS: ReadonlySet<string> = new Set(['web_search', 'fetch_url', 'save_web_source', 'search_wikipedia', 'WebSearch', 'WebFetch'])

/** Suma una llamada a una herramienta de internet (el primer error se guarda en una línea). */
export function countWebCall(t: WebToolTotals | undefined, ok: boolean, summary: string): WebToolTotals {
  const next: WebToolTotals = { ok: t?.ok ?? 0, failed: t?.failed ?? 0 }
  if (t?.firstError) next.firstError = t.firstError
  if (ok) next.ok += 1
  else {
    next.failed += 1
    if (!next.firstError) next.firstError = errorLine(summary)
  }
  return next
}

/** `{"error":"Could not save the page: …","ok":false}` → «Could not save the page: …». */
function errorLine(summary: string): string {
  const m = /"error"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(summary)
  const text = (m ? m[1] : summary).replace(/\\"/g, '"').replace(/<\/?tool_use_error>/g, '').trim()
  return Array.from(text).slice(0, 200).join('')
}

/** El motivo de los fallos dicho en llano (sin el texto técnico, que va en otro idioma). */
function failureReason(firstError: string | undefined): string {
  const e = firstError ?? ''
  if (/fetch failed|no pude conectar|could not connect|econn|enotfound|getaddrinfo|network|proxy/i.test(e)) return tr('no se pudo conectar con internet', "Aula couldn't connect to the internet")
  if (/timeout|tardó demasiado|took too long/i.test(e)) return tr('las páginas tardaron demasiado en responder', 'the pages took too long to answer')
  if (/captcha|verificación|demasiadas búsquedas|rate/i.test(e)) return tr('el buscador pidió esperar', 'the search engine asked to wait')
  return tr('las páginas no se pudieron leer', "the pages couldn't be read")
}

export interface ResearchFacts {
  allowWeb: boolean
  mode: 'create' | 'extend'
  /** Materiales del curso (todos) y cuántos son páginas guardadas de internet. */
  sources: number
  webSources: number
  web?: WebToolTotals
}

/**
 * El aviso sobre la investigación en internet, o nada si no hace falta:
 *  - creación sin ningún material: las lecciones salen de lo que Aula ya sabe (y por qué, si fallaron las búsquedas);
 *  - las herramientas de internet fallaron todas y no se guardó ninguna página: el curso se hizo sin internet.
 */
export function researchNote(f: ResearchFacts): string | undefined {
  if (!f.allowWeb) return undefined
  const failed = f.web?.failed ?? 0
  const okCalls = f.web?.ok ?? 0
  if (f.mode === 'create' && f.sources === 0) {
    if (failed > 0) {
      const why = failureReason(f.web?.firstError)
      return tr(`La búsqueda en internet falló (${why}): no se guardó ninguna fuente, así que las lecciones se basan en lo que Aula ya sabe y sus citas no remiten a ningún material guardado.`,
        `Web research failed (${why}): no sources were saved, so the lessons are based on what Aula already knows and their citations don't point to any saved material.`)
    }
    return tr('No se guardó ninguna fuente de internet: las lecciones se basan en lo que Aula ya sabe.', 'No web sources were saved: the lessons are based on what Aula already knows.')
  }
  if (failed > 0 && okCalls === 0 && f.webSources === 0) {
    const why = failureReason(f.web?.firstError)
    return tr(`La búsqueda en internet falló (${why}): no se guardó ninguna página; se usaron tus materiales y lo que Aula ya sabe.`,
      `Web research failed (${why}): no pages were saved; your materials and what Aula already knows were used instead.`)
  }
  return undefined
}
