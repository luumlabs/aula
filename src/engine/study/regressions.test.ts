// Regresiones de la revisión de corrección frente a Swift: apartados «con IA», claves como «constructor» o «__proto__»,
// huellas iguales a las de la app Swift, ids estables al releer y duración activa del simulacro.
import { describe, expect, it } from 'vitest'
import {
  decodeExercise, decodeProgress, decodeSkill, emptyProgress, makeExercise, makePack, makeSkill, makeSkillRef, ownValue,
  type Answer, type ExamRun, type Exercise
} from '@shared/schema'
import { canonicalInput, decodeAnswerInput, grade, Input } from '@engine/grading'
import { ContentValidator } from '@engine/content'
import { text, tryIt } from './testutil'
import { fingerprint, LearningController } from './learning'
import { PracticeQueue } from './practice'
import { Recorder } from './recorder'
import { ExamBuilder } from './exam'
import { canonicalJSON, fnv1a64, skillMap, swiftJSONNumber } from './util'
import { numeric } from './testutil'

const NOW = new Date(1_900_000_000_000)

describe('apartados corregidos con IA', () => {
  const multi: Answer = {
    kind: 'multi', parts: [
      { label: 'a', prompt: [text('2 + 2', 'pa')], answer: numeric('4'), points: 1, hints: [] },
      { label: 'b', prompt: [text('¿Por qué?', 'pb')], answer: { kind: 'short', accepted: ['porque sí'], keywords: [], typoTolerance: true, aiGrade: true }, points: 1, hints: [] }
    ]
  }
  const e = makeExercise({ id: 'm1', skill: 's', prompt: [text('Responde.', 'p')], answer: multi })

  it('como en Swift, el ejercicio por apartados no queda «pendiente de revisión» aunque una parte lo esté', () => {
    const r = grade(e, Input.parts([Input.text('4'), Input.text('otra cosa')]))
    expect(r.parts[1].needsReview).toBe(true)
    expect(r.needsReview).toBe(false)
    expect(r.needsAI).toBe(false)
    expect(r.status).toBe('partial')
  })

  it('y la lección guiada lo cuenta (antes se descartaba y el intento nunca se apuntaba)', () => {
    const s = makeSkill({ id: 's', title: 'S', exercises: [e], lesson: [text('# Sumas\nDos y dos.', 'c'), tryIt(['m1'], 't')] })
    const c = LearningController.concepts(s)[0]
    const q = LearningController.acknowledgeExplanation(c, s, undefined)
    expect(q.exercise?.id).toBe('m1')
    const r = grade(e, Input.parts([Input.text('4'), Input.text('otra cosa')]))
    const after = LearningController.recordCheck(c, s, q.exercise!, r, { hints: 0, revealed: false }, q.progress)
    expect(after.phase).toBe('reteach')
    expect(after.progress.learning[c.id]?.attemptedChecks.length).toBe(1)
  })
})

describe('claves que coinciden con propiedades de Object', () => {
  const lefts = ['constructor', 'toString', 'push', '__proto__', 'hasOwnProperty']
  const matching: Answer = { kind: 'matching', pairs: lefts.map((l, i) => ({ left: l, right: `r${i}` })), extraRights: [] }
  const e = makeExercise({ id: 'mt', skill: 's', prompt: [text('Empareja.', 'p')], answer: matching })

  it('la clave se acepta a sí misma y el validador no protesta', () => {
    const key = canonicalInput(matching)!
    expect(key.kind === 'matching' && Object.keys(key.pairs).sort()).toEqual([...lefts].sort())
    expect(grade(e, key).status).toBe('correct')
    const issues = ContentValidator.withMath().checkExercise(e, 'e')
    expect(issues.filter((i) => i.message.includes('no se acepta a sí misma'))).toEqual([])
  })

  it('una selección vacía no encuentra lo heredado ni enseña código nativo', () => {
    const r = grade(e, Input.matching({}))
    expect(r.credit).toBe(0)
    expect(r.feedback.map((f) => f.markdown).join(' ')).not.toMatch(/native code|function/)
  })

  it('«__proto__» sobrevive a la lectura de la respuesta y del progreso', () => {
    const decoded = decodeAnswerInput(JSON.parse('{"kind":"matching","pairs":{"__proto__":"r3","constructor":"r0"}}'))
    expect(decoded?.kind === 'matching' && Object.hasOwn(decoded.pairs, '__proto__')).toBe(true)
    expect(decoded?.kind === 'matching' && decoded.pairs.__proto__).toBe('r3')
    const p = decodeProgress(JSON.parse('{"skills":{"__proto__":{"alpha":3,"beta":1,"attempts":2},"constructor":{"alpha":2,"beta":1,"attempts":1}}}'))
    expect(Object.keys(p.skills).sort()).toEqual(['__proto__', 'constructor'])
    expect(Object.hasOwn(p.skills, '__proto__')).toBe(true)
  })

  it('habilidades llamadas «constructor» o que no existen («toString») no rompen el motor', () => {
    const ex = (id: string, skill: string): Exercise => makeExercise({ id, skill, prompt: [text('?', `${id}-p`)], answer: { kind: 'truefalse', value: true, explainWhy: false } })
    const s = makeSkill({ id: 'constructor', title: 'C', exercises: [ex('c1', 'constructor'), ex('c2', 'constructor')] })
    const skills = skillMap([s])
    expect(Object.getPrototypeOf(skills)).toBeNull()
    expect(skills.toString).toBeUndefined()
    const pack = makePack({ id: 'p', title: 'P', skills: [makeSkillRef({ id: 'constructor', title: 'C' }), makeSkillRef({ id: 'toString', title: 'T' })] })
    expect(PracticeQueue.build(pack, [s], emptyProgress(), { kind: 'skill', skillId: 'toString' }, { now: NOW, seed: 1 })).toEqual([])
    expect(PracticeQueue.build(pack, [s], emptyProgress(), { kind: 'skill', skillId: 'constructor' }, { now: NOW, seed: 1 }).length).toBe(2)
    const p = Recorder.record(emptyProgress(), ex('c1', 'constructor'), { credit: 1, mode: 'practice' }, NOW)
    expect(ownValue(p.skills, 'constructor')?.attempts).toBe(1)
    expect(Recorder.mastery(ownValue(p.skills, 'constructor'), NOW)).toBeGreaterThan(0.5)
    expect(PracticeQueue.weakest(pack, [s], emptyProgress(), NOW)).toEqual(['constructor'])
  })
})

describe('huellas como las de la app Swift', () => {
  it('los números se escriben como JSONEncoder de Swift', () => {
    expect(swiftJSONNumber(0.000001)).toBe('1e-06')
    expect(swiftJSONNumber(0.5)).toBe('0.5')
    expect(swiftJSONNumber(3)).toBe('3')
    expect(swiftJSONNumber(-0)).toBe('0')
    expect(swiftJSONNumber(1.5e20)).toBe('1.5e+20')
    expect(swiftJSONNumber(0.0001)).toBe('0.0001')
    expect(canonicalJSON({ b: [1, 0.25], a: 'm/s' })).toBe('{"a":"m\\/s","b":[1,0.25]}')
  })

  it('FNV-1a con la base de LearningController.hash (1469598103934665603)', () => {
    // valor de Swift: var value: UInt64 = 1469598103934665603; for byte in "a".utf8 { value = (value ^ UInt64(byte)) &* 1099511628211 }
    expect(fnv1a64('a')).toBe('44bd8ad473cd9906')
    expect(fnv1a64('')).toBe('14650fb0739d0383')
  })

  it('la huella de un ejercicio numérico con tolerancia es la que guardó Swift', () => {
    // canonical() de Swift (JSONEncoder .sortedKeys, sin ids ni metadatos, espacios reducidos) para este ejercicio:
    const swiftCanonical = '{"answer":{"absTol":1e-06,"alternatives":[],"angle":"radians","form":"any","kind":"numeric","relTol":0.25,"unit":"m\\/s","unitMode":"optional","value":"0.5"},"prompt":[{"md":"Halla x.","type":"text"}]}'
    const e = makeExercise({ id: 'x', skill: 's', prompt: [text('Halla  x.', 'p')], answer: numeric('0.5', { absTol: 0.000001, relTol: 0.25, unit: 'm/s' }) })
    expect(fnv1a64(swiftCanonical)).toBe('63032086783fbfce')
    expect(fingerprint(e)).toBe('63032086783fbfce')
  })
})

describe('ids estables al releer', () => {
  const raw = {
    id: 's', title: 'S',
    lesson: ['# Tema\nUna explicación.', { type: 'text', md: 'Otra.' }, { type: 'tryit', exerciseIDs: [] }],
    exercises: [{ skill: 's', prompt: ['¿Cuál?'], answer: { kind: 'choice', options: [{ md: 'A', correct: false }, { md: 'B', correct: true }] } }],
    cards: [{ front: 'f', back: 'b' }]
  }

  it('opciones, ejercicios, bloques y tarjetas sin id reciben siempre el mismo', () => {
    const a = decodeSkill(JSON.parse(JSON.stringify(raw)))
    const b = decodeSkill(JSON.parse(JSON.stringify(raw)))
    expect(a.lesson.map((x) => x.id)).toEqual(b.lesson.map((x) => x.id))
    expect(new Set(a.lesson.map((x) => x.id)).size).toBe(3)
    expect(a.exercises[0].id).toBe(b.exercises[0].id)
    expect(a.cards[0].id).toBe(b.cards[0].id)
    const opts = (x: typeof a): string[] => (x.exercises[0].answer.kind === 'choice' ? x.exercises[0].answer.options.map((o) => o.id) : [])
    expect(opts(a)).toEqual(['o0', 'o1'])
    expect(opts(b)).toEqual(opts(a))
    // lo elegido con la primera lectura se corrige bien con la segunda (lo que hace study.submitExam)
    expect(grade(b.exercises[0], Input.choice(['o1'])).status).toBe('correct')
    expect(LearningController.concepts(a).map((c) => c.id)).toEqual(LearningController.concepts(b).map((c) => c.id))
  })

  it('un ejercicio suelto también', () => {
    const one = { skill: 's', prompt: ['?'], answer: { kind: 'truefalse', value: true } }
    expect(decodeExercise(one)?.id).toBe(decodeExercise(JSON.parse(JSON.stringify(one)))?.id)
  })
})

describe('duración del simulacro', () => {
  const e = makeExercise({ id: 'e', skill: 's', prompt: [text('?', 'p')], answer: { kind: 'truefalse', value: true, explainWhy: false } })
  const run = (durationMinutes: number): ExamRun => ({
    id: 'x', startedAt: NOW.toISOString(), durationMinutes, currentIndex: 0, kind: 'mock', items: [{ exerciseID: 'e', skill: 's', points: 1, flagged: false, seconds: 0 }]
  })
  const later = new Date(NOW.getTime() + 3_600_000)

  it('se guarda el tiempo activo (como ExamModel.submit), no el de reloj', () => {
    expect(ExamBuilder.grade(run(0), { e }, { e: Input.bool(true) }, later, 300).result.durationSeconds).toBe(300)
    // con límite: el tope del motor (límite × 1,2)
    expect(ExamBuilder.grade(run(1), { e }, { e: Input.bool(true) }, later, 1000).result.durationSeconds).toBeCloseTo(72, 6)
    // sin el dato, como antes: desde que empezó
    expect(ExamBuilder.grade(run(0), { e }, { e: Input.bool(true) }, later).result.durationSeconds).toBeCloseTo(3600, 6)
    expect(ExamBuilder.grade(run(0), { e }, { e: Input.bool(true) }, later, Number.NaN).result.durationSeconds).toBeCloseTo(3600, 6)
  })
})
