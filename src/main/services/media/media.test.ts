import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseTimecode, timecode } from '@shared/ingest'
import { decodeSourceRef, encodeSourceRef, sourceRefLabel } from '@shared/schema/common'
import { detectKind, ingestFile, isIngestError } from '../ingest'
import { transcriptPages } from '../ingest/extract/media'
import { containerOf, mediaSignature } from './formats'
import { MediaTooLargeError, mp3Frame, planAudio, SPEECH_RATE } from './parts'
import { NoTranscriberError, TranscriptionError, openAITranscription, parseSubtitles, sidecarSubtitles, tidy, transcribeRecording, type TranscriptionEngine } from './transcribe'

const M4A = join(__dirname, 'testing', 'clase.m4a')
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const temp = (): string => { const d = mkdtempSync(join(tmpdir(), 'aula-media-')); dirs.push(d); return d }
const HEAD_M4A = Uint8Array.from([0, 0, 0, 0x1c, ...Buffer.from('ftypM4A ')])

/** Un MP3 de mentira pero válido: tramas MPEG1 capa 3 a 128 kbps y 44,1 kHz (417 bytes, 26 ms cada una), en silencio. */
function mp3(frames: number, withTag = true): Buffer {
  const frame = Buffer.alloc(417)
  frame.set([0xff, 0xfb, 0x90, 0x00], 0)
  const tag = withTag ? Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 10]), Buffer.alloc(10)]) : Buffer.alloc(0)
  return Buffer.concat([tag, ...Array.from({ length: frames }, () => frame)])
}

/** WAV PCM de 16 bits con un tono, estéreo a 44,1 kHz. */
function wav(seconds: number, rate = 44100, channels = 2): Buffer {
  const frames = Math.floor(seconds * rate)
  const data = Buffer.alloc(frames * channels * 2)
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 12000), (i * channels + c) * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22)
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

/** Motor de pruebas: devuelve una frase por trozo, con su tiempo dentro del trozo. */
function fakeEngine(): TranscriptionEngine & { calls: Array<{ filename: string; bytes: number; language?: string }> } {
  const calls: Array<{ filename: string; bytes: number; language?: string }> = []
  return {
    label: 'Prueba · modelo', calls,
    async transcribe(part, options) {
      calls.push({ filename: part.filename, bytes: part.bytes.length, language: options.language })
      return { text: `dicho en ${part.filename}`, language: 'es', segments: [{ start: 0.5, end: 2, text: ` Frase de ${part.filename}. ` }, { start: 2, end: 3, text: 'Otra frase.' }] }
    }
  }
}

describe('reconocer grabaciones', () => {
  it('por la firma y la extensión, sin confundir fotos HEIC con vídeos', () => {
    expect(mediaSignature(HEAD_M4A)).toEqual({ container: 'mp4', audioOnly: true })
    expect(mediaSignature(Uint8Array.from([0, 0, 0, 0x18, ...Buffer.from('ftypheic')]))).toBeNull()
    expect(mediaSignature(Uint8Array.from([0, 0, 0, 0x18, ...Buffer.from('ftypisom')]))).toEqual({ container: 'mp4', audioOnly: false })
    expect(mediaSignature(Buffer.from('RIFF\0\0\0\0WAVEfmt '))?.container).toBe('wav')
    expect(mediaSignature(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBeNull()
    expect(mediaSignature(mp3(1, false))).toMatchObject({ container: 'mp3', weak: true })
    expect(mediaSignature(Uint8Array.from([0xff, 0xf1, 0x50, 0x80]))?.container).toBe('aac')
    expect(mediaSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull()
    expect(containerOf(new Uint8Array(0), 'mov')).toBe('mp4')
    const dir = temp()
    writeFileSync(join(dir, 'clase.mp3'), mp3(40))
    writeFileSync(join(dir, 'clase.wav'), wav(0.2))
    copyFileSync(M4A, join(dir, 'grabacion.m4a'))
    copyFileSync(M4A, join(dir, 'video.mp4'))
    copyFileSync(M4A, join(dir, 'sin-extension'))
    // un texto en UTF-16 empieza por FF FE, que se parece a una trama de MP3: sigue siendo texto
    writeFileSync(join(dir, 'utf16.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Hola, esto es texto', 'utf16le')]))
    expect(detectKind(join(dir, 'utf16.txt'))).toBe('text')
    writeFileSync(join(dir, 'sin-etiqueta.mp3'), mp3(40, false))
    expect(detectKind(join(dir, 'sin-etiqueta.mp3'))).toBe('audio')
    expect([detectKind(join(dir, 'clase.mp3')), detectKind(join(dir, 'clase.wav')), detectKind(join(dir, 'grabacion.m4a')), detectKind(join(dir, 'video.mp4')), detectKind(join(dir, 'sin-extension'))]).toEqual(['audio', 'audio', 'audio', 'video', 'audio'])
  })
})

describe('trocear el audio', () => {
  it('MP3: corta entre tramas, cada trozo empieza por una trama y los tiempos encajan', () => {
    const dir = temp()
    const file = join(dir, 'clase.mp3')
    writeFileSync(file, mp3(1000))
    expect(mp3Frame(mp3(1, false), 0)).toEqual({ bytes: 417, seconds: 1152 / 44100 })
    const plan = planAudio(file, mp3(1), { maxSeconds: 10, maxBytes: 1e9 })
    expect(plan.duration).toBeCloseTo((1000 * 1152) / 44100, 3)
    expect(plan.parts.length).toBe(3)
    let frames = 0
    for (const [i, p] of plan.parts.entries()) {
      const bytes = p.load()
      expect(bytes[0]).toBe(0xff)
      expect(bytes.length % 417).toBe(0)
      frames += bytes.length / 417
      if (i > 0) expect(p.start).toBeCloseTo(plan.parts[i - 1].end!, 6)
      expect(p.end! - p.start).toBeLessThanOrEqual(10.0001)
    }
    expect(frames).toBe(1000)
    // por tamaño también
    expect(planAudio(file, mp3(1), { maxSeconds: 3600, maxBytes: 417 * 100 }).parts.length).toBe(10)
  })

  it('WAV: baja a voz (16 kHz, mono, 16 bits) y corta por tiempo', () => {
    const dir = temp()
    const file = join(dir, 'clase.wav')
    writeFileSync(file, wav(2.5))
    const plan = planAudio(file, wav(0.01), { maxSeconds: 1, maxBytes: 1e9 })
    expect(plan.duration).toBeCloseTo(2.5, 3)
    expect(plan.parts.map((p) => [p.start, p.end])).toEqual([[0, 1], [1, 2], [2, 2.5]])
    const first = Buffer.from(plan.parts[0].load())
    expect(first.toString('latin1', 0, 4)).toBe('RIFF')
    expect(first.readUInt32LE(24)).toBe(SPEECH_RATE)
    expect(first.readUInt16LE(22)).toBe(1)
    expect(first.length).toBe(44 + SPEECH_RATE * 2)
    // sigue sonando el tono: no es silencio ni ruido saturado
    let peak = 0
    for (let i = 44; i < first.length; i += 2) peak = Math.max(peak, Math.abs(first.readInt16LE(i)))
    expect(peak).toBeGreaterThan(6000)
    expect(peak).toBeLessThan(13000)
  })

  it('un formato que no sabe trocear se sube entero si es pequeño; si no, lo dice', () => {
    const dir = temp()
    const small = join(dir, 'nota.ogg')
    writeFileSync(small, Buffer.concat([Buffer.from('OggS'), Buffer.alloc(2000)]))
    const plan = planAudio(small, Buffer.from('OggS'), { maxSeconds: 600, maxBytes: 5000 })
    expect(plan.parts).toHaveLength(1)
    expect(plan.parts[0].filename).toBe('grabacion.ogg')
    expect(plan.parts[0].load().length).toBe(2004)
    expect(() => planAudio(small, Buffer.from('OggS'), { maxSeconds: 600, maxBytes: 1000 })).toThrow(MediaTooLargeError)
  })
})

describe('subtítulos', () => {
  const SRT = '1\r\n00:00:01,000 --> 00:00:04,500\r\n<i>Hola</i> a todos.\r\n\r\n2\r\n00:01:02,250 --> 00:01:05,000\r\nHoy vemos\r\nla derivada.\r\n'
  const VTT = 'WEBVTT\n\nNOTE comentario\n\n00:05.000 --> 00:07.000 align:start\nPrimera línea\n\n00:07.000 --> 00:09.000\nPrimera línea\n\n1:00:00.000 --> 1:00:02.000\n{\\an8}Una hora &amp; pico\n'
  it('lee SRT y WebVTT con sus tiempos, sin etiquetas ni líneas repetidas', () => {
    expect(parseSubtitles(SRT)).toEqual([{ start: 1, end: 4.5, text: 'Hola a todos.' }, { start: 62.25, end: 65, text: 'Hoy vemos la derivada.' }])
    expect(parseSubtitles(VTT)).toEqual([{ start: 5, end: 9, text: 'Primera línea' }, { start: 3600, end: 3602, text: 'Una hora & pico' }])
    expect(parseSubtitles('nada que ver')).toEqual([])
  })
  it('si la grabación trae subtítulos al lado, se usan y no hace falta ningún servicio', async () => {
    const dir = temp()
    copyFileSync(M4A, join(dir, 'Clase 3.m4a'))
    writeFileSync(join(dir, 'clase 3.es.srt'), SRT)
    expect(sidecarSubtitles(join(dir, 'Clase 3.m4a'))?.file).toBe('clase 3.es.srt')
    const t = await transcribeRecording(join(dir, 'Clase 3.m4a'), { head: HEAD_M4A })
    expect(t).toMatchObject({ origin: 'subtitles', by: 'clase 3.es.srt', duration: 65 })
    expect(t.segments).toHaveLength(2)
  })
})

describe('transcribir una grabación', () => {
  it('sin subtítulos ni servicio, lo dice', async () => {
    await expect(transcribeRecording(M4A, { head: HEAD_M4A })).rejects.toBeInstanceOf(NoTranscriberError)
  })

  it('envía cada trozo y coloca sus frases en el minuto real de la grabación', async () => {
    const engine = fakeEngine()
    const progress: number[] = []
    const t = await transcribeRecording(M4A, { head: HEAD_M4A, engine, language: 'es', limits: { maxSeconds: 4, maxBytes: 1e9 }, onProgress: (f) => progress.push(f) })
    expect(engine.calls.map((c) => c.filename)).toEqual(['parte-1.m4a', 'parte-2.m4a', 'parte-3.m4a'])
    expect(engine.calls.every((c) => c.language === 'es' && c.bytes > 1000)).toBe(true)
    expect(t.origin).toBe('speech')
    expect(t.by).toBe('Prueba · modelo')
    expect(t.duration).toBeGreaterThan(11)
    expect(t.segments.map((s) => s.text)).toEqual(['Frase de parte-1.m4a.', 'Otra frase.', 'Frase de parte-2.m4a.', 'Otra frase.', 'Frase de parte-3.m4a.', 'Otra frase.'])
    // el segundo trozo empieza hacia el segundo 3,9: su primera frase, medio segundo después
    expect(t.segments[2].start).toBeGreaterThan(4.2)
    expect(t.segments[2].start).toBeLessThan(4.6)
    for (let i = 1; i < t.segments.length; i++) expect(t.segments[i].start).toBeGreaterThanOrEqual(t.segments[i - 1].start)
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(1)
  })

  it('se puede cancelar entre trozos', async () => {
    const stop = new AbortController()
    const engine = fakeEngine()
    const original = engine.transcribe.bind(engine)
    engine.transcribe = async (part, options) => { const r = await original(part, options); stop.abort(); return r }
    await expect(transcribeRecording(M4A, { head: HEAD_M4A, engine, signal: stop.signal, limits: { maxSeconds: 4, maxBytes: 1e9 } })).rejects.toThrow()
    expect(engine.calls).toHaveLength(1)
  })

  it('limpia frases vacías y la misma frase repetida seguida', () => {
    expect(tidy([{ start: 5, end: 6, text: ' b ' }, { start: 0, end: 1, text: 'a' }, { start: 6, end: 9, text: 'b' }, { start: 9, end: 10, text: '  ' }])).toEqual([{ start: 0, end: 1, text: 'a' }, { start: 5, end: 9, text: 'b' }])
  })
})

describe('servicio de transcripción compatible con OpenAI', () => {
  const ok = { text: 'hola', language: 'spanish', duration: 3.2, segments: [{ id: 0, start: 0, end: 1.5, text: ' Hola.' }, { id: 1, start: 1.5, end: 3.2, text: ' Adiós.' }] }
  const part = { bytes: Uint8Array.from([1, 2, 3]), filename: 'parte-1.m4a', mime: 'audio/mp4' }

  it('manda el archivo, el modelo y pide los tramos con su tiempo; nunca sigue redirecciones', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(ok), { status: 200 }))
    const engine = openAITranscription({ baseURL: 'https://api.example.test/v1/', apiKey: 'clave', model: 'whisper-x', label: 'Ejemplo · whisper-x', fetch: fetchMock as unknown as typeof fetch })
    const heard = await engine.transcribe(part, { language: 'es-MX' })
    expect(heard).toEqual({ text: 'hola', language: 'spanish', duration: 3.2, segments: [{ start: 0, end: 1.5, text: ' Hola.' }, { start: 1.5, end: 3.2, text: ' Adiós.' }] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.test/v1/audio/transcriptions')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer clave' } })
    const form = init!.body as FormData
    expect(form.get('model')).toBe('whisper-x')
    expect(form.get('response_format')).toBe('verbose_json')
    expect(form.get('timestamp_granularities[]')).toBe('segment')
    expect(form.get('language')).toBe('es')
    expect((form.get('file') as File).name).toBe('parte-1.m4a')
    expect((form.get('file') as File).size).toBe(3)
  })

  it('reintenta lo pasajero y explica lo que no tiene arreglo', async () => {
    const replies = [new Response('lleno', { status: 503 }), new Response('{}', { status: 429, headers: { 'retry-after': '0' } }), new Response(JSON.stringify({ text: 'al fin' }), { status: 200 })]
    const flaky = vi.fn(async () => replies.shift()!)
    const engine = openAITranscription({ baseURL: 'https://x.test/v1', apiKey: 'k', model: 'm', label: 'X', fetch: flaky as unknown as typeof fetch, retryDelays: [0, 0, 0] })
    expect((await engine.transcribe(part, {})).text).toBe('al fin')
    expect(flaky).toHaveBeenCalledTimes(3)
    const fails = (status: number, body = '{"error":{"message":"motivo"}}'): TranscriptionEngine => openAITranscription({ baseURL: 'https://x.test/v1', apiKey: 'k', model: 'm', label: 'X', retryDelays: [], fetch: (async () => new Response(body, { status })) as unknown as typeof fetch })
    for (const [status, code] of [[401, 'auth'], [413, 'tooLarge'], [400, 'unsupported'], [429, 'rateLimited'], [500, 'server']] as const) {
      const err = await fails(status).transcribe(part, {}).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(TranscriptionError)
      expect((err as TranscriptionError).code).toBe(code)
      expect((err as TranscriptionError).message).toContain('motivo')
    }
    const down = openAITranscription({ baseURL: 'https://x.test/v1', apiKey: 'k', model: 'm', label: 'X', retryDelays: [0], fetch: (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch })
    expect(((await down.transcribe(part, {}).catch((e: unknown) => e)) as TranscriptionError).code).toBe('network')
  })
})

describe('una grabación como material del curso', () => {
  it('queda como fuente de audio: tramos con su minuto, fragmentos con sus segundos y la duración', async () => {
    const engine = fakeEngine()
    const r = await ingestFile(M4A, { transcription: () => engine, language: 'es' })
    expect(r.kind).toBe('audio')
    expect(r.title).toBe('clase')
    expect(Number(r.metadata.duration)).toBeGreaterThan(10)
    expect(r.metadata).toMatchObject({ transcribedBy: 'Prueba · modelo', transcriptOrigin: 'speech' })
    expect(r.pages[0]).toMatchObject({ number: 1, start: 0, text: 'Frase de parte-1.m4a. Otra frase.' })
    expect(r.pages[0].end).toBeGreaterThanOrEqual(3)
    expect(r.chunks.length).toBeGreaterThan(0)
    expect(r.chunks[0]).toMatchObject({ page: 1, start: 0 })
    expect(r.chunks[0].end).toBeGreaterThanOrEqual(3)
  })

  it('agrupa las frases en tramos de medio minuto que saben cuándo empiezan', () => {
    const segments = Array.from({ length: 40 }, (_, i) => ({ start: i * 5, end: i * 5 + 5, text: `Frase ${i}.` }))
    const pages = transcriptPages(segments)
    expect(pages.length).toBeGreaterThanOrEqual(6)
    expect(pages[0]).toMatchObject({ number: 1, start: 0 })
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i].start).toBeGreaterThanOrEqual(pages[i - 1].end! - 1)
      expect(pages[i].end! - pages[i].start!).toBeLessThanOrEqual(31)
    }
    expect(pages.map((p) => p.text).join(' ')).toBe(segments.map((s) => s.text).join(' '))
  })

  it('sin servicio de transcripción, el error dice qué conectar', async () => {
    const err = await ingestFile(M4A, { transcription: () => undefined }).catch((e: unknown) => e)
    expect(isIngestError(err, 'unsupportedType')).toBe(true)
    expect((err as Error).message).toMatch(/Groq, OpenAI/)
  })
})

describe('citar el minuto', () => {
  it('los instantes se leen y se escriben como se dicen', () => {
    expect([timecode(0), timecode(59.9), timecode(2480), timecode(3725)]).toEqual(['0:00', '0:59', '41:20', '1:02:05'])
    expect([parseTimecode('41:20'), parseTimecode('1:02:05'), parseTimecode('2480'), parseTimecode('00:01:02,500'), parseTimecode('hola')]).toEqual([2480, 3725, 2480, 62.5, undefined])
  })
  it('una cita puede llevar el segundo de la grabación (en número o como «41:20») y se etiqueta con él', () => {
    expect(decodeSourceRef({ source: 'clase-3', at: 2480 })).toEqual({ source: 'clase-3', at: 2480 })
    expect(decodeSourceRef({ source: 'clase-3', at: '41:20', atEnd: '42:00', quote: 'la regla de la cadena' })).toEqual({ source: 'clase-3', at: 2480, atEnd: 2520, quote: 'la regla de la cadena' })
    expect(decodeSourceRef({ source: 'clase-3', page: 4, at: 'ayer' })).toEqual({ source: 'clase-3', page: 4 })
    expect(encodeSourceRef({ source: 's', at: 2480, atEnd: 2520 })).toEqual({ source: 's', at: 2480, atEnd: 2520 })
    expect(sourceRefLabel({ source: 's', at: 2480 })).toBe('41:20')
    expect(sourceRefLabel({ source: 's', at: 2480, atEnd: 2520, page: 3 })).toBe('41:20–42:00')
    expect(sourceRefLabel({ source: 's', page: 3 })).toBe('p. 3')
  })
})
