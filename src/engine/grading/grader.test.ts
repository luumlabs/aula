// Port de Tests/StudyEngineTests/GraderTests.swift.
import { describe, expect, it } from 'vitest'
import { decodeExercise, decodeTemplate, type Exercise } from '@shared/schema'
import {
  Input, MathKitChecker, correctAnswerMarkdown, grade, instantiateTemplate, instantiateTemplateOrThrow, previewExpression, type AnswerInput, type GradeResult
} from '@engine/grading'

function ex(answer: string, wrongs = '[]'): Exercise {
  const e = decodeExercise(JSON.parse(`{"id":"e","skill":"s","prompt":["p"],"answer":${answer},"wrongs":${wrongs}}`))
  if (!e) throw new Error('ejercicio ilegible')
  return e
}
const g = (answer: string, input: AnswerInput, wrongs = '[]'): GradeResult => grade(ex(answer, wrongs), input)

describe('ExerciseGrader', () => {
  it('numérico: acepta formas equivalentes y explica errores típicos', () => {
    const a = '{"kind":"numeric","value":"sqrt(3)/2"}'
    for (const ok of ['sqrt(3)/2', '√3/2', '0.8660254', '3^0.5/2', ' sqrt(3) / 2 ']) expect(g(a, Input.text(ok)).status, ok).toBe('correct')
    const wrong = g(a, Input.text('-sqrt(3)/2'))
    expect(wrong.status).toBe('incorrect')
    expect(wrong.diagnosis).toContain('signError')
    expect(wrong.feedback.length).toBeGreaterThan(0)
    expect(g(a, Input.text('sqrt(3')).status).toBe('invalid')
    expect(g(a, Input.text('  ')).status).toBe('invalid')
    const d = '{"kind":"numeric","value":"pi","decimals":2}'
    expect(g(d, Input.text('3.14')).status).toBe('correct')
    expect(g(d, Input.text('3.2')).status).not.toBe('correct')
    expect(g('{"kind":"numeric","value":"1/2","form":"reducedFraction"}', Input.text('2/4')).status).not.toBe('correct')
  })

  it('los errores típicos del autor ganan al diagnóstico genérico', () => {
    const r = g('{"kind":"numeric","value":"5"}', Input.text('3'), '[{"input":"3","why":"Sumaste en vez de multiplicar."}]')
    expect(r.matchedWrong?.why).toBe('Sumaste en vez de multiplicar.')
    expect(r.feedback[0]?.markdown).toBe('Sumaste en vez de multiplicar.')
    const r2 = g('{"kind":"numeric","value":"5"}', Input.text('6/2'), '[{"input":"3","why":"Sumaste."}]')
    expect(r2.matchedWrong).toBeDefined()
  })

  it('expresión, ecuación, conjunto, intervalo y punto', () => {
    expect(g('{"kind":"expression","expected":"(x+1)^2"}', Input.text('x^2+2x+1')).status).toBe('correct')
    expect(g('{"kind":"expression","expected":"(x+1)^2"}', Input.text('x^2+1')).status).not.toBe('correct')
    expect(g('{"kind":"equation","expected":"y=2x+1"}', Input.text('2x-y+1=0')).status).toBe('correct')
    expect(g('{"kind":"set","expected":["2","3"]}', Input.text('x=3 o x=2')).status).toBe('correct')
    expect(g('{"kind":"set","expected":["2","3"]}', Input.text('2')).status).not.toBe('correct')
    expect(g('{"kind":"interval","expected":"(-inf,3]"}', Input.text('(−∞, 3]')).status).toBe('correct')
    expect(g('{"kind":"point","expected":["1","-2"]}', Input.text('(1, -2)')).status).toBe('correct')
    expect(g('{"kind":"point","expected":["1","-2"]}', Input.text('(-2, 1)')).status).not.toBe('correct')
  })

  it('texto, opciones, huecos, ordenar, emparejar y verdadero/falso', () => {
    expect(g('{"kind":"short","accepted":["mitocondria"]}', Input.text('La Mitocondria')).status).toBe('correct')
    const choice = '{"kind":"choice","options":[{"id":"a","md":"A","correct":false,"why":"Confunde X con Y"},{"id":"b","md":"B","correct":true,"why":"Porque sí"},{"id":"c","md":"C","correct":false}]}'
    expect(g(choice, Input.choice(['b'])).status).toBe('correct')
    const bad = g(choice, Input.choice(['a']))
    expect(bad.status).toBe('incorrect')
    expect(bad.feedback[0]?.markdown).toBe('Confunde X con Y')
    const multi = '{"kind":"choice","multi":true,"options":[{"id":"a","md":"A","correct":true},{"id":"b","md":"B","correct":true},{"id":"c","md":"C","correct":false}]}'
    expect(g(multi, Input.choice(['a', 'b'])).status).toBe('correct')
    const part = g(multi, Input.choice(['a']))
    expect(part.status).toBe('partial')
    expect(part.credit).toBeCloseTo(0.5, 9)
    expect(g(multi, Input.choice(['a', 'c'])).status).toBe('incorrect')
    const cloze = '{"kind":"cloze","text":"El [[1]] produce [[2]].","blanks":[{"accepted":["núcleo"]},{"accepted":["3","tres"],"numeric":true}]}'
    expect(g(cloze, Input.blanks(['nucleo', '3'])).status).toBe('correct')
    const half = g(cloze, Input.blanks(['nucleo', '4']))
    expect(half.status).toBe('partial')
    expect(half.parts.length).toBe(2)
    expect(g('{"kind":"ordering","items":["a","b","c"]}', Input.ordering(['a', 'b', 'c'])).status).toBe('correct')
    const o = g('{"kind":"ordering","items":["a","b","c"]}', Input.ordering(['b', 'a', 'c']))
    expect(o.status).toBe('partial')
    expect(o.credit).toBeCloseTo(1 / 3, 9)
    const m = '{"kind":"matching","pairs":[{"left":"H","right":"Hidrógeno"},{"left":"O","right":"Oxígeno"}]}'
    expect(g(m, Input.matching({ H: 'Hidrógeno', O: 'Oxígeno' })).status).toBe('correct')
    expect(g(m, Input.matching({ H: 'Oxígeno', O: 'Hidrógeno' })).status).toBe('incorrect')
    expect(g('{"kind":"truefalse","value":false}', Input.bool(false)).status).toBe('correct')
    expect(g('{"kind":"truefalse","value":false}', Input.bool(true)).status).toBe('incorrect')
    const open = g('{"kind":"open","modelAnswer":"x","rubric":["a"]}', Input.text('mi respuesta'))
    expect(open.needsReview).toBe(true)
    expect(open.needsAI).toBe(true)
  })

  it('el crédito de un ejercicio por apartados se pondera', () => {
    const a = '{"kind":"multi","parts":[{"label":"a","prompt":"p","answer":{"kind":"numeric","value":"2"},"points":1},{"label":"b","prompt":"q","answer":{"kind":"numeric","value":"3"},"points":3}]}'
    expect(g(a, Input.parts([Input.text('2'), Input.text('3')])).status).toBe('correct')
    const r = g(a, Input.parts([Input.text('2'), Input.text('9')]))
    expect(r.status).toBe('partial')
    expect(r.credit).toBeCloseTo(0.25, 9)
    expect(r.parts.length).toBe(2)
  })

  it('la respuesta correcta se muestra en LaTeX', () => {
    expect(correctAnswerMarkdown(ex('{"kind":"numeric","value":"sqrt(3)/2"}'))).toBe('$\\frac{\\sqrt{3}}{2}$')
    expect(correctAnswerMarkdown(ex('{"kind":"interval","expected":"(-inf,3]"}'))).toContain('\\infty')
    expect(correctAnswerMarkdown(ex('{"kind":"equation","expected":"y=2x+1"}'))).toContain('=')
  })

  it('la vista previa enseña LaTeX y los errores de sintaxis', () => {
    expect(previewExpression('sqrt(3)/2').tex).toBe('\\frac{\\sqrt{3}}{2}')
    expect(previewExpression('sqrt(3').error).toBeDefined()
    expect(previewExpression('1, 2, 3').error).toBeUndefined()
    expect(previewExpression('').tex).toBeUndefined()
    expect(previewExpression('y=2x+1').tex).toContain('=')
  })

  it('la autoverificación encuentra claves que no se aceptan y errores típicos contradictorios', () => {
    const c = MathKitChecker
    expect(c.selfCheck(ex('{"kind":"numeric","value":"3/4"}'))).toEqual([])
    expect(c.selfCheck(ex('{"kind":"numeric","value":"pi","decimals":3}'))).toEqual([])
    expect(c.selfCheck(ex('{"kind":"numeric","value":"5","unit":"m/s","unitMode":"required"}'))).toEqual([])
    const contradictory = c.selfCheck(ex('{"kind":"numeric","value":"1/2"}', '[{"input":"0.5","why":"x"}]'))
    expect(contradictory.some((i) => i.severity === 'warning' && i.message.includes('error típico'))).toBe(true)
    expect(c.checkExpression('2*x+', null)).toBeDefined()
    expect(c.checkExpression('a*q', new Set(['a', 'x']))).toBeDefined()
    expect(c.checkExpression('a*x', new Set(['a', 'x']))).toBeUndefined()
    expect(c.checkExpression('gcd(a,b) == 1', new Set(['a', 'b']))).toBeUndefined()
    expect(c.checkExpression('a*b < 100', new Set(['a', 'b']))).toBeUndefined()
    expect(c.checkNumericValue('x+1')).toBeDefined()
    expect(c.checkNumericValue('DNE')).toBeUndefined()
    expect(c.checkNumericValue('sqrt(2)/2')).toBeUndefined()
  })
})

describe('Plantillas', () => {
  const template = decodeTemplate(JSON.parse('{"id":"lin","skill":"s","level":2,"vars":[{"name":"a","kind":"int","min":2,"max":9},{"name":"b","kind":"int","min":-9,"max":9,"exclude":[0]}],"constraints":["a != b"],"prompt":[{"type":"text","md":"Resuelve ${{a}}x{{signed:b}}=0$."}],"answer":{"kind":"numeric","value":"-b/a"},"hints":["Despeja x"],"solution":[{"type":"text","md":"$x=-\\\\frac{{{b}}}{{{a}}}$"}],"wrongs":[{"input":"b/a","why":"Olvidaste cambiar el signo."}]}'))!

  const promptValues = (e: Exercise): [number, number] | undefined => {
    const b = e.prompt[0]
    if (!b || b.type !== 'text') return undefined
    const m = /\$(\d+)x([+-]\d+)=0\$/.exec(b.md)
    return m ? [Number(m[1]), Number(m[2])] : undefined
  }

  it('son deterministas y sus respuestas exactas', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      const e = instantiateTemplateOrThrow(template, seed)
      expect(e.id).toBe(`lin#${seed}`)
      expect(e.templateID).toBe('lin')
      const v = promptValues(e)
      expect(v, JSON.stringify(e.prompt)).toBeDefined()
      const [a, b] = v!
      expect(a).not.toBe(b)
      expect(b).not.toBe(0)
      seen.add(`${a},${b}`)
      expect(grade(e, Input.text(`${-b}/${a}`)).status, `a=${a} b=${b} ${JSON.stringify(e.answer)}`).toBe('correct')
      expect(grade(e, Input.text(`${b}/${a}`)).status).not.toBe('correct')
      expect(MathKitChecker.selfCheck(e).filter((i) => i.severity === 'error')).toEqual([])
    }
    expect(seen.size).toBeGreaterThan(10)
    expect(JSON.stringify(instantiateTemplate(template, 7))).toBe(JSON.stringify(instantiateTemplate(template, 7)))
  })

  it('una plantilla imposible o con un tipo desconocido no se instancia', () => {
    expect(instantiateTemplate({ ...template, vars: [{ ...template.vars[0], kind: 'banana' }, template.vars[1]] }, 1)).toBeUndefined()
    expect(instantiateTemplate({ ...template, constraints: ['a > 100'] }, 1)).toBeUndefined()
  })
})
