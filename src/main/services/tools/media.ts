// Imágenes y modelos 3D para las lecciones (port de StudyEngine/Tools/MediaTools.swift): búsqueda en Wikimedia Commons y
// descarga al curso con su ficha (medidas, autor, licencia, página de origen) para citarla siempre.
import { basename } from 'node:path'
import { isJSONObject, Schema } from '@engine/base/json'
import { assetCredit, captionHasCredit, imageSize, type AssetMeta } from '@engine/content'
import type { AgentTool } from '../ai'
import { saveAssetMeta } from '../study/assets'
import { defineTool, ToolOut, type ToolContext, type WebAccess } from './context'
import { stripTags } from './research'

/** Máximo que se descarga por imagen y por modelo. */
export const MAX_IMAGE_BYTES = 8_000_000
export const MAX_MODEL_BYTES = 40_000_000

/** Tipo de imagen por su contenido (PNG, JPEG, GIF, WebP); undefined si no es una imagen que se pueda mostrar. */
export function imageKind(b: Uint8Array): string | undefined {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  return undefined
}

/** Tipo de modelo por su contenido (y la extensión como pista). undefined si no es un modelo que se pueda abrir. */
export function modelKind(data: Uint8Array, name: string): string | undefined {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const head = data.subarray(0, 512)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(head).toLowerCase()
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'usdz'   // USDZ es un zip sin comprimir
  if (text.startsWith('pxr-usdc')) return 'usdc'
  if (text.startsWith('#usda')) return 'usda'
  if (text.startsWith('ply')) return 'ply'
  if (text.includes('<collada')) return 'dae'
  if (ext === 'stl') return data.length >= 84 ? 'stl' : undefined
  if (ext === 'obj' || text.includes('\nv ') || text.startsWith('v ') || text.includes('\nvn ')) return 'obj'
  if (text.startsWith('solid')) return 'stl'
  return undefined
}

/** Autor, licencia y página de un archivo de Wikimedia Commons (a partir de su dirección de descarga o de miniatura). */
export async function commonsMetadata(url: URL, web: WebAccess, signal?: AbortSignal): Promise<{ author: string; license: string; page: string; title: string } | undefined> {
  const host = url.hostname
  if (!host.endsWith('wikimedia.org') && !host.endsWith('wikipedia.org')) return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  // /wikipedia/commons/thumb/c/cc/<Archivo>/<n>px-… · /wikipedia/commons/c/cc/<Archivo>
  const t = parts.indexOf('thumb')
  const c = parts.indexOf('commons')
  const file = t >= 0 && parts.length > t + 3 ? parts[t + 3] : c >= 0 && parts.length > c + 3 ? parts[c + 3] : undefined
  if (!file) return undefined
  let name = file
  try { name = decodeURIComponent(file) } catch { /* tal cual */ }
  const api = new URL('https://commons.wikimedia.org/w/api.php')
  for (const [k, v] of [['action', 'query'], ['format', 'json'], ['titles', 'File:' + name], ['prop', 'imageinfo'], ['iiprop', 'extmetadata|url'], ['iiextmetadatafilter', 'LicenseShortName|Artist']]) api.searchParams.set(k, v)
  let root: unknown
  try { root = JSON.parse(new TextDecoder().decode((await web.fetchData(api.toString(), 400_000, signal)).data)) } catch { return undefined }
  const pages = isJSONObject(root) && isJSONObject(root.query) && isJSONObject(root.query.pages) ? Object.values(root.query.pages) : []
  const page = pages[0]
  const info = isJSONObject(page) && Array.isArray(page.imageinfo) && isJSONObject(page.imageinfo[0]) ? page.imageinfo[0] : undefined
  if (!info) return undefined
  const meta = isJSONObject(info.extmetadata) ? info.extmetadata : {}
  const m = (k: string): string => { const x = meta[k]; return isJSONObject(x) && typeof x.value === 'string' ? stripTags(x.value).trim() : '' }
  const author = Array.from(m('Artist')).slice(0, 120).join(''), license = m('LicenseShortName')
  if (!author && !license) return undefined
  return { author, license, page: typeof info.descriptionurl === 'string' ? info.descriptionurl : 'https://commons.wikimedia.org/wiki/File:' + name.replace(/ /g, '_'), title: name }
}

export function findImage(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'find_image', 'Search Wikimedia Commons for freely licensed photos, diagrams and maps (SVG diagrams come as PNG) to illustrate a lesson or build a labeled diagram: a real cell micrograph, an anatomical diagram, a historical map, a painting. Returns candidates with a direct URL, size, license and author; then call add_image with the chosen URL. For labeled diagrams and «point at the part» exercises prefer images WITHOUT printed labels (search e.g. \'heart diagram no labels\', \'skeleton blank\', \'blank map Europe\'). Prefer plot/diagram/drawing blocks for schematic math figures.',
    Schema.object([['query', Schema.string('What the picture must show; English terms usually find more (e.g. \'animal cell diagram unlabeled\')')], ['limit', Schema.integer('default 6, max 10', 1, 10)]], { required: ['query'] }),
    async (a, signal) => {
      const q = a.string('query')
      if (!q) return ToolOut.error("Missing required argument 'query'.")
      if (!ctx.web) return ToolOut.error('Web access is not available.')
      try {
        const found = await ctx.web.searchImages(q, Math.min(10, Math.max(1, a.int('limit') ?? 6)), signal)
        if (!found.length) return ToolOut.json({ ok: true, count: 0, images: [], tip: "Nothing found: try other (English) terms ('… diagram', '… blank', '… no labels'), or draw it with a drawing/labeled block." })
        const images = found.map((r) => ({ title: r.title, url: r.url, page: r.pageURL, width: r.width, height: r.height, license: r.license, author: r.author, description: r.description }))
        ctx.webGate?.noteFound(found.flatMap((r) => [r.url, r.pageURL]))
        return ToolOut.json({ ok: true, count: images.length, images, tip: 'Pick one that clearly shows what you teach (for labeled diagrams: no printed labels) and call add_image with its url, author, license and page.' })
      } catch (err) {
        return ToolOut.error(`Image search failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function addImage(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'add_image', 'Download an image (PNG/JPEG/GIF/WebP, max 8 MB) into the course so lessons, labeled diagrams, exercises, cards and slides can show it offline. Only freely licensed images (e.g. from find_image). For Wikimedia Commons files the author and license are read automatically. Returns the asset id, its pixel size and aspect, the credit line and ready-to-use `image` and `labeled` blocks (for labeled diagrams, add `parts` with x,y as fractions of width/height: divide pixel coordinates by the returned width/height).',
    Schema.object([['url', Schema.string('Direct https URL of the image file')], ['alt', Schema.string('What the image shows, for accessibility (in the course language)')],
      ['caption', Schema.string('Caption (what to look at); the credit goes in its own field')], ['author', Schema.string('Author (if known; read automatically for Wikimedia Commons)')],
      ['license', Schema.string("License short name, e.g. 'CC BY-SA 4.0', 'Public domain'")], ['page', Schema.string('Page of the work (e.g. the Commons file page)')]], { required: ['url', 'alt'] }),
    async (a, signal) => {
      const raw = a.string('url')?.trim()
      const alt = a.string('alt')
      if (!raw || !alt) return ToolOut.error("Missing required arguments 'url' and 'alt'.")
      let url: URL
      try { url = new URL(raw) } catch { return ToolOut.error("Missing required arguments 'url' and 'alt'.") }
      if (!ctx.web) return ToolOut.error('Web access is not available.')
      const gate = ctx.webGate?.check(raw)
      if (gate && !gate.ok) return ToolOut.error(gate.error, gate.hint)
      try {
        const { data, mimeType } = await ctx.web.fetchData(url.toString(), MAX_IMAGE_BYTES, signal)
        const ext = imageKind(data)
        const size = ext ? imageSize(data) : undefined
        if (!ext || !size) return ToolOut.error(`That URL is not a readable image (got ${mimeType || 'unknown content'}). Use the direct file URL (e.g. upload.wikimedia.org/…); SVG files: use their PNG thumbnail (find_image returns it).`)
        const [width, height] = size
        if (width < 32 || height < 32) return ToolOut.error(`The image is too small (${width}×${height}).`)
        const meta: AssetMeta = { kind: 'image', width, height, fileURL: url.toString() }
        const author = a.string('author'), license = a.string('license'), page = a.string('page')
        if (author) meta.author = author
        if (license) meta.license = license
        if (page) meta.pageURL = page
        const w = await commonsMetadata(url, ctx.web, signal)
        if (w) {
          if (!meta.author) meta.author = w.author || undefined
          if (!meta.license) meta.license = w.license || undefined
          if (!meta.pageURL) meta.pageURL = w.page
          meta.title = w.title
        }
        // sin autor ni licencia conocidos: el crédito puede venir en el pie («Célula. Conrad, CC0, Wikimedia Commons»)
        if (!meta.author && !meta.license) {
          const cap = a.string('caption')
          if (!cap || !captionHasCredit(cap)) return ToolOut.error('I could not find the author and license of this image. Pass `author` and `license` (only freely licensed images), or choose one from find_image.')
          const parts = cap.split('. ')
          meta.creditText = parts.length > 1 ? parts.slice(1).join('. ') : cap
        }
        if (!meta.pageURL && !url.hostname.includes('wikimedia')) meta.pageURL = url.toString()
        for (const k of Object.keys(meta) as Array<keyof AssetMeta>) if (meta[k] === undefined) delete meta[k]
        const id = ctx.store.addAsset(data, ext)
        saveAssetMeta(ctx.store, id, meta)
        const credit = assetCredit(meta) ?? ''
        const image: Record<string, unknown> = { type: 'image', asset: id, alt }
        const cap = a.string('caption'); if (cap) image.caption = cap
        if (credit) image.credit = credit
        const aspect = Math.round((width / height) * 1000) / 1000
        const labeled: Record<string, unknown> = { type: 'labeled', asset: id, alt, aspect, parts: [] }
        if (credit) labeled.credit = credit
        const out: Record<string, unknown> = {
          ok: true, asset: id, width, height, aspect, block: image, labeled_block: labeled,
          tip: `Use \`block\` as is, or \`labeled_block\` adding parts [{id, name, x, y, r, detail}] (x = pixelX / ${width}, y = pixelY / ${height}). The same asset works in exercises (locate/draglabel), card figures and slides (\`image\`).`
        }
        if (credit) out.credit = credit
        return ToolOut.json(out)
      } catch (err) {
        return ToolOut.error(`Could not add the image: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function addModel(ctx: ToolContext): AgentTool {
  return defineTool(ctx, 'add_model', 'Download a freely licensed 3D model (OBJ, STL, PLY, DAE, USDZ/USD; max 40 MB) into the course for a model3d block (e.g. an organ, a skull, a molecule, a machine part from NIH 3D, Smithsonian 3D or Wikimedia Commons). Give author and license. Molecules and geometric solids do NOT need a file: use model3d with `formula`/`atoms` or `solids`.',
    Schema.object([['url', Schema.string('Direct https URL of the model file')], ['title', Schema.string('What it is')], ['author', Schema.string()], ['license', Schema.string("e.g. 'CC BY 4.0', 'Public domain'")], ['page', Schema.string('Page of the work')]], { required: ['url', 'title', 'license'] }),
    async (a, signal) => {
      const raw = a.string('url')?.trim()
      const title = a.string('title')
      const license = a.string('license')
      if (!raw || !title || !license) return ToolOut.error("Missing required arguments 'url', 'title' and 'license'.")
      if (!ctx.web) return ToolOut.error('Web access is not available.')
      let url: URL
      try { url = new URL(raw) } catch { return ToolOut.error("Missing required arguments 'url', 'title' and 'license'.") }
      const gate = ctx.webGate?.check(raw)
      if (gate && !gate.ok) return ToolOut.error(gate.error, gate.hint)
      try {
        const { data } = await ctx.web.fetchData(url.toString(), MAX_MODEL_BYTES, signal)
        const ext = modelKind(data, basename(url.pathname))
        if (!ext) return ToolOut.error('That file is not a 3D model Aula can open (OBJ, STL, PLY, DAE, USDZ/USD).')
        const id = ctx.store.addAsset(data, ext)
        const meta: AssetMeta = { kind: 'model', title, license, pageURL: a.string('page') ?? url.toString(), fileURL: url.toString() }
        const author = a.string('author'); if (author) meta.author = author
        saveAssetMeta(ctx.store, id, meta)
        const block = { type: 'model3d', title, asset: id, credit: assetCredit(meta) ?? license, alt: title }
        return ToolOut.json({ ok: true, asset: id, block, tip: 'Put `block` in the lesson (write_lesson) or on a slide (layout focus).' })
      } catch (err) {
        return ToolOut.error(`Could not add the model: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function mediaTools(ctx: ToolContext): AgentTool[] {
  return ctx.web ? [findImage(ctx), addImage(ctx), addModel(ctx)] : []
}
