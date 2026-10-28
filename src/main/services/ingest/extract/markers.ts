// Rótulos que los extractores escriben dentro del texto («[Figura: …]», «Notas al pie:»…), en el idioma de la interfaz.
import { L } from '../messages'

export const Markers = {
  get figureLabel(): string { return L('Figura') },
  figure: (alt: string): string => `[${L('Figura')}: ${alt}]`,
  /** Expresión regular de `figure` (con el rótulo de este idioma). */
  get figurePattern(): RegExp { return new RegExp('\\[' + escapeRegExp(L('Figura')) + ': [^\\]]*\\]', 'g') },
  get footnotes(): string { return L('Notas al pie') + ':' },
  get speakerNotes(): string { return L('Notas del orador') + ':' },
  /** «Hoja1», «Hoja2»… para un libro sin lista de hojas. */
  sheetName: (n: number): string => L('Hoja%lld', n)
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
