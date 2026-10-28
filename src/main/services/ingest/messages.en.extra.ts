// Textos nuevos de esta versión (no existen en el catálogo de la app Swift), en inglés.
import type { Translation } from './messages'

export const EN_EXTRA_MESSAGES: Record<string, Translation> = {
  'La imagen tiene %lld páginas; solo se leyó la primera.': 'The image has %lld pages; only the first one was read.',
  'El reconocimiento de texto (OCR) no está disponible: la imagen se guardó sin texto.': 'Text recognition (OCR) isn’t available: the image was saved without text.',
  'el lector de archivos se cerró de forma inesperada': 'the file reader closed unexpectedly',
  'El PDF tarda demasiado en leerse; solo se leyeron las primeras %lld páginas.': 'The PDF takes too long to read; only the first %lld pages were read.',
  'el lector de archivos tardó demasiado y se reinició': 'the file reader took too long and was restarted',
  'El documento es demasiado largo; solo se guardó su principio (%lld millones de caracteres).': 'The document is too long; only its beginning was kept (%lld million characters).',
  'Una página parece escaneada y no se pudo leer su texto; se usará su imagen.': 'One page looks scanned and its text couldn’t be read; its image will be used.',
  '%lld páginas parecen escaneadas y no se pudo leer su texto; se usarán sus imágenes.': {
    one: '%lld page looks scanned and its text couldn’t be read; its image will be used.',
    other: '%lld pages look scanned and their text couldn’t be read; their images will be used.'
  }
}
