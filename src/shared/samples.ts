// Los cursos de ejemplo que trae Aula (la bienvenida, el de funciones y el de trigonometría con sus materiales): se instalan
// en el primer arranque como visita guiada. No son del estudiante: la interfaz los marca como «Ejemplo» y su examen no cuenta
// como uno de verdad (ni en el resumen del calendario ni en los avisos: A4-P1-1).

/** Ids del curso de bienvenida (en español, en inglés y el que usaban las versiones anteriores). */
export const WELCOME_COURSE_IDS: readonly string[] = ['bienvenida-aula', 'welcome-aula', 'bienvenida-mimir']
/** El curso de ejemplo de matemáticas (funciones cuadráticas). */
export const DEMO_MATH_COURSE_ID = 'demo-cuadraticas'
/** El curso de trigonometría que viene con la app («Exam #2 · MATH 101», en `resources/demo-course`). */
export const BUNDLED_COURSE_ID = 'exam-2-math112'

export const SAMPLE_COURSE_IDS: readonly string[] = [...WELCOME_COURSE_IDS, DEMO_MATH_COURSE_ID, BUNDLED_COURSE_ID]

/** ¿Es uno de los cursos de ejemplo de Aula? */
export function isSampleCourse(id: string | null | undefined): boolean {
  return !!id && SAMPLE_COURSE_IDS.includes(id)
}
