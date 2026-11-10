// Qué grabaciones entiende Aula y cómo se llama cada contenedor. Sin Electron ni dependencias: solo mira bytes y extensiones.

/** Contenedor de una grabación: decide cómo se trocea su audio para transcribirlo. */
export type MediaContainer = 'mp4' | 'mp3' | 'wav' | 'webm' | 'ogg' | 'flac' | 'aac' | 'other'

export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(['mp3', 'm4a', 'm4b', 'wav', 'wave', 'aac', 'flac', 'ogg', 'oga', 'opus', 'weba', 'aiff', 'aif', 'caf', 'amr', 'wma', 'mpga'])
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', '3gp', 'ogv', 'wmv', 'mpg', 'mpeg', 'ts', 'mts'])

/** Subtítulos que pueden acompañar a una grabación (mismo nombre, al lado): se usan en vez de transcribir. */
export const SUBTITLE_EXTENSIONS: readonly string[] = ['vtt', 'srt']

export function mediaKindForExtension(ext: string): 'audio' | 'video' | null {
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return null
}

const at = (b: Uint8Array, text: string, offset = 0): boolean => {
  if (b.length < offset + text.length) return false
  for (let i = 0; i < text.length; i++) if (b[offset + i] !== text.charCodeAt(i)) return false
  return true
}

/** Marcas de imagen de la familia ISO (HEIC, AVIF): comparten la caja `ftyp` con el MP4, pero no son grabaciones. */
const STILL_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis'])
const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ', 'F4A ', 'F4B '])

/**
 * Contenedor por la firma de los primeros bytes (null si no es una grabación conocida). `audioOnly` dice si la firma ya
 * deja claro que no lleva imagen (un .m4a); si no, lo decide la extensión.
 */
export function mediaSignature(head: Uint8Array): { container: MediaContainer; audioOnly?: boolean; weak?: boolean } | null {
  if (at(head, 'ftyp', 4) && head.length >= 12) {
    const brand = String.fromCharCode(...head.subarray(8, 12))
    if (STILL_BRANDS.has(brand)) return null
    return { container: 'mp4', audioOnly: AUDIO_BRANDS.has(brand) }
  }
  // QuickTime antiguo: sin `ftyp`, empieza por `moov`, `mdat`, `wide` o `free`
  if (head.length >= 8 && (at(head, 'moov', 4) || at(head, 'mdat', 4) || at(head, 'wide', 4))) return { container: 'mp4' }
  if (at(head, 'RIFF') && at(head, 'WAVE', 8)) return { container: 'wav', audioOnly: true }
  if (at(head, 'RIFF') && at(head, 'AVI ', 8)) return { container: 'other' }
  if (at(head, 'ID3')) return { container: 'mp3', audioOnly: true }
  if (at(head, 'OggS')) return { container: 'ogg' }
  if (at(head, 'fLaC')) return { container: 'flac', audioOnly: true }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return { container: 'webm' }
  if (at(head, 'FORM') && (at(head, 'AIFF', 8) || at(head, 'AIFC', 8))) return { container: 'other', audioOnly: true }
  if (at(head, 'caff')) return { container: 'other', audioOnly: true }
  if (head.length >= 2 && head[0] === 0xff) {
    // ADTS (AAC suelto): 12 bits de sincronía y capa 0; MP3: 11 bits de sincronía y capa distinta de 0. Son firmas
    // débiles (dos bytes): un texto en UTF-16 empieza por FF FE. Solo valen si la extensión también dice que es audio.
    if ((head[1] & 0xf6) === 0xf0) return { container: 'aac', audioOnly: true, weak: true }
    if ((head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0) return { container: 'mp3', audioOnly: true, weak: true }
  }
  return null
}

/** Contenedor de un archivo ya reconocido como grabación (la firma manda; si no la hay, la extensión). */
export function containerOf(head: Uint8Array, ext: string): MediaContainer {
  const sig = mediaSignature(head)
  if (sig) return sig.container
  switch (ext) {
    case 'mp4': case 'm4v': case 'mov': case 'm4a': case 'm4b': case '3gp': return 'mp4'
    case 'mp3': case 'mpga': return 'mp3'
    case 'wav': case 'wave': return 'wav'
    case 'webm': case 'weba': case 'mkv': return 'webm'
    case 'ogg': case 'oga': case 'opus': case 'ogv': return 'ogg'
    case 'flac': return 'flac'
    case 'aac': return 'aac'
    default: return 'other'
  }
}

/** Tipo MIME para servir o subir una grabación. */
export function mediaMime(ext: string): string {
  switch (ext) {
    case 'mp3': case 'mpga': return 'audio/mpeg'
    case 'm4a': case 'm4b': return 'audio/mp4'
    case 'wav': case 'wave': return 'audio/wav'
    case 'aac': return 'audio/aac'
    case 'flac': return 'audio/flac'
    case 'ogg': case 'oga': case 'opus': return 'audio/ogg'
    case 'weba': return 'audio/webm'
    case 'aiff': case 'aif': return 'audio/aiff'
    case 'mp4': case 'm4v': return 'video/mp4'
    case 'mov': return 'video/quicktime'
    case 'webm': return 'video/webm'
    case 'mkv': return 'video/x-matroska'
    case 'ogv': return 'video/ogg'
    default: return 'application/octet-stream'
  }
}
