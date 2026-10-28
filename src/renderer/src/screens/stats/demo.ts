// Estadísticas de ejemplo (solo modo demostración, si 'stats.get' aún no responde): deterministas para las capturas.
import { STATS_WINDOW_DAYS, type StatsCourse, type StatsData, type StatsDay, type StatsLevelPoint, type StatsScorePoint } from '@shared/ipc/stats'
import { shiftKey } from './derive'
import { demoText } from '@renderer/lib/demo'

function localKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Generador pseudoaleatorio con semilla (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Spec {
  id: string
  title: string
  icon: string
  hue: number
  examIn?: number
  /** Día de la ventana en que empezó (0…83). */
  startedAt: number
  intensity: number
  skills: string[]
  final: number
}

const SPECS: Spec[] = [
  { id: 'exam-2-math112', title: 'Exam #2 · MATH 101', icon: 'trigonometry', hue: 0.6, examIn: 3, startedAt: 30, intensity: 1, final: 0.78, skills: ['Reference angles', 'The unit circle', 'Exact values', 'Pythagorean identities', 'Law of sines', 'Law of cosines', 'Graphs of sine and cosine', 'Radians'] },
  { id: 'demo-quimica', title: 'General Chemistry', icon: 'chemistry', hue: 0.38, examIn: 9, startedAt: 52, intensity: 0.7, final: 0.52, skills: ['Molar mass', 'The mole and Avogadro', 'Balancing equations', 'Stoichiometry', 'Limiting reagent'] },
  { id: 'demo-ingles', title: 'Spanish B1', icon: 'spanish', hue: 0.93, examIn: 16, startedAt: 12, intensity: 0.45, final: 0.64, skills: ['Ser and estar', 'The subjunctive', 'Describing pictures', 'Giving opinions'] }
]
const SPECS_ES: Spec[] = [
  { id: 'exam-2-math112', title: 'Trigonometría', icon: 'trigonometry', hue: 0.6, examIn: 3, startedAt: 30, intensity: 1, final: 0.78, skills: ['Ángulos de referencia', 'Círculo unitario', 'Identidades pitagóricas', 'Ley de senos', 'Ley de cosenos', 'Gráficas de seno y coseno', 'Ecuaciones trigonométricas', 'Radianes'] },
  { id: 'demo-quimica', title: 'Química general', icon: 'chemistry', hue: 0.38, examIn: 9, startedAt: 52, intensity: 0.7, final: 0.52, skills: ['Masa molar', 'El mol y Avogadro', 'Balanceo de ecuaciones', 'Estequiometría', 'Reactivo limitante'] },
  { id: 'demo-ingles', title: 'Inglés B2', icon: 'english', hue: 0.93, examIn: 16, startedAt: 12, intensity: 0.45, final: 0.64, skills: ['Phrasal verbs', 'Conditionals', 'Describing pictures', 'Giving opinions'] }
]

export function demoStats(now = new Date()): StatsData {
  const today = localKey(now)
  const start = shiftKey(today, -(STATS_WINDOW_DAYS - 1))
  const courses = (demoText('es', 'en') === 'en' ? SPECS : SPECS_ES).map((s, i) => course(s, start, now, 17 + i * 31))
  return { start, today, courses }
}

function course(s: Spec, start: string, now: Date, seed: number): StatsCourse {
  const r = rng(seed)
  const days: StatsDay[] = []
  for (let i = 0; i < STATS_WINDOW_DAYS; i++) {
    const date = shiftKey(start, i)
    const dow = new Date(date + 'T12:00:00').getDay()
    const before = i < s.startedAt
    const rest = r() < (dow === 6 || dow === 0 ? 0.55 : 0.22)
    const ramp = 1 + Math.max(0, (i - (STATS_WINDOW_DAYS - 10)) / 6) * (s.examIn && s.examIn < 10 ? 1 : 0.2)
    const minutes = before || rest ? 0 : Math.round((8 + r() * 38) * s.intensity * ramp)
    const attempts = minutes ? Math.round(minutes / (2.2 + r() * 1.5)) : 0
    const acc = Math.min(0.97, 0.45 + (i - s.startedAt) / 110 + r() * 0.15)
    days.push({ date, minutes, attempts, correct: Math.round(attempts * acc * 10) / 10 })
  }
  const topics = s.skills.map((title, k) => {
    const attempts = Math.round(6 + r() * 44 * s.intensity)
    return { id: `${s.id}/s${k}`, courseId: s.id, skillId: `s${k}`, title, courseTitle: s.title, hue: s.hue, attempts, accuracy: Math.min(0.98, 0.42 + r() * 0.52) }
  })
  const levels: StatsLevelPoint[] = []
  const history: StatsScorePoint[] = []
  const n = s.skills.length
  for (let i = 0; i < STATS_WINDOW_DAYS; i++) {
    const date = shiftKey(start, i)
    const p = Math.max(0, (i - s.startedAt) / (STATS_WINDOW_DAYS - s.startedAt))
    if (i % 7 === 6 || i === STATS_WINDOW_DAYS - 1) {
      const mastered = Math.round(n * Math.max(0, p - 0.45) * 0.9)
      const solid = Math.round(n * Math.max(0, Math.min(0.3, p - 0.25)))
      const practicing = Math.round(n * Math.min(0.3, p * 0.6))
      const learning = Math.round(n * Math.min(0.25, p * 0.9))
      const seen = Math.min(n, mastered + solid + practicing + learning)
      levels.push({ date, counts: { unseen: n - seen, learning: Math.max(0, learning - Math.max(0, mastered + solid + practicing + learning - n)), practicing, solid, mastered } })
    }
    if (i >= s.startedAt && (i - s.startedAt) % 2 === 0) {
      const expected = Math.min(0.95, 0.25 + (s.final - 0.25) * Math.pow(p, 0.8) + (r() - 0.5) * 0.03)
      const w = 0.28 * (1 - p) + 0.07
      history.push({ date, expected, low: Math.max(0, expected - w), high: Math.min(1, expected + w * 0.85) })
    }
  }
  const last = history[history.length - 1]
  const exam = s.examIn != null ? new Date(now.getTime() + s.examIn * 86400000) : undefined
  return {
    id: s.id,
    title: s.title,
    icon: s.icon,
    hue: s.hue,
    examDate: exam ? exam.toISOString() : undefined,
    expected: last ? last.expected : null,
    low: last?.low ?? 0,
    high: last?.high ?? 0,
    coverage: Math.min(1, 0.4 + s.intensity * 0.5),
    label: last ? (last.expected > 0.75 ? 'almostReady' : last.expected > 0.55 ? 'gettingThere' : 'early') : 'notStarted',
    days,
    topics,
    levels,
    history,
    skillCount: n
  }
}
