// Clasifica un evento por su título (y descripción) como examen, quiz, tarea u otro. Portado de CanvasKit/Core/ExamDetector.swift.
//
// En español e inglés (y las palabras más comunes de pt, fr, de, it, ru, ar, hi; zh/ja/ko como subcadena), evitando los falsos
// positivos: palabras completas («contest» no es «test»), repasos y materiales de apoyo («Exam 2 Review»), prácticas («Practice
// quiz» → quiz con isExam = false), otros sentidos («COVID test», «pago parcial») y «Final» que acompaña a otro sustantivo.
import { CourseCode } from './courseCode'
import type { StudyEventKind } from './studyEvent'

export interface ExamVerdict {
  kind: StudyEventKind
  isExam: boolean
  /** El título contenía alguna palabra de evaluación (aunque el contexto la anulara). */
  matched: boolean
}

/** Minúsculas y sin diacríticos (en la misma forma que se usan las tablas). */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

const COMPOUNDS: [string, string][] = [
  ['mid-term', 'midterm'], ['mid term', 'midterm'], ['take-home', 'takehome'], ['take home', 'takehome'],
  ['make-up', 'makeup'], ['make up', 'makeup'], ['re-take', 'retake'], ['in-class', 'inclass'],
  ['pre-test', 'pretest'], ['post-test', 'posttest'], ['pre-quiz', 'prequiz'], ['post-quiz', 'postquiz'],
  ['self-test', 'selftest'], ['self test', 'selftest'], ['self-quiz', 'selfquiz'], ['self quiz', 'selfquiz'],
  ['self-assessment', 'selfassessment'], ['self assessment', 'selfassessment'], ['peer assessment', 'peerassessment'],
  ['peer-assessment', 'peerassessment'], ['a/b', 'ab']
]

const LETTER = /\p{L}/u
const NUMBER = /\p{N}/u

/** Minúsculas, sin tildes, uniendo compuestos y separando letras de dígitos («exam2» → «exam», «2»). */
export function tokenize(title: string): string[] {
  let s = title.trim()
  const split = CourseCode.splitTrailingBracket(s)
  if (split.bracket !== null && NUMBER.test(split.bracket)) s = split.title
  s = foldText(s).replace(/@/g, ' at ')
  for (const [from, to] of COMPOUNDS) if (s.includes(from)) s = s.split(from).join(to)
  const tokens: string[] = []
  let current = ''
  let currentIsDigit = false
  for (const ch of s) {
    const isL = LETTER.test(ch), isN = NUMBER.test(ch)
    if (isL || isN) {
      if (current && isN !== currentIsDigit) { tokens.push(current); current = '' }
      current += ch
      currentIsDigit = isN
    } else if (current) {
      tokens.push(current)
      current = ''
    }
  }
  if (current) tokens.push(current)
  return tokens
}

const i18n = (words: string[]) => new Set(words.flatMap((w) => tokenize(w)))
const union = (...sets: Iterable<string>[]) => { const out = new Set<string>(); for (const s of sets) for (const x of s) out.add(x); return out }
const isInt = (w: string) => /^[0-9]+$/.test(w)

const examWords = union(['exam', 'exams', 'examination', 'examinations', 'examen', 'examenes', 'midterm', 'midterms', 'parcial', 'parciales',
  'certamen', 'certamenes', 'solemne', 'solemnes'], i18n(['prova', 'provas', 'exame', 'exames', 'partiel', 'partiels', 'klausur', 'klausuren', 'prüfung', 'prüfungen', 'esame', 'esami',
  'экзамен', 'экзамены', 'экзамена', 'зачёт', 'зачет', 'امتحان', 'الامتحان', 'امتحانات', 'परीक्षा']))
const testWords = union(['test', 'tests', 'retest', 'prueba', 'pruebas', 'evaluacion', 'evaluaciones'],
  i18n(['teste', 'testes', 'avaliação', 'avaliações', 'contrôle', 'тест', 'тестирование', 'контрольная', 'اختبار', 'الاختبار']))
const quizWords = new Set(['quiz', 'quizzes', 'quizz', 'quizes', 'quizs'])
const assessmentWords = new Set(['assessment', 'assessments'])
const finalWords = new Set(['final', 'finals'])
const genericExamWords = new Set(['midterm', 'midterms', 'parcial', 'parciales'])
const practiceWords = union(['practice', 'sample', 'samples', 'mock', 'simulacro', 'simulacros', 'ejemplo', 'diagnostic', 'diagnostico', 'diagnostica',
  'pretest', 'prequiz', 'posttest', 'postquiz', 'selftest', 'selfquiz', 'selfassessment', 'ungraded'],
  i18n(['simulado', 'simulados', 'entraînement', 'blanc', 'übung', 'simulazione', 'esercitazione', 'пробный', 'пробная', 'تجريبي']))
const practiceBigrams = new Set(['de practica', 'de repaso', 'de ejemplo', 'dry run', 'no calificado', 'no calificada', 'sin calificar'])
const selfPracticeWords = union(['pretest', 'prequiz', 'posttest', 'postquiz', 'selftest', 'selfquiz'], i18n(['probeklausur']))
const practiceFillers = new Set(['de', 'del', 'of'])
const beforeNegators = union(['review', 'reviews', 'reviewing', 'prep', 'preparation', 'prepare', 'preparing', 'study', 'studying', 'repaso', 'repasar',
  'repasa', 'preparacion', 'preparar', 'estudiar', 'estudio', 'revision', 'about', 'regarding', 'tips', 'strategies', 'after',
  'cancelled', 'canceled', 'cancelado', 'cancelada', 'cancelacion', 'calendar', 'calendario', 'schedule', 'horario', 'policy',
  'politica', 'register', 'registration', 'registro', 'inscripcion', 'request', 'solicitud', 'sign', 'signup', 'formulario',
  'survey', 'encuesta', 'practicar', 'ensayar', 'grades', 'grade', 'results', 'result', 'scores', 'score', 'feedback', 'answers',
  'answer', 'solutions', 'solution', 'notas', 'calificaciones', 'resultados', 'soluciones', 'solucion', 'respuestas', 'correcciones',
  'corrections'], i18n(['revisão', 'estudo', 'révision', 'préparation', 'wiederholung', 'vorbereitung', 'ripasso', 'preparazione',
  'подготовка', 'повторение', 'консультация', 'مراجعة', 'पुनरावृत्ति', 'ergebnisse', 'résultats', 'risultati', 'результаты', 'نتائج', 'परिणाम']))
const beforeAdjacentNegators = new Set(['no', 'sin', 'not'])
const beforeNegatorBigrams = new Set(['semana de', 'periodo de', 'week of', 'how to', 'como prepararse', 'guia de', 'guide to', 'guide for', 'fecha de', 'date of',
  'dates for', 'tomar el', 'previa al', 'previo al', 'previa a', 'previo a', 'antes del', 'antes de', 'before the', 'pre exam',
  'pre examen', 'post exam', 'post examen'])
const afterNegators = union(['review', 'reviews', 'prep', 'preparation', 'study', 'guide', 'guides', 'session', 'sessions', 'solutions', 'solution',
  'key', 'answers', 'answer', 'corrections', 'correction', 'grades', 'grade', 'results', 'scores', 'score', 'feedback',
  'reflection', 'reflections', 'wrapper', 'schedule', 'schedules', 'policy', 'policies', 'info', 'information', 'instructions',
  'directions', 'survey', 'registration', 'register', 'signup', 'reservation', 'reservations', 'request', 'requests',
  'accommodation', 'accommodations', 'tutoring', 'tutorial', 'workshop', 'strategies', 'strategy', 'tips', 'anxiety', 'bank',
  'calendar', 'dates', 'announcement', 'announcements', 'reminder', 'reminders', 'evaluation', 'evaluations', 'sign', 'repaso',
  'guia', 'solucion', 'soluciones', 'respuestas', 'clave', 'correcciones', 'calificaciones', 'notas', 'resultados',
  'retroalimentacion', 'reflexion', 'horario', 'politica', 'informacion', 'instrucciones', 'formulario', 'encuesta', 'registro',
  'inscripcion', 'solicitud', 'tutoria', 'taller', 'estrategias', 'consejos', 'ansiedad', 'banco', 'calendario', 'fechas',
  'aviso', 'avisos', 'recordatorio', 'recordatorios', 'cancelled', 'canceled', 'cancelado', 'cancelada', 'revision',
  'revisiones', 'proctoring', 'scheduling', 'analysis', 'debrief', 'setup', 'install', 'installation'],
  i18n(['revisão', 'gabarito', 'resultado', 'notas', 'révision', 'corrigé', 'résultats', 'wiederholung', 'vorbereitung', 'ergebnisse',
    'lösungen', 'ripasso', 'risultati', 'soluzioni', 'результаты', 'ответы', 'подготовка', 'نتائج', 'مراجعة', 'परिणाम']))
const afterAdjacentNegators = new Set(['week', 'weeks', 'semana', 'semanas', 'period', 'periodo', 'season', 'temporada'])
const barrierWords = new Set(['covers', 'cover', 'covering', 'includes', 'including', 'coverage', 'cubre', 'incluye', 'abarca', 'contiene', 'consists'])
const workNounsAfterGeneric = new Set(['project', 'projects', 'paper', 'papers', 'presentation', 'presentations', 'report', 'reports', 'essay', 'essays',
  'assignment', 'assignments', 'portfolio', 'proyecto', 'proyectos', 'informe', 'informes', 'ensayo', 'ensayos', 'trabajo',
  'trabajos', 'tarea', 'tareas', 'entrega', 'entregas', 'draft', 'drafts', 'reflection', 'discussion', 'survey',
  'submission', 'submissions', 'homework', 'lab', 'labs'])
const testSenseBefore = new Set(['covid', 'pcr', 'antigen', 'antigeno', 'antigenos', 'drug', 'blood', 'sangre', 'pregnancy', 'embarazo', 'allergy', 'alergia',
  'strep', 'vision', 'hearing', 'eye', 'beta', 'alpha', 'stress', 'smoke', 'regression', 'integration', 'usability', 'medical',
  'dental', 'medico', 'medica', 'ocular', 'orina', 'urine', 'speed', 'personality', 'personalidad', 'crash', 'fire'])
const testSenseAfter = new Set(['drive', 'kitchen', 'flight', 'site', 'case', 'cases', 'run', 'ride'])
const quizSenseBefore = new Set(['pub', 'trivia', 'bar'])
const quizSenseAfter = new Set(['night', 'show', 'bowl', 'game', 'games', 'competition', 'tournament', 'contest'])
const parcialBlockers = new Set(['pago', 'pagos', 'entrega', 'entregas', 'avance', 'avances', 'calificacion', 'calificaciones', 'nota', 'notas', 'cobro',
  'reembolso', 'resultado', 'resultados', 'cierre', 'informe', 'informes', 'devolucion', 'retiro', 'matricula', 'ingreso', 'inscripcion'])
const evaluationBlockers = new Set(['curso', 'docente', 'profesor', 'profesora', 'maestro', 'maestra', 'instructor', 'desempeno', 'satisfaccion', 'encuesta',
  'institucional', 'calidad', 'servicio', 'programa', 'materia', 'catedra', 'pares', 'companeros', 'salud'])
const finalCompanions = new Set(['the', 'my', 'el', 'la', 'mi', 'cumulative', 'comprehensive', 'cumulativo', 'comprehensivo', 'acumulativo', 'written', 'oral',
  'online', 'takehome', 'inclass', 'makeup', 'retake', 'semester', 'term', 'course', 'mathematics', 'math', 'calculus', 'calc',
  'trig', 'trigonometry', 'algebra', 'precalc', 'precalculus', 'physics', 'chemistry', 'chem', 'biology', 'bio', 'history',
  'english', 'spanish', 'statistics', 'stats', 'stat', 'economics', 'econ', 'psychology', 'psych', 'sociology', 'anatomy',
  'geometry', 'matematicas', 'calculo', 'fisica', 'quimica', 'biologia', 'historia', 'ingles', 'espanol', 'estadistica',
  'economia', 'trigonometria', 'geometria', 'programacion', 'anatomia', 'lab', 'laboratory', 'practical', 'for', 'in', 'class',
  'de', 'del', 'today', 'tomorrow', 'hoy', 'manana', 'all', 'a', 'an', 'is', 'es', 'on', 'at', 'en'])
const scopeWords = new Set(['ch', 'chapter', 'chapters', 'chap', 'sec', 'section', 'sections', 'unit', 'units', 'module', 'modules', 'covers', 'cover',
  'through', 'thru', 'to', 'and', 'of', 'y', 'capitulo', 'capitulos', 'cap', 'seccion', 'secciones', 'unidad', 'unidades',
  'tema', 'temas', 'st', 'nd', 'rd', 'th', 'er', 'do', 'ro', 'no', 'num', 'number', 'numero', 'nro', 'am', 'pm', 'noon', 'midday', 'mediodia'])
const assignmentWords = new Set(['homework', 'hw', 'assignment', 'assignments', 'assign', 'tarea', 'tareas', 'deber', 'deberes', 'pset', 'psets', 'worksheet',
  'worksheets', 'essay', 'ensayo', 'paper', 'project', 'projects', 'proyecto', 'proyectos', 'report', 'reports', 'informe',
  'reading', 'readings', 'lectura', 'lecturas', 'presentation', 'presentacion', 'discussion', 'discusion', 'foro', 'forum',
  'submission', 'submissions', 'submit', 'entrega', 'entregas', 'ejercicio', 'ejercicios', 'exercise', 'exercises', 'actividad',
  'actividades', 'activity', 'journal', 'reflection', 'portfolio', 'portafolio', 'writeup', 'lab', 'labs', 'laboratorio',
  'trabajo', 'trabajos', 'drill', 'drills', 'problem', 'problems', 'problemas'])
const leadingNonExamWords = new Set(['discussion', 'discussions', 'discusion', 'discusiones', 'foro', 'foros', 'forum', 'forums', 'reflection', 'reflections', 'reflexion',
  'reflexiones', 'survey', 'surveys', 'encuesta', 'encuestas', 'journal', 'journals', 'diario', 'blog', 'poll', 'wrapper'])
const assessmentQualifiers = new Set(['module', 'unit', 'chapter', 'lesson', 'week', 'final', 'midterm', 'ch', 'section', 'topic', 'end', 'placement',
  'proficiency', 'entrance', 'competency', 'mastery', 'readiness'])

interface Hit { index: number; kind: StudyEventKind; blocked: boolean; negated: boolean; practice: boolean; forced: boolean }

function classifyTokens(t: string[]): ExamVerdict {
  if (t.length === 0) return { kind: 'other', isExam: false, matched: false }
  if (leadingNonExamWords.has(t[0])) {
    const mentions = t.some((w) => examWords.has(w) || testWords.has(w) || quizWords.has(w))
    return { kind: 'assignment', isExam: false, matched: mentions }
  }
  const hits: Hit[] = []
  t.forEach((w, i) => {
    const h = (kind: StudyEventKind, practice = false, forced = false): Hit => ({ index: i, kind, blocked: false, negated: false, practice, forced })
    if (examWords.has(w) || testWords.has(w)) hits.push(h('exam'))
    else if (quizWords.has(w)) hits.push(h('quiz'))
    else if (selfPracticeWords.has(w)) hits.push(h('quiz', true, true))
    else if (assessmentWords.has(w) && assessmentQualifies(t, i)) hits.push(h('quiz'))
    else if (w === 'practical' && i > 0 && ['lab', 'labs', 'laboratory', 'skills', 'final'].includes(t[i - 1])) hits.push(h('exam'))
  })
  for (const hit of hits) {
    const i = hit.index
    const word = t[i]
    if ((word === 'prueba' || word === 'pruebas') && i + 1 < t.length && ['corta', 'cortas', 'rapida', 'rapidas', 'breve'].includes(t[i + 1])) hit.kind = 'quiz'
    hit.blocked = isBlocked(t, i, word)
    const ctx = context(t, i)
    hit.negated = ctx.negated
    hit.practice = hit.forced || (ctx.practice && !ctx.negated)
  }
  const live = hits.filter((h) => !h.blocked && !h.negated)
  const hasAssignment = t.some((w) => assignmentWords.has(w))
  if (live.length > 0) {
    const real = live.filter((h) => !h.practice)
    if (real.length === 0) return { kind: hasAssignment ? 'assignment' : 'quiz', isExam: false, matched: true }
    if (real.some((h) => h.kind === 'exam')) return { kind: 'exam', isExam: true, matched: true }
    return { kind: 'quiz', isExam: true, matched: true }
  }
  if (hits.length > 0) return { kind: hasAssignment ? 'assignment' : 'other', isExam: false, matched: true }
  if (isStandaloneFinal(t)) return { kind: 'exam', isExam: true, matched: true }
  return { kind: hasAssignment ? 'assignment' : 'other', isExam: false, matched: false }
}

function assessmentQualifies(t: string[], i: number): boolean {
  if (i > 0 && assessmentQualifiers.has(t[i - 1])) return true
  if (i + 1 < t.length && isInt(t[i + 1])) return true
  if (i > 1 && assessmentQualifiers.has(t[i - 2]) && isInt(t[i - 1])) return true
  return false
}

function previousWord(t: string[], i: number): string | null {
  let k = i - 1
  while (k >= 0 && isInt(t[k])) k--
  return k >= 0 ? t[k] : null
}

function nextWord(t: string[], i: number): string | null {
  let k = i + 1
  while (k < t.length && isInt(t[k])) k++
  return k < t.length ? t[k] : null
}

function isBlocked(t: string[], i: number, word: string): boolean {
  const prev = previousWord(t, i)
  const next = i + 1 < t.length ? t[i + 1] : null
  const next2 = i + 2 < t.length ? t[i + 2] : null
  switch (word) {
    case 'parcial': case 'parciales':
      if (prev !== null && parcialBlockers.has(prev)) return true
      if (next !== null && parcialBlockers.has(next)) return true
      if (next === 'de' && next2 !== null && parcialBlockers.has(next2)) return true
      return false
    case 'evaluacion': case 'evaluaciones':
      for (let k = Math.max(0, i - 2); k <= Math.min(t.length - 1, i + 3); k++) if (k !== i && evaluationBlockers.has(t[k])) return true
      return false
    case 'prueba': case 'pruebas':
      if (prev === 'a' && next === 'de') return true
      if (next !== null && ['concepto', 'gratis', 'gratuita', 'gratuito', 'piloto', 'vida', 'pago'].includes(next)) return true
      if (next === 'de' && next2 !== null && ['concepto', 'vida', 'embarazo', 'covid', 'pcr', 'antigeno', 'antigenos', 'sangre', 'agua', 'balas', 'pago', 'fuego', 'orina'].includes(next2)) return true
      if (prev !== null && ['covid', 'pcr', 'antigeno', 'antigenos'].includes(prev)) return true
      return false
    case 'quiz': case 'quizzes': case 'quizz': case 'quizes': case 'quizs':
      if (prev !== null && quizSenseBefore.has(prev)) return true
      if (next !== null && quizSenseAfter.has(next)) return true
      return false
    default:
      if (prev !== null && testSenseBefore.has(prev)) return true
      if ((word === 'test' || word === 'tests') && next !== null && testSenseAfter.has(next)) return true
      if ((word === 'test' || word === 'tests') && next === 'taking') return true
      return false
  }
}

function context(t: string[], i: number): { negated: boolean; practice: boolean } {
  const word = t[i]
  let negated = false
  let practice = false
  const lo = Math.max(0, i - 4)
  for (let k = lo; k < i; k++) {
    const between = t.slice(k + 1, i)
    const hasBarrier = between.some((w) => barrierWords.has(w))
    const w = t[k]
    if (practiceWords.has(w)) {
      // pegada (ignorando números y «de/of») = evaluación de práctica; separada = material de práctica (anula)
      const separating = between.filter((x) => !isInt(x) && !practiceFillers.has(x) && !practiceWords.has(x))
      if (separating.length === 0) practice = true
      else if (!hasBarrier) negated = true
    } else if (beforeNegators.has(w) && !hasBarrier) {
      negated = true
    } else if (beforeAdjacentNegators.has(w) && k === i - 1) {
      negated = true
    }
    if (beforeNegatorBigrams.has(w + ' ' + t[k + 1])) negated = true
    if (k + 1 < i && practiceBigrams.has(w + ' ' + t[k + 1])) practice = true
  }
  let k = i + 1
  let distance = 1
  let numericGap = true
  let protectedIndex = -1
  while (k < t.length && distance <= 4) {
    const w = t[k]
    if (barrierWords.has(w)) break
    if (k + 1 < t.length && practiceBigrams.has(w + ' ' + t[k + 1])) { practice = true; protectedIndex = k + 1 }
    if (k === protectedIndex) {
      // parte de «de repaso», «de práctica»…
    } else if (practiceWords.has(w)) {
      if (numericGap) practice = true
      else negated = true
    } else if (afterNegators.has(w)) {
      negated = true
    } else if (distance === 1 && afterAdjacentNegators.has(w)) {
      // «Finals Week» es un periodo, pero «Quiz Week 4» no
      if (!(k + 1 < t.length && isInt(t[k + 1]))) negated = true
    }
    if (!isInt(w) && !practiceFillers.has(w)) numericGap = false
    k++
    distance++
  }
  if (genericExamWords.has(word)) {
    const n = nextWord(t, i)
    if (n !== null && workNounsAfterGeneric.has(n)) negated = true
  }
  return { negated, practice }
}

function isStandaloneFinal(t: string[]): boolean {
  let i = 0
  let sawFinal = false
  while (i < t.length) {
    const w = t[i]
    if (finalWords.has(w)) { sawFinal = true; i++; continue }
    if (sawFinal && (w === 'at' || w === 'in' || w === 'en')) return true
    if (isInt(w)) { i++; continue }
    const len = Array.from(w).length
    if (len >= 2 && len <= 6 && Array.from(w).every((c) => LETTER.test(c)) && i + 1 < t.length && t[i + 1].length >= 3 && t[i + 1].length <= 4 && isInt(t[i + 1])) {
      i += 2
      continue
    }
    if (scopeWords.has(w) || finalCompanions.has(w)) { i++; continue }
    return false
  }
  return sawFinal
}

const denseExam = ['考试', '考試', '测试', '測試', '期中考', '期末考', '試験', 'テスト', '시험', '고사']
const denseQuiz = ['测验', '測驗', '小测', '小テスト', '퀴즈', '쪽지시험']
const denseNegators = ['复习', '復習', '복습', '模拟', '模擬', '练习', '練習', '연습', '答案', '解答', '정답', '해설', '成绩', '成績', '성적', '范围', '範囲', '범위', '安排', '日程', '일정']

/** Títulos en chino, japonés o coreano («期中考试», «期末試験», «중간고사»), salvo repasos, simulacros y resultados. */
export function classifyDense(title: string): ExamVerdict | null {
  const t = title.normalize('NFC')
  const quiz = denseQuiz.some((w) => t.includes(w))
  if (!quiz && !denseExam.some((w) => t.includes(w))) return null
  if (denseNegators.some((w) => t.includes(w))) return { kind: 'other', isExam: false, matched: true }
  return { kind: quiz ? 'quiz' : 'exam', isExam: true, matched: true }
}

const DESCRIPTION_RE = /^[\s#>*_-]*(?:this|the|your|esta|este|el|la|tu|su)\s+(?:(?:final|midterm|written|oral|chapter|unit|first|second|third|primer|segundo|tercer|primera|segunda|tercera)\s+)?(exam|examination|midterm|test|quiz|examen|parcial|prueba|evaluacion)\b/i

function classifyDescription(description: string): { kind: StudyEventKind; isExam: boolean } | null {
  const head = foldText(Array.from(description).slice(0, 400).join(''))
  const m = DESCRIPTION_RE.exec(head)
  if (!m) return null
  // la frase de la coincidencia no debe ser un repaso, una entrega o una práctica
  const rest = head.slice(m.index)
  const end = rest.search(/[.!?\n]/)
  const words = tokenize(end < 0 ? rest : rest.slice(0, end))
  if (words.some((w) => beforeNegators.has(w) || afterNegators.has(w) || assignmentWords.has(w) || practiceWords.has(w))) return null
  return m[1].toLowerCase() === 'quiz' ? { kind: 'quiz', isExam: true } : { kind: 'exam', isExam: true }
}

export const ExamDetector = {
  /** `kind` (exam, quiz, assignment u other si no hay señal) e `isExam` (evaluación calificada). */
  classify(title: string, description?: string | null): { kind: StudyEventKind; isExam: boolean } {
    const v = ExamDetector.analyze(title, description)
    return { kind: v.kind, isExam: v.isExam }
  },

  analyze(title: string, description?: string | null): ExamVerdict {
    let v = classifyTokens(tokenize(title))
    if (v.kind === 'other' && !v.matched) {
      const dense = classifyDense(title)
      if (dense) v = dense
    }
    if (v.kind === 'other' && !v.matched && description) {
      const d = classifyDescription(description)
      if (d) v = { kind: d.kind, isExam: d.isExam, matched: true }
    }
    return v
  },

  tokenize
}
