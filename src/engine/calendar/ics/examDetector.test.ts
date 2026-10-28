// Port de CanvasKitTests/ExamDetectorTests.swift (+ SEC-16 de AuditSecurityFixTests y la ensalada de palabras de RobustnessTests).
// Cada fila: (título, kind esperado, isExam esperado).
import { describe, expect, it } from 'vitest'
import { ExamDetector, tokenize } from './examDetector'
import type { StudyEventKind } from './studyEvent'
import { LCG } from './testSupport.testutil'

type Case = [string, StudyEventKind, boolean]

const exams: Case[] = [
  ["Exam 1", "exam", true],
  ["Exam #2", "exam", true],
  ["EXAM 3", "exam", true],
  ["Midterm", "exam", true],
  ["Midterm Exam", "exam", true],
  ["Midterm 1", "exam", true],
  ["Mid-term Exam", "exam", true],
  ["Midterm Examination - MATH112", "exam", true],
  ["Final Exam", "exam", true],
  ["Final Exam [MATH112-12345]", "exam", true],
  ["Final", "exam", true],
  ["Final (Chapters 1-7)", "exam", true],
  ["Comprehensive Final", "exam", true],
  ["Math Final", "exam", true],
  ["Chapter 3 Test", "exam", true],
  ["Chapter 3 Exam", "exam", true],
  ["Unit 2 Test", "exam", true],
  ["Test 1", "exam", true],
  ["Test #3 (Ch. 5-6)", "exam", true],
  ["Take-Home Exam 2", "exam", true],
  ["Makeup Exam", "exam", true],
  ["Make-up Test", "exam", true],
  ["Exam2", "exam", true],
  ["Test2", "exam", true],
  ["Examen 1", "exam", true],
  ["Examen parcial", "exam", true],
  ["Examen final", "exam", true],
  ["Primer parcial", "exam", true],
  ["Parcial 2", "exam", true],
  ["2do Parcial", "exam", true],
  ["Segundo parcial de matemáticas", "exam", true],
  ["Prueba 3", "exam", true],
  ["Prueba de unidad", "exam", true],
  ["Prueba escrita", "exam", true],
  ["Evaluación 2", "exam", true],
  ["Evaluación final", "exam", true],
  ["Evaluación parcial", "exam", true],
  ["Exámenes finales", "exam", true],
  ["Test: Trig Identities", "exam", true],
  ["Oral Exam", "exam", true],
  ["Lab Practical Exam", "exam", true],
  ["Certamen 1", "exam", true],
  ["Recuperación del examen", "exam", true],
  ["Retake Test 2", "exam", true],
  ["Exam Day", "exam", true],
  ["Exam 2 tomorrow!", "exam", true],
  ["Reminder: Midterm Exam on Friday", "exam", true],
  ["Exam 2 - Room 204", "exam", true],
  ["Exam 3 (covers review of chapters 1-3)", "exam", true],
  ["Midterm Exam 1 (Chapters 1-4)", "exam", true],
  ["Test 2 Chapter 3 and 4", "exam", true],
  ["ENG1101 Midterm", "exam", true],
  ["Parcial de Cálculo", "exam", true],
  ["Test", "exam", true],
  ["Exam", "exam", true],
  ["Prueba", "exam", true],
  ["Parcial", "exam", true],
  ["Examen sorpresa", "exam", true],
  ["Examen oral", "exam", true],
  ["Examen extraordinario", "exam", true],
  ["Examen de admisión", "exam", true],
  ["Evaluación continua", "exam", true],
  ["Entrance Exam", "exam", true],
  ["Placement Test", "exam", true],
  ["MATH112 Final", "exam", true],
  ["Final: Ch 1-9", "exam", true],
  ["Examen de recuperación", "exam", true],
  ["Chapter 5 Test - Trigonometric Functions", "exam", true],
  ["Exam 2 [MATH112-12345]", "exam", true],
  ["Examen Final de Cálculo", "exam", true],
  ["Final Cumulative Exam", "exam", true],
  ["TEST 1 - Ch. 1,2", "exam", true],
  ["The Final", "exam", true],
  ["Final Examination", "exam", true],
]

const quizzes: Case[] = [
  ["Quiz 1", "quiz", true],
  ["Quiz #4", "quiz", true],
  ["Chapter 3 Quiz", "quiz", true],
  ["Pop Quiz", "quiz", true],
  ["Reading Quiz 5", "quiz", true],
  ["Weekly Quiz", "quiz", true],
  ["Quiz: Sections 3.1-3.3", "quiz", true],
  ["Quiz 2 [MATH112-12345]", "quiz", true],
  ["Prueba corta 2", "quiz", true],
  ["Quiz2", "quiz", true],
  ["Syllabus Quiz", "quiz", true],
  ["Quiz", "quiz", true],
  ["Quiz de Álgebra", "quiz", true],
  ["Chapter 4 Assessment", "quiz", true],
  ["Module 3 Assessment", "quiz", true],
  ["Quizzes Week 4", "quiz", true],
  ["Quiz sorpresa", "quiz", true],
]

const practice: Case[] = [
  ["Practice Quiz 3", "quiz", false],
  ["Practice Exam", "quiz", false],
  ["Sample Midterm", "quiz", false],
  ["Mock Exam 1", "quiz", false],
  ["Practice Test #2", "quiz", false],
  ["Exam 2 Practice", "quiz", false],
  ["Examen de práctica", "quiz", false],
  ["Simulacro de examen", "quiz", false],
  ["Diagnostic Test", "quiz", false],
  ["Pre-test", "quiz", false],
  ["Ungraded Practice Quiz", "quiz", false],
  ["Quiz Practice", "quiz", false],
  ["Self-test", "quiz", false],
  ["Examen de repaso", "quiz", false],
  ["Prueba diagnóstica", "quiz", false],
  ["Post-Test", "quiz", false],
]

const negated: Case[] = [
  ["Exam 2 Review", "other", false],
  ["Review for Exam 2", "other", false],
  ["Midterm Review Session", "other", false],
  ["Final Exam Study Guide", "other", false],
  ["Study Guide for Midterm", "other", false],
  ["Exam Prep Workshop", "other", false],
  ["Quiz Review", "other", false],
  ["Exam Schedule", "other", false],
  ["Final Exam Schedule", "other", false],
  ["Finals Week", "other", false],
  ["Exam Week", "other", false],
  ["Midterm Grades Due", "other", false],
  ["Exam Results Posted", "other", false],
  ["Test Corrections", "other", false],
  ["Exam Policy", "other", false],
  ["Test Accommodations Form", "other", false],
  ["Repaso para el examen", "other", false],
  ["Repaso del parcial", "other", false],
  ["Guía de estudio - Examen final", "other", false],
  ["Horario de exámenes", "other", false],
  ["Semana de exámenes", "other", false],
  ["Resultados del examen", "other", false],
  ["Calificaciones del parcial", "other", false],
  ["Exam Review Assignment", "assignment", false],
  ["Practice Problems for Exam 2", "assignment", false],
  ["Study for Midterm", "other", false],
  ["Midterm Project", "assignment", false],
  ["Midterm Project Submission", "assignment", false],
  ["Midterm Paper Due", "assignment", false],
  ["Exam 2 Corrections", "other", false],
  ["How to Prepare for Exams", "other", false],
  ["Test-taking strategies", "other", false],
  ["No Quiz Today", "other", false],
  ["CANCELLED: Chapter 3 Exam", "other", false],
  ["Exam 3 cancelled", "other", false],
  ["Midterm Evaluation Survey", "other", false],
  ["Exam Wrapper", "other", false],
  ["Exam Reflection", "assignment", false],
  ["Test Retake Request", "other", false],
  ["Make-up Exam Request Form", "other", false],
  ["Exam Proctor Sign-up", "other", false],
  ["Final Review", "other", false],
  ["Final Exam Review", "other", false],
  ["Midterm 2 Study Guide", "other", false],
  ["Answer Key for Exam 2", "other", false],
  ["Notas del parcial", "other", false],
]

const falsePositives: Case[] = [
  ["Final Project Submission", "assignment", false],
  ["Final Paper", "assignment", false],
  ["Final Grades Due", "other", false],
  ["Final Presentation", "assignment", false],
  ["Final Draft Due", "other", false],
  ["Final Day to Withdraw", "other", false],
  ["Final Thoughts", "other", false],
  ["Finals Week Schedule", "other", false],
  ["Contest", "other", false],
  ["Latest news", "other", false],
  ["Protest March", "other", false],
  ["Testing Center Hours", "other", false],
  ["Examine the Primary Sources", "other", false],
  ["Example Problems", "assignment", false],
  ["COVID Test Appointment", "other", false],
  ["COVID-19 Test", "other", false],
  ["Blood Test", "other", false],
  ["Eye Exam", "other", false],
  ["Dental Exam", "other", false],
  ["Prueba de concepto", "other", false],
  ["Pago parcial de matrícula", "other", false],
  ["Entrega parcial del proyecto", "assignment", false],
  ["Evaluación del curso", "other", false],
  ["Evaluación docente", "other", false],
  ["Pub Quiz Night", "other", false],
  ["Quiz Night", "other", false],
  ["Test Drive", "other", false],
  ["Beta Test", "other", false],
  ["Course Evaluation", "other", false],
  ["Self-Assessment", "other", false],
  ["Peer Assessment 2", "other", false],
  ["Needs Assessment Paper", "assignment", false],
  ["Quizlet study set", "other", false],
  ["Greatest Hits", "other", false],
  ["Attestation letter", "other", false],
  ["Contestants", "other", false],
]

const assignmentsAndOthers: Case[] = [
  ["Homework 3", "assignment", false],
  ["HW4 due", "assignment", false],
  ["Tarea 5", "assignment", false],
  ["Lab Report 2", "assignment", false],
  ["Essay Draft", "assignment", false],
  ["Discussion: Week 3", "assignment", false],
  ["Team Meeting", "other", false],
  ["Office Hours", "other", false],
  ["Lunch with Maria", "other", false],
  ["", "other", false],
  ["   ", "other", false],
  ["Problem Set 4", "assignment", false],
  ["Proyecto final", "assignment", false],
  ["Entrega final del proyecto", "assignment", false],
  ["Trabajo práctico 2", "assignment", false],
]

const secondBatch: Case[] = [
  ["Exam 1: Chapters 1-3", "exam", true],
  ["Test 3 – Sections 5.1-5.4", "exam", true],
  ["Quiz 5.1-5.3", "quiz", true],
  ["Online Quiz #2", "quiz", true],
  ["Midterm Exam - Take Home", "exam", true],
  ["Proctored Final Exam", "exam", true],
  ["Final Exam (In person)", "exam", true],
  ["Final Exam - Honorlock", "exam", true],
  ["Midterm Exam (Respondus LockDown Browser)", "exam", true],
  ["Exam 2 Makeup", "exam", true],
  ["Test 1 Retake", "exam", true],
  ["Quiz: Lecture 3", "quiz", true],
  ["Extra Credit Quiz", "quiz", true],
  ["Quiz Corrections", "other", false],
  ["Exam 1 Grade Appeal", "other", false],
  ["Review Worksheet for Test 2", "assignment", false],
  ["Extra Practice for Exam 2", "other", false],
  ["Exam 2 Practice Problems", "assignment", false],
  ["Examen 2 - Capítulos 3 y 4", "exam", true],
  ["Primer examen parcial", "exam", true],
  ["Examen final presencial", "exam", true],
  ["Prueba de matemáticas", "exam", true],
  ["Prueba de Cálculo I", "exam", true],
  ["Quiz 3 de Física", "quiz", true],
  ["Evaluación del tema 3", "exam", true],
  ["Evaluación de desempeño", "other", false],
  ["Revisión del examen", "other", false],
  ["Examen: Sala 301", "exam", true],
  ["Parcial 1 (Cap. 1-4)", "exam", true],
  ["Parcial de la unidad 2", "exam", true],
  ["Tarea previa al examen", "assignment", false],
  ["Math 101 Midterm", "exam", true],
  ["Chem Final @ Room 101", "exam", true],
  ["Calc 2 Final 8am", "exam", true],
  ["ENG 101 - Midterm", "exam", true],
  ["BIO final exam", "exam", true],
  ["Study for Calc Final", "other", false],
  ["Calc final review", "other", false],
  ["Exam!!!", "exam", true],
  ["📝 Quiz 4", "quiz", true],
  ["midterm :(", "exam", true],
  ["Physics 2 midterm", "exam", true],
  ["PHY2048 Exam 3", "exam", true],
  ["Test day!", "exam", true],
  ["Quiz bowl practice", "other", false],
  ["Book club", "other", false],
  ["Discussion 5: Test Anxiety", "assignment", false],
  ["Chapter 3 Test Corrections (optional)", "other", false],
  ["Exam 1 Wrapper", "other", false],
  ["Midterm Exam Info", "other", false],
  ["Exam Information Session", "other", false],
  ["Quiz on Chapter 3", "quiz", true],
  ["Midterm exam - Chapter 1 to 4 (50 questions)", "exam", true],
  ["Mini Quiz", "quiz", true],
  ["Pop Quiz!!", "quiz", true],
  ["Exit Ticket", "other", false],
  ["Attendance", "other", false],
  ["Quizz 1", "quiz", true],
  ["Test de vocabulario", "exam", true],
  ["Test 1 de Biología", "exam", true],
  ["Prueba de nivel", "exam", true],
  ["Pruebas parciales", "exam", true],
  ["Examen de la unidad 3", "exam", true],
  ["Evaluación diagnóstica", "quiz", false],
  ["Final exams week", "other", false],
  ["Pre-Calculus Exam", "exam", true],
  ["Pre-Algebra Quiz 2", "quiz", true],
  ["Pre-Exam Survey", "other", false],
  ["Post-exam reflection", "assignment", false],
  ["Trig Exam", "exam", true],
  ["Trigonometry Test 2", "exam", true],
  ["Exam #2: Circle unit", "exam", true],
  ["Examen #2 (Círculo unidad)", "exam", true],
  ["Mid-Term Test", "exam", true],
  ["Pretest: Algebra", "quiz", false],
  ["Final Exam Make-Up", "exam", true],
  ["Test Bank Access", "other", false],
  ["Midterm Grades", "other", false],
  ["Midterm Evaluation", "other", false],
  ["Syllabus Quiz (Honor Code)", "quiz", true],
]

const trigCourse: Case[] = [
  ["Exam 2 (Ch. 3-4)", "exam", true],
  ["Test 2", "exam", true],
  ["Quiz 3.1-3.3", "quiz", true],
  ["Homework 3.2", "assignment", false],
  ["MyLab Homework: Section 3.1", "assignment", false],
  ["Chapter 3 Test", "exam", true],
  ["Final Exam", "exam", true],
  ["Syllabus Quiz", "quiz", true],
  ["Practice Test (not graded)", "quiz", false],
  ["Test 2 Review", "other", false],
  ["Review Test 2", "other", false],
  ["Lockdown Browser Practice Quiz", "quiz", false],
  ["Online Test 1", "exam", true],
  ["Test #1 (Chapter 1-2)", "exam", true],
  ["Test 1 – Take Home", "exam", true],
  ["EXAM 2 - TURN IN", "exam", true],
  ["Exam 2 Submission", "exam", true],
  ["Exam Corrections", "other", false],
  ["Exam 2 (Honorlock)", "exam", true],
  ["Chapter 5 Test (Makeup)", "exam", true],
  ["Retest", "exam", true],
  ["Retest Chapter 4", "exam", true],
  ["ALEKS Placement Assessment", "quiz", true],
  ["Entrance Assessment", "quiz", true],
  ["Pearson MyLab: Unit Circle Practice", "other", false],
  ["Extra Credit: Graphing Project", "assignment", false],
  ["Attendance", "other", false],
  ["Test Taking Strategies Workshop", "other", false],
  ["Lab practical", "exam", true],
  ["Skills practical", "exam", true],
  ["Online Proctored Test - Honorlock Setup", "other", false],
  ["Practical Applications of Trig", "other", false],
  ["Trig Identities Cheat Sheet", "other", false],
  ["Calculator Policy", "other", false],
]
function check(cases: Case[]): void {
  for (const [title, kind, isExam] of cases) {
    const r = ExamDetector.classify(title, null)
    expect(r.kind, `«${title}»: kind`).toBe(kind)
    expect(r.isExam, `«${title}»: isExam`).toBe(isExam)
  }
}

describe('ExamDetector · tablas', () => {
  it('exámenes reales (es/en)', () => check(exams))
  it('quizzes y pruebas cortas', () => check(quizzes))
  it('prácticas y simulacros: quiz que no cuenta como examen', () => check(practice))
  it('repasos, guías, calendarios y materiales de apoyo', () => check(negated))
  it('falsos positivos', () => check(falsePositives))
  it('tareas y otros eventos', () => check(assignmentsAndOthers))
  it('segundo lote de títulos reales y adversarios', () => check(secondBatch))
  it('un curso de Trigonometría en Canvas', () => check(trigCourse))
})

describe('ExamDetector · contrato y normalización', () => {
  it('ejemplos del contrato', () => {
    for (const t of ['examen', 'parcial', 'prueba', 'test', 'quiz', 'midterm', 'final', 'exam #2', 'chapter test', 'evaluación']) expect(ExamDetector.classify(t, null).isExam, t).toBe(true)
    expect(ExamDetector.classify('final project submission', null).isExam).toBe(false)
    expect(ExamDetector.classify('contest', null).isExam).toBe(false)
    expect(ExamDetector.classify('Final Project Submission').kind).toBe('assignment')
    expect(ExamDetector.classify('Contest').kind).toBe('other')
  })

  it('la descripción es opcional', () => {
    expect(ExamDetector.classify('Exam 1').kind).toBe('exam')
    expect(ExamDetector.classify('Exam 1', null).kind).toBe('exam')
    expect(ExamDetector.classify('Exam 1', '').kind).toBe('exam')
  })

  it('mayúsculas y tildes no importan', () => {
    for (const t of ['EXAMEN FINAL', 'examen final', 'ExAmEn FiNaL', 'Exámen Final', 'Evaluacion Final', 'EVALUACIÓN FINAL']) expect(ExamDetector.classify(t).kind, t).toBe('exam')
  })

  it('Unicode descompuesto', () => {
    expect(ExamDetector.classify('Exámen 2').kind).toBe('exam')
    expect(ExamDetector.classify('Evaluación final').kind).toBe('exam')
  })

  it('el corchete del curso de Canvas se ignora', () => {
    expect(ExamDetector.classify('Examen 2 [MATH112-12345]').kind).toBe('exam')
    expect(ExamDetector.classify('Homework 5 [MATH112-12345]').kind).toBe('assignment')
    expect(ExamDetector.classify('Exam 2 [Practice]').isExam).toBe(false)
    expect(ExamDetector.classify('[Quiz] Capítulo 3').kind).toBe('quiz')
  })

  it('tokenize separa letras y cifras', () => {
    expect(tokenize('Exam2')).toEqual(['exam', '2'])
    expect(tokenize('Mid-term Exam')).toEqual(['midterm', 'exam'])
    expect(tokenize('Chem Final @ Room 101')).toEqual(['chem', 'final', 'at', 'room', '101'])
    expect(tokenize('Évaluation FINALE!')).toEqual(['evaluation', 'finale'])
    expect(tokenize('   ')).toEqual([])
  })
})

describe('ExamDetector · descripción como pista secundaria', () => {
  it('se usa si el título no dice nada', () => {
    expect(ExamDetector.classify('Unit 4', 'This exam covers chapters 3-4. You have 90 minutes.').kind).toBe('exam')
    expect(ExamDetector.classify('Unit 4', 'This exam covers chapters 3-4.').isExam).toBe(true)
    expect(ExamDetector.classify('Unidad 4', 'Este examen cubre los capítulos 3 y 4.').kind).toBe('exam')
    expect(ExamDetector.classify('Week 3', 'The quiz opens Monday and closes Friday.').kind).toBe('quiz')
  })

  it('no pisa al título ni salta con menciones', () => {
    expect(ExamDetector.classify('Homework 3', 'This exam covers chapters').kind).toBe('assignment')
    expect(ExamDetector.classify('Unit 4', 'Homework due before the exam. Complete problems 1-10.').isExam).toBe(false)
    expect(ExamDetector.classify('Unit 4', 'Review for the exam on Friday.').isExam).toBe(false)
    expect(ExamDetector.classify('Unit 4', 'Study guide: this exam is hard').isExam).toBe(false)
    expect(ExamDetector.classify('Unit 4', 'This practice exam covers chapters 3-4.').isExam).toBe(false)
    expect(ExamDetector.classify('Unit 4', 'Submit your answers. The exam is next week.').isExam).toBe(false)
    expect(ExamDetector.classify('Exam 1 Review', 'This exam covers chapters').isExam).toBe(false)
  })

  it('solo mira el principio', () => {
    expect(ExamDetector.classify('Unit 4', 'Texto de relleno. '.repeat(100) + 'This exam covers everything.').isExam).toBe(false)
  })

  it('entradas vacías y hostiles', () => {
    expect(ExamDetector.classify('').kind).toBe('other')
    expect(ExamDetector.classify('📝📚🎓').kind).toBe('other')
    expect(ExamDetector.classify('exam '.repeat(20_000)).kind).toBe('exam')
    expect(ExamDetector.classify('x'.repeat(200_000)).kind).toBe('other')
    expect(ExamDetector.classify('\u0000\u0001exam\u0002').kind).toBe('exam')
    expect(ExamDetector.classify('Exam\nReview').isExam).toBe(false)
  })

  it('analyze dice si vio alguna palabra de evaluación', () => {
    expect(ExamDetector.analyze('Quiz Review').matched).toBe(true)
    expect(ExamDetector.analyze('Quiz Review').isExam).toBe(false)
    expect(ExamDetector.analyze('Chapter 3').matched).toBe(false)
    expect(ExamDetector.analyze('Final').matched).toBe(true)
    expect(ExamDetector.analyze('Homework 2').matched).toBe(false)
  })

  it('diez mil títulos, rápido', () => {
    const titles = ['Exam 2 [MATH112-12345]', 'Review for the midterm', 'Homework 4', 'Office hours', 'Quiz 3 - Chapter 5', 'Final Project Submission']
    const t0 = Date.now()
    let n = 0
    for (let i = 0; i < 10_000; i++) if (ExamDetector.classify(titles[i % titles.length]).isExam) n++
    expect(n).toBe(3333)
    expect(Date.now() - t0).toBeLessThan(5000)
  })

  it('una discusión sobre el parcial no es el parcial', () => {
    for (const t of ['Discussion 7: My Midterm Exam Success Plan', 'Reflection: after the final exam', 'Survey about the quiz format', 'Foro: dudas del examen parcial']) {
      const r = ExamDetector.classify(t)
      expect(r.isExam, t).toBe(false)
      expect(r.kind, t).toBe('assignment')
    }
    expect(ExamDetector.classify('Exam #2').isExam).toBe(true)
    expect(ExamDetector.classify('Chemical Reactions Quiz').isExam).toBe(true)
    expect(ExamDetector.classify('Midterm Exam (Ch 5-7)').isExam).toBe(true)
  })
})

describe('ExamDetector · otros idiomas y robustez', () => {
  it('exámenes en los 12 idiomas de la app (SEC-16)', () => {
    for (const t of ['Klausur Lineare Algebra', 'Prova 2 de Cálculo', 'Esame di Fisica', 'Экзамен по химии', '期中考试', '期末試験', '중간고사', 'Examen partiel de chimie',
      'Prüfung Mathematik', 'امتحان الكيمياء', 'रसायन परीक्षा', 'Contrôle de physique']) expect(ExamDetector.classify(t).isExam, t).toBe(true)
    expect(ExamDetector.classify('小テスト 3').kind).toBe('quiz')
    expect(ExamDetector.classify('퀴즈 2').kind).toBe('quiz')
    for (const t of ['Revisão para a prova 2', 'Wiederholung Klausur', "Ripasso per l'esame", 'Подготовка к экзамену', '期中考试复习', '模拟考试', 'Simulado da prova',
      'Probeklausur', 'Ergebnisse der Klausur', 'Examen blanc']) expect(ExamDetector.classify(t).isExam, t).toBe(false)
    expect(ExamDetector.classify('Clase de química').isExam).toBe(false)
  })

  it('ensaladas de palabras: solo hay examen si el tipo es examen o quiz', () => {
    const rng = new LCG(11)
    const words = ['exam', 'test', 'quiz', 'final', 'review', 'practice', 'midterm', 'project', 'homework', 'prueba', 'parcial', 'examen', 'repaso', '2', '#', 'the', 'de', 'la', 'covid', '[MATH112-1]', '💥', 'Ünïcode', '']
    for (let n = 0; n < 2000; n++) {
      const count = rng.below(12)
      const parts = Array.from({ length: count }, () => words[rng.below(words.length)])
      const title = parts.join(rng.below(2) === 0 ? ' ' : '-')
      const r = ExamDetector.classify(title, rng.below(3) === 0 ? title : null)
      if (r.isExam) expect(r.kind === 'exam' || r.kind === 'quiz', title).toBe(true)
    }
  })
})
