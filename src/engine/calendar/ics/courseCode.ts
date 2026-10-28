// Códigos de curso (`MATH112-12345` → `MATH112`), portado de CanvasKit/Core/CourseCode.swift.

/** Palabras con forma de prefijo de código que no lo son («Fall 2024», «CRN 12345», «Section 001»…). */
const NOT_PREFIXES = new Set([
  'FALL', 'SPRING', 'SUMMER', 'WINTER', 'AUTUMN', 'TERM', 'SEM', 'SEMESTER', 'YEAR', 'CLASS', 'SECTION', 'SEC', 'SECT', 'CRN', 'LAB',
  'ROOM', 'PERIOD', 'BLOCK', 'WEEK', 'CHAPTER', 'CH', 'UNIT', 'MODULE', 'LESSON', 'PART', 'TEST', 'QUIZ', 'EXAM', 'PAGE', 'DAY',
  'FINAL', 'MIDTERM', 'HW', 'PROJECT', 'GRUPO', 'CURSO', 'CLASE', 'PAGINA'
])

const PATTERN = /(?<![A-Za-z0-9])([A-Za-z]{2,6})[ _-]?([0-9]{3,4})([A-Za-z]?)(?![A-Za-z0-9])/g

export const CourseCode = {
  /** Código corto: «MATH112-12345» → «MATH112», «MATH 112 Trigonometry» → «MATH112», «2024FA-MATH112-12345» → «MATH112».
   *  Sin nada con forma de código («Trigonometría»), el texto recortado. */
  short(text: string): string {
    const trimmed = text.trim()
    if (!trimmed) return ''
    PATTERN.lastIndex = 0
    for (const m of trimmed.matchAll(PATTERN)) {
      const letters = m[1].toUpperCase()
      if (NOT_PREFIXES.has(letters)) continue
      return letters + m[2] + (m[3] ?? '').toUpperCase()
    }
    return trimmed
  },

  /** Si el título termina con un corchete («Examen 2 [MATH112-12345]») lo separa. Solo cuenta si tiene alguna letra. */
  splitTrailingBracket(title: string): { title: string; bracket: string | null } {
    const t = title.trim()
    if (!t.endsWith(']')) return { title: t, bracket: null }
    const open = t.lastIndexOf('[')
    if (open < 0) return { title: t, bracket: null }
    const inner = t.slice(open + 1, t.length - 1).trim()
    if (!inner || !/\p{L}/u.test(inner) || inner.includes('[')) return { title: t, bracket: null }
    const head = t.slice(0, open).trim()
    if (!head) return { title: t, bracket: null }
    return { title: head, bracket: inner }
  }
}
