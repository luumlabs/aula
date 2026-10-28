// Modo demostración (solo desarrollo y capturas: la app se abre con ?demo=1 cuando AULA_DEMO=1).
// Si el proceso principal aún no ofrece un dato, la interfaz usa estos ejemplos para poder diseñarse y revisarse.
import type { Pack } from '@shared/schema/pack'
import i18n from '@renderer/i18n'

/** Un texto de los datos de ejemplo en el idioma de la interfaz (son contenido, no interfaz: van aquí y no en los JSON). */
export function demoText(es: string, en: string): string {
  return (i18n.language ?? 'es').startsWith('en') ? en : es
}

export function isDemo(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')
}

function synthetic(id: string, title: string, subject: string, icon: string, hue: number, units: [string, string[]][]): Pack {
  const now = new Date().toISOString()
  const skills = units.flatMap(([, s], ui) =>
    s.map((t, i) => ({
      id: `${id}-s${ui}-${i}`,
      unit: `u${ui + 1}`,
      title: t,
      summary: '',
      objectives: [],
      prerequisites: [],
      weight: 10,
      minutes: 20,
      order: ui * 10 + i,
      status: 'ready' as const,
      counts: { lessonBlocks: 8, exercises: 10, templates: 1, cards: 6, decks: 0 }
    }))
  )
  return {
    schema: 1, id, title, subject, language: demoText('es', 'en'), icon, hue, created: now, updated: now,
    units: units.map(([t], ui) => ({ id: `u${ui + 1}`, title: t, skillIDs: skills.filter((s) => s.unit === `u${ui + 1}`).map((s) => s.id) })),
    skills, glossary: [], formulaSheet: [], sources: [], generation: []
  } as unknown as Pack
}

let cache: Pack[] | null = null
let cacheLang = ''
export async function demoPacks(): Promise<Pack[]> {
  const lang = demoText('es', 'en')
  if (cache && cacheLang === lang) return cache
  cacheLang = lang
  const trig = (await import('../../../../resources/demo-course/Packs/exam-2-math112/pack.json')).default as unknown as Pack
  const d = (n: number) => {
    const x = new Date()
    x.setDate(x.getDate() + n)
    x.setHours(9, 0, 0, 0)
    return x.toISOString()
  }
  const L = demoText
  cache = [
    { ...trig, exam: { ...(trig.exam ?? { title: 'Exam' }), date: d(3) } },
    { ...synthetic('demo-quimica', L('Química general', 'General Chemistry'), L('Química', 'Chemistry'), 'chemistry', 0.38, [[L('Átomos y moles', 'Atoms and moles'), [L('Masa molar', 'Molar mass'), L('El mol y Avogadro', 'The mole and Avogadro')]], [L('Reacciones', 'Reactions'), [L('Balanceo de ecuaciones', 'Balancing equations'), L('Estequiometría', 'Stoichiometry'), L('Reactivo limitante', 'Limiting reagent')]]]), exam: { title: L('Examen final', 'Final exam'), date: d(9) } },
    { ...synthetic('demo-ingles', L('Inglés B2', 'Spanish B1'), L('Idiomas', 'Languages'), L('english', 'spanish'), 0.93, lang === 'es' ? [['Grammar', ['Phrasal verbs', 'Conditionals']], ['Speaking', ['Describing pictures', 'Giving opinions']]] : [['Gramática', ['Ser y estar', 'El subjuntivo']], ['Conversación', ['Describir fotos', 'Dar tu opinión']]]), exam: { title: L('Speaking test', 'Oral exam'), date: d(16) } },
    synthetic('demo-biologia', L('Biología celular', 'Cell Biology'), L('Biología', 'Biology'), 'biology', 0.5, [[L('La célula', 'The cell'), [L('Membrana y transporte', 'Membrane and transport'), L('Orgánulos', 'Organelles')]], [L('División', 'Division'), ['Mitosis', 'Meiosis']]])
  ]
  return cache
}
