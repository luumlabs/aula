// Sólo recursos emitidos para figure-render.html; nunca rutas de cursos ni perfiles del usuario.
import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { extname, join, sep } from 'node:path'

export const FIGURE_RENDER_URL = 'app://aula/figure-render.html'
export const FIGURE_RENDER_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src blob:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'"
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' }
export function figureAssetName(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'app:' || u.host !== 'aula' || u.username || u.password || u.search || u.hash) return null
    const name = u.pathname.slice(1)
    if (!/^[A-Za-z0-9_.\/-]+$/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..')) return null
    return name
  } catch { return null }
}
export async function loadFigureAssets(root: string): Promise<Map<string, { file: string; mime: string }>> {
  const base = realpathSync(root), bytes = await readFile(join(base, 'figure-render-assets.json'))
  if (bytes.length > 64 * 1024) throw new Error('Invalid figure asset manifest')
  const manifest: unknown = JSON.parse(bytes.toString('utf8'))
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid figure asset manifest')
  const v = manifest as { version?: unknown; files?: unknown }
  if (v.version !== 1 || !Array.isArray(v.files) || v.files.length > 512 || !v.files.includes('figure-render.html')) throw new Error('Invalid figure asset manifest')
  const files = new Map<string, { file: string; mime: string }>()
  for (const name of v.files) {
    if (typeof name !== 'string' || figureAssetName(`app://aula/${name}`) !== name || (name !== 'figure-render.html' && !name.startsWith('assets/'))) throw new Error('Invalid figure asset manifest')
    const mime = MIME[extname(name)]
    if (!mime || (name.endsWith('.html') && name !== 'figure-render.html')) throw new Error('Invalid figure asset type')
    const file = realpathSync(join(base, name))
    if (!file.startsWith(base + sep)) throw new Error('Invalid figure asset path')
    files.set(name, { file, mime })
  }
  return files
}
