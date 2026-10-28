// Corrección exacta de huecos y respuestas cortas (cursos de idiomas). Los casos son los del juez en el curso de español
// «The Spanish Transition to Democracy»: «murio» por «murió» tenía todo el crédito, «aprobaran» por «aprobaron» 0,97 y los
// errores de concordancia 0,9.
import { describe, expect, it } from 'vitest'
import { decodeExercise, encodeAnswer, decodeAnswer, type Exercise } from '@shared/schema'
import { courseGradeOptions, grade, Input, isLanguageCourse, nearMiss, type GradeOptions } from '@engine/grading'
import { gradeExam } from '@engine/study'
import { ContentNormalizer } from '@engine/content'

function ex(answer: unknown): Exercise {
  const e = decodeExercise({ id: 'e', skill: 's', prompt: ['p'], answer })
  if (!e) throw new Error('ejercicio ilegible')
  return e
}
const cloze = (accepted: string[][], extra: Record<string, unknown> = {}): Exercise =>
  ex({ kind: 'cloze', text: accepted.map((_, i) => `[[${i + 1}]]`).join(' '), blanks: accepted.map((a) => ({ accepted: a, ...extra })) })

const LANGUAGE: GradeOptions = { lang: 'es', exactText: true }
const PI_E1 = cloze([['murió'], ['nombró'], ['ganó']])
const PI_E6 = cloze([['redactaron'], ['aprobaron'], ['fueron'], ['hicieron']])
const PASIVA_E3 = cloze([['fue aprobada'], ['fueron asesinados'], ['fue nombrado'], ['fueron ganadas']])
const PASIVA_E4 = cloze([['aprobaron'], ['ratificó', 'ratifico'], ['ganó', 'gano'], ['asaltó', 'asalto']])

describe('huecos exactos en un curso de idiomas', () => {
  it('las tildes cuentan: «murio/nombro/gano» ya no tienen crédito', () => {
    const r = grade(PI_E1, Input.blanks(['murio', 'nombro', 'gano']), LANGUAGE)
    expect(r.status).toBe('incorrect')
    expect(r.credit).toBe(0)
    expect(r.feedback.map((f) => f.markdown).join(' ')).toMatch(/tildes/)
    expect(r.feedback[0].markdown).toContain('Hueco 1')
    expect(r.feedback[0].markdown).toContain('«murio»')
    expect(r.parts.every((p) => p.status === 'incorrect' && p.credit === 0)).toBe(true)
  })

  it('las mayúsculas no cuentan, pero el acento grave por el agudo sí', () => {
    expect(grade(PI_E1, Input.blanks(['murió', 'nombró', 'ganó']), LANGUAGE).status).toBe('correct')
    const r = grade(PI_E1, Input.blanks(['Murió', 'NOMBRÓ', 'ganò']), LANGUAGE)
    expect(r.parts.map((p) => p.status)).toEqual(['correct', 'correct', 'incorrect'])
    expect(r.credit).toBeCloseTo(2 / 3)
  })

  it('la forma verbal y la concordancia cuentan: 0 en el hueco, con el aviso', () => {
    const r = grade(PASIVA_E4, Input.blanks(['aprobaran', 'ratificó', 'ganó', 'asaltó']), LANGUAGE)
    expect(r.parts[0].credit).toBe(0)
    expect(r.credit).toBeCloseTo(0.75)
    expect(r.feedback[0].markdown).toMatch(/forma exacta de «aprobaran»/)
    const conc = grade(PASIVA_E3, Input.blanks(['fue aprobado', 'fueron asesinadas', 'fue nombrada', 'fueron ganados']), LANGUAGE)
    expect(conc.credit).toBe(0)
    expect(conc.status).toBe('incorrect')
    expect(grade(PASIVA_E3, Input.blanks(['fue aprobada', 'fueron asesinados', 'fue nombrado', 'fueron ganadas']), LANGUAGE).status).toBe('correct')
    const sub = grade(PI_E6, Input.blanks(['redactaran', 'aprobaran', 'fueran', 'hicieran']), LANGUAGE)
    expect(sub.credit).toBe(0)
    expect(sub.feedback).toHaveLength(3)
  })

  it('las variantes que el autor aceptó (sin tilde) siguen valiendo', () => {
    expect(grade(PASIVA_E4, Input.blanks(['aprobaron', 'ratifico', 'gano', 'asalto']), LANGUAGE).status).toBe('correct')
  })

  it('los artículos cuentan («el mano» no es «la mano»)', () => {
    const e = cloze([['la mano']])
    const r = grade(e, Input.blanks(['el mano']), LANGUAGE)
    expect(r.credit).toBe(0)
    expect(r.feedback[0].markdown).toMatch(/artículos/)
    expect(grade(e, Input.blanks(['La mano.']), LANGUAGE).status).toBe('correct')
  })

  it('una respuesta lejana es un error normal, sin aviso de «casi»', () => {
    const r = grade(PI_E1, Input.blanks(['moría', 'nombraba', 'ganaba']), LANGUAGE)
    expect(r.credit).toBe(0)
    expect(r.feedback).toEqual([])
  })

  it('el aviso no da la respuesta', () => {
    const r = grade(PI_E1, Input.blanks(['murio', 'nombró', 'ganó']), { lang: 'en', exactText: true })
    expect(r.feedback[0].markdown).toBe('Blank 1: Check the accents in “murio”: they count here.')
    expect(r.feedback[0].markdown).not.toContain('murió')
  })
})

describe('el ejercicio y el curso deciden', () => {
  it('fuera de un curso de idiomas, como siempre (sin tildes y con erratas leves)', () => {
    expect(grade(PI_E1, Input.blanks(['murio', 'nombro', 'gano'])).status).toBe('correct')
    expect(grade(PASIVA_E4, Input.blanks(['aprobaran', 'ratificó', 'ganó', 'asaltó'])).credit).toBeCloseTo(0.975)
  })

  it('«exact» en el hueco gana al curso (en los dos sentidos)', () => {
    const strict = cloze([['murió']], { exact: true })
    expect(grade(strict, Input.blanks(['murio'])).credit).toBe(0)
    const loose = cloze([['murió']], { exact: false })
    expect(grade(loose, Input.blanks(['murio']), LANGUAGE).status).toBe('correct')
  })

  it('respuesta corta: exacta en idiomas, con aviso; los errores típicos siguen ganando', () => {
    const e = ex({ kind: 'short', accepted: ['Se legalizó el PCE el 9 de abril de 1977'], typoTolerance: true })
    expect(grade(e, Input.text('se legalizo el pce el 9 de abril de 1977')).status).toBe('correct')
    const r = grade(e, Input.text('se legalizo el pce el 9 de abril de 1977'), LANGUAGE)
    expect(r.credit).toBe(0)
    expect(r.feedback[0].markdown).toMatch(/tildes de «legalizo»/)
    expect(grade(e, Input.text('El 9 de abril de 1977, se legalizó el PCE.'), LANGUAGE).status).not.toBe('correct')
    expect(grade(e, Input.text('Se legalizó el PCE el 9 de abril de 1977.'), LANGUAGE).status).toBe('correct')
    const w = decodeExercise({ id: 'w', skill: 's', prompt: ['p'], answer: { kind: 'short', accepted: ['ganó'] }, wrongs: [{ input: 'gano', why: '«gano» es presente (yo).' }] })!
    const rw = grade(w, Input.text('gano'), LANGUAGE)
    expect(rw.matchedWrong?.why).toBe('«gano» es presente (yo).')
    expect(rw.credit).toBe(0)
  })

  it('las palabras clave siguen dando crédito parcial en modo exacto', () => {
    const e = ex({ kind: 'short', accepted: [], keywords: ['Suárez', 'reforma'], exact: true })
    expect(grade(e, Input.text('Suárez')).credit).toBeCloseTo(0.5)
    expect(grade(e, Input.text('Suarez')).credit).toBe(0)
  })

  it('«exact» llega intacto desde lo que escribe la IA (normalizador de add_exercises)', () => {
    const raw = { prompt: 'Franco [[1]] (morir) en 1975.', answer: { kind: 'cloze', blanks: [{ accepted: ['murió'], exact: true }] }, level: 1 }
    const e = decodeExercise(ContentNormalizer.exercise(raw, 's', 'e1'))
    expect(e?.answer.kind === 'cloze' && e.answer.blanks[0].exact).toBe(true)
    const sh = decodeExercise(ContentNormalizer.exercise({ prompt: '¿Pasado de «ganar» (él)?', answer: { kind: 'short', accepted: ['ganó'], exact: 'true' }, level: 1 }, 's', 'e2'))
    expect(sh?.answer.kind === 'short' && sh.answer.exact).toBe(true)
  })

  it('«exact» se lee con tolerancia y se escribe como lo leyó', () => {
    const a = decodeAnswer({ kind: 'cloze', text: '[[1]] [[2]] [[3]]', blanks: [{ accepted: ['a'], exact: 'sí' }, { accepted: ['b'], strict: true }, { accepted: ['c'], exact: 'quizá' }] })
    if (a?.kind !== 'cloze') throw new Error('no es cloze')
    expect(a.blanks.map((b) => b.exact)).toEqual([true, true, undefined])
    const enc = encodeAnswer(a) as { blanks: Array<Record<string, unknown>> }
    expect(enc.blanks[0].exact).toBe(true)
    expect('exact' in enc.blanks[2]).toBe(false)
    const s = decodeAnswer({ kind: 'short', accepted: ['x'], exact: 1 })
    expect(s?.kind === 'short' && s.exact).toBe(true)
  })
})

describe('el curso', () => {
  it('es de idiomas por su clase de meta o, en los de antes, por el título y la asignatura', () => {
    expect(isLanguageCourse({ title: 'Inglés B2', subject: '' })).toBe(true)
    expect(isLanguageCourse({ title: 'The Spanish Transition to Democracy', subject: 'History' })).toBe(false)
    expect(isLanguageCourse({ title: 'The Spanish Transition to Democracy', subject: 'History', goalKind: 'language' })).toBe(true)
    expect(isLanguageCourse({ title: 'Inglés', subject: '', goalKind: 'subject' })).toBe(false)
    expect(courseGradeOptions({ title: 'Learn French', subject: '' }, 'en')).toEqual({ lang: 'en', exactText: true })
    expect(courseGradeOptions({ title: 'Capitales de Sudamérica', subject: '' })).toEqual({})
  })
})

describe('el simulacro', () => {
  it('corrige con la opción del curso', () => {
    const run = { id: 'r', startedAt: '2026-10-26T10:00:00.000Z', durationMinutes: 30, currentIndex: 0, kind: 'mock', items: [{ exerciseID: 'e', skill: 's', points: 1, flagged: false, seconds: 30 }] }
    const inputs = { e: Input.blanks(['murio', 'nombro', 'gano']) }
    const now = new Date('2026-10-26T10:30:00.000Z')
    expect(gradeExam(run, { e: PI_E1 }, inputs, now).grades.e.credit).toBe(1)
    expect(gradeExam(run, { e: PI_E1 }, inputs, now, { exactText: true }).grades.e.credit).toBe(0)
  })
})

describe('nearMiss', () => {
  it('distingue tildes, artículos y ortografía', () => {
    expect(nearMiss('murio', ['murió'])?.kind).toBe('accents')
    expect(nearMiss('libro', ['el libro'])?.kind).toBe('articles')
    expect(nearMiss('aprobado', ['aprobada'])?.kind).toBe('spelling')
    expect(nearMiss('ganaba', ['ganó'])).toBeUndefined()
    expect(nearMiss('gano', ['ganó'], ['gano'])).toBeUndefined()
  })
})
