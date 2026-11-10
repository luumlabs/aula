// Transcripción de una grabación (audio o vídeo) con el minuto de cada frase.
//  1. Si al lado hay subtítulos con el mismo nombre (.vtt / .srt), se usan: son exactos y no cuestan nada.
//  2. Si no, el audio se parte en trozos (parts.ts) y cada uno se envía a un servicio de transcripción (el de un proveedor
//     de IA que el estudiante ya tiene conectado y que sabe transcribir). Los tiempos de cada trozo se suman a su inicio.
// Sin Electron: el motor (red y clave) se le pasa desde fuera, y en las pruebas es uno simulado.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { parseTimecode } from '@shared/ingest'
import { SUBTITLE_EXTENSIONS } from './formats'
import { DEFAULT_LIMITS, planAudio, type AudioPart, type PartLimits } from './parts'

export interface TranscriptSegment {
  /** Segundos desde el principio de la grabación. */
  start: number
  end: number
  text: string
}

export interface Transcript {
  segments: TranscriptSegment[]
  /** Duración de la grabación en segundos, si se sabe. */
  duration?: number
  /** De dónde salió: los subtítulos que la acompañan o el servicio que la transcribió. */
  origin: 'subtitles' | 'speech'
  /** Motor y modelo («Groq · whisper-large-v3-turbo») o el nombre del archivo de subtítulos. */
  by: string
  language?: string
}

export type TranscriptionFailure = 'auth' | 'tooLarge' | 'unsupported' | 'rateLimited' | 'network' | 'server'

export class TranscriptionError extends Error {
  constructor(readonly code: TranscriptionFailure, message: string, readonly status?: number) {
    super(message)
    this.name = 'TranscriptionError'
  }
}

/** Quien transcribe un trozo de audio. */
export interface TranscriptionEngine {
  /** Para mostrar: «Groq · whisper-large-v3-turbo». */
  label: string
  transcribe(part: { bytes: Uint8Array; filename: string; mime: string }, options: { language?: string; signal?: AbortSignal }): Promise<{ text: string; duration?: number; language?: string; segments: TranscriptSegment[] }>
}

// MARK: Subtítulos

/** Lee subtítulos SRT o WebVTT: una frase por entrada, con sus segundos. Las etiquetas de estilo se quitan. */
export function parseSubtitles(text: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = []
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  const arrow = /^\s*(\d{1,3}(?::\d{2}){1,2}[.,]\d{1,3})\s*-->\s*(\d{1,3}(?::\d{2}){1,2}[.,]\d{1,3})/
  for (let i = 0; i < lines.length; i++) {
    const m = arrow.exec(lines[i])
    if (!m) continue
    const start = parseTimecode(m[1].replace(',', '.'))
    const end = parseTimecode(m[2].replace(',', '.'))
    const body: string[] = []
    for (i++; i < lines.length && lines[i].trim() !== ''; i++) body.push(lines[i])
    const said = body.join(' ').replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
    if (start === undefined || end === undefined || !said) continue
    // los subtítulos «en cascada» repiten la línea anterior: no se duplica
    const last = out[out.length - 1]
    if (last && last.text === said) { last.end = Math.max(last.end, end); continue }
    out.push({ start, end: Math.max(end, start), text: said })
  }
  return out
}

/** Subtítulos que acompañan a la grabación: mismo nombre, al lado («clase3.mp4» → «clase3.vtt», «clase3.es.srt»). */
export function sidecarSubtitles(path: string): { file: string; segments: TranscriptSegment[] } | undefined {
  const dir = dirname(path)
  const stem = basename(path, extname(path)).toLowerCase()
  let names: string[]
  try { names = readdirSync(dir) } catch { return undefined }
  const candidates = names
    .filter((n) => {
      const lower = n.toLowerCase()
      const ext = extname(lower).slice(1)
      return SUBTITLE_EXTENSIONS.includes(ext) && (lower === `${stem}.${ext}` || lower.startsWith(`${stem}.`))
    })
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
  for (const name of candidates) {
    const file = join(dir, name)
    try {
      if (!existsSync(file)) continue
      const segments = parseSubtitles(readFileSync(file, 'utf8'))
      if (segments.length) return { file: name, segments }
    } catch { /* se prueba con el siguiente */ }
  }
  return undefined
}

// MARK: Transcribir

export interface TranscribeOptions {
  /** Quien transcribe. Sin él solo valen los subtítulos que acompañen a la grabación. */
  engine?: TranscriptionEngine
  /** Idioma en el que se habla («es», «en»…): mejora la transcripción. Si falta, el servicio lo detecta. */
  language?: string
  signal?: AbortSignal
  /** Avance 0…1 y el trozo por el que va. */
  onProgress?: (fraction: number, part: number, parts: number) => void
  limits?: PartLimits
  /** Los primeros bytes del archivo (para reconocer el contenedor). */
  head: Uint8Array
}

/** No hay con qué transcribir: ni subtítulos al lado ni un servicio conectado que sepa hacerlo. */
export class NoTranscriberError extends Error {
  constructor() {
    super('No transcription engine available')
    this.name = 'NoTranscriberError'
  }
}

/** Transcribe una grabación. Lanza `NoTranscriberError`, `TranscriptionError`, `MediaFormatError` o `MediaTooLargeError`. */
export async function transcribeRecording(path: string, options: TranscribeOptions): Promise<Transcript> {
  const sidecar = sidecarSubtitles(path)
  if (sidecar) {
    const last = sidecar.segments[sidecar.segments.length - 1]
    return { segments: sidecar.segments, duration: last?.end, origin: 'subtitles', by: sidecar.file }
  }
  if (!options.engine) throw new NoTranscriberError()
  const plan = planAudio(path, options.head, options.limits ?? DEFAULT_LIMITS)
  const segments: TranscriptSegment[] = []
  let language: string | undefined
  let clock = 0
  for (const part of plan.parts) {
    throwIfAborted(options.signal)
    options.onProgress?.(part.index / plan.parts.length, part.index + 1, plan.parts.length)
    const heard = await options.engine.transcribe({ bytes: part.load(), filename: part.filename, mime: part.mime }, { language: options.language ?? language, signal: options.signal })
    language ??= heard.language
    const end = part.end ?? part.start + (heard.duration ?? 0)
    segments.push(...placed(heard, part, end))
    clock = Math.max(clock, end)
  }
  options.onProgress?.(1, plan.parts.length, plan.parts.length)
  return { segments: tidy(segments), duration: plan.duration ?? (clock || undefined), origin: 'speech', by: options.engine.label, ...(language ? { language } : {}) }
}

/** Los tramos de un trozo, con sus segundos contados desde el principio de la grabación y sin salirse del trozo. */
function placed(heard: { text: string; segments: TranscriptSegment[] }, part: AudioPart, end: number): TranscriptSegment[] {
  if (!heard.segments.length) {
    const text = heard.text.trim()
    return text ? [{ start: part.start, end: Math.max(end, part.start), text }] : []
  }
  const limit = end > part.start ? end : Infinity
  return heard.segments.map((s) => ({
    start: Math.min(limit, part.start + Math.max(0, s.start)),
    end: Math.min(limit, part.start + Math.max(s.start, s.end)),
    text: s.text
  }))
}

/** Tramos limpios y en orden: sin vacíos y sin la misma frase repetida seguida (un fallo conocido con silencios largos). */
export function tidy(segments: TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = []
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    const text = s.text.replace(/\s+/g, ' ').trim()
    if (!text || !Number.isFinite(s.start) || !Number.isFinite(s.end)) continue
    const last = out[out.length - 1]
    if (last && last.text === text) { last.end = Math.max(last.end, s.end); continue }
    out.push({ start: Math.max(0, s.start), end: Math.max(s.start, s.end), text })
  }
  return out
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
}

// MARK: Servicio compatible con OpenAI

export interface OpenAITranscriptionConfig {
  /** «https://api.groq.com/openai/v1», sin la barra final. */
  baseURL: string
  apiKey: string
  model: string
  label: string
  fetch?: typeof fetch
  /** Segundos de espera entre reintentos (pruebas: 0). */
  retryDelays?: number[]
}

/** `POST {baseURL}/audio/transcriptions` (OpenAI, Groq, Mistral y servidores compatibles), pidiendo los tramos con su tiempo. */
export function openAITranscription(config: OpenAITranscriptionConfig): TranscriptionEngine {
  const doFetch = config.fetch ?? fetch
  const delays = config.retryDelays ?? [1.5, 5, 12]
  const url = `${config.baseURL.replace(/\/+$/, '')}/audio/transcriptions`
  return {
    label: config.label,
    async transcribe(part, options) {
      for (let attempt = 0; ; attempt++) {
        const form = new FormData()
        form.append('file', new Blob([part.bytes as Uint8Array<ArrayBuffer>], { type: part.mime }), part.filename)
        form.append('model', config.model)
        form.append('response_format', 'verbose_json')
        form.append('timestamp_granularities[]', 'segment')
        form.append('temperature', '0')
        if (options.language && /^[a-z]{2,3}$/i.test(options.language.slice(0, 2))) form.append('language', options.language.slice(0, 2).toLowerCase())
        let res: Response
        try {
          res = await doFetch(url, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}` }, body: form, signal: options.signal, redirect: 'error' })
        } catch (err) {
          if (options.signal?.aborted) throw err
          if (attempt < delays.length) { await pause(delays[attempt], options.signal); continue }
          throw new TranscriptionError('network', `No se pudo conectar con ${config.label}.`)
        }
        if (res.ok) return readTranscription(await res.json() as unknown)
        const retryable = res.status === 429 || res.status === 408 || res.status >= 500
        if (retryable && attempt < delays.length) {
          const wait = Number(res.headers.get('retry-after'))
          await pause(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 60) : delays[attempt], options.signal)
          continue
        }
        throw failure(res.status, await res.text().catch(() => ''), config.label)
      }
    }
  }
}

function readTranscription(raw: unknown): { text: string; duration?: number; language?: string; segments: TranscriptSegment[] } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const list = Array.isArray(o.segments) ? o.segments : []
  const segments: TranscriptSegment[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    const start = num(s.start), end = num(s.end)
    if (start === undefined || typeof s.text !== 'string') continue
    segments.push({ start, end: end ?? start, text: s.text })
  }
  return { text: typeof o.text === 'string' ? o.text : segments.map((s) => s.text).join(' '), duration: num(o.duration), language: typeof o.language === 'string' ? o.language : undefined, segments }
}

function failure(status: number, body: string, label: string): TranscriptionError {
  let detail = ''
  try { const j = JSON.parse(body) as { error?: { message?: string } | string }; detail = typeof j.error === 'string' ? j.error : j.error?.message ?? '' } catch { detail = body.slice(0, 200) }
  const tail = detail ? ` (${detail.slice(0, 200)})` : ''
  if (status === 401 || status === 403) return new TranscriptionError('auth', `${label} rechazó la clave${tail}.`, status)
  if (status === 413) return new TranscriptionError('tooLarge', `${label} dice que el audio es demasiado grande${tail}.`, status)
  if (status === 404 || status === 400 || status === 415 || status === 422) return new TranscriptionError('unsupported', `${label} no pudo transcribir este audio${tail}.`, status)
  if (status === 429) return new TranscriptionError('rateLimited', `${label} está limitando las peticiones; inténtalo dentro de un rato${tail}.`, status)
  return new TranscriptionError('server', `${label} respondió ${status}${tail}.`, status)
}

function pause(seconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve() }, Math.max(0, seconds) * 1000)
    const stop = (): void => { clearTimeout(timer); reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')) }
    signal?.addEventListener('abort', stop, { once: true })
  })
}
