// Adjuntos del chat (port de AssistantMedia.swift): cada archivo se prepara para la IA sin salir del equipo y queda en el almacén
// de la conversación (`AssistantStore.files`):
//   - documentos (PDF, Word, PowerPoint, Excel, EPUB, texto…): su texto con el lector de materiales (y OCR si es escaneado);
//   - imágenes: una copia (reducida si se puede) para la IA que ve imágenes + el texto que reconozca el OCR;
//   - vídeo y audio: la transcripción y los fotogramas solo si quien monta el servicio sabe hacerlo (`AttachmentMedia`).
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { IDs } from '@engine/base/ids'
import { tr } from '@shared/ai/i18n'
import type { AssistantAttachment } from '@shared/assistant/types'
import { EmptySourceError, importSourceIntoPack } from '../ingest'
import { imageInfo } from '../ingest/extract/imageInfo'
import { log } from '../log'
import type { PackStore } from '../store/packStore'
import { attachmentKind } from './models'

/** Lado mayor de las imágenes que se mandan a la IA (los proveedores reducen por encima de ~1,15 megapíxeles). */
export const MAX_IMAGE_SIDE = 1568
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024
/** Sin poder reducirla, una imagen más grande no se manda a la IA (solo su texto). */
const MAX_RAW_IMAGE_BYTES = 4 * 1024 * 1024
export const MAX_ATTACHMENTS = 10

/** Lo que sabe hacer con imágenes, vídeo y audio quien monta el servicio (Electron: `nativeImage`); todo opcional. */
export interface AttachmentMedia {
  /** JPEG con el lado mayor ≤ `maxSide` (undefined = no se pudo). */
  jpeg?(path: string, maxSide: number): Promise<Uint8Array | undefined>
  /** Miniatura JPEG de cualquier archivo (la primera página de un PDF…). */
  thumbnail?(path: string): Promise<Uint8Array | undefined>
  /** Fotogramas clave de un vídeo (JPEG) y su duración en segundos. */
  frames?(path: string): Promise<{ frames: Uint8Array[]; duration?: number } | undefined>
  /** Transcripción de la voz de un audio o vídeo. */
  transcribe?(path: string, language: string): Promise<{ text: string; duration?: number } | undefined>
}

/** Un adjunto aún sin leer (para enseñarlo enseguida en el mensaje). */
export function pendingAttachment(path: string): AssistantAttachment {
  let bytes = 0
  try { bytes = statSync(path).size } catch { bytes = 0 }
  return { id: IDs.short(8), kind: attachmentKind(extname(path)), name: basename(path), bytes, status: 'processing', pages: 0, characters: 0, imageAssets: [] }
}

const isImageFile = (path: string): boolean => attachmentKind(extname(path)) === 'image'
const browserImage = (path: string): boolean => ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extname(path).toLowerCase())

async function importText(files: PackStore, path: string, title?: string, signal?: AbortSignal): Promise<{ id: string; pages: number; characters: number } | undefined> {
  const imported = await importSourceIntoPack(files.directory, { type: 'file', path, ...(title ? { title } : {}) }, { store: files, trust: 'other', ...(signal ? { signal } : {}) })
  return { id: imported.meta.id, pages: imported.meta.pages, characters: imported.meta.characters }
}

async function importTranscript(files: PackStore, text: string, name: string, signal?: AbortSignal): Promise<{ id: string; characters: number } | undefined> {
  try {
    const imported = await importSourceIntoPack(files.directory, { type: 'text', text, title: tr(`${name} (transcripción)`, `${name} (transcript)`) }, { store: files, trust: 'other', ...(signal ? { signal } : {}) })
    return { id: imported.meta.id, characters: imported.meta.characters }
  } catch {
    return undefined
  }
}

/** Píxeles como mucho para decodificar una imagen del chat en el proceso principal (un móvil de 48 Mpx cabe). */
export const CHAT_MAX_DECODE_PIXELS = 60_000_000

/**
 * ¿La imagen tiene más píxeles de los que se pueden decodificar aquí? Se mira solo la cabecera (A2-P2-15: un PNG de 281 KB y
 * 17 000 × 17 000 píxeles llevaba el proceso principal a 2,3 GB, dos veces). Si no se sabe, false.
 */
export function imageTooLargeToDecode(path: string, maxPixels = CHAT_MAX_DECODE_PIXELS): boolean {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const head = new Uint8Array(1024 * 1024)
    const n = readSync(fd, head, 0, head.length, 0)
    const info = imageInfo(head.subarray(0, n))
    return !!info && info.width > 0 && info.height > 0 && info.width * info.height > maxPixels
  } catch {
    return false
  } finally {
    if (fd !== null) try { closeSync(fd) } catch { /* nada */ }
  }
}

/** Una copia de la imagen para la IA (reducida si se puede) y su miniatura. */
async function imageAssets(path: string, files: PackStore, media: AttachmentMedia | undefined): Promise<{ asset?: string; thumbnail?: string }> {
  const out: { asset?: string; thumbnail?: string } = {}
  // una imagen gigantesca no se decodifica aquí (su texto lo sigue leyendo el lector aparte, con su propio tope)
  if (imageTooLargeToDecode(path)) media = undefined
  try {
    const big = await media?.jpeg?.(path, MAX_IMAGE_SIDE)
    if (big?.length) out.asset = files.addAsset(big, 'jpg')
    else if (browserImage(path) && statSync(path).size <= MAX_RAW_IMAGE_BYTES) out.asset = files.addAsset(readFileSync(path), extname(path).slice(1).toLowerCase().replace('jpeg', 'jpg'))
    const small = await media?.jpeg?.(path, 360)
    out.thumbnail = small?.length ? files.addAsset(small, 'jpg') : out.asset
  } catch (err) {
    log.debug('Chat: no pude copiar la imagen', err)
  }
  return out
}

/** Lee un archivo adjunto y lo deja en el almacén de la conversación. Nunca lanza: si falla, el adjunto dice por qué. */
export async function processAttachment(path: string, base: AssistantAttachment, files: PackStore, opts: { media?: AttachmentMedia; language: string; signal?: AbortSignal }): Promise<AssistantAttachment> {
  const a: AssistantAttachment = { ...base, status: 'processing', imageAssets: [...base.imageAssets] }
  const fail = (note: string): AssistantAttachment => ({ ...a, status: 'failed', note })
  let size = 0
  try { size = statSync(path).size } catch { return fail(tr('No encuentro el archivo.', "I can't find the file.")) }
  a.bytes = size
  if (size > MAX_ATTACHMENT_BYTES) return fail(tr('Es demasiado grande (máximo 200 MB).', "It's too big (200 MB max)."))
  const media = opts.media
  switch (a.kind) {
    case 'image': {
      const img = await imageAssets(path, files, media)
      if (img.asset) a.imageAssets = [img.asset]
      if (img.thumbnail) a.thumbnail = img.thumbnail
      // el texto de la imagen (OCR): sirve aunque la IA no vea imágenes
      try {
        const t = await importText(files, path, undefined, opts.signal)
        if (t && t.characters > 0) { a.sourceID = t.id; a.characters = t.characters }
      } catch { /* sin texto */ }
      if (!a.imageAssets.length && !a.sourceID) return fail(tr('No pude abrir la imagen.', "I couldn't open the image."))
      a.status = 'ready'
      return a
    }
    case 'video': case 'audio': {
      if (a.kind === 'video') {
        const f = await media?.frames?.(path).catch(() => undefined)
        if (f) {
          if (f.duration) a.duration = f.duration
          f.frames.slice(0, 6).forEach((frame, i) => {
            try {
              const id = files.addAsset(frame, 'jpg')
              a.imageAssets.push(id)
              if (i === 0) a.thumbnail = id
            } catch { /* sin fotograma */ }
          })
        }
      }
      const heard = await media?.transcribe?.(path, opts.language).catch(() => undefined)
      if (heard?.duration && !a.duration) a.duration = heard.duration
      const text = heard?.text.trim() ?? ''
      if (text) {
        a.transcript = text
        const t = await importTranscript(files, text, a.name, opts.signal)
        if (t) { a.sourceID = t.id; a.characters = t.characters }
      }
      if (a.kind === 'audio' && !text) return fail(media?.transcribe ? tr('No pude transcribirlo.', "I couldn't transcribe it.") : tr('Este equipo aún no sabe transcribir audio.', "This computer can't transcribe audio yet."))
      if (a.kind === 'video' && !a.imageAssets.length && !text) return fail(tr('No pude leer el vídeo.', "I couldn't read the video."))
      a.status = 'ready'
      if (a.kind === 'video' && !text) a.note = tr('Solo la imagen (sin voz que transcribir)', 'Only the picture (no speech to transcribe)')
      return a
    }
    default: {
      try {
        const t = await importText(files, path, undefined, opts.signal)
        if (t) { a.sourceID = t.id; a.pages = t.pages; a.characters = t.characters }
        a.status = 'ready'
        if (!a.characters) a.note = tr('Sin texto legible', 'No readable text')
      } catch (err) {
        if (err instanceof EmptySourceError) return { ...a, status: 'ready', note: tr('Sin texto legible', 'No readable text') }
        // una imagen que no sabíamos clasificar por su extensión
        if (isImageFile(path) || a.kind === 'other') {
          const img = await imageAssets(path, files, media)
          if (img.asset) return { ...a, kind: 'image', imageAssets: [img.asset], ...(img.thumbnail ? { thumbnail: img.thumbnail } : {}), status: 'ready' }
        }
        return fail(err instanceof Error ? err.message : String(err))
      }
      try {
        const thumb = await media?.thumbnail?.(path)
        if (thumb?.length) a.thumbnail = files.addAsset(thumb, 'jpg')
      } catch { /* sin miniatura */ }
      return a
    }
  }
}
