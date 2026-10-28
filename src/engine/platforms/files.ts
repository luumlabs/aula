// Enlaces de archivos de las plataformas (port de BrowserKit/Downloads/StudyFileLinks.swift y CanvasLinks): convierte la página
// de un archivo en su descarga directa (con la sesión) y reconoce los enlaces que ya son archivos.

function parse(url: string): URL | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null
  } catch {
    return null
  }
}

/** Dirección de descarga directa, o null si no es la página de un archivo conocida (entonces se descarga tal cual). */
export function directDownloadURL(url: string): string | null {
  const u = parse(url)
  if (!u) return null
  return canvasFile(u) ?? moodleFile(u) ?? brightspaceFile(u) ?? googleFile(u) ?? sharePointFile(u)
}

/** ¿Es un enlace a un archivo de una plataforma (directo o convertible)? Sirve para descargar en vez de abrir la página. */
export function isStudyFileLink(url: string): boolean {
  if (directDownloadURL(url) != null) return true
  const u = parse(url)
  if (!u) return false
  const path = u.pathname.toLowerCase()
  // ya directos: Moodle, Blackboard, Sakai, Schoology, Open edX
  return path.includes('/pluginfile.php/') || path.startsWith('/bbcswebdav/') || path.startsWith('/access/content/') ||
    (path.startsWith('/attachment/') && path.includes('/source/')) || path.includes('/asset-v1:') || path.startsWith('/assets/courseware/')
}

/** Canvas: `…/courses/1/files/2?verifier=X&wrap=1` → `…/courses/1/files/2/download?download_frd=1&verifier=X`. */
export function canvasFile(u: URL): string | null {
  const segs = u.pathname.split('/').filter(Boolean)
  const i = segs.lastIndexOf('files')
  if (i < 0 || i + 1 >= segs.length || !/^\d+$/.test(segs[i + 1])) return null
  if (i + 2 < segs.length && !['download', 'preview', 'file_preview', 'inline_view'].includes(segs[i + 2])) return null
  const out = new URL(u.toString())
  out.pathname = '/' + [...segs.slice(0, i + 2), 'download'].join('/')
  const verifier = u.searchParams.get('verifier')
  out.search = ''
  out.searchParams.set('download_frd', '1')
  if (verifier) out.searchParams.set('verifier', verifier)
  out.hash = ''
  return out.toString()
}

/** Moodle: `…/mod/resource/view.php?id=N` → `…&redirect=1`; `…/pluginfile.php/…` → `…?forcedownload=1`. */
function moodleFile(u: URL): string | null {
  const path = u.pathname.toLowerCase()
  const out = new URL(u.toString())
  out.hash = ''
  if (path.endsWith('/mod/resource/view.php') && u.searchParams.has('id')) {
    if (u.searchParams.get('redirect') === '1') return u.toString()
    out.searchParams.set('redirect', '1')
    return out.toString()
  }
  if (path.includes('/pluginfile.php/')) {
    if (u.searchParams.has('forcedownload')) return u.toString()
    out.searchParams.set('forcedownload', '1')
    return out.toString()
  }
  return null
}

/** Brightspace: `…/d2l/le/content/<ou>/viewContent/<topic>/View` → `…/topics/files/download/<topic>/DirectFileTopicDownload`. */
function brightspaceFile(u: URL): string | null {
  const segs = u.pathname.split('/').filter(Boolean)
  const i = segs.findIndex((s) => s.toLowerCase() === 'viewcontent')
  if (i < 3 || i + 1 >= segs.length) return null
  if (segs[i - 3].toLowerCase() !== 'le' || segs[i - 2].toLowerCase() !== 'content') return null
  if (!/^\d+$/.test(segs[i - 1]) || !/^\d+$/.test(segs[i + 1])) return null
  const prefix = segs.slice(0, i - 2).join('/')
  const out = new URL(u.origin)
  out.pathname = `/${prefix}/content/${segs[i - 1]}/topics/files/download/${segs[i + 1]}/DirectFileTopicDownload`
  return out.toString()
}

/** Drive `file/d/<id>/view` y `open?id=` → descarga; Docs → PDF, Slides → PDF, Sheets → Excel (exportación oficial). */
function googleFile(u: URL): string | null {
  const host = u.hostname.toLowerCase()
  const segs = u.pathname.split('/').filter(Boolean)
  const idAfter = (marker: string): string | null => {
    const i = segs.indexOf(marker)
    if (i < 0 || i + 1 >= segs.length) return null
    const v = segs[i + 1]
    return v.length >= 10 && /^[A-Za-z0-9_-]+$/.test(v) ? v : null
  }
  if (host === 'drive.google.com') {
    const fid = (segs[0] === 'file' ? idAfter('d') : null) ?? (segs[segs.length - 1] === 'open' || segs[segs.length - 1] === 'uc' ? u.searchParams.get('id') : null)
    if (!fid) return null
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fid)}&confirm=t`
  }
  if (host === 'docs.google.com') {
    const kinds: [string, string][] = [['document', 'pdf'], ['presentation', 'pdf'], ['spreadsheets', 'xlsx']]
    for (const [kind, format] of kinds) {
      if (segs[0] !== kind) continue
      const did = idAfter('d')
      if (!did) return null
      if (segs.includes('export')) return u.toString()
      return `https://docs.google.com/${kind}/d/${did}/export?format=${format}`
    }
  }
  return null
}

/** SharePoint: visor (`Doc.aspx?sourcedoc={GUID}`) → `download.aspx?UniqueId=GUID`; enlace de un archivo → `?download=1`. */
function sharePointFile(u: URL): string | null {
  const host = u.hostname.toLowerCase()
  if (!host.endsWith('.sharepoint.com')) return null
  const path = u.pathname.toLowerCase()
  if (/\/_layouts\/15\/(doc|doc2|wopiframe)\.aspx$/.test(path)) {
    let raw: string | null = null
    for (const [k, v] of u.searchParams) if (k.toLowerCase() === 'sourcedoc') raw = v
    if (!raw) return null
    const guid = raw.replace(/[{} ]/g, '')
    if (guid.length < 32) return null
    const out = new URL(u.origin)
    out.pathname = u.pathname.replace(/\/[^/]+$/, '/download.aspx')
    out.searchParams.set('UniqueId', guid)
    return out.toString()
  }
  if (path.endsWith('/_layouts/15/download.aspx')) return u.toString()
  const sharing = ['/:b:/', '/:w:/', '/:p:/', '/:x:/', '/:u:/', '/:i:/', '/:v:/', '/:t:/'].some((p) => path.startsWith(p))
  const ext = (path.match(/\.([a-z0-9]+)$/) ?? [])[1] ?? ''
  const fileLike = !!ext && !['aspx', 'html', 'htm', 'php'].includes(ext)
  if (!sharing && !fileLike) return null
  if (u.searchParams.has('download')) return u.toString()
  const out = new URL(u.toString())
  out.hash = ''
  out.searchParams.set('download', '1')
  return out.toString()
}
