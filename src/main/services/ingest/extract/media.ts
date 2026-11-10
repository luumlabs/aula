// Grabaciones (audio y vídeo) como material: su texto es la transcripción, por tramos con su minuto. Una «página» de una
// grabación es un tramo de medio minuto, así los fragmentos, las citas y el lector pueden decir «41:20» y saltar ahí.
import { basename } from 'node:path'
import { timecode, type SourceDocument, type SourceKind, type SourcePage } from '@shared/ingest'
import { MediaFormatError } from '../../media/mp4'
import { MediaTooLargeError } from '../../media/parts'
import { NoTranscriberError, TranscriptionError, transcribeRecording, type Transcript, type TranscriptSegment } from '../../media/transcribe'
import { corrupt, IngestError, network, tooLarge, unreadable, unsupportedType } from '../errors'
import { L } from '../messages'
import { readHead } from '../kind'
import type { IngestContext } from '../core/progress'

/** Cuánto dura un tramo (una «página» de la grabación) como mucho, y cuánto texto cabe. */
const PAGE_SECONDS = 30
const PAGE_CHARS = 700

/** Agrupa las frases en tramos de medio minuto: cada uno sabe en qué segundo empieza y termina. */
export function transcriptPages(segments: readonly TranscriptSegment[]): SourcePage[] {
  const pages: SourcePage[] = []
  let text: string[] = []
  let start = 0
  let end = 0
  const flush = (): void => {
    if (!text.length) return
    pages.push({ number: pages.length + 1, text: text.join(' '), usedOCR: false, hasFigures: false, start: Math.floor(start), end: Math.ceil(end) })
    text = []
  }
  for (const s of segments) {
    if (text.length && (s.end - start > PAGE_SECONDS || text.join(' ').length + s.text.length > PAGE_CHARS)) flush()
    if (!text.length) start = s.start
    text.push(s.text)
    end = Math.max(end, s.end)
  }
  flush()
  return pages
}

/** Transcribe una grabación y la deja como documento: páginas = tramos con su tiempo. */
export async function extractMedia(path: string, kind: SourceKind, ctx: IngestContext): Promise<SourceDocument> {
  const name = basename(path)
  const head = readHead(path, 64)
  if (!head) throw unreadable(L('no se pudo acceder a «%@»', name))
  ctx.progress.report(0.02, L('Preparando la grabación…'), true)
  let transcript: Transcript
  try {
    transcript = await transcribeRecording(path, {
      head,
      engine: ctx.options.transcription?.(),
      language: ctx.options.language,
      signal: ctx.signal,
      onProgress: (fraction, part, parts) => ctx.progress.report(0.04 + fraction * 0.92, parts > 1 ? L('Transcribiendo la grabación (parte %lld de %lld)…', part, parts) : L('Transcribiendo la grabación…'), true)
    })
  } catch (err) {
    throw mediaError(err, name)
  }
  const pages = transcriptPages(transcript.segments)
  if (!pages.length) ctx.warnings.add(L('No se oyó nada que transcribir en la grabación.'))
  const metadata: Record<string, string> = { transcribedBy: transcript.by, transcriptOrigin: transcript.origin }
  if (transcript.duration !== undefined) metadata.duration = String(Math.round(transcript.duration))
  if (transcript.language) metadata.language = transcript.language
  if (transcript.origin === 'subtitles') ctx.warnings.add(L('Se usaron los subtítulos que acompañan a la grabación («%@»).', transcript.by))
  else if (kind === 'video') ctx.warnings.add(L('Se transcribió lo que se dice; lo que solo se ve en la pantalla no está en el texto.'))
  return {
    title: ctx.fallbackTitle,
    kind,
    pages: pages.length ? pages : [{ number: 1, text: '', usedOCR: false, hasFigures: false }],
    metadata,
    warnings: ctx.warnings.all
  }
}

/** Cada fallo, con lo que el estudiante puede hacer para arreglarlo. */
function mediaError(err: unknown, name: string): unknown {
  if (err instanceof IngestError) return err
  if (err instanceof NoTranscriberError) {
    return unsupportedType(L('para transcribir «%@» hace falta conectar en Ajustes → Tu IA un servicio que transcriba audio (Groq, OpenAI o Mistral), o poner al lado sus subtítulos (.vtt o .srt con el mismo nombre)', name))
  }
  if (err instanceof MediaTooLargeError) {
    return tooLarge(L('«%@» ocupa %lld MB y Aula solo sabe trocear MP4, M4A, MOV, MP3 y WAV; conviértela a uno de esos formatos (o extrae su audio)', name, err.megabytes))
  }
  if (err instanceof MediaFormatError) {
    switch (err.code) {
      case 'noAudio': return unsupportedType(L('«%@» no tiene pista de audio que transcribir', name))
      case 'unsupportedCodec': return unsupportedType(L('el audio de «%@» usa un formato que Aula aún no sabe transcribir; conviértelo a MP3 o M4A', name))
      default: return corrupt(L('la grabación «%@» está incompleta o dañada', name))
    }
  }
  if (err instanceof TranscriptionError) {
    switch (err.code) {
      case 'auth': return unsupportedType(L('el servicio de transcripción rechazó la clave; revísala en Ajustes → Tu IA'))
      case 'tooLarge': return tooLarge(L('el servicio de transcripción no aceptó un trozo de «%@» por su tamaño', name))
      case 'network': case 'rateLimited': case 'server': return network(err.message)
      default: return unsupportedType(err.message)
    }
  }
  return err
}

/** Etiqueta de un tramo para quien lee («41:20»). */
export const pageTime = (page: Pick<SourcePage, 'start'>): string | undefined => (page.start !== undefined ? timecode(page.start) : undefined)
