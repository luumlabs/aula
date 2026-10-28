// Ficha de un archivo del curso (imagen o modelo 3D) y lo que se deduce de ella (port de StudyEngine/Content/AssetMeta.swift):
// medidas, procedencia y crédito; y el «enriquecimiento» que rellena la proporción y el crédito que la IA no tiene por qué
// saber. Aquí solo la lógica pura: leer los archivos lo hace el proceso principal (src/main/services/study/assets.ts).
import type { Block, CardFigure, Deck, Exercise, Flashcard, SourceRef } from '@shared/schema'
import { answerForGrading } from '@shared/schema'

/** `assets/<id>.meta.json` (mismas claves que la app Swift). */
export interface AssetMeta {
  /** image | model */
  kind: string
  width?: number
  height?: number
  title?: string
  author?: string
  license?: string
  /** Página de la obra (p. ej. la de Wikimedia Commons) y dirección del archivo descargado. */
  pageURL?: string
  fileURL?: string
  /** Crédito escrito a mano, si no hay autor y licencia por separado. */
  creditText?: string
}

/** Ancho / alto. */
export function assetAspect(m: AssetMeta): number | undefined {
  return m.width !== undefined && m.height !== undefined && m.width > 0 && m.height > 0 ? m.width / m.height : undefined
}

/** ¿Viene de fuera (con autor o licencia que hay que citar)? */
export function assetNeedsCredit(m: AssetMeta): boolean {
  return !!m.license || !!m.author || !!m.pageURL || !!m.creditText
}

/** Crédito listo para el pie: «Autor · Licencia · Wikimedia Commons». */
export function assetCredit(m: AssetMeta): string | undefined {
  const c = m.creditText?.trim()
  if (c && !m.author && !m.license) return c
  const parts: string[] = []
  const a = m.author?.trim()
  if (a) parts.push(Array.from(a).slice(0, 120).join(''))
  const l = m.license?.trim()
  if (l) parts.push(l)
  if (m.pageURL) {
    try {
      const host = new URL(m.pageURL).host
      if (host) parts.push(host.includes('wikimedia') || host.includes('wikipedia') ? 'Wikimedia Commons' : host.replace('www.', ''))
    } catch { /* dirección no válida */ }
  }
  return parts.length ? parts.join(' · ') : undefined
}

/** Lee una ficha guardada (tolerante: tipos equivocados se ignoran). */
export function decodeAssetMeta(raw: unknown): AssetMeta | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const s = (k: string): string | undefined => (typeof o[k] === 'string' ? (o[k] as string) : undefined)
  const n = (k: string): number | undefined => (typeof o[k] === 'number' && Number.isInteger(o[k]) ? (o[k] as number) : undefined)
  const m: AssetMeta = { kind: s('kind') ?? 'image' }
  const put = <K extends keyof AssetMeta>(k: K, v: AssetMeta[K] | undefined): void => { if (v !== undefined) m[k] = v }
  put('width', n('width')); put('height', n('height')); put('title', s('title')); put('author', s('author')); put('license', s('license'))
  put('pageURL', s('pageURL')); put('fileURL', s('fileURL')); put('creditText', s('creditText'))
  return m
}

/** ¿El pie ya cita autor o licencia? */
export function captionHasCredit(caption: string | undefined): boolean {
  const low = caption?.toLowerCase()
  if (!low) return false
  return ['wikimedia', 'cc by', 'cc-by', 'cc0', 'dominio público', 'public domain', 'licencia', 'license', 'gfdl', '©'].some((x) => low.includes(x))
}

// MARK: Medidas de una imagen (cabeceras PNG, JPEG, GIF, WebP y BMP)

const u16be = (b: Uint8Array, i: number): number => (b[i] << 8) | b[i + 1]
const u16le = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8)
const u32be = (b: Uint8Array, i: number): number => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]
const u32le = (b: Uint8Array, i: number): number => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0)

/** Orientación EXIF de un JPEG (1…8) a partir del segmento APP1. */
function jpegOrientation(b: Uint8Array, start: number, len: number): number | undefined {
  const s = start + 4
  if (len < 14 || String.fromCharCode(b[s], b[s + 1], b[s + 2], b[s + 3]) !== 'Exif') return undefined
  const tiff = s + 6
  const le = b[tiff] === 0x49
  const r16 = (i: number): number => (le ? u16le(b, i) : u16be(b, i))
  const r32 = (i: number): number => (le ? u32le(b, i) : u32be(b, i))
  const ifd = tiff + r32(tiff + 4)
  if (ifd + 2 > b.length) return undefined
  const n = r16(ifd)
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12
    if (e + 12 > b.length) break
    if (r16(e) === 0x0112) return r16(e + 8)
  }
  return undefined
}

/** Ancho y alto tal como se ven (fotos giradas EXIF 5…8: se intercambian). undefined si no es una imagen conocida. */
export function imageSize(b: Uint8Array): [number, number] | undefined {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return [u32be(b, 16), u32be(b, 20)]
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return [u16le(b, 6), u16le(b, 8)]
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) return [u32le(b, 18), Math.abs(u32le(b, 22) | 0)]
  if (b.length >= 30 && String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP') {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (kind === 'VP8 ') return [u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff]
    if (kind === 'VP8L') { const v = u32le(b, 21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1] }
    if (kind === 'VP8X') return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))]
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    let orientation: number | undefined
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue }
      const marker = b[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const len = u16be(b, i + 2)
      if (marker === 0xe1) orientation = jpegOrientation(b, i, len) ?? orientation
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        const h = u16be(b, i + 5), w = u16be(b, i + 7)
        return orientation !== undefined && orientation >= 5 && orientation <= 8 ? [h, w] : [w, h]
      }
      i += 2 + len
    }
  }
  return undefined
}

// MARK: Enriquecimiento

/** Lo que el enriquecimiento necesita saber del curso. */
export interface AssetLookup {
  meta(id: string): AssetMeta | undefined
  /** Proporción de la página de un material que se usa como figura. */
  sourceAspect?(ref: SourceRef): number | undefined
}

const needsCreditFill = (credit: string | undefined, caption: string | undefined): boolean => !credit && !captionHasCredit(caption)

/** Rellena la proporción y el crédito de un bloque (devuelve uno nuevo). */
export function enrichBlock(b: Block, store: AssetLookup): Block {
  switch (b.type) {
    case 'labeled': {
      const out = { ...b }
      const m = out.asset ? store.meta(out.asset) : undefined
      if (m) {
        if (out.aspect === undefined) { const a = assetAspect(m); if (a !== undefined) out.aspect = a }
        if (needsCreditFill(out.credit, out.caption)) { const c = assetCredit(m); if (c) out.credit = c }
      }
      // página de un material: su proporción, para que el corrector mida como la interfaz que la dibuja
      if (!out.asset && !out.drawing && out.aspect === undefined && out.source) { const a = store.sourceAspect?.(out.source); if (a !== undefined) out.aspect = a }
      return out
    }
    case 'image': case 'model3d': {
      const m = b.asset ? store.meta(b.asset) : undefined
      if (!m || !needsCreditFill(b.credit, b.caption)) return b
      const c = assetCredit(m)
      return c ? { ...b, credit: c } : b
    }
    case 'tryit': return { ...b, inline: b.inline.map((e) => enrichExercise(e, store)) }
    default: return b
  }
}

export const enrichBlocks = (blocks: readonly Block[], store: AssetLookup): Block[] => blocks.map((b) => enrichBlock(b, store))

export function enrichExercise(e: Exercise, store: AssetLookup): Exercise {
  const enrichAnswer = (a: Exercise['answer']): Exercise['answer'] => {
    const x = answerForGrading(a)
    if (x.kind === 'label') {
      const out = { ...x }
      const m = out.asset ? store.meta(out.asset) : undefined
      if (m) {
        if (out.aspect === undefined) { const asp = assetAspect(m); if (asp !== undefined) out.aspect = asp }
        if (!out.credit) { const c = assetCredit(m); if (c) out.credit = c }
      }
      if (!out.asset && !out.drawing && out.aspect === undefined && out.source) { const asp = store.sourceAspect?.(out.source); if (asp !== undefined) out.aspect = asp }
      return out
    }
    if (x.kind === 'multi') return { ...x, parts: x.parts.map((p) => ({ ...p, answer: enrichAnswer(p.answer), prompt: enrichBlocks(p.prompt, store) })) }
    return a
  }
  return { ...e, prompt: enrichBlocks(e.prompt, store), solution: enrichBlocks(e.solution, store), answer: enrichAnswer(e.answer) }
}

export function enrichCard(c: Flashcard, store: AssetLookup): Flashcard {
  const f = c.figure
  const m = f?.asset ? store.meta(f.asset) : undefined
  if (!f || !m) return c
  const figure: CardFigure = { ...f }
  if (figure.aspect === undefined) { const a = assetAspect(m); if (a !== undefined) figure.aspect = a }
  if (!figure.credit) { const cr = assetCredit(m); if (cr) figure.credit = cr }
  return { ...c, figure }
}

export function enrichDeck(d: Deck, store: AssetLookup): Deck {
  return {
    ...d,
    slides: d.slides.map((s) => {
      const out = { ...s, blocks: enrichBlocks(s.blocks, store), right: enrichBlocks(s.right, store) }
      if (s.image && !s.credit) { const m = store.meta(s.image); const c = m ? assetCredit(m) : undefined; if (c) out.credit = c }
      return out
    })
  }
}
