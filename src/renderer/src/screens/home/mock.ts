// Datos de ejemplo para diseñar Inicio sin motor (solo en desarrollo, si 'home.summary' aún no existe).
import type { HomeSummary } from '@shared/ipc/home'
import { demoText as L } from '@renderer/lib/demo'

export function mockHome(): HomeSummary {
  const d = (days: number, h = 9) => {
    const x = new Date()
    x.setDate(x.getDate() + days)
    x.setHours(h, 0, 0, 0)
    return x.toISOString()
  }
  return {
    name: 'Maya',
    today: { minutesDone: 18, minutesGoal: 45, itemsDone: 1, itemsTotal: 4 },
    streak: { days: 6, best: 11, week: [true, true, true, false, true, true, false] },
    plan: [
      { id: 'p1', courseId: 'exam-2-math112', courseTitle: L('Trigonometría', 'Exam #2 · MATH 101'), icon: 'trigonometry', hue: 0.6, kind: 'cards', title: L('Repaso de tarjetas', 'Flashcard review'), detail: L('12 tarjetas vencidas', '12 cards due'), minutes: 6 },
      { id: 'p2', courseId: 'demo-quimica', courseTitle: L('Química general', 'General Chemistry'), icon: 'chemistry', hue: 0.38, kind: 'learn', title: L('Estequiometría', 'Stoichiometry'), detail: L('Vale 25 puntos · vas en 40 %', 'Worth 25 points · 40% done'), minutes: 14, skillId: 's' },
      { id: 'p3', courseId: 'exam-2-math112', courseTitle: L('Trigonometría', 'Exam #2 · MATH 101'), icon: 'trigonometry', hue: 0.6, kind: 'mistakes', title: L('Repaso de errores', 'Mistake review'), detail: L('3 errores por corregir', '3 mistakes to fix'), minutes: 5 },
      { id: 'p4', courseId: 'demo-ingles', courseTitle: L('Inglés B2', 'Spanish B1'), icon: L('english', 'spanish'), hue: 0.93, kind: 'practice', title: L('Phrasal verbs', 'Ser and estar'), detail: L('Práctica mezclada', 'Mixed practice'), minutes: 10 }
    ],
    exams: [
      { courseId: 'exam-2-math112', title: L('Parcial 2', 'Exam #2'), courseTitle: L('Trigonometría', 'Exam #2 · MATH 101'), icon: 'trigonometry', hue: 0.6, date: d(3), started: true, readiness: 0.78, readinessLow: 0.7, readinessHigh: 0.85, coverage: 0.9 },
      { courseId: 'demo-quimica', title: L('Examen final', 'Final exam'), courseTitle: L('Química general', 'General Chemistry'), icon: 'chemistry', hue: 0.38, date: d(9), started: true, readiness: 0.52, readinessLow: 0.4, readinessHigh: 0.63, coverage: 0.55 },
      { courseId: 'demo-ingles', title: L('Speaking test', 'Oral exam'), courseTitle: L('Inglés B2', 'Spanish B1'), icon: L('english', 'spanish'), hue: 0.93, date: d(16), started: true, readiness: 0.64, readinessLow: 0.55, readinessHigh: 0.72, coverage: 0.7 }
    ],
    courses: [
      { id: 'exam-2-math112', title: L('Trigonometría', 'Exam #2 · MATH 101'), subject: L('Matemáticas', 'Mathematics'), icon: 'trigonometry', hue: 0.6, started: true, readiness: 0.78, coverage: 0.9, examDate: d(3), dueCards: 12, mistakes: 3, skillCount: 8 },
      { id: 'demo-quimica', title: L('Química general', 'General Chemistry'), subject: L('Química', 'Chemistry'), icon: 'chemistry', hue: 0.38, started: true, readiness: 0.52, coverage: 0.55, examDate: d(9), dueCards: 4, mistakes: 1, skillCount: 11 },
      { id: 'demo-ingles', title: L('Inglés B2', 'Spanish B1'), subject: L('Idiomas', 'Languages'), icon: L('english', 'spanish'), hue: 0.93, started: true, readiness: 0.64, coverage: 0.7, examDate: d(16), dueCards: 20, mistakes: 0, skillCount: 9 },
      { id: 'demo-biologia', title: L('Biología celular', 'Cell Biology'), subject: L('Biología', 'Biology'), icon: 'biology', hue: 0.5, started: true, readiness: 0.2, coverage: 0.15, examDate: null, dueCards: 0, mistakes: 0, skillCount: 6, generating: true }
    ],
    upcoming: [
      { id: 'e1', title: L('Entrega: problemas 4.2', 'Due: problem set 4.2'), start: d(1, 23), kind: 'assignment', courseId: 'exam-2-math112' },
      { id: 'e2', title: L('Parcial 2 · Trigonometría', 'Exam #2 — Trigonometry (MATH 101)'), start: d(3, 9), kind: 'exam', courseId: 'exam-2-math112' },
      { id: 'e3', title: L('Laboratorio de química', 'Chemistry lab'), start: d(4, 11), kind: 'class', courseId: 'demo-quimica' },
      { id: 'e4', title: L('Repasar con Ana', 'Study session with Ana'), start: d(5, 17), kind: 'event' }
    ],
    dueCards: 36,
    mistakes: 4,
    aiReady: true
  }
}
