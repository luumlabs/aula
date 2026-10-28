// Texto de los bloques (lógica pura): delimitadores de fórmulas que el Markdown no entiende y cifras en las celdas.

/**
 * Delimitadores que escribe la IA y el Markdown no entiende como fórmula en pantalla: `$$…$$` en una sola línea y `\[…\]`
 * pasan a un bloque `$$` propio; `\(…\)` a `$…$`. No toca `\\[2pt]` (salto de línea con espacio dentro de una fórmula).
 */
export function normalizeMath(md: string): string {
  if (!md.includes('$$') && !md.includes('\\[') && !md.includes('\\(')) return md
  return md
    .replace(/(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/g, (_, tex: string) => `\n$$\n${tex.trim()}\n$$\n`)
    .replace(/(?<!\\)\\\(([\s\S]+?)(?<!\\)\\\)/g, (_, tex: string) => `$${tex.trim()}$`)
    .replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, tex: string) => `$$\n${tex.trim()}\n$$`)
}

/** ¿La celda es una cifra? («3,5», «−12 %», «1 200», «4.50 €», «0.25»). */
export function isNumericCell(s: string): boolean {
  const t = s.trim().replace(/^\$|\$$/g, '').trim()
  return t.length > 0 && t.length < 24 && /^[−+-]?[$€£]?\s?\d[\d\s.,  ]*(\s?(%|‰|€|°|[a-zA-Zµ]{1,3}))?$/.test(t)
}

/** Fracciones a tamaño de texto (`\frac` → `\dfrac`): en celdas y rótulos, las fracciones en línea quedan diminutas. */
export const displayFractions = (s: string): string => s.replace(/\\frac(?=\s*[{0-9])/g, '\\dfrac')
