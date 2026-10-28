// Textos de los documentos que crea Aula (títulos de sección, cabeceras, marcadores), en español y en inglés. Los ve el
// estudiante en el papel; salen en el idioma de la interfaz (como `String(localized:)` en la app Swift).
import type { CalloutKind } from '@shared/schema'
import type { DocumentKind, PrintWords } from '@shared/documents'

export type DocLang = 'es' | 'en'

/** 'es' para cualquier español; cualquier otro idioma, inglés (como la interfaz). Sin código: español, el idioma base. */
export function docLang(code: string | undefined): DocLang {
  const c = (code ?? '').trim().toLowerCase()
  return !c || c.startsWith('es') ? 'es' : 'en'
}

const ES = {
  kind: { guide: 'Guía de estudio', summary: 'Resumen', cheatsheet: 'Chuleta', flashcards: 'Tarjetas para imprimir', exam: 'Examen de práctica', slides: 'Diapositivas' } as Record<DocumentKind, string>,
  notice: 'Preparado por Aula con tus materiales para que estudies. No es un trabajo para entregar.',
  formulaSheet: 'Hoja de fórmulas',
  glossary: 'Glosario',
  mistakes: 'Errores comunes',
  myNotes: 'Mis notas',
  lesson: (n: number) => `Lección ${n}`,
  lessonUnit: (n: number, u: string) => `Lección ${n} · ${u}`,
  mustKnow: 'Lo que debes saber',
  keyTerms: 'Términos clave',
  watchOut: 'Ojo con',
  formulas: 'Fórmulas',
  definitions: 'Definiciones y teoremas',
  terms: 'Términos',
  cards: 'Tarjetas',
  questions: 'Preguntas',
  answerKey: 'Hoja de respuestas',
  answerKeyNote: 'Corrige al terminar: tapa esta hoja mientras respondes.',
  workedExample: 'Ejemplo resuelto',
  review: 'Para repasar',
  rubric: 'Se valora:',
  points: (v: string, one: boolean) => (one ? `${v} punto` : `${v} puntos`),
  minutes: (m: number) => `${m} min`,
  examOn: (d: string) => `Examen: ${d}`,
  contents: 'Contenido',
  nameDate: '**Nombre:** ______________________  **Fecha:** ____________',
  nameDateDocx: 'Nombre: ______________________________   Fecha: ______________',
  answer: 'Respuesta:',
  true: 'Verdadero',
  false: 'Falso',
  speakerNotes: 'Notas:',
  image: 'Imagen',
  plot: 'Gráfica',
  interactivePlot: 'Gráfica interactiva',
  diagram: 'Diagrama',
  drawing: 'Dibujo',
  numberLine: 'Recta numérica',
  model3d: 'Modelo 3D',
  map: 'Mapa',
  simulation: 'Simulación',
  labeled: 'Figura con partes',
  interactive: 'Figura interactiva',
  figure: 'Figura',
  question: 'Pregunta',
  response: 'Respuesta',
  emptyScope: 'Ninguna lección del curso coincide con lo que pediste.',
  empty: {
    guide: 'Este curso aún no tiene lecciones para la guía.', summary: 'No hay nada que resumir todavía en estas lecciones.',
    cheatsheet: 'Este curso aún no tiene fórmulas ni definiciones para la chuleta.', flashcards: 'Estas lecciones aún no tienen tarjetas de repaso.',
    exam: 'Estas lecciones aún no tienen ejercicios para el examen.', slides: 'Estas lecciones aún no tienen contenido para diapositivas.'
  } as Record<DocumentKind, string>,
  order: 'Escribe el orden (1, 2, 3…):',
  cut: 'Recorta por la línea',
  page: 'Página',
  callouts: {
    definition: 'Definición', theorem: 'Teorema', remember: 'Recuerda', warning: 'Ojo', tip: 'Consejo', example: 'Ejemplo', examTip: 'Para el examen',
    mistake: 'Error común', question: 'Pregunta', source: 'Fuente', note: 'Nota'
  } as Record<CalloutKind, string>,
  and: 'y'
}

type Words = typeof ES

const EN: Words = {
  kind: { guide: 'Study guide', summary: 'Summary', cheatsheet: 'Cheat sheet', flashcards: 'Printable flashcards', exam: 'Practice exam', slides: 'Slides' },
  notice: 'Prepared by Aula from your materials so you can study. Not work to hand in.',
  formulaSheet: 'Formula sheet',
  glossary: 'Glossary',
  mistakes: 'Common mistakes',
  myNotes: 'My notes',
  lesson: (n) => `Lesson ${n}`,
  lessonUnit: (n, u) => `Lesson ${n} · ${u}`,
  mustKnow: 'What you should know',
  keyTerms: 'Key terms',
  watchOut: 'Watch out for',
  formulas: 'Formulas',
  definitions: 'Definitions and theorems',
  terms: 'Terms',
  cards: 'Cards',
  questions: 'Questions',
  answerKey: 'Answer key',
  answerKeyNote: 'Check when you finish: cover this page while you answer.',
  workedExample: 'Worked example',
  review: 'To review',
  rubric: 'Graded on:',
  points: (v, one) => (one ? `${v} point` : `${v} points`),
  minutes: (m) => `${m} min`,
  examOn: (d) => `Exam: ${d}`,
  contents: 'Contents',
  nameDate: '**Name:** ______________________  **Date:** ____________',
  nameDateDocx: 'Name: ______________________________   Date: ______________',
  answer: 'Answer:',
  true: 'True',
  false: 'False',
  speakerNotes: 'Notes:',
  image: 'Image',
  plot: 'Graph',
  interactivePlot: 'Interactive graph',
  diagram: 'Diagram',
  drawing: 'Drawing',
  numberLine: 'Number line',
  model3d: '3D model',
  map: 'Map',
  simulation: 'Simulation',
  labeled: 'Labeled figure',
  interactive: 'Interactive figure',
  figure: 'Figure',
  question: 'Question',
  response: 'Answer',
  emptyScope: 'No lesson in the course matches what you asked for.',
  empty: {
    guide: "This course doesn't have lessons for the guide yet.", summary: "There's nothing to summarize in these lessons yet.",
    cheatsheet: "This course doesn't have formulas or definitions for the cheat sheet yet.", flashcards: "These lessons don't have review cards yet.",
    exam: "These lessons don't have exercises for the exam yet.", slides: "These lessons don't have content for slides yet."
  },
  order: 'Write the order (1, 2, 3…):',
  cut: 'Cut along the line',
  page: 'Page',
  callouts: {
    definition: 'Definition', theorem: 'Theorem', remember: 'Remember', warning: 'Watch out', tip: 'Tip', example: 'Example', examTip: 'For the exam',
    mistake: 'Common mistake', question: 'Question', source: 'Source', note: 'Note'
  },
  and: 'and'
}

export function words(lang: DocLang): Words {
  return lang === 'en' ? EN : ES
}

/** «3 puntos», «1 punto», «2.5 puntos» (acotado: un 1e300 de una rúbrica dañada no rompe nada). */
export function pointsText(raw: number, lang: DocLang): string {
  const p = Number.isFinite(raw) ? Math.min(Math.max(raw, -1e9), 1e9) : 0
  const v = Math.round(p) === p ? String(p) : p.toFixed(1)
  return words(lang).points(v, p === 1)
}

/** «a, b y c». */
export function listText(items: string[], lang: DocLang): string {
  if (items.length <= 1) return items.join('')
  return items.slice(0, -1).join(', ') + ` ${words(lang).and} ` + items[items.length - 1]
}

/** Fecha larga («3 de marzo de 2026»). */
export function longDate(iso: string, lang: DocLang): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Los textos fijos de la vista de impresión. */
export function printWords(lang: DocLang): PrintWords {
  const w = words(lang)
  return {
    contents: w.contents, page: w.page, name: lang === 'en' ? 'Name' : 'Nombre', date: lang === 'en' ? 'Date' : 'Fecha', minutes: 'min',
    points: w.points('', false).trim(), point: w.points('', true).trim(), exam: lang === 'en' ? 'Exam' : 'Examen', answer: w.answer,
    question: w.question, true: w.true, false: w.false, order: w.order, notes: w.speakerNotes, figure: w.figure, example: w.workedExample,
    cut: w.cut, callouts: { ...w.callouts }
  }
}
