// Pruebas del modelo de curso: ejercicios, respuestas, curso, habilidad y progreso (port de ModelCodingTests,
// HostileDecodingTests, DamagedProgressTests, LearningProgressTests, SelfPacedPackTests y AuditContentFixTests de
// la app Swift anterior: Tests/StudyModelTests).
import { describe, expect, it } from 'vitest'
import { parseJSON, stringifyJSON } from '@engine/base/json'
import { textBlock } from './blocks'
import {
  ANSWER_KINDS, answerForGrading, decodeAnswer, decodeExercise, encodeAnswer, encodeExercise, makeExercise, type Answer, type Exercise
} from './exercises'
import { makeFlashcard } from './cards'
import {
  decodeBlueprint, decodePack, decodeSkill, encodeBlueprint, encodePack, encodeSkill, makeExamBlueprint, makePack, makeSkill, makeSkillRef,
  orderedSkills, packHasExam, skillCounts
} from './pack'
import {
  decodeLearningConcept, decodeProgress, decodeStudySettings, emptyProgress, encodeLearningConcept, encodeProgress, examPercent, makeAttempt,
  makeLearningConcept, makeSkillProgress, MAX_ATTEMPTS, trimAttempts, LESSON_LEARNING_MODES
} from './progress'
import { applyCourseMetaPatch, parseCourseMetaPatch } from './library'

const rt = (v: unknown): unknown => parseJSON(stringifyJSON(v))
const j = (s: string): unknown => parseJSON(s)

describe('ejercicios', () => {
  it('lee con tolerancia lo que escribe la IA', () => {
    const e = decodeExercise(j(`{"id":"e1","skill":"s1","level":5,"prompt":"Resuelve $2x=6$","hints":"piensa en dividir",
      "answer":{"kind":"number","value":3},"solution":"x = 3","wrongs":[{"value":"12","explanation":"multiplicaste"}]}`))!
    expect(e.level).toBe(3) // se acota a 1…3
    expect(e.hints).toEqual(['piensa en dividir'])
    expect(e.answer.kind).toBe('numeric')
    expect(e.answer.kind === 'numeric' && e.answer.value).toBe('3')
    expect(e.wrongs[0]).toEqual({ input: '12', why: 'multiplicaste' })
    expect(e.prompt).toHaveLength(1)
    expect(e.solution).toHaveLength(1)
  })

  it('todos los tipos de respuesta sobreviven a un ciclo de guardado', () => {
    const answers = [
      '{"kind":"choice","options":[{"id":"a","md":"x","correct":true,"why":"porque"}],"multi":false}',
      '{"kind":"numeric","value":"3/4","unit":"m","unitMode":"required"}',
      '{"kind":"expression","expected":"2x+1","forbidden":["sqrt"]}',
      '{"kind":"equation","expected":"y=2x+1"}',
      '{"kind":"set","expected":["1","2"],"ordered":false}',
      '{"kind":"interval","expected":"(-inf, 3]"}',
      '{"kind":"point","expected":["1","2"]}',
      '{"kind":"short","accepted":["mitocondria"],"keywords":["energía|ATP"],"aiGrade":true}',
      '{"kind":"cloze","text":"La [[1]] produce [[2]]","blanks":[{"accepted":["célula"]},{"accepted":["ATP"]}]}',
      '{"kind":"ordering","items":["a","b","c"]}',
      '{"kind":"matching","pairs":[{"left":"H","right":"hidrógeno"}],"extraRights":["helio"]}',
      '{"kind":"truefalse","value":false,"explainWhy":true}',
      '{"kind":"label","asset":"cell.png","spots":[{"x":0.3,"y":0.4,"accepted":["núcleo"]}],"wordBank":["núcleo"]}',
      '{"kind":"open","modelAnswer":"…","rubric":[{"text":"menciona X","points":2}]}',
      '{"kind":"multi","parts":[{"label":"a","prompt":[{"type":"text","md":"p"}],"answer":{"kind":"numeric","value":"1"},"points":2}]}',
      '{"kind":"chem","mode":"number","expected":"0.250","sigFigs":3,"unit":"mol","tolerance":0.02}'
    ].map((s) => decodeAnswer(j(s))!)
    for (const a of answers) expect(decodeAnswer(rt(encodeAnswer(a))), a.kind).toEqual(a)
    expect(new Set(answers.map((a) => a.kind))).toEqual(new Set(ANSWER_KINDS))
  })

  it('un tipo de respuesta desconocido se conserva y se corrige como respuesta corta', () => {
    const a = decodeAnswer(j('{"kind":"hologram","accepted":["x"],"foo":[1,{"b":2}]}'))!
    expect(a.kind).toBe('unknown')
    expect(a.kind === 'unknown' && a.rawKind).toBe('hologram')
    expect(encodeAnswer(a)).toEqual({ kind: 'hologram', accepted: ['x'], foo: [1, { b: 2 }] })
    const g = answerForGrading(a)
    expect(g.kind).toBe('short')
    expect(g.kind === 'short' && g.accepted).toEqual(['x'])
    // y dentro de un ejercicio, ida y vuelta
    const e = decodeExercise(j('{"id":"e","prompt":"p","answer":{"kind":"hologram","foo":1}}'))!
    expect(encodeExercise(decodeExercise(rt(encodeExercise(e)))!).answer).toEqual({ kind: 'hologram', foo: 1 })
  })

  it('las partes anidadas sin fin se cortan en vez de desbordar', () => {
    let answer = '{"kind":"short","accepted":["x"]}'
    for (let i = 0; i < 160; i++) answer = `{"kind":"multi","parts":[{"label":"a","answer":${answer}}]}`
    const ex = decodeExercise(j(`{"id":"e","prompt":"p","answer":${answer}}`))!
    let a: Answer = ex.answer
    let n = 0
    while (a.kind === 'multi' && a.parts[0]) { n++; a = a.parts[0].answer }
    expect(n).toBeGreaterThan(5)
    expect(n).toBeLessThan(40) // se corta en ContentLimits.maxNesting
  })

  it('los números absurdos se acotan', () => {
    const ex = decodeExercise(j('{"id":"e","prompt":"p","points":1e308,"answer":{"kind":"numeric","value":"1/3","decimals":9223372036854775807}}'))!
    expect(ex.points).toBeLessThanOrEqual(1e6)
    expect(ex.answer.kind === 'numeric' && ex.answer.decimals).toBe(15)
    const open = decodeAnswer(j('{"kind":"open","modelAnswer":"m","rubric":[{"text":"t","points":1e300}]}'))!
    expect(open.kind === 'open' && open.rubric[0].points).toBe(1e6)
  })

  it('las semillas de las variantes conservan todas sus cifras', () => {
    const e = decodeExercise(j('{"id":"t#1","skill":"s","prompt":"p","answer":{"kind":"numeric","value":"1"},"templateID":"t","seed":18446744073709551615}'))!
    expect(e.seed).toBe('18446744073709551615')
    expect(stringifyJSON(encodeExercise(e), { pretty: false })).toContain('"seed":18446744073709551615')
  })
})

describe('curso y habilidad', () => {
  it('plantilla, habilidad y curso sobreviven a un ciclo de guardado', () => {
    const skill = decodeSkill(j(`{"id":"s1","title":"Ecuaciones","lesson":[{"type":"text","md":"hola"}],
      "exercises":[{"id":"e1","skill":"s1","prompt":[{"type":"text","md":"p"}],"answer":{"kind":"numeric","value":"1"}}],
      "templates":[{"id":"t1","skill":"s1","vars":[{"name":"a","kind":"int","min":2,"max":9,"exclude":[0]},{"name":"u","kind":"pick","values":["m","cm"]}],
        "constraints":["a != 5"],"prompt":"Resuelve \${{a}}x=6$","answer":{"kind":"numeric","value":"6/{{a}}"}}],
      "cards":[{"front":"f","back":"b"}],"decks":[{"title":"d","slides":[{"title":"t","blocks":["x"]}]}],
      "mistakes":[{"title":"t","wrong":"w","right":"r","why":"y"}],"updated":"2026-09-21T10:13:20.000Z"}`))
    expect(decodeSkill(rt(encodeSkill(skill)))).toEqual(skill)
    const pack = makePack({ id: 'p1', title: 'Álgebra', subject: 'Matemáticas', exam: { title: 'Parcial', date: '2027-01-15T08:00:00.000Z', durationMinutes: 60 } })
    pack.skills = [makeSkillRef({ id: 's1', unit: 'u1', title: 'Ecuaciones', counts: skillCounts(skill) })]
    pack.units = [{ id: 'u1', title: 'Unidad 1', skillIDs: ['s1'] }]
    pack.blueprint = makeExamBlueprint(60, 100, [{ title: 'A', skillIDs: ['s1'], count: 5, minLevel: 1, maxLevel: 3, pointsEach: 1 }])
    const back = decodePack(rt(encodePack(pack)))
    expect(back).toEqual(pack)
    expect(orderedSkills(back).map((s) => s.id)).toEqual(['s1'])
  })

  it('un archivo mínimo (o de una versión vieja) también se lee', () => {
    const p = decodePack(j('{"id":"x","title":"Solo título"}'))
    expect(p.language).toBe('es')
    expect(p.hue).toBe(0.6)
    expect(p.units).toEqual([])
    expect(decodeSkill(j('{"id":"x"}')).lesson).toHaveLength(0)
    expect(decodeSkill(j('{"id":"x"}')).title).toBe('x')
    expect(decodeSkill(j('{"id":"x"}')).status).toBe('draft')
    expect(decodeProgress(j('{}')).attempts).toHaveLength(0)
    expect(() => decodePack(j('[1,2]'))).toThrow()
  })

  it('un elemento dañado no borra toda la lista', () => {
    const skill = decodeSkill(j(`{"id":"s","title":"S",
      "lesson":[{"type":"text","md":"uno"}, 42, "dos (texto suelto)", null, {"type":"math","tex":"x"}],
      "exercises":[{"id":"e1","prompt":"p","answer":{"kind":"truefalse","value":true}}, "basura", {"id":"e2","prompt":"q","answer":{"kind":"short","accepted":["a", 3, true]}}],
      "cards":[17, {"front":"f","back":"b"}],
      "objectives":["a", 2]}`))
    expect(skill.lesson).toHaveLength(3)
    expect(skill.exercises.map((e) => e.id)).toEqual(['e1', 'e2'])
    const a = skill.exercises[1].answer
    expect(a.kind === 'short' && a.accepted).toEqual(['a', '3', 'true'])
    expect(skill.cards).toHaveLength(1)
    expect(skill.objectives).toEqual(['a', '2'])
  })

  it('los ids repetidos del curso se arreglan', () => {
    const pack = decodePack(j('{"id":"p","skills":[{"id":"a","title":"A"},{"id":"a","title":"A otra vez"}],"units":[{"id":"u","skillIDs":["a","a"]},{"id":"u"}]}'))
    expect(pack.skills.map((s) => s.title)).toEqual(['A'])
    expect(new Set(pack.units.map((u) => u.id)).size).toBe(2)
    expect(pack.units[0].skillIDs).toEqual(['a'])
  })

  it('los números absurdos del curso se acotan', () => {
    const pack = decodePack(j('{"id":"p","skills":[{"id":"a","weight":1e308,"minutes":9223372036854775807}],"blueprint":{"durationMinutes":9223372036854775807,"sections":[{"count":9223372036854775807,"pointsEach":-5}]}}'))
    expect(pack.skills[0].weight).toBe(1e6)
    expect(pack.skills[0].minutes).toBe(10_000)
    expect(pack.blueprint?.durationMinutes).toBe(10_000)
    expect(pack.blueprint?.sections[0].count).toBe(500)
    expect(pack.blueprint?.sections[0].pointsEach).toBe(0)
  })

  it('los ejercicios incrustados toman su habilidad al leerse', () => {
    const s = makeSkill({ id: 'vertice', title: 'Vértice' })
    s.lesson = [{ id: 'b1', type: 'tryit', exerciseIDs: [], inline: [makeExercise({ id: 'in1', skill: '', prompt: [textBlock('¿in1?')], answer: { kind: 'truefalse', value: true, explainWhy: false } })] }]
    const back = decodeSkill(rt(encodeSkill(s)))
    const t = back.lesson[0]
    expect(t.type === 'tryit' && t.inline[0].skill).toBe('vertice')
  })

  it('los iconos antiguos se traducen al leer el curso', () => {
    expect(decodePack(j('{"id":"t","title":"Trigonometría · Círculo unidad","subject":"Matemáticas (MATH112)","icon":"function","hue":0.58}')).icon).toBe('trigonometry')
    expect(decodePack(j('{"id":"x","title":"Química"}')).icon).toBe('chemistry') // sin icono: por el título
    expect(decodePack(j('{"id":"y","title":"Química","icon":"idea"}')).icon).toBe('idea') // el elegido no se cambia
  })
})

describe('cursos a su ritmo', () => {
  it('los cursos de antes tienen examen y selfPaced se guarda', () => {
    const old = decodePack(j('{"id":"a","title":"Física"}'))
    expect(old.selfPaced).toBeUndefined()
    expect(packHasExam(old)).toBe(true) // sin la marca se trata como con examen
    const p = makePack({ id: 'ia', title: 'IA desde cero', selfPaced: true })
    expect(packHasExam(p)).toBe(false)
    const back = decodePack(rt(encodePack(p)))
    expect(back.selfPaced).toBe(true)
    expect(packHasExam(back)).toBe(false)
    p.exam = { title: 'Final', date: '2027-01-15T08:00:00.000Z' }
    expect(packHasExam(p)).toBe(true) // con fecha vuelve a tener examen
  })

  it('la nota de corte del simulacro se guarda y un valor imposible se descarta', () => {
    const bp = makeExamBlueprint(42, 30, [], { passPercent: 0.7 })
    expect(decodeBlueprint(rt(encodeBlueprint(bp)))?.passPercent).toBe(0.7)
    expect(makeExamBlueprint(1, 1, [], { passPercent: 70 }).passPercent).toBeUndefined()
    expect(decodeBlueprint(j('{"sections":[],"passPercent":-1}'))?.passPercent).toBeUndefined()
    expect(decodeBlueprint(j('{"sections":[]}'))?.passPercent).toBeUndefined()
  })
})

describe('progreso', () => {
  it('ida y vuelta y recorte de intentos', () => {
    const t0 = '2026-09-21T10:13:20.000Z'
    const p = emptyProgress()
    p.skills.s1 = makeSkillProgress({ alpha: 3, beta: 2, attempts: 4, lessonDone: true })
    p.cards.c1 = { phase: 'review', due: t0, stability: 4.2, difficulty: 5, reps: 3, lapses: 0, step: 0 }
    p.attempts = Array.from({ length: MAX_ATTEMPTS + 50 }, (_, i) => makeAttempt({ exerciseID: `e${i}`, skill: 's1', date: t0, credit: 1 }))
    trimAttempts(p)
    expect(p.attempts).toHaveLength(MAX_ATTEMPTS)
    expect(p.attempts[0].exerciseID).toBe('e50')
    p.examRun = decodeProgress(j(`{"examRun":{"startedAt":"${t0}","durationMinutes":60,"items":[{"exerciseID":"e1","skill":"s1","answer":{"kind":"numeric","value":"3"}}]}}`)).examRun
    expect(decodeProgress(rt(encodeProgress(p)))).toEqual(p)
  })

  it('los contadores dañados se acotan', () => {
    const p = decodeProgress(j(`{"skills":{"a":{"lessonStep":-5,"attempts":9223372036854775807,"streak":-3}},
      "cards":{"c":{"reps":-1,"lapses":9223372036854775807,"step":-9}},
      "mistakes":[{"id":"m","stage":-3,"count":9223372036854775807}],
      "exams":[{"scorePoints":1e308,"totalPoints":1e-308,"durationSeconds":1e300,"items":[{"credit":7,"points":1e308}]}],
      "days":[{"day":"2026-01-01","minutes":1e300,"attempts":-4}],
      "examRun":{"durationMinutes":9223372036854775807,"currentIndex":-1,"items":[{"exerciseID":"e","points":1e308,"answer":${'['.repeat(400) + ']'.repeat(400)}}]},
      "xp":9223372036854775807}`))
    expect(p.skills.a.lessonStep).toBe(0)
    expect(p.skills.a.streak).toBe(0)
    expect(p.cards.c.reps).toBe(0)
    expect(p.mistakes[0].stage).toBe(0)
    const exam = p.exams[0]
    const pct = examPercent(exam)
    expect(Number.isFinite(pct) && pct >= 0 && pct <= 1).toBe(true)
    expect(exam.durationSeconds).toBeLessThanOrEqual(1e7)
    expect(exam.items[0].credit).toBe(1)
    expect(p.days[0].attempts).toBe(0)
    expect(p.examRun?.currentIndex).toBe(0)
    expect(p.examRun?.durationMinutes).toBe(10_000)
    expect(p.xp).toBeLessThan(Number.MAX_SAFE_INTEGER / 2)
    // y se puede volver a guardar (sin NaN ni infinitos)
    expect(stringifyJSON(encodeProgress(p))).not.toMatch(/NaN|Infinity/)
  })

  it('la nota de un simulacro siempre es finita', () => {
    expect(examPercent({ scorePoints: Infinity, totalPoints: Infinity })).toBe(0)
    expect(examPercent({ scorePoints: 5, totalPoints: 0 })).toBe(0)
    expect(examPercent({ scorePoints: 1e308, totalPoints: 1e-308 })).toBe(1)
    expect(examPercent({ scorePoints: 3, totalPoints: 4 })).toBe(0.75)
  })

  // Revisión J1 (ENG-05): un curso de antes del modo guiado sigue como estaba («Explorar»).
  it('el progreso de antes sigue en modo «Explorar» sin convertir lo hecho en evidencia', () => {
    const progress = decodeProgress(j('{"skills":{"s":{"alpha":9,"beta":1,"attempts":8,"lessonDone":true,"lessonStep":5}},"settings":{"dailyMinutes":25,"showGloss":false},"diagnosticDone":true}'))
    expect(progress.settings.lessonMode).toBe('explore')
    expect(decodeProgress(j('{"skills":{}}')).settings.lessonMode).toBe('explore') // sin «settings» también es de antes
    expect(decodeProgress(rt(encodeProgress(progress))).settings.lessonMode).toBe('explore')
    expect(decodeStudySettings(j('{"lessonMode":"guided"}'))?.lessonMode).toBe('guided')
    expect(emptyProgress().settings.lessonMode).toBe('guided') // un curso nuevo empieza guiado
    expect(progress.settings.dailyMinutes).toBe(25)
    expect(progress.settings.showGloss).toBe(false)
    expect(progress.skills.s).toMatchObject({ alpha: 9, attempts: 8, lessonStep: 5, lessonDone: true, learning: {} })
    expect(progress.diagnosticDone).toBe(true)
  })

  it('un modo desconocido o un estado guiado dañado no dan nada por superado', () => {
    expect(decodeStudySettings(j('{"lessonMode":"future-mode"}'))?.lessonMode).toBe('guided')
    const state = decodeLearningConcept(j('{"phase":"future","successfulChecks":"corrupt","activeInput":[1,2]}'))!
    expect(state.phase).toBe('explanation')
    expect(state.successfulChecks).toEqual([])
    expect(state.activeInput).toEqual([1, 2])
    expect(state.activeExercise).toBeUndefined()
    expect(state.passedWithout).toBeUndefined()
    expect(decodeLearningConcept(j('{"phase":"mastered","passedWithout":"future"}'))?.passedWithout).toBeUndefined()
    const passed = makeLearningConcept({ phase: 'mastered', passedWithout: 'unchecked' })
    expect(decodeLearningConcept(rt(encodeLearningConcept(passed)))?.passedWithout).toBe('unchecked')
  })

  it('cada modo y un estado guiado pendiente sobreviven a un ciclo de guardado', () => {
    const exercise: Exercise = makeExercise({ id: 'q', skill: 's', prompt: [textBlock('2 + 2', 'q-p')], answer: decodeAnswer(j('{"kind":"numeric","value":"4"}'))! })
    for (const mode of LESSON_LEARNING_MODES) {
      const progress = emptyProgress()
      progress.settings.lessonMode = mode
      const state = makeLearningConcept({
        revision: 'lesson', phase: 'check', successfulChecks: ['one'], attemptedChecks: ['one'], activeExercise: exercise,
        successfulSources: { q1: 'version' }, activeSourceRevision: 'q-version', activeInput: '4'
      })
      progress.skills.s = makeSkillProgress({ alpha: 10, beta: 2, attempts: 10, lessonDone: true, learning: { concept: state } })
      progress.attempts = [makeAttempt({ id: 'attempt', exerciseID: 'old', skill: 's', credit: 1, mode: 'practice', date: '2026-09-21T10:13:20.000Z' })]
      const restored = decodeProgress(rt(encodeProgress(progress)))
      expect(restored).toEqual(progress)
      expect(restored.skills.s.learning.concept.activeExercise).toEqual(exercise)
      expect(restored.skills.s.learning.concept.activeInput).toBe('4')
    }
  })
})

describe('cambios de metadatos del curso', () => {
  it('valida lo que llega por IPC', () => {
    expect(parseCourseMetaPatch(null).ok).toBe(false)
    expect(parseCourseMetaPatch({ title: 3 }).ok).toBe(false)
    expect(parseCourseMetaPatch({ hue: Number.NaN }).ok).toBe(false)
    expect(parseCourseMetaPatch({ exam: { date: 'mañana' } }).ok).toBe(false)
    expect(parseCourseMetaPatch({ exam: { durationMinutes: -3 } }).ok).toBe(false)
    const ok = parseCourseMetaPatch({ title: 'Nuevo', exam: { date: '2027-01-15T09:00:00+01:00', durationMinutes: 90.4, notes: null } })
    expect(ok).toEqual({ ok: true, patch: { title: 'Nuevo', exam: { date: '2027-01-15T08:00:00.000Z', durationMinutes: 90, notes: null } } })
  })

  it('aplica título, icono, color y examen', () => {
    const p = makePack({ id: 'p', title: 'Física', subject: 'Ciencias', exam: { title: 'Parcial', date: '2027-01-15T08:00:00.000Z', notes: 'n' } })
    applyCourseMetaPatch(p, { title: '  Física II ', icon: 'chemistry', hue: 7, courseCode: 'FIS-2', exam: { durationMinutes: 60, notes: null } })
    expect(p.title).toBe('Física II')
    expect(p.icon).toBe('chemistry') // un icono del catálogo se queda tal cual
    expect(applyCourseMetaPatch({ ...p }, { icon: 'no-existe' }).icon).toBe('physics') // uno desconocido: el del curso
    expect(p.hue).toBe(1)
    expect(p.courseCode).toBe('FIS-2')
    expect(p.exam).toEqual({ title: 'Parcial', date: '2027-01-15T08:00:00.000Z', durationMinutes: 60 })
    applyCourseMetaPatch(p, { exam: { date: null }, courseCode: null, selfPaced: true })
    expect(p.exam).toEqual({ title: 'Parcial', durationMinutes: 60 })
    expect(p.courseCode).toBeUndefined()
    expect(packHasExam(p)).toBe(false)
    applyCourseMetaPatch(p, { exam: null, title: '' })
    expect(p.exam).toBeUndefined()
    expect(p.title).toBe('Física II') // un título vacío no borra el que hay
    // el curso se sigue guardando como en Swift
    expect(decodePack(rt(encodePack(p)))).toEqual(p)
  })
})

describe('tarjetas', () => {
  it('ida y vuelta de una tarjeta básica', () => {
    const c = makeFlashcard({ id: 'c1', front: 'f', back: 'b', skill: 's' })
    const s = makeSkill({ id: 's', title: 'S', cards: [c] })
    expect(decodeSkill(rt(encodeSkill(s))).cards).toEqual([c])
  })
})
