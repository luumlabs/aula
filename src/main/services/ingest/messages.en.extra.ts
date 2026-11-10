// Textos nuevos de esta versión (no existen en el catálogo de la app Swift), en inglés.
import type { Translation } from './messages'

export const EN_EXTRA_MESSAGES: Record<string, Translation> = {
  'Preparando la grabación…': 'Preparing the recording…',
  'Transcribiendo la grabación…': 'Transcribing the recording…',
  'Transcribiendo la grabación (parte %lld de %lld)…': 'Transcribing the recording (part %lld of %lld)…',
  'No se oyó nada que transcribir en la grabación.': 'Nothing to transcribe was heard in the recording.',
  'Se usaron los subtítulos que acompañan a la grabación («%@»).': 'The subtitles next to the recording were used (“%@”).',
  'Se transcribió lo que se dice; lo que solo se ve en la pantalla no está en el texto.': 'What is said was transcribed; what is only shown on screen is not in the text.',
  'para transcribir «%@» hace falta conectar en Ajustes → Tu IA un servicio que transcriba audio (Groq, OpenAI o Mistral), o poner al lado sus subtítulos (.vtt o .srt con el mismo nombre)': 'to transcribe “%@”, connect a service that transcribes audio in Settings → Your AI (Groq, OpenAI or Mistral), or put its subtitles next to it (.vtt or .srt with the same name)',
  '«%@» ocupa %lld MB y Aula solo sabe trocear MP4, M4A, MOV, MP3 y WAV; conviértela a uno de esos formatos (o extrae su audio)': '“%@” is %lld MB and Aula can only split MP4, M4A, MOV, MP3 and WAV; convert it to one of those formats (or extract its audio)',
  '«%@» no tiene pista de audio que transcribir': '“%@” has no audio track to transcribe',
  'el audio de «%@» usa un formato que Aula aún no sabe transcribir; conviértelo a MP3 o M4A': 'the audio in “%@” uses a format Aula can’t transcribe yet; convert it to MP3 or M4A',
  'la grabación «%@» está incompleta o dañada': 'the recording “%@” is incomplete or damaged',
  'el servicio de transcripción rechazó la clave; revísala en Ajustes → Tu IA': 'the transcription service rejected the key; check it in Settings → Your AI',
  'el servicio de transcripción no aceptó un trozo de «%@» por su tamaño': 'the transcription service rejected a part of “%@” because of its size',
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
