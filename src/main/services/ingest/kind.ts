// Detección del tipo de una fuente (port de SourceKindDetection.swift): firma de los primeros bytes, extensión y contenido.
import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import type { SourceKind } from '@shared/ingest'
import { looksLikeText, utf8 } from './core/textDecoding'
import { zipEntryNames } from './core/zipArchive'

const ZIP_BASED: ReadonlySet<SourceKind> = new Set(['docx', 'pptx', 'xlsx', 'epub'])

const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'log', 'csv', 'tsv', 'tex', 'rst', 'adoc', 'org', 'srt', 'vtt', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf',
  'py', 'swift', 'js', 'ts', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'sql', 'r', 'm', 'kt', 'lua', 'css'
])

/** Tipos que no tienen firma binaria pero sí extensiones de texto conocidas por el sistema (lo que en Swift daba UTType). */
const SYSTEM_TEXT_EXTENSIONS = new Set([
  'mjs', 'cjs', 'jsx', 'tsx', 'scss', 'sass', 'less', 'toml', 'properties', 'bat', 'ps1', 'pl', 'pm', 'scala', 'dart', 'hs', 'ml',
  'ex', 'exs', 'erl', 'clj', 'vue', 'svelte', 'bib', 'sty', 'cls', 'diff', 'patch', 'mm', 'f90', 'jl', 'zsh', 'bash', 'fish', 'nim',
  'vcf', 'ics', 'strings', 'gradle', 'cmake', 'make', 'mk', 'tsv', 'nfo', 'asc'
])

/** Tipo de una extensión (sin punto, en minúsculas), o `null` si no se conoce. */
export function kindForExtension(ext: string): SourceKind | null {
  switch (ext) {
    case 'pdf': return 'pdf'
    case 'docx': case 'docm': case 'dotx': case 'dotm': return 'docx'
    case 'pptx': case 'pptm': case 'ppsx': case 'ppsm': case 'potx': case 'potm': return 'pptx'
    case 'xlsx': case 'xlsm': case 'xltx': case 'xltm': return 'xlsx'
    case 'epub': return 'epub'
    case 'html': case 'htm': case 'xhtml': case 'xht': case 'shtml': return 'html'
    case 'md': case 'markdown': case 'mdown': case 'mkd': case 'mkdn': case 'mdx': return 'markdown'
    case 'rtf': return 'rtf'
    case 'png': case 'jpg': case 'jpeg': case 'jpe': case 'jfif': case 'heic': case 'heif': case 'tif': case 'tiff': case 'webp': case 'gif': case 'bmp': case 'avif':
      return 'image'
    default: return TEXT_EXTENSIONS.has(ext) ? 'text' : null
  }
}

/** Extensión de un nombre de archivo, sin punto y en minúsculas («Apuntes.PDF» → «pdf»). */
export function extensionOf(path: string): string {
  return extname(path).slice(1).toLowerCase()
}

type Signature = 'pdf' | 'image' | 'rtf' | 'zip' | 'ole'

const startsAt = (b: Uint8Array, prefix: ArrayLike<number>, offset = 0): boolean => {
  if (b.length < offset + prefix.length) return false
  for (let i = 0; i < prefix.length; i++) if (b[offset + i] !== prefix[i]) return false
  return true
}
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0))

/** Posición de `needle` en `hay` (o -1). */
export function indexOfBytes(hay: Uint8Array, needle: ArrayLike<number>, from = 0, to = hay.length): number {
  const end = Math.min(to, hay.length) - needle.length
  outer: for (let i = Math.max(0, from); i <= end; i++) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer
    return i
  }
  return -1
}

const PDF_MAGIC = ascii('%PDF-')
export const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis'])

/** ¿Los primeros bytes son de un PDF? La cabecera puede ir precedida de basura (hasta 1024 bytes). */
export function looksLikePDF(head: Uint8Array): boolean {
  return indexOfBytes(head, PDF_MAGIC, 0, 1024) >= 0
}

function signatureOf(head: Uint8Array): Signature | null {
  const b = head.subarray(0, 32)
  if (looksLikePDF(head)) return 'pdf'
  if (startsAt(b, [0x89, 0x50, 0x4e, 0x47])) return 'image'                                      // PNG
  if (startsAt(b, [0xff, 0xd8, 0xff])) return 'image'                                            // JPEG
  if (startsAt(b, ascii('GIF87a')) || startsAt(b, ascii('GIF89a'))) return 'image'
  if (startsAt(b, [0x49, 0x49, 0x2a, 0x00]) || startsAt(b, [0x4d, 0x4d, 0x00, 0x2a])) return 'image'  // TIFF
  if (startsAt(b, ascii('RIFF')) && startsAt(b, ascii('WEBP'), 8)) return 'image'
  if (startsAt(b, ascii('ftyp'), 4) && b.length >= 12) {
    const brand = String.fromCharCode(...b.subarray(8, 12))
    if (HEIF_BRANDS.has(brand)) return 'image'
  }
  if (startsAt(b, ascii('BM')) && b.length >= 18 && [12, 40, 52, 56, 64, 108, 124].includes(b[14]) && b[15] === 0 && b[16] === 0 && b[17] === 0) return 'image'
  if (startsAt(b, ascii('{\\rtf'))) return 'rtf'
  if (startsAt(b, [0x50, 0x4b, 0x03, 0x04]) || startsAt(b, [0x50, 0x4b, 0x05, 0x06])) return 'zip'
  if (startsAt(b, OLE_MAGIC)) return 'ole'
  return null
}

/** Primeros bytes de un archivo normal (nunca de una tubería o un dispositivo, que podrían bloquear la lectura). */
export function readHead(path: string, maxBytes = 4096): Uint8Array | null {
  let fd: number | null = null
  try {
    const real = realpathSync(path)
    if (!statSync(real).isFile()) return null
    fd = openSync(real, 'r')
    const buf = new Uint8Array(maxBytes)
    const n = readSync(fd, buf, 0, maxBytes, 0)
    return buf.subarray(0, n)
  } catch {
    return null
  } finally {
    if (fd !== null) try { closeSync(fd) } catch { /* nada */ }
  }
}

/** Un ZIP puede ser docx, pptx, xlsx, epub u otra cosa: se mira su contenido. */
function refineZip(path: string, byExtension: SourceKind | null): SourceKind {
  // solo el directorio central (A2-P2-14: antes se leía el archivo entero, en el proceso principal, al añadirlo a «Crear curso»)
  const names = zipEntryNames(path)
  if (!names) return byExtension && ZIP_BASED.has(byExtension) ? byExtension : 'unknown'
  const has = (prefix: string): boolean => names.some((n) => n.toLowerCase().startsWith(prefix))
  const contains = (name: string): boolean => names.some((n) => n === name || n.toLowerCase() === name.toLowerCase())
  if (names.includes('mimetype') && contains('META-INF/container.xml')) return 'epub'
  if (contains('META-INF/container.xml') && (has('oebps/') || names.some((n) => n.endsWith('.opf')))) return 'epub'
  if (has('word/')) return 'docx'
  if (has('ppt/')) return 'pptx'
  if (has('xl/')) return 'xlsx'
  if (contains('META-INF/container.xml')) return 'epub'
  if (byExtension && ZIP_BASED.has(byExtension)) return byExtension   // paquete incompleto: el extractor lo explicará
  return 'unknown'
}

function looksLikeHTML(head: Uint8Array): boolean {
  let s = utf8(head.subarray(0, 512))
  if (s.startsWith('﻿')) s = s.slice(1)
  const t = s.trim().toLowerCase()
  return t.startsWith('<!doctype html') || t.startsWith('<html') || t.startsWith('<head') || t.startsWith('<body') || (t.startsWith('<?xml') && t.includes('<html'))
}

/** ¿Es una dirección web (http/https)? */
export function isWebAddress(s: string): boolean {
  return /^https?:\/\//i.test(s.trim())
}

/**
 * Tipo de una fuente: la firma de bytes manda sobre la extensión; después la extensión conocida y, por último, el contenido.
 * Las direcciones http(s) son `web`. Los archivos ilegibles se clasifican solo por extensión.
 */
export function detectKind(path: string): SourceKind {
  if (isWebAddress(path)) return 'web'
  // Otros esquemas («ftp:», «mailto:»…) no son archivos (una letra sola es una unidad de Windows: «C:\\…»)
  if (/^[a-z][a-z0-9+.-]+:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return 'unknown'
  const ext = extensionOf(path)
  const byExtension = kindForExtension(ext)
  const head = readHead(path)
  if (!head || head.length === 0) return byExtension ?? 'unknown'

  // 1. Firma de bytes
  switch (signatureOf(head)) {
    case 'pdf': return 'pdf'
    case 'image': return 'image'
    case 'rtf': return 'rtf'
    case 'ole': return 'unknown'                         // .doc / .xls / .ppt antiguos: no soportados
    case 'zip': return refineZip(path, byExtension)
    default: break
  }
  // 2. Extensión conocida (sin firma binaria: texto, HTML… o un archivo dañado que el extractor explicará)
  if (byExtension) return byExtension
  // 3. Extensiones de texto que el sistema conoce
  if (ext && SYSTEM_TEXT_EXTENSIONS.has(ext)) return 'text'
  // 4. Contenido
  if (looksLikeHTML(head)) return 'html'
  if (looksLikeText(head)) return 'text'
  return 'unknown'
}
