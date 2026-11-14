// El idioma que se APRENDE en un curso de idiomas (no el de las explicaciones, que es `pack.language`). El planificador lo
// guarda en `pack.examLanguage`; en los cursos de antes, o mientras no está, se deduce del nombre («Alemán A2», «Deutsch A2»,
// «Preparar el DELF»). Lo usan el contexto de los agentes y la voz de «Escuchar» en las tarjetas. Puro.
import { CourseLanguages } from '@engine/base/language'
import { foldGoalText } from './goal'

/** Nombres de idiomas (sin acentos, en varios idiomas) y palabras que lo sugieren sin decirlo del todo → código BCP-47.
 *  «cambridge» también examina de francés o español (IGCSE), «ele» es «él» en portugués: por eso no van en `EXAMS`. */
const NAMES: Record<string, readonly string[]> = {
  en: ['ingles', 'inglesa', 'english', 'englisch', 'anglais', 'inglese', 'cambridge', 'trinity'],
  es: ['espanol', 'espanola', 'castellano', 'castellana', 'spanish', 'spanisch', 'espagnol', 'spagnolo', 'ele', 'cervantes'],
  fr: ['frances', 'francesa', 'french', 'francais', 'franzosisch', 'francese'],
  de: ['aleman', 'alemana', 'german', 'deutsch', 'allemand', 'tedesco', 'zertifikat'],
  it: ['italiano', 'italiana', 'italian', 'italienisch', 'italien'],
  pt: ['portugues', 'portuguesa', 'portuguese', 'portugiesisch', 'portugais', 'portoghese'],
  'zh-Hans': ['chino', 'china', 'chinese', 'mandarin', 'chinois', 'chinesisch', 'cinese'],
  ja: ['japones', 'japonesa', 'japanese', 'japanisch', 'japonais', 'giapponese'],
  ko: ['coreano', 'coreana', 'korean', 'koreanisch', 'coreen'],
  ru: ['ruso', 'rusa', 'russian', 'russisch', 'russe', 'russo'],
  ar: ['arabe', 'arabic', 'arabisch'],
  hi: ['hindi'],
  ca: ['catalan', 'catala'],
  eu: ['euskera', 'basque'],
  gl: ['gallego', 'galician'],
  nl: ['neerlandes', 'holandes', 'dutch', 'niederlandisch', 'neerlandais'],
  sv: ['sueco', 'swedish'],
  nb: ['noruego', 'norwegian'],
  da: ['danes', 'danish'],
  fi: ['finlandes', 'finnish'],
  pl: ['polaco', 'polish'],
  tr: ['turco', 'turkish'],
  el: ['griego', 'greek'],
  he: ['hebreo', 'hebrew'],
  fa: ['persa', 'farsi', 'persian'],
  vi: ['vietnamita', 'vietnamese'],
  th: ['tailandes', 'thai'],
  id: ['indonesio', 'indonesian'],
  sw: ['swahili'],
  uk: ['ucraniano', 'ukrainian'],
  cs: ['checo', 'czech'],
  ro: ['rumano', 'romanian'],
  hu: ['hungaro', 'hungarian'],
  eo: ['esperanto']
}

/** Exámenes, siglas y escrituras que dicen SOLOS el idioma que se aprende: mandan sobre cualquier otro idioma del nombre
 *  («IELTS preparation for Chinese students» es inglés). */
const EXAMS: Record<string, readonly string[]> = {
  en: ['toefl', 'ielts', 'toeic', 'linguaskill', 'aptis', 'esl', 'efl', 'tefl'],
  es: ['dele', 'siele'],
  fr: ['delf', 'dalf', 'dilf', 'tcf', 'tef'],
  de: ['goethe', 'testdaf'],
  it: ['cils', 'celi', 'plida'],
  pt: ['ciple', 'caple'],
  'pt-BR': ['celpe'],
  'zh-Hans': ['hsk', 'hskk', 'pinyin', 'hanzi'],
  ja: ['jlpt', 'kanji', 'hiragana', 'katakana'],
  ko: ['topik', 'hangul']
}

const wordMap = (table: Record<string, readonly string[]>): ReadonlyMap<string, string> =>
  new Map(Object.entries(table).flatMap(([code, words]) => words.map((w) => [w, code] as const)))
const NAME_TO_CODE = wordMap(NAMES)
const EXAM_TO_CODE = wordMap(EXAMS)
/** Con estas palabras, el portugués es el de Brasil. */
const BRAZIL = new Set(['brasil', 'brazil', 'brasileno', 'brasilena', 'brazilian', 'brasileiro'])
/** «for Chinese students», «de habla inglesa»: el idioma de quien estudia, no el que aprende. Sin «speaking»: «English speaking
 *  practice» es practicar inglés («for Spanish-speaking students» ya lo cubre el «for»). */
const AUDIENCE_BEFORE = new Set(['for', 'para', 'pour', 'fur', 'per', 'habla'])
const AUDIENCE_AFTER = new Set(['speakers', 'speaker', 'students', 'learners', 'natives', 'hablantes', 'estudiantes', 'alumnos', 'nativos',
  'falantes', 'estudantes', 'alunos', 'apprenants', 'etudiants', 'studenti', 'sprecher', 'lernende'])

const base = (code: string): string => code.toLowerCase().split('-')[0]

/** Palabras sueltas de un texto: «Español-alemán» → «espanol», «aleman»; «DELF.» → «delf». */
function wordsOf(text: string): string[] {
  return foldGoalText(text).split(/[\s\-]+/).map((w) => w.replace(/^\.+|\.+$/g, '')).filter(Boolean)
}

interface Named {
  code: string
  /** Lo dice como público («for Chinese students»), no como lo que se aprende. */
  audience: boolean
}

/** Los idiomas que nombra un texto, en orden de aparición, y si es el del público. */
function namedLanguages(words: readonly string[]): Named[] {
  const brazil = words.some((w) => BRAZIL.has(w))
  const out: Named[] = []
  words.forEach((w, i) => {
    let code = NAME_TO_CODE.get(w)
    if (!code) return
    if (code === 'pt' && brazil) code = 'pt-BR'
    const audience = AUDIENCE_BEFORE.has(words[i - 1] ?? '') || AUDIENCE_AFTER.has(words[i + 1] ?? '')
    const seen = out.find((n) => n.code === code)
    if (!seen) out.push({ code, audience })
    else if (!audience) seen.audience = false
  })
  return out
}

/** El primer examen o escritura que dice el idioma por sí solo. */
function examLanguage(words: readonly string[]): string | undefined {
  for (const w of words) {
    const code = EXAM_TO_CODE.get(w)
    if (code) return code
  }
  return undefined
}

/**
 * El idioma que se aprende según el nombre y la asignatura del curso (código BCP-47: «de», «en», «zh-Hans», «pt-BR»…).
 * Un examen o una escritura (IELTS, DELF, HSK, kanji) lo dice solo. Si no, de los idiomas que nombra se quitan los del
 * público («for Chinese students», «para hablantes de inglés») y, si quedan varios («Learn German in English»), el primero
 * que no es el de las explicaciones. undefined si no nombra ninguno. No decide si es un curso de idiomas: eso es `isLanguageCourse`.
 */
export function learnedLanguageFromName(title: string, subject = '', courseLanguage?: string): string | undefined {
  const titleWords = wordsOf(title)
  const subjectWords = wordsOf(subject)
  const exam = examLanguage(titleWords) ?? examLanguage(subjectWords)
  if (exam) return exam
  const named = [...namedLanguages(titleWords), ...namedLanguages(subjectWords)]
  if (!named.length) return undefined
  // si todos son de público («Prácticas para alemán»), no queda otra que ellos
  const learned = named.filter((n) => !n.audience)
  const candidates = (learned.length ? learned : named).map((n) => n.code)
  const explained = courseLanguage ? base(courseLanguage) : undefined
  return candidates.find((c) => base(c) !== explained) ?? candidates[0]
}

/** El idioma que se aprende: el que guardó el planificador o, si no, el que dice el nombre. Para cursos de idiomas. */
export function learnedLanguage(c: { title: string; subject: string; language?: string; examLanguage?: string }): string | undefined {
  return c.examLanguage?.trim() || learnedLanguageFromName(c.title, c.subject, c.language)
}

/** La voz para leer en voz alta un curso de idiomas: la del idioma que se aprende; si no se sabe, la del curso. */
export function learnedSpeechLanguage(c: { title: string; subject: string; language: string; examLanguage?: string }): string {
  const code = learnedLanguage(c) || c.language
  const known = CourseLanguages.find(code)
  // «zh-Hans» → «zh-CN»; un idioma fuera de los 12 («nl», «tr»…) o con otra región («pt») se lee con su código tal cual
  return known && known.id.toLowerCase() === code.toLowerCase() ? CourseLanguages.speechLanguage(known) : code
}
