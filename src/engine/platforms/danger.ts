// Clasificador de peligro (port de ComputerKit/Safety/DangerClassifier.swift + DangerPhrases+Platforms.swift).
// Antes de pulsar, escribir o navegar decide si la acción necesita la aprobación explícita del estudiante (entregar, empezar
// exámenes, borrar, enviar mensajes, pagar, cerrar sesión, darse de baja, conceder permisos, formularios con contraseña…) o si
// está prohibida (escribir contraseñas, salir de apps).
//
// Cómo decide (gana la coincidencia más específica):
// 1. Etiqueta normalizada contra frases por categoría: exactas, al principio o en cualquier parte.
// 2. Dirección de destino: esquemas de otras apps, logout, `…/quizzes/N/take`, pagos, bajas, borrados, supervisores de exámenes
//    y las rutas propias de cada plataforma (Moodle `processattempt.php`, Brightspace `quizzing/user/attempt`, Google Forms…).
// 3. Enlaces a herramientas externas o elementos de módulo de Canvas cuyo nombre parece un examen (y no un repaso).
// 4. Confirmaciones («OK», «Sí», «Aceptar») dentro de un diálogo heredan el peligro del texto del diálogo.
// 5. Botones dentro de un formulario con contraseña → credentials.
import {
  BASE_TABLE, CONFIRM_EXACT, CONFIRM_PREFIXES, DELETE_EXCLUSIONS, DELETE_SEGMENTS, EXAM_LABEL_DENSE, EXAM_LABEL_PHRASES, EXAM_LABEL_WORDS,
  EXAM_NOUNS, EXAM_SEGMENTS, FILLERS, LOGOUT_SEGMENTS, PAYMENT_SEGMENTS, PLATFORM_TABLE, PROCEED_LABELS, PROCTOR_HOSTS, RISKY_HOSTS,
  SAFE_EXACT, SEARCH_DENSE, SEARCH_WORDS, SENSITIVE_DENSE, SENSITIVE_EXACT, SENSITIVE_PHRASES, SENSITIVE_WORDS, SENTENCE_VERBS,
  START_VERBS, STATE_TABLE, STUDY_DENSE, STUDY_PHRASES, STUDY_WORDS, UNENROLL_SEGMENTS, VIEW_LABELS, type DangerCategory, type RuleMode
} from './danger-phrases'
import { hasDenseScript, normalizeLabel, words } from './text-norm'
import { pick, tr, type Bilingual } from '@shared/ai/i18n'

export type { DangerCategory } from './danger-phrases'

export interface DangerAssessment {
  category: DangerCategory
  /** Frase o patrón que coincidió (normalizado), útil para depurar y para la clave de aprobación. */
  matched: string
  /** true si la acción está prohibida incluso con aprobación (contraseñas, salir de apps…). */
  forbidden: boolean
  /** Explicación para el estudiante (en el idioma de la interfaz). */
  reason: string
  /** Explicación para la IA (inglés). */
  aiReason: string
}

// Lo que lee el estudiante en el aviso de permiso, en el idioma de la interfaz (se elige al pedirlo, no al importar).
const USER_REASON: Record<DangerCategory, Bilingual> = {
  submit: { es: 'Parece que entrega un trabajo, un examen o un intento.', en: 'It looks like it submits work, an exam or an attempt.' },
  assessment: {
    es: 'Podría empezar, reanudar o repetir un examen o cuestionario (con tiempo o intentos limitados).',
    en: 'It could start, resume or retake an exam or quiz (timed or with limited attempts).'
  },
  delete: { es: 'Podría borrar o quitar algo.', en: 'It could delete or remove something.' },
  message: { es: 'Enviaría, publicaría o compartiría algo en tu nombre.', en: 'It would send, post or share something on your behalf.' },
  payment: { es: 'Podría hacer un pago, una compra o una suscripción.', en: 'It could make a payment, a purchase or a subscription.' },
  logout: { es: 'Cerraría tu sesión.', en: 'It would sign you out.' },
  unenroll: { es: 'Podría darte de baja o sacarte de un curso o grupo.', en: 'It could unenroll you from a course or group.' },
  permission: { es: 'Concedería un permiso del navegador o del sistema.', en: 'It would grant a browser or system permission.' },
  consent: { es: 'Aceptaría condiciones, cookies o una invitación en tu nombre.', en: 'It would accept terms, cookies or an invitation on your behalf.' },
  credentials: { es: 'Es un inicio de sesión o un formulario con contraseña.', en: 'It’s a sign-in or a password form.' },
  modify: { es: 'Cambiaría datos o ajustes de tu cuenta.', en: 'It would change your account data or settings.' },
  upload: { es: 'Subiría archivos de tu ordenador.', en: 'It would upload files from your computer.' },
  closeWindow: { es: 'Cerraría una ventana o una pestaña.', en: 'It would close a window or tab.' },
  externalApp: { es: 'Abriría otra app.', en: 'It would open another app.' },
  system: { es: 'Cerraría apps o la sesión del ordenador.', en: 'It would close apps or sign you out of your computer.' }
}

const AI_REASON: Record<DangerCategory, string> = {
  submit: 'it looks like it submits work, an exam or an attempt',
  assessment: 'it may start, resume or retake a quiz/exam attempt (timed or limited attempts)',
  delete: 'it may delete or remove something',
  message: "it would send, post or share something on the user's behalf",
  payment: 'it may make a payment, purchase or subscription',
  logout: 'it would log the user out',
  unenroll: 'it may unenroll the user or leave a course/group',
  permission: 'it would grant a browser or system permission',
  consent: "it would accept terms, cookies or an invitation on the user's behalf",
  credentials: 'it is a login or a form with a password',
  modify: "it would change the user's data or settings",
  upload: 'it would upload files from the computer',
  closeWindow: 'it would close a window or tab',
  externalApp: 'it would open another app',
  system: 'it would quit apps or log out of the computer'
}

export function dangerReason(category: DangerCategory): string {
  return pick(USER_REASON[category])
}

function assessment(category: DangerCategory, matched: string, extra?: Partial<DangerAssessment>): DangerAssessment {
  return { category, matched, forbidden: false, reason: dangerReason(category), aiReason: AI_REASON[category], ...extra }
}

/** Lo que se sabe del elemento y de su entorno. */
export interface DangerContext {
  action: 'press' | 'click' | 'select' | 'setText' | 'typeText' | 'openURL' | 'key' | 'download' | 'focus' | 'scroll'
  /** Rol corto: link, button, menuitem, checkbox, textfield, passwordfield… */
  role?: string
  /** Nombre accesible (título, descripción o texto). */
  label: string
  /** Destino del enlace o dirección que se va a abrir. */
  url?: string
  pageURL?: string
  /** Título y texto del diálogo que contiene el elemento. */
  dialogText?: string
  /** El elemento está junto a un campo de contraseña (mismo formulario). */
  inPasswordForm?: boolean
  /** Hay un campo de contraseña en otra parte de la página (señal débil). */
  passwordOnPage?: boolean
  /** Texto que se va a escribir. */
  text?: string
}

// MARK: Motor de frases

interface Rule { phrase: string; words: number; mode: RuleMode; category: DangerCategory; dense: boolean }

function makeRule(raw: string, mode: RuleMode, category: DangerCategory): Rule | null {
  const phrase = normalizeLabel(raw)
  if (!phrase) return null
  const dense = hasDenseScript(phrase)
  const n = dense ? Math.max(1, Math.min(4, Math.floor([...phrase.replace(/ /g, '')].length / 2))) : phrase.split(' ').length
  return { phrase, words: n, mode, category, dense }
}

const RULES: Rule[] = [...BASE_TABLE, ...PLATFORM_TABLE, ...STATE_TABLE].flatMap(([cat, mode, phrases]) =>
  phrases.map((p) => makeRule(p, mode, cat)).filter((r): r is Rule => r !== null)
)
const norm = (list: string[]): string[] => list.map(normalizeLabel)
const normSet = (list: string[]): Set<string> => new Set(list.map(normalizeLabel))
const SAFE = normSet(SAFE_EXACT)
const PROCEED = new Set(PROCEED_LABELS.map(normalizeLabel))
const CONFIRM = normSet(CONFIRM_EXACT)
const CONFIRM_PRE = norm(CONFIRM_PREFIXES).map((p) => p + ' ')
const SENT_VERBS = normSet(SENTENCE_VERBS)
const FILL = norm(FILLERS)
const DEL_EXCL = norm(DELETE_EXCLUSIONS)
const STARTS = normSet(START_VERBS)
const EXAMS = normSet(EXAM_NOUNS)
const EXAM_WORDS = normSet(EXAM_LABEL_WORDS)
const EXAM_PHRASES = norm(EXAM_LABEL_PHRASES)
const EXAM_DENSE = norm(EXAM_LABEL_DENSE)
const STUDY = normSet(STUDY_WORDS)
const STUDY_PHR = norm(STUDY_PHRASES)
const STUDY_DNS = norm(STUDY_DENSE)
const SENS_EXACT = normSet(SENSITIVE_EXACT)
const SENS_WORDS = norm(SENSITIVE_WORDS)
const SENS_PHRASES = norm(SENSITIVE_PHRASES)
const SENS_DENSE = norm(SENSITIVE_DENSE)
const VIEW = norm(VIEW_LABELS).filter(Boolean)
const VIEW_SET = new Set(VIEW)
const SEARCH = norm(SEARCH_WORDS)
const SEARCH_DNS = norm(SEARCH_DENSE)

/** Prioridad entre categorías cuando empatan. */
function priority(c: DangerCategory): number {
  switch (c) {
    case 'system': return 9
    case 'assessment': case 'submit': case 'payment': return 8
    case 'delete': case 'unenroll': case 'credentials': case 'logout': return 7
    case 'permission': case 'upload': return 6
    case 'message': case 'consent': return 5
    case 'externalApp': case 'closeWindow': return 4
    case 'modify': return 3
  }
}

function stripFillers(n: string): string {
  let s = n
  let changed = true
  while (changed) {
    changed = false
    for (const f of FILL) {
      if (s.startsWith(f + ' ')) {
        s = s.slice(f.length + 1)
        changed = true
      }
    }
  }
  return s
}

const MODE_BONUS: Record<RuleMode, number> = { exact: 5, prefix: 3, contains: 1, containsNonLink: 0 }

/** `sentence`: el texto es una frase (de un diálogo); todas las reglas se buscan en cualquier parte. */
function matchLabelScored(normalized: string, isLink: boolean, sentence: boolean): { score: number; a: DangerAssessment } | null {
  if (!normalized) return null
  const n = [...normalized].slice(0, 240).join('')
  const stripped = sentence ? n : stripFillers(n)
  const padded = ` ${n} `
  let best: { score: number; rule: Rule } | null = null
  for (const r of RULES) {
    let hit = false
    if (sentence && r.dense) {
      // en frases, una palabra genérica suelta («提交», «시작») no basta: solo frases o palabras de 3+ caracteres
      hit = (r.mode !== 'exact' || [...r.phrase].length >= 3) && [...r.phrase].length >= 2 && n.includes(r.phrase)
    } else if (sentence) {
      // En diálogos solo cuentan frases de 2+ palabras y verbos claros («like», «leave», «exit» aparecen en textos inocentes)
      hit = (r.words >= 2 || SENT_VERBS.has(r.phrase)) && padded.includes(` ${r.phrase} `)
    } else {
      switch (r.mode) {
        case 'exact': hit = stripped === r.phrase || n === r.phrase; break
        case 'prefix':
          hit = r.dense
            ? stripped.startsWith(r.phrase) || n.startsWith(r.phrase)
            : stripped === r.phrase || stripped.startsWith(r.phrase + ' ') || n === r.phrase || n.startsWith(r.phrase + ' ')
          break
        case 'contains': hit = r.dense ? n.includes(r.phrase) : padded.includes(` ${r.phrase} `); break
        case 'containsNonLink': hit = !isLink && (r.dense ? n.includes(r.phrase) : padded.includes(` ${r.phrase} `)); break
      }
    }
    if (!hit) continue
    if (r.category === 'delete' && DEL_EXCL.some((x) => padded.includes(` ${x} `))) continue
    const score = r.words * 10 + MODE_BONUS[r.mode] + priority(r.category)
    if (!best || score > best.score) best = { score, rule: r }
  }
  // Verbo de empezar + sustantivo de examen («Start practice quiz», «Comenzar el parcial»)
  if (!sentence) {
    const a = startVerbPlusExam(stripped)
    if (a) {
      const score = 22 + priority('assessment')
      if (!best || score > best.score) return { score, a }
    }
  }
  if (!best) return null
  return { score: best.score, a: assessment(best.rule.category, best.rule.phrase, { forbidden: best.rule.category === 'system' }) }
}

function startVerbPlusExam(n: string): DangerAssessment | null {
  const w = words(n)
  const first = w[0]
  if (!first || !STARTS.has(first)) return null
  for (const word of w.slice(1, 7)) {
    if (EXAMS.has(word)) return assessment('assessment', `${first}+${word}`)
  }
  return null
}

function parseURL(s: string): URL | null {
  try {
    return new URL(s)
  } catch {
    return null
  }
}

function examLaunchLink(n: string, url: string): DangerAssessment | null {
  const u = parseURL(url)
  if (!u) return null
  const segs = u.pathname.toLowerCase().split('/').filter(Boolean)
  const host = u.hostname.toLowerCase()
  const launchy = segs.includes('external_tools') || segs.includes('lti') || segs.includes('launch') || segs.includes('sessionless_launch') ||
    (segs.includes('modules') && segs.includes('items')) || host.includes('quiz-lti') || host.includes('quiz-api')
  if (!launchy) return null
  const ws = new Set(words(n))
  const padded = ` ${n} `
  const examLike = [...ws].some((w) => EXAM_WORDS.has(w)) || EXAM_PHRASES.some((p) => padded.includes(` ${p} `)) || EXAM_DENSE.some((d) => n.includes(d))
  if (!examLike) return null
  if ([...ws].some((w) => STUDY.has(w)) || STUDY_PHR.some((p) => padded.includes(` ${p} `)) || STUDY_DNS.some((d) => n.includes(d))) return null
  return assessment('assessment', 'exam-link', {
    reason: tr('Parece un examen o cuestionario; abrirlo podría empezar un intento con tiempo.', 'It looks like an exam or quiz; opening it could start a timed attempt.'),
    aiReason: 'this link looks like an exam/quiz launch and may start a timed attempt'
  })
}

function isConfirmation(n: string): boolean {
  if (CONFIRM.has(n)) return true
  return CONFIRM_PRE.some((p) => n.startsWith(p))
}

function shortRole(role?: string): string {
  const r = (role ?? '').toLowerCase()
  if (r.startsWith('ax')) return r.slice(2)
  if (r === 'a') return 'link'
  return r
}

// MARK: API

/** Evalúa una acción. null = no hace falta aprobación. */
export function classifyAction(c: DangerContext): DangerAssessment | null {
  switch (c.action) {
    case 'focus': case 'scroll': case 'download': case 'key': return null
    case 'setText': case 'typeText': return classifyTextEntry(c)
    case 'openURL': return c.url ? classifyURL(c.url) : null
    default: return classifyActivation(c)
  }
}

/** Clasifica solo una etiqueta (botón o elemento de menú). */
/**
 * ¿La etiqueta es la de un botón que solo enseña algo (siguiente, ver más, desplegar, buscar, cerrar…)? Lo usa la política de
 * clics para los botones sin dirección (A2-P1-5): los demás piden permiso. No mira el peligro: eso va antes.
 */
export function isViewLabel(label: string): boolean {
  const n = normalizeLabel(label)
  if (!n) return false
  if (VIEW_SET.has(n) || SAFE.has(n)) return true
  // paginación: «3», «Página 3», «Page 3 of 9»
  if (/^\d{1,4}$/.test(n) || /^(page|pagina|seite|pagine|страница)( \d{1,4})( (of|de|von|di|из) \d{1,4})?$/.test(n)) return true
  return VIEW.some((p) => (hasDenseScript(p) ? n.startsWith(p) : n.startsWith(p + ' ')))
}

/** ¿«OK», «Sí», «Aceptar», «Entendido»…? (dentro de un diálogo inocente cierran el aviso) */
export function isConfirmLabel(label: string): boolean {
  const n = normalizeLabel(label)
  return !!n && isConfirmation(n)
}

export function classifyLabel(label: string, isLink = false): DangerAssessment | null {
  return matchLabelScored(normalizeLabel(label), isLink, false)?.a ?? null
}

/** ¿La etiqueta de un campo sugiere contraseña, código, tarjeta u otro dato secreto? */
export function isSensitiveFieldLabel(label: string): boolean {
  const n = normalizeLabel(label)
  if (!n) return false
  const padded = ` ${n} `
  if (SENS_EXACT.has(n)) return true
  if (SENS_DENSE.some((d) => n.includes(d))) return true
  if (SENS_WORDS.some((w) => padded.includes(` ${w} `))) return true
  for (const p of SENS_PHRASES) {
    if (!padded.includes(` ${p} `)) continue
    if (p === 'clave' && (padded.includes(' palabras clave ') || padded.includes(' palabra clave '))) continue
    return true
  }
  return false
}

/** ¿La etiqueta de un campo es de búsqueda o de dirección (Intro ahí no envía nada peligroso)? */
export function isSearchLabel(label: string): boolean {
  const n = normalizeLabel(label)
  return SEARCH.some((w) => ` ${n} `.includes(` ${w} `)) || SEARCH_DNS.some((d) => n.includes(d))
}

/** Evalúa una dirección de destino (enlace o navegación). */
export function classifyURL(raw: string): DangerAssessment | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const lower = s.toLowerCase()
  const colon = lower.indexOf(':')
  if (colon > 0 && !lower.startsWith('http://') && !lower.startsWith('https://')) {
    const scheme = lower.slice(0, colon)
    if (/^[a-z0-9+.-]+$/.test(scheme)) {
      if (['javascript', 'about', 'blob', 'data'].includes(scheme)) return null // sin destino real: decide la etiqueta
      if (['mailto', 'sms', 'imessage', 'facetime', 'tel', 'facetime-audio'].includes(scheme)) return assessment('message', `url:${scheme}`)
      return assessment('externalApp', `url:${scheme}`)
    }
  }
  const u = parseURL(s)
  if (!u) return null
  const host = u.hostname.toLowerCase()
  for (const p of PROCTOR_HOSTS) if (host.includes(p)) return assessment('assessment', `host:${p}`)
  for (const [h, cat] of RISKY_HOSTS) if (host === h || host.endsWith('.' + h)) return assessment(cat, `host:${h}`)
  let path = u.pathname.toLowerCase()
  try {
    path = decodeURIComponent(path)
  } catch { /* se queda codificada */ }
  const segs = path.split('/').filter(Boolean)
  const query = u.search.toLowerCase().replace(/^\?/, '')
  const plat = platformURLRule(host, path, segs, query)
  if (plat) return plat
  // Canvas: /courses/1/quizzes/2/take; Moodle: /mod/quiz/startattempt.php, attempt.php
  if (segs.includes('take') || segs.some((x) => x === 'startattempt.php' || x === 'attempt.php')) return assessment('assessment', 'url:take')
  const ai = segs.findIndex((x) => x === 'attempts' || x === 'attempt')
  if (ai >= 0 && ai + 1 < segs.length && ['new', 'start', 'begin'].includes(segs[ai + 1])) return assessment('assessment', 'url:attempt')
  if (segs.includes('start') && segs.some((x) => EXAM_SEGMENTS.includes(x))) return assessment('assessment', 'url:start')
  for (const seg of segs) {
    const base = seg.split('.')[0] ?? seg
    if (LOGOUT_SEGMENTS.includes(base)) return assessment('logout', `url:${base}`)
    if (DELETE_SEGMENTS.includes(base)) return assessment('delete', `url:${base}`)
    if (PAYMENT_SEGMENTS.includes(base)) return assessment('payment', `url:${base}`)
    if (UNENROLL_SEGMENTS.includes(base)) return assessment('unenroll', `url:${base}`)
  }
  if (query.includes('_method=delete') || query.includes('action=delete')) return assessment('delete', 'url:method=delete')
  if (query.includes('logout=') || query.includes('action=logout')) return assessment('logout', 'url:logout')
  return null
}

/**
 * Reglas de dirección propias de cada plataforma (abrirlas empieza o entrega un intento, publica o cambia algo). La página de
 * presentación de un cuestionario (Moodle `mod/quiz/view.php`, Canvas `/quizzes/N`, Brightspace `quiz_summary.d2l`, Sakai
 * `beginTakingAssessment.faces`) NO cuenta: solo se lee.
 */
function platformURLRule(host: string, path: string, segs: string[], query: string): DangerAssessment | null {
  const last = segs[segs.length - 1] ?? ''
  const a = (c: DangerCategory, m: string): DangerAssessment => assessment(c, `url:${m}`)
  // Moodle
  if (segs.includes('quiz') && last === 'processattempt.php') return a('submit', 'moodle-processattempt')
  if (segs.includes('quiz') && last === 'summary.php') return a('submit', 'moodle-quiz-summary')
  if (segs.includes('assign') && last === 'view.php' &&
    ['action=editsubmission', 'action=submit', 'action=savesubmission', 'action=removesubmission', 'action=confirmsubmit'].some((q) => query.includes(q))) {
    return a('submit', 'moodle-assign-submission')
  }
  if (segs.includes('forum') && last === 'post.php') return a('message', 'moodle-forum-post')
  if (last === 'togglecompletion.php') return a('modify', 'moodle-completion')
  if (segs.includes('scorm') && last === 'player.php') return a('assessment', 'moodle-scorm-player')
  if (segs.includes('feedback') && last === 'complete.php') return a('submit', 'moodle-feedback-complete')
  if (segs.includes('choice') && query.includes('action=makechoice')) return a('submit', 'moodle-choice')
  if (segs[0] === 'enrol' && (last === 'index.php' || last === 'self.php')) return a('consent', 'moodle-enrol')
  // Canvas: intentos de New Quizzes y respuestas de un intento clásico
  if (segs.includes('new_quizzes') && segs.some((x) => x.startsWith('taking'))) return a('assessment', 'canvas-new-quizzes')
  if (segs.includes('quizzes') && segs.includes('submissions') && segs.some((x) => ['record_answer', 'backup', 'complete'].includes(x))) {
    return a('submit', 'canvas-quiz-submission')
  }
  if (segs.includes('saml_logout') || (segs.includes('saml') && segs.includes('logout'))) return a('logout', 'saml-logout')
  // Blackboard Learn (Original)
  if (path.includes('/webapps/assignment/uploadassignment')) return a('submit', 'blackboard-upload-assignment')
  if (path.includes('/webapps/discussionboard/do/message') && ['action=create', 'action=save', 'action=reply'].some((q) => query.includes(q))) {
    return a('message', 'blackboard-discussion')
  }
  if (path.includes('/webapps/assessment/') && (last.startsWith('launch') || last.startsWith('take'))) return a('assessment', 'blackboard-take')
  // Brightspace
  if (path.includes('/quizzing/user/attempt') || path.includes('/quizzing/user/quiz_attempt')) return a('assessment', 'brightspace-quiz-attempt')
  if (path.includes('/dropbox/user/folder_submit_files')) return a('submit', 'brightspace-dropbox-submit')
  if (path.includes('/survey/user/attempt')) return a('assessment', 'brightspace-survey')
  // Sakai (Tests & Quizzes): entregar o seguir un examen; «beginTakingAssessment» solo presenta
  if (path.includes('/samigo-app/') && ['deliverassessment', 'confirmsubmit', 'submitted.faces', '/servlet/login'].some((x) => path.includes(x))) {
    return a('assessment', 'sakai-samigo')
  }
  // Google Forms / Microsoft Forms
  if (host === 'docs.google.com' && segs.includes('forms') && last === 'formresponse') return a('submit', 'google-forms-submit')
  if ((host.endsWith('forms.office.com') || host === 'forms.microsoft.com') && path.includes('responsepage.aspx')) return a('assessment', 'microsoft-forms')
  // Open edX
  if (path.includes('problem_check') || path.includes('/handler/xmodule_handler/problem_')) return a('submit', 'openedx-problem-check')
  if (path.includes('/edx_proctoring/') && path.includes('attempt')) return a('assessment', 'openedx-proctored-exam')
  return null
}

function classifyActivation(c: DangerContext): DangerAssessment | null {
  const role = shortRole(c.role)
  const isLink = role === 'link'
  const n = normalizeLabel(c.label)
  if (role === 'passwordfield') return null // pulsar o enfocar un campo no revela nada
  // «Cancelar»/«Volver»: nunca peligrosos… salvo que su destino lo sea (la etiqueta inocente no anula la dirección)
  const urlDanger = c.url ? classifyURL(c.url) : null
  if (SAFE.has(n) && !urlDanger) return null
  let best: { score: number; a: DangerAssessment } | null = null
  const consider = (a: DangerAssessment | null, score: number): void => {
    if (a && (!best || score > best.score)) best = { score, a }
  }
  const m = matchLabelScored(n, isLink, false)
  if (m) consider(m.a, m.score)
  if (urlDanger) consider(urlDanger, 45)
  if (isLink && c.url) consider(examLaunchLink(n, c.url), 25)
  // Confirmaciones dentro de un diálogo: heredan el peligro del diálogo
  if (c.dialogText && isConfirmation(n)) {
    const dm = matchLabelScored(normalizeLabel(c.dialogText), false, true)
    if (dm) consider({ ...dm.a, matched: `dialog:${dm.a.matched}` }, dm.score)
  }
  if (c.inPasswordForm && (!isLink || !best)) {
    consider(assessment('credentials', 'password-form'), 15)
  } else if (c.passwordOnPage && !best && !isLink && PROCEED.has(stripFillers(n))) {
    // Contraseña en la página y un botón genérico de «seguir»: probablemente envía el inicio de sesión
    consider(assessment('credentials', 'password-page'), 15)
  }
  return (best as { score: number; a: DangerAssessment } | null)?.a ?? null
}

function classifyTextEntry(c: DangerContext): DangerAssessment | null {
  if (shortRole(c.role) === 'passwordfield') {
    return assessment('credentials', 'secure-field', {
      forbidden: true, reason: tr('Aula nunca lee ni escribe contraseñas.', 'Aula never reads or types passwords.'), aiReason: 'Typing into password fields is never allowed.'
    })
  }
  if (isSensitiveFieldLabel(c.label)) {
    return assessment('credentials', 'sensitive-label', {
      forbidden: true, reason: tr('Aula no escribe en campos de contraseñas, códigos o tarjetas.', 'Aula doesn’t type into password, code or card fields.'),
      aiReason: 'This field looks like a password/code/card field; typing there is never allowed.'
    })
  }
  if (c.text && containsCardNumber(c.text)) {
    return assessment('payment', 'card-number', {
      forbidden: true, reason: tr('El texto parece un número de tarjeta; Aula no lo escribe.', 'The text looks like a card number; Aula won’t type it.'),
      aiReason: 'The text looks like a payment card number; typing it is never allowed.'
    })
  }
  return null
}

/** Números de tarjeta (13–19 dígitos que pasan Luhn), con espacios o guiones. */
export function containsCardNumber(text: string): boolean {
  let digits: number[] = []
  const check = (): boolean => {
    if (digits.length < 13 || digits.length > 19) return false
    let sum = 0
    const rev = [...digits].reverse()
    rev.forEach((d, i) => {
      if (i % 2 === 1) {
        const x = d * 2
        sum += x > 9 ? x - 9 : x
      } else sum += d
    })
    return sum % 10 === 0 && new Set(digits).size > 1
  }
  for (const ch of text + 'x') {
    if (ch >= '0' && ch <= '9') {
      digits.push(ch.charCodeAt(0) - 48)
      continue
    }
    if (ch === ' ' || ch === '-') continue
    if (check()) return true
    digits = []
  }
  return false
}
