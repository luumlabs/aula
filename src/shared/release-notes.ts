// Notas de la versión para mostrarlas en la app. El archivo de notas (docs/release-notes/<v>.md, que electron-builder
// mete en latest*.yml) trae las dos lenguas, cada una marcada con `<!-- lang:en -->` / `<!-- lang:es -->` (GitHub no
// muestra los comentarios). Si no hay marcas, se usa entero. Si llegan en HTML (el feed de GitHub), se pasa a texto.

/** Normaliza lo que da electron-updater (texto, lista de notas por versión o nada). */
export function releaseNotesText(raw: unknown): string | undefined {
  if (typeof raw === 'string') return clean(raw)
  if (Array.isArray(raw)) {
    const parts = raw
      .map((n) => (n && typeof n === 'object' && typeof (n as { note?: unknown }).note === 'string' ? (n as { note: string }).note : ''))
      .filter(Boolean)
    return parts.length ? clean(parts.join('\n\n')) : undefined
  }
  return undefined
}

function clean(s: string): string | undefined {
  let t = s.trim()
  if (/^<[a-z!]/i.test(t) && !/<!--\s*lang:/i.test(t)) t = htmlToText(t)
  t = t.trim()
  return t ? t.slice(0, 20000) : undefined
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
}

/** La parte de las notas en el idioma pedido (o todas si no están marcadas). Sin la tabla de instalación. */
export function notesForLanguage(notes: string | undefined, lang: string): string | undefined {
  if (!notes) return undefined
  const marks = [...notes.matchAll(/<!--\s*lang:([a-z-]+)\s*-->/gi)]
  let text = notes
  if (marks.length) {
    const want = lang.toLowerCase().slice(0, 2)
    const i = Math.max(0, marks.findIndex((m) => m[1].toLowerCase().startsWith(want)))
    const start = (marks[i].index ?? 0) + marks[i][0].length
    const end = marks[i + 1]?.index ?? notes.length
    text = notes.slice(start, end)
  }
  // «Install / Instalar» explica cómo bajarla: dentro de la app sobra
  text = text.replace(/\n#{2,3}\s*(Install|Instalar|Installation|Instalación)\b[\s\S]*?(?=\n#{1,3}\s|$)/i, '\n')
  // el título grande (# Aula 0.1 — …) ya lo pone la interfaz
  text = text.replace(/^\s*#\s+[^\n]*\n/, '')
  const t = text.trim()
  return t || undefined
}
