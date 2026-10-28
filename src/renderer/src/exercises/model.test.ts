import { describe, expect, it } from 'vitest'
import { makeExercise, type Answer, type Exercise } from '@shared/schema/exercises'
import {
  applyResult, applySelfGrade, canCheck, checkedWrong, choiceOrder, draftHasInput, draftInput, finalCredit, hintsUsed, initialDraft,
  initialOrder, initialRun, inputKey, inputSummary, isBinary, isFinished, isStale, needsSelfReview, restoreDraft, rightsOrder,
  SeededShuffler, snapshotDraft, snapshotInput, unique
} from './model'
import { makeResult } from './types'

const ex = (id: string, answer: Answer): Exercise => makeExercise({ id, skill: 's', answer })
const ordering = (id: string, items: string[]): Exercise => ex(id, { kind: 'ordering', items })
const choice = (multi: boolean, n = 4, shuffle = true): Extract<Answer, { kind: 'choice' }> => ({
  kind: 'choice', multi, shuffle, options: Array.from({ length: n }, (_, i) => ({ id: `o${i}`, md: `Opción ${i}`, correct: i === 0 }))
})
const numeric: Answer = { kind: 'numeric', value: '2', alternatives: [], absTol: 0, relTol: 0, form: 'any', unitMode: 'ignore', angle: 'radians' }

describe('barajado estable', () => {
  it('la misma semilla da siempre el mismo orden', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(new SeededShuffler('ej-1').shuffled(items)).toEqual(new SeededShuffler('ej-1').shuffled(items))
    expect(new SeededShuffler('ej-1').shuffled(items).sort()).toEqual(items)
  })
  it('semillas distintas suelen dar órdenes distintos', () => {
    const items = Array.from({ length: 10 }, (_, i) => String(i))
    const orders = new Set(['a', 'b', 'c', 'd', 'e'].map((s) => new SeededShuffler(s).shuffled(items).join()))
    expect(orders.size).toBeGreaterThan(1)
  })
  it('las opciones sin barajar quedan en su orden y sin repetidos', () => {
    const a = choice(false, 3, false)
    expect(choiceOrder('x', a)).toEqual(['o0', 'o1', 'o2'])
    expect(unique(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
  })
  it('la columna derecha incluye parejas y distractores', () => {
    const r = rightsOrder('m', { kind: 'matching', pairs: [{ left: 'a', right: '1' }, { left: 'b', right: '2' }], extraRights: ['3', '1'] })
    expect([...r].sort()).toEqual(['1', '2', '3'])
  })
  it('ordenar nunca empieza en el orden correcto', () => {
    for (const id of ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8']) {
      const items = ['a', 'b', 'c']
      expect(initialOrder(id, items)).not.toEqual(items)
    }
    expect(initialOrder('uno', ['a'])).toEqual(['a'])
  })
})

describe('borrador (port de UIBaseFixTests)', () => {
  it('ordenar sin tocar no cuenta como respondida', () => {
    const e = ordering('o1', ['a', 'b', 'c', 'd'])
    const d = initialDraft(e)
    expect(draftHasInput(e.answer, d)).toBe(false)
    expect(draftInput(e.answer, d)).toEqual({ kind: 'none' })
    expect(snapshotDraft(e.answer, d)).toBeUndefined()
    const moved = { ...d, order: [d.order[1], d.order[0], ...d.order.slice(2)], orderTouched: true }
    expect(draftHasInput(e.answer, moved)).toBe(true)
    expect(draftInput(e.answer, moved)).toEqual({ kind: 'ordering', items: moved.order })
    // lo guardado vuelve como tocado
    const back = restoreDraft(e.answer, initialDraft(e), snapshotDraft(e.answer, moved))
    expect(back.orderTouched).toBe(true)
    expect(back.order).toEqual(moved.order)
    // un solo elemento no se puede mover: cuenta como respondida
    const one = ordering('o2', ['a'])
    expect(draftHasInput(one.answer, initialDraft(one))).toBe(true)
  })
  it('ordenar sin tocar dentro de varias partes tampoco cuenta', () => {
    const e = ex('m1', { kind: 'multi', parts: [{ label: 'a', prompt: [], answer: { kind: 'ordering', items: ['x', 'y', 'z'] }, points: 1, hints: [] }] })
    const d = initialDraft(e)
    expect(draftHasInput(e.answer, d)).toBe(false)
    const touched = { ...d, parts: [{ ...d.parts[0], order: [...d.parts[0].order].reverse(), orderTouched: true }] }
    expect(draftHasInput(e.answer, touched)).toBe(true)
  })
  it('un orden guardado que no encaja se ignora', () => {
    const e = ordering('o3', ['a', 'b', 'c'])
    const back = restoreDraft(e.answer, initialDraft(e), { order: ['a', 'b', 'zzz'] })
    expect(back.orderTouched).toBe(false)
  })
  it('huecos y etiquetas: una entrada por hueco', () => {
    const cloze = ex('c', { kind: 'cloze', text: 'Uno [[1]] y dos [[2]].', blanks: [{ accepted: ['a'], numeric: false }, { accepted: ['b'], numeric: false }] })
    const d = initialDraft(cloze)
    expect(d.blanks).toEqual(['', ''])
    expect(draftHasInput(cloze.answer, d)).toBe(false)
    expect(draftInput(cloze.answer, { ...d, blanks: ['a', ''] })).toEqual({ kind: 'blanks', values: ['a', ''] })
    // un guardado con otro número de huecos no se aplica
    expect(restoreDraft(cloze.answer, d, { blanks: ['solo uno'] }).blanks).toEqual(['', ''])
  })
  it('instantánea de ida y vuelta con las claves de Swift', () => {
    const a = choice(true)
    const e = ex('ch', a)
    const d = { ...initialDraft(e), choice: ['o2', 'o0'] }
    const snap = snapshotDraft(a, d)
    expect(snap).toEqual({ choice: ['o0', 'o2'] })
    expect(snapshotInput(e, snap)).toEqual({ kind: 'choice', ids: ['o0', 'o2'] })
    expect(snapshotInput(ex('n', numeric), { text: '2,5' })).toEqual({ kind: 'text', text: '2,5' })
    expect(snapshotInput(ex('tf', { kind: 'truefalse', value: true, explainWhy: false }), { bool: false })).toEqual({ kind: 'bool', value: false })
    expect(snapshotInput(e, 'basura')).toEqual({ kind: 'choice', ids: [] })
  })
  it('la clave de la entrada no depende del orden de elección', () => {
    expect(inputKey({ kind: 'choice', ids: ['b', 'a'] })).toBe(inputKey({ kind: 'choice', ids: ['a', 'b'] }))
    expect(inputKey({ kind: 'matching', pairs: { x: '1', y: '2' } })).toBe(inputKey({ kind: 'matching', pairs: { y: '2', x: '1' } }))
    expect(inputKey({ kind: 'text', text: 'a' })).not.toBe(inputKey({ kind: 'text', text: 'b' }))
  })
  it('resume lo contestado como texto', () => {
    const a = choice(true, 3, false)
    expect(inputSummary(a, { ...initialDraft(ex('c', a)), choice: ['o1'] })).toBe('Opción 1')
    expect(inputSummary(numeric, initialDraft(ex('n', numeric)))).toBeUndefined()
    const tf: Answer = { kind: 'truefalse', value: true, explainWhy: false }
    expect(inputSummary(tf, { ...initialDraft(ex('t', tf)), bool: true }, { true: 'True', false: 'False' })).toBe('True')
  })
})

describe('flujo', () => {
  const e = ex('n1', numeric)
  const typed = (s = initialRun(e, undefined, 0), text = '3') => ({ ...s, draft: { ...s.draft, text } })

  it('sin escribir no se puede comprobar', () => {
    const s = initialRun(e, undefined, 0)
    expect(canCheck(e, s)).toBe(false)
    expect(canCheck(e, typed(s))).toBe(true)
  })
  it('un fallo se puede reintentar al cambiar la respuesta', () => {
    const s = applyResult(e, typed(), makeResult('incorrect', 0), 1000)
    expect(s.attempts).toBe(1)
    expect(s.errorPulse).toBe(1)
    expect(checkedWrong(e, s)).toBe(true)
    expect(canCheck(e, s)).toBe(false)
    const edited = typed(s, '2')
    expect(isStale(e, edited)).toBe(true)
    expect(canCheck(e, edited)).toBe(true)
    expect(checkedWrong(e, edited)).toBe(false)
  })
  it('acertar termina el ejercicio', () => {
    const s = applyResult(e, typed(undefined, '2'), makeResult('correct', 1), 2000)
    expect(isFinished(s)).toBe(true)
    expect(s.successPulse).toBe(1)
    expect(s.finishedAt).toBe(2000)
    expect(canCheck(e, s)).toBe(false)
  })
  it('«no se entendió» no cuenta como intento', () => {
    const s = applyResult(e, typed(), makeResult('invalid', 0))
    expect(s.attempts).toBe(0)
    expect(canCheck(e, s)).toBe(true)
  })
  it('en lo binario, fallar enseña la solución', () => {
    const tf = ex('tf', { kind: 'truefalse', value: true, explainWhy: false })
    expect(isBinary(tf.answer)).toBe(true)
    expect(isBinary(choice(false, 2))).toBe(true)
    expect(isBinary(choice(false, 3))).toBe(false)
    expect(isBinary(choice(true, 2))).toBe(false)
    const s = applyResult(tf, { ...initialRun(tf), draft: { ...initialDraft(tf), bool: false } }, makeResult('incorrect', 0))
    expect(s.revealed).toBe(true)
    expect(isFinished(s)).toBe(true)
  })
  it('las abiertas esperan la autoevaluación y luego quedan cerradas', () => {
    const open = ex('op', { kind: 'open', modelAnswer: 'Porque sí.', rubric: [{ text: 'Da una razón', points: 1 }] })
    const s0 = { ...initialRun(open), draft: { ...initialDraft(open), text: 'Porque…' } }
    const s1 = applyResult(open, s0, makeResult('partial', 0, { needsReview: true }))
    expect(needsSelfReview(open, s1)).toBe(true)
    expect(s1.errorPulse).toBe(0)
    expect(checkedWrong(open, s1)).toBe(false)
    const s2 = applySelfGrade(open, s1, 0.5)
    expect(s2.result?.status).toBe('partial')
    expect(s2.result?.credit).toBe(0.5)
    expect(isFinished(s2)).toBe(true)
    expect(applySelfGrade(open, s1, 7).result?.status).toBe('correct')
  })
  it('el crédito final: primer intento menos 0,1 por pista', () => {
    expect(finalCredit(makeResult('correct', 1), 0)).toBe(1)
    expect(finalCredit(makeResult('correct', 1), 2)).toBeCloseTo(0.8)
    expect(finalCredit(makeResult('incorrect', 0), 3)).toBe(0)
    expect(finalCredit(makeResult('partial', 0.15), 5)).toBe(0)
    expect(finalCredit(undefined, 0)).toBe(0)
  })
  it('pistas usadas: las del ejercicio o la parte con más', () => {
    const s = initialRun(e)
    expect(hintsUsed(s)).toBe(0)
    expect(hintsUsed({ ...s, hintsShown: 1, partHints: [0, 2] })).toBe(2)
  })
})
