// Protocolos propios de la app:
//   app://aula/<ruta>  → la interfaz (out/renderer: index.html, raster.html, sus scripts, estilos, fuentes, KaTeX, pdf.js…).
//     Antes se cargaba con file://, y una página file:// (con el fusible GrantFileProtocolExtraPrivileges) podía leer
//     CUALQUIER archivo del disco con fetch('file:///…'). Ahora la página tiene su propio origen, la CSP no admite file: y
//     el fusible está apagado (electron-builder.yml): fetch('file://…') falla.
//   aula-asset://pack/<id>/<ruta> → archivos de un curso (imágenes, modelos 3D, PDF originales), sin salir de su carpeta.
import { net, protocol } from 'electron'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { paths } from '@main/services/paths'

export const ASSET_SCHEME = 'aula-asset'
export const APP_SCHEME = 'app'
export const APP_HOST = 'aula'
/** Origen de la interfaz (para CORS de aula-asset y para reconocer la página de la app). */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

/** Privilegios de los dos esquemas (se registran antes de `app.whenReady`). */
export const SCHEME_PRIVILEGES: Electron.CustomScheme[] = [
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true } },
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]

/** CSP que acompaña a cada página de la interfaz (la de index.html + lo que una meta no puede decir: frame-ancestors). */
export const APP_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: aula-asset:; " +
  "media-src 'self' data: blob: aula-asset:; font-src 'self' data:; connect-src 'self' aula-asset: data: blob:; worker-src 'self' blob:; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'"

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream'
}

export function mimeFor(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** app://aula/<ruta> → archivo dentro de `root` (la carpeta out/renderer), o null si sale de ella o no es de la app. */
export function resolveAppUrl(url: string, root: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${APP_SCHEME}:` || u.hostname !== APP_HOST || u.username || u.password || u.port) return null
  let parts: string[]
  try {
    parts = u.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p))
  } catch {
    return null
  }
  if (parts.some((p) => !p || p === '.' || p === '..' || /[\\/\0:]/.test(p))) return null
  if (parts.length === 0) parts = ['index.html']
  const base = resolve(root)
  const full = join(base, ...parts)
  return full.startsWith(base + sep) ? full : null
}

/** La carpeta de la interfaz compilada (dentro de app.asar en la app instalada). */
export function rendererRoot(): string {
  return join(__dirname, '../renderer')
}

/** Sirve la interfaz por app://aula (solo GET; cada página con su CSP; nada fuera de out/renderer). */
export function registerAppProtocol(root = rendererRoot()): void {
  protocol.handle(APP_SCHEME, async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
    const file = resolveAppUrl(req.url, root)
    if (!file) return new Response('Not found', { status: 404 })
    let data: Buffer
    try {
      data = await readFile(file)
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const type = mimeFor(file)
    const headers: Record<string, string> = { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' }
    if (type.startsWith('text/html')) headers['content-security-policy'] = APP_CSP
    return new Response(req.method === 'HEAD' ? null : new Uint8Array(data), { status: 200, headers })
  })
}

/** Partes de un curso que la interfaz puede leer: sus imágenes/modelos y sus materiales. */
const PACK_AREAS = new Set(['assets', 'sources', 'documents'])

export function resolveAssetUrl(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  let parts: string[]
  try {
    parts = u.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p))
  } catch {
    return null
  }
  // ningún trozo puede ser «.», «..», vacío ni llevar separadores (tampoco codificados)
  if (parts.some((p) => !p || p === '.' || p === '..' || /[\\/\0]/.test(p))) return null
  if (u.hostname === 'pack' && parts.length >= 2) {
    const [packId, ...rest] = parts
    if (!/^[\w-][\w.-]*$/.test(packId) || packId.includes('..')) return null
    // «assets/…» o «sources/…» tal cual; cualquier otra referencia es un recurso del curso por su nombre (como
    // `assetURL` de la app Swift: el último trozo dentro de assets/)
    const area = rest.length >= 2 && PACK_AREAS.has(rest[0]) ? rest[0] : 'assets'
    const tail = area === rest[0] && rest.length >= 2 ? rest.slice(1) : [rest[rest.length - 1]]
    const base = join(paths.pack(packId), area)
    return inside(base, join(base, ...tail))
  }
  if (u.hostname === 'doc' && parts.length >= 1) {
    const base = paths.documents()
    return inside(base, join(base, ...parts))
  }
  return null
}

/** La ruta si queda dentro de `base` también tras resolver enlaces simbólicos; si no, null. */
function inside(base: string, full: string): string | null {
  const b = normalize(base)
  const f = normalize(full)
  if (!f.startsWith(b + sep)) return null
  try {
    const rb = realpathSync(b)
    const rf = realpathSync(f)
    return rf.startsWith(rb + sep) ? rf : null
  } catch {
    // aún no existe: la comprobación de texto basta (net.fetch dará 404)
    return f
  }
}

export function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (req) => {
    const file = resolveAssetUrl(req.url)
    if (!file) return new Response('Not found', { status: 404 })
    // net.fetch de file:// (en el proceso principal) admite rangos para el vídeo y el audio
    const range = req.headers.get('range')
    const res = await net.fetch(pathToFileURL(file).toString(), range ? { headers: { range } } : undefined)
    // la interfaz (app://aula) es otro origen: puede leerlos con fetch (pdf.js, modelos 3D); nadie más
    const headers = new Headers(res.headers)
    headers.set('access-control-allow-origin', APP_ORIGIN)
    headers.set('x-content-type-options', 'nosniff')
    if (!headers.get('content-type')) headers.set('content-type', mimeFor(file))
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  })
}
