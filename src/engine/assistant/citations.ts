// Citas de materiales en las respuestas (port de AssistantCitations.swift): «(Fuente: Apuntes de la parábola, p. 3)» se convierte
// en un enlace `aula-cita://abrir?t=…&p=3`. También las líneas «Basado en: …» de las conversaciones antiguas del tutor y las
// fuentes en otros idiomas («Source:», «Fonte:», «Quelle:»…). La búsqueda del material se hace con `bestCitationMatch`.
import { foldPlain } from './fold'

export const CITATION_SCHEME = 'aula-cita'

export interface Citation {
  title: string
  page?: number
}

const ANY_LABEL = /(fuente|fuentes|source|sources|fonte|fontes|quelle|quellen|basado en|based on)\s*:/i
const PAREN = /\((fuentes?|sources?|fontes?|quellen?)\s*:\s*([^()[\]\n]{2,240}?)\)/gi
const BASED = /(basado en|based on)\s*:\s*([^\n_[\]]{2,300})/gi
const PAGE = /[,\s]\s*(?:p\.|pp\.|pág\.|págs\.|pag\.|página|páginas|pagina|page|pages|s\.|seite)\s*(\d{1,4})(?:\s*[-–]\s*\d{1,4})?\s*$/i

const trimChars = (s: string, chars: string): string => {
  let a = 0, b = s.length
  while (a < b && chars.includes(s[a])) a++
  while (b > a && chars.includes(s[b - 1])) b--
  return s.slice(a, b)
}

/** «Apuntes de la parábola, p. 3» → título y página (la primera de un rango). */
export function parseCitation(text: string): Citation | undefined {
  const t = trimChars(text.trim(), '.,')
  if (!t) return undefined
  const m = PAGE.exec(t)
  if (m) {
    const title = trimChars(t.slice(0, m.index).trim(), ',').trim()
    return { title, page: Number(m[1]) }
  }
  // sin página: solo si parece un título (no una frase larga)
  if (Array.from(t).length > 120) return undefined
  return { title: t }
}

export function citationURL(c: Citation): string {
  const q = new URLSearchParams({ t: c.title })
  if (c.page !== undefined) q.set('p', String(c.page))
  return `${CITATION_SCHEME}://abrir?${q.toString().replace(/\+/g, '%20')}`
}

export function parseCitationURL(url: string): Citation | undefined {
  if (!url.startsWith(`${CITATION_SCHEME}://`)) return undefined
  const q = url.indexOf('?')
  if (q < 0) return undefined
  const params = new URLSearchParams(url.slice(q + 1))
  const t = params.get('t')
  if (!t) return undefined
  const p = Number(params.get('p'))
  return Number.isInteger(p) && params.get('p') ? { title: t, page: p } : { title: t }
}

/** Una o varias citas separadas por «;» (o «·»): cada una con su enlace; lo que no parezca una cita queda igual. */
function linkParts(body: string, separators: string[]): string {
  let parts = [body]
  for (const sep of separators) parts = parts.flatMap((p) => p.split(sep))
  const joiner = body.includes(' · ') && separators.includes(' · ') ? ' · ' : '; '
  return parts.map((raw) => {
    const p = raw.trim()
    const c = parseCitation(p)
    if (!c || Array.from(c.title).length < 2) return p
    const text = p.replace(/\[/g, '(').replace(/\]/g, ')')
    return `[${text}](${citationURL(c)})`
  }).join(joiner)
}

/** Sustituye cada coincidencia salvo lo que ya es un enlace («[…](…)») o está dentro de un código. */
function replaceOutsideCode(text: string, re: RegExp, make: (label: string, body: string) => string): string {
  re.lastIndex = 0
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const before = text.slice(0, m.index)
    if (before.endsWith('[') || before.split('`').length % 2 === 0) continue
    out += text.slice(last, m.index) + make(m[1], m[2])
    last = m.index + m[0].length
  }
  return out + text.slice(last)
}

/** «(Fuente: A, p. 3; B, p. 5)» → «(Fuente: [A, p. 3](aula-cita://…); [B, p. 5](aula-cita://…))». */
export function linkCitations(markdown: string): string {
  if (!ANY_LABEL.test(markdown)) return markdown
  let out = replaceOutsideCode(markdown, PAREN, (label, body) => `(${label}: ` + linkParts(body, [';']) + ')')
  out = replaceOutsideCode(out, BASED, (label, body) => `${label}: ` + linkParts(body.trim(), [' · ', ';']))
  return out
}

/** Las citas de un texto (sin repetir), sin tocar el texto. */
export function extractCitations(markdown: string): Citation[] {
  const found: Citation[] = []
  const seen = new Set<string>()
  const add = (body: string, seps: string[]): void => {
    let parts = [body]
    for (const sep of seps) parts = parts.flatMap((p) => p.split(sep))
    for (const raw of parts) {
      const c = parseCitation(raw.trim())
      if (!c || Array.from(c.title).length < 2) continue
      const key = normTitle(c.title) + '#' + (c.page ?? '')
      if (seen.has(key)) continue
      seen.add(key)
      found.push(c)
    }
  }
  for (const re of [PAREN, BASED]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(markdown))) {
      const before = markdown.slice(0, m.index)
      if (before.split('`').length % 2 === 0) continue
      add(m[2], re === PAREN ? [';'] : [' · ', ';'])
    }
  }
  return found.slice(0, 12)
}

/** Sin acentos, sin extensión y sin signos. */
export function normTitle(s: string): string {
  let t = foldPlain(s)
  t = t.replace(/\.(pdf|docx?|pptx?|key|pages|txt|md|png|jpe?g|heic|epub)$/, '')
  t = Array.from(t).map((ch) => (/[\p{L}\p{N}]/u.test(ch) ? ch : ' ')).join('')
  return t.split(' ').filter((x) => x).join(' ')
}

/** Lo que hace falta de un material para elegir el citado. */
export interface CitableSource { id: string; title: string }

/** El material citado: el de título más parecido en los almacenes dados, por orden de preferencia (`rank` = su posición). */
export function bestCitationMatch<T extends { sources: CitableSource[] }>(title: string, stores: T[]): { store: T; source: CitableSource } | undefined {
  const wanted = normTitle(title)
  if (wanted.length < 2) return undefined
  let best: { score: number; store: T; source: CitableSource } | undefined
  stores.forEach((store, rank) => {
    for (const m of store.sources) {
      const have = normTitle(m.title)
      if (!have) continue
      let score = 0
      if (have === wanted) score = 100
      else if (have.startsWith(wanted) || wanted.startsWith(have)) score = 70
      else if (have.includes(wanted) || wanted.includes(have)) score = 55
      else {
        const a = new Set(have.split(' ')), b = new Set(wanted.split(' '))
        const common = [...a].filter((w) => b.has(w) && w.length > 2).length
        if (common >= 2 && common / Math.max(1, b.size) >= 0.6) score = 40 + common
      }
      if (score <= 0) continue
      score -= rank // a igualdad, el almacén preferido
      if (!best || score > best.score) best = { score, store, source: m }
    }
  })
  return best ? { store: best.store, source: best.source } : undefined
}

export const AssistantCitations = { linked: linkCitations, extract: extractCitations, citation: parseCitation, url: citationURL, parse: parseCitationURL, norm: normTitle, resolve: bestCitationMatch }
