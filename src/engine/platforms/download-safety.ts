// Seguridad de lo que se descarga (port de BrowserKit/Downloads/DownloadSafety.swift y BaseKit/ExecutableFiles.swift):
// nunca se guarda un programa, nunca se ejecuta nada, nombres saneados y tipos comprobados. Puro (los bytes llegan de fuera).

/** Extensiones que nunca se guardan: apps, instaladores, imágenes de disco, guiones y lanzadores. */
export const BLOCKED_EXTENSIONS = new Set([
  'app', 'pkg', 'mpkg', 'dmg', 'iso', 'img', 'sparseimage', 'sparsebundle', 'command', 'tool', 'sh', 'bash', 'zsh', 'csh',
  'ksh', 'tcsh', 'fish', 'terminal', 'workflow', 'action', 'prefpane', 'kext', 'plugin', 'bundle', 'osax', 'scpt', 'scptd',
  'applescript', 'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'vbs', 'vbe', 'ps1', 'jar', 'apk', 'deb', 'rpm', 'dylib', 'so',
  'webloc', 'inetloc', 'fileloc', 'mobileconfig', 'xpi', 'crx', 'run', 'bin', 'out', 'elf', 'lnk', 'url', 'desktop', 'appimage',
  'msix', 'appx', 'reg', 'hta', 'wsf', 'cpl', 'dll', 'sys', 'pif', 'gadget', 'application', 'msp', 'mst', 'jse'
])

/** Tipos de contenido que nunca se aceptan. */
const BLOCKED_MIME = [
  'application/x-msdownload', 'application/x-msdos-program', 'application/x-executable', 'application/x-mach-binary', 'application/x-elf',
  'application/vnd.android.package-archive', 'application/x-apple-diskimage', 'application/x-sh', 'application/x-shellscript',
  'application/java-archive', 'application/x-java-archive', 'application/x-ms-installer', 'application/x-msi', 'application/x-dosexec',
  'application/vnd.microsoft.portable-executable', 'application/x-debian-package', 'application/x-rpm', 'application/x-xpinstall',
  'application/x-chrome-extension', 'application/hta'
]

/** Tipos MIME comunes → extensión (para nombres sin extensión). */
const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt', 'text/csv': 'csv', 'text/markdown': 'md', 'text/html': 'html', 'application/rtf': 'rtf',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/svg+xml': 'svg',
  'application/zip': 'zip', 'application/epub+zip': 'epub', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/mp4': 'mp4',
  'application/json': 'json', 'application/vnd.oasis.opendocument.text': 'odt', 'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods', 'text/calendar': 'ics'
}

export function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? ''
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

export function hasBlockedExtension(name: string): boolean {
  return BLOCKED_EXTENSIONS.has(extensionOf(name))
}

export function mimeBase(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0].trim().toLowerCase()
}

export function isBlockedMime(mime: string | null | undefined): boolean {
  const m = mimeBase(mime)
  return !!m && BLOCKED_MIME.includes(m)
}

/** ¿Llegó una página web en vez del archivo? (casi siempre: la sesión caducó y es la página de acceso) */
export function looksLikeWebPage(mime: string | null | undefined, head?: Uint8Array, requestedName?: string): boolean {
  const m = mimeBase(mime)
  const wantedHTML = ['html', 'htm', 'xhtml'].includes(extensionOf(requestedName ?? ''))
  if (wantedHTML) return false
  if (m === 'text/html' || m === 'application/xhtml+xml') return true
  if (head && head.length > 0) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(head.subarray(0, 512)).trimStart().toLowerCase()
    return text.startsWith('<!doctype html') || text.startsWith('<html')
  }
  return false
}

/**
 * ¿Es un ejecutable por su contenido? Mach-O/universal, PE («MZ»), ELF, instalador xar («xar!»), guion con «#!» sin extensión de
 * documento, o imagen de disco UDIF (remolque «koly» en los últimos 512 bytes, si se pasa `tail`).
 */
export function isExecutableContent(head: Uint8Array, name: string, tail?: Uint8Array): boolean {
  if (hasBlockedExtension(name)) return true
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return true // MZ
  if (head.length >= 4) {
    const be = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(be)) {
      // 0xCAFEBABE también es un .class de Java: igualmente fuera
      return true
    }
    if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return true // ELF
    if (head[0] === 0x78 && head[1] === 0x61 && head[2] === 0x72 && head[3] === 0x21) return true // xar!
  }
  if (head.length >= 2 && head[0] === 0x23 && head[1] === 0x21 && !extensionOf(name)) return true // #!
  if (tail && tail.length >= 4 && tail[0] === 0x6b && tail[1] === 0x6f && tail[2] === 0x6c && tail[3] === 0x79) return true // koly
  return false
}

/** Nombre seguro: sin rutas, sin controles ni caracteres de dirección (que disfrazan extensiones), sin «:», ≤ 180. */
export function sanitizeFilename(raw: string, fallback = 'archivo'): string {
  let s = (raw ?? '').replace(/\\/g, '/')
  s = s.split('/').pop() ?? ''
  s = [...s]
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0
      if (ch === '\t' || ch === '\n' || ch === '\r') return ' '
      if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp < 0xa0)) return ''
      if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x200e || cp === 0x200f) return ''
      return ch
    })
    .join('')
  s = s.replace(/:/g, '-').replace(/[<>"|?*]/g, '_')
  s = s.split(/\s+/).filter(Boolean).join(' ')
  s = s.replace(/^[.\s-]+/, '').replace(/[.\s]+$/, '')
  // nombres reservados de Windows
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = '_' + s
  if (!s) return fallback
  if ([...s].length > 180) {
    const ext = extensionOf(s)
    const base = ext ? s.slice(0, s.length - ext.length - 1) : s
    s = [...base].slice(0, Math.max(1, 180 - ext.length - 1)).join('') + (ext ? '.' + ext : '')
  }
  return s
}

/** Añade la extensión del tipo MIME si el nombre no la tiene. */
export function ensureExtension(name: string, mime: string | null | undefined): string {
  if (extensionOf(name)) return name
  const ext = MIME_EXTENSIONS[mimeBase(mime)]
  return ext ? `${name}.${ext}` : name
}

/** Nombre del archivo desde una cabecera Content-Disposition (`filename*=UTF-8''…` o `filename="…"`). */
export function filenameFromContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''))
    } catch { /* sigue */ }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header)
  if (plain) return (plain[2] ?? plain[1]).trim()
  return null
}

/** Nombre a partir de la dirección (último segmento decodificado) o null. */
export function filenameFromURL(url: string): string | null {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    if (!last) return null
    const name = decodeURIComponent(last)
    return /\.[A-Za-z0-9]{1,8}$/.test(name) ? name : null
  } catch {
    return null
  }
}

/** Candidatos de nombre sin sobrescribir: «tema.pdf», «tema (2).pdf», «tema (3).pdf»… */
export function uniqueNameCandidates(name: string, max = 500): string[] {
  const ext = extensionOf(name)
  const base = ext ? name.slice(0, name.length - ext.length - 1) : name
  const out = [name]
  for (let n = 2; n <= max; n++) out.push(`${base} (${n})${ext ? '.' + ext : ''}`)
  return out
}
