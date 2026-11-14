// Medida aproximada de los textos de un dibujo (sin DOM): la usan la colocación de etiquetas y los avisos de solapes del
// validador. La interfaz pasa su propia medida (canvas) cuando la tiene; las fórmulas KaTeX se estiman siempre.

/** Ancho en px de un texto con la letra dada (`size` en px). */
export type TextMeasure = (text: string, size: number) => number

/** Ancho aproximado: ~0,56 em por letra latina y 1 em por ideograma (chino, japonés, coreano). */
export const estimateText: TextMeasure = (text, size) => {
  let ems = 0
  for (const ch of text) {
    const u = ch.codePointAt(0) ?? 0
    const wide = (u >= 0x1100 && u <= 0x115f) || (u >= 0x2e80 && u <= 0xa4cf) || (u >= 0xac00 && u <= 0xd7a3) || (u >= 0xf900 && u <= 0xfaff) || (u >= 0xff00 && u <= 0xff60)
    ems += wide ? 1 : 0.56
  }
  return ems * size
}

/**
 * Ancho de una etiqueta con fórmulas: el texto normal con la medida dada y cada fórmula `$…$` estimada (KaTeX usa una letra
 * algo más ancha y cada orden — \alpha, \ge — ocupa un símbolo).
 */
export function labelWidth(text: string, size: number, measure: TextMeasure = estimateText): number {
  let w = 0
  for (const part of text.split(/(\$\$?[^$]*\$\$?)/)) {
    if (part.startsWith('$')) {
      const body = part.replace(/\$/g, '')
      const cmds = (body.match(/\\[a-zA-Z]+/g) ?? []).length
      const plain = body.replace(/\\[a-zA-Z]+/g, '').replace(/[{}^_\s]/g, '')
      w += (plain.length * 0.62 + cmds * 0.9) * size * 1.05 + 2
    } else if (part) w += measure(part, size)
  }
  return w
}

/** Alto de una línea de etiqueta (px). */
export const labelHeight = (text: string, size: number): number => size * (/\\frac|\\dfrac|\^\{|_\{|\\sqrt/.test(text) ? 1.9 : 1.3)
