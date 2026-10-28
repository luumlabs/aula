// Tipos del modelo de fuentes (materiales del curso), con el mismo formato JSON que la app Swift (IngestKit / StudyModel).
// Isomorfo: sin Node ni DOM.

/** Tipo de fuente que el usuario le da a la app (mismos valores que `SourceKind` de Swift). */
export type SourceKind =
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'epub'
  | 'html'
  | 'markdown'
  | 'text'
  | 'rtf'
  | 'image'
  | 'web'
  | 'unknown'

export const SOURCE_KINDS: readonly SourceKind[] = [
  'pdf', 'docx', 'pptx', 'xlsx', 'epub', 'html', 'markdown', 'text', 'rtf', 'image', 'web', 'unknown'
]

/**
 * Una «página» de una fuente: página de PDF, diapositiva, hoja de cálculo, capítulo de EPUB…
 * El texto usa una convención ligera tipo Markdown: títulos `#`, listas `- ` / `1. `, tablas `a | b | c`.
 */
export interface SourcePage {
  /** Número de página, empezando en 1 (en PDF, la página real; en PowerPoint, la diapositiva…). */
  number: number
  /** Texto de la página ya limpio. */
  text: string
  /** `true` si el texto salió de OCR y no de una capa de texto. */
  usedOCR: boolean
  /** Título de la página (primer encabezado, título de la diapositiva, nombre de la hoja…). */
  heading?: string
  /** `true` si la página contiene imágenes o figuras relevantes. */
  hasFigures: boolean
  /** La página no tiene capa de texto útil (escaneada) y no se pudo hacer OCR; hace falta su imagen. */
  needsOCR?: boolean
  /** Confianza media del OCR (0…1) si `usedOCR`. */
  ocrConfidence?: number
  /** El OCR de esta página tiene poca confianza (< 0,5): conviene revisar el texto. */
  lowConfidence?: boolean
}

/** Documento ya leído: texto por páginas, metadatos y advertencias (`SourceDocument` de Swift). */
export interface SourceDocument {
  title: string
  kind: SourceKind
  /** Siempre hay al menos una página. */
  pages: SourcePage[]
  /** Claves posibles: title, author, subject, keywords, creator, created, modified, pageCount, language, url, siteName… */
  metadata: Record<string, string>
  /** Avisos para el usuario, ya en el idioma de la interfaz. */
  warnings: string[]
}

/** Fragmento de una fuente (formato de `sources/<id>/chunks.json`; las claves opcionales se omiten si no hay valor). */
export interface SourceChunk {
  /** Estable: primeros 16 hex de sha256("<sourceID>\u001F<ordinal>\u001F<text>"). */
  id: string
  sourceID: string
  ordinal: number
  page?: number
  pageEnd?: number
  heading?: string
  text: string
}

/** Material registrado en el curso (`pack.json → sources[]`, `SourceMeta` de Swift). */
export interface SourceMeta {
  id: string
  title: string
  /** pdf, docx, pptx, image, web, text, canvas… */
  kind: string
  /** Archivo original dentro de `sources/<id>/`. */
  filename?: string
  url?: string
  /** ISO-8601. */
  addedAt: string
  pages: number
  characters: number
  status: 'processing' | 'ready' | 'failed'
  trust: SourceTrust
  note?: string
  warnings: string[]
}

export type SourceTrust = 'official' | 'book' | 'notes' | 'web' | 'canvas' | 'other'

/** Progreso de una lectura: 0…1 y un mensaje para el usuario. */
export interface IngestProgress {
  fraction: number
  message: string
}

/** Resultado de alto nivel de `ingestFile`, `ingestURL` e `ingestText`. */
export interface IngestResult {
  /** Id de la fuente con el que se hicieron los fragmentos («slug-del-titulo-abcd» o el que se pidió). */
  sourceID: string
  kind: SourceKind
  title: string
  pages: SourcePage[]
  /** Todo el texto, con las páginas no vacías separadas por una línea en blanco. */
  text: string
  chunks: SourceChunk[]
  warnings: string[]
  metadata: Record<string, string>
  /** Números de las páginas que necesitan OCR o su imagen (escaneadas sin OCR disponible). */
  pagesNeedingOCR: number[]
}

/** Un resultado de búsqueda en los materiales de un curso. El fragmento marca las coincidencias con `**…**`. */
export interface SourceHit {
  chunkID: string
  sourceID: string
  sourceTitle?: string
  page?: number
  pageEnd?: number
  heading?: string
  /** ≈ 200 caracteres alrededor de la coincidencia, con los términos en `**negrita**` (los `*` del texto llegan como `∗`). */
  snippet: string
  score: number
}

/**
 * Dibuja páginas de PDF (y convierte imágenes) a PNG para el OCR y los modelos con visión. Lo implementa la capa de
 * Electron (ventana fuera de pantalla); la lectura funciona sin él (las páginas escaneadas quedan con `needsOCR`).
 */
export interface PageRasterizer {
  /** PNG de la página `page` (desde 1) con el lado largo de `maxDimension` px (como mucho 4096); `null` si no se puede. */
  renderPdfPage(pdf: Uint8Array, page: number, maxDimension: number): Promise<Uint8Array | null>
  /** Opcional: convierte una imagen que el OCR no sabe leer (HEIC, AVIF…) a PNG, con la orientación EXIF aplicada. */
  imageToPng?(image: Uint8Array, maxDimension: number): Promise<Uint8Array | null>
}

/** Cómo citar una ubicación de este tipo de fuente («p. 3», «diapositiva 3», «hoja 2», «cap. 5»). */
export function locationLabel(kind: SourceKind, page: number, language = 'es'): string {
  const n = String(page)
  const en = language.toLowerCase().startsWith('en')
  switch (kind) {
    case 'pptx': return en ? `slide ${n}` : `diapositiva ${n}`
    case 'xlsx': return en ? `sheet ${n}` : `hoja ${n}`
    case 'epub': return en ? `ch. ${n}` : `cap. ${n}`
    default: return `p. ${n}`
  }
}

/** Todo el texto de un documento: páginas no vacías separadas por una línea en blanco. */
export function fullText(doc: Pick<SourceDocument, 'pages'>): string {
  return doc.pages.map((p) => p.text).filter((t) => t.length > 0).join('\n\n')
}

/** Lo que se puede añadir como material: un archivo, una página web o un texto pegado. */
export type IngestInput =
  | { type: 'file'; path: string; title?: string }
  | { type: 'url'; url: string; title?: string }
  | { type: 'text'; text: string; title?: string }
