// Port de Tests/StudyEngineTests/StudyEngineTests.swift (ValidatorTests, NormalizerTests y LatexSupportTests).
import { describe, expect, it } from 'vitest'
import { decodeBlock, decodeExercise, decodeTemplate, type Block, type Exercise } from '@shared/schema'
import { MathKitChecker } from '@engine/grading'
import { ContentValidator } from './validator'
import { ContentNormalizer } from './normalizer'
import { texProblems } from './tex'

const v = new ContentValidator()
const block = (json: string): Block => decodeBlock(ContentNormalizer.block(JSON.parse(json)))!
const textBlock = (md: string): Block => ({ id: 'b', type: 'text', md })
const ex = (json: string, skill = 's', id = 'e1'): Exercise => decodeExercise(ContentNormalizer.exercise(JSON.parse(json), skill, id))!

describe('ContentValidator', () => {
  it('el LaTeX roto es un error', () => {
    const issues = v.checkBlock(textBlock('La fórmula $\\frac{a}{$ no cierra'), 'b')
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('LaTeX'))).toBe(true)
    expect(v.checkBlock(textBlock('Todo bien: $\\frac{a}{b}$ y $x^2$'), 'b').filter((i) => i.severity === 'error')).toEqual([])
  })

  it('las cantidades de dinero no son matemáticas', () => {
    expect(v.checkBlock(textBlock('Cuesta \\$5 y luego \\$6'), 'b')).toEqual([])
  })

  it('predict necesita exactamente una opción correcta', () => {
    const b = block('{"type":"predict","question":"¿?","options":[{"md":"a","correct":true},{"md":"b","correct":true}]}')
    expect(v.checkBlock(b, 'p').some((i) => i.severity === 'error' && i.message.includes('exactamente 1'))).toBe(true)
  })

  it('el índice de «encuentra el error» debe estar en rango', () => {
    const b = block('{"type":"spot","intro":"x","lines":["a","b","c"],"wrongIndex":3,"explanation":"e"}')
    expect(v.checkBlock(b, 's').some((i) => i.severity === 'error' && i.path.endsWith('wrongIndex'))).toBe(true)
  })

  it('una gráfica necesita contenido y rangos ordenados', () => {
    expect(v.checkBlock(block('{"type":"plot"}'), 'p').some((i) => i.severity === 'error')).toBe(true)
    expect(v.checkBlock(block('{"type":"plot","curves":["x^2"],"xMin":5,"xMax":1}'), 'p').some((i) => i.message.includes('xMin'))).toBe(true)
  })

  it('los parámetros de explore', () => {
    const b = block('{"type":"explore","plot":{"curves":[{"expr":"a*x"}]},"params":[{"name":"x","min":0,"max":5,"value":1},{"name":"ab","min":3,"max":1,"value":2}]}')
    const issues = v.checkBlock(b, 'e')
    expect(issues.some((i) => i.message.includes('x') && i.severity === 'error')).toBe(true)
    expect(issues.some((i) => i.message.includes('una sola letra'))).toBe(true)
    expect(issues.some((i) => i.message.includes('min debe ser menor'))).toBe(true)
  })

  it('las flechas de un diagrama apuntan a nodos que existen', () => {
    const b = block('{"type":"diagram","nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"edges":[["a","z"]]}')
    expect(v.checkBlock(b, 'd').some((i) => i.severity === 'error' && i.message.includes('no existe'))).toBe(true)
  })

  it('comprobaciones de ejercicios', () => {
    expect(v.checkExercise(ex('{"question":"¿?","options":["a","b"],"answer":"z"}'), 'e').some((i) => i.message.includes('Ninguna opción'))).toBe(true)
    const c = ex('{"prompt":"El [[1]] y el [[2]]","answer":{"kind":"cloze","blanks":[{"accepted":["a"]}]}}')
    expect(v.checkExercise(c, 'e').some((i) => i.message.includes('marcas'))).toBe(true)
    const o = ex('{"prompt":"ordena","answer":{"kind":"ordering","items":["a","a","b"]}}')
    expect(v.checkExercise(o, 'e').some((i) => i.message.includes('repetidos'))).toBe(true)
    const good = ex('{"prompt":"¿Cuánto es $2+2$?","level":1,"answer":{"kind":"numeric","value":4},"hints":["suma"],"solution":"$2+2=4$"}')
    expect(v.checkExercise(good, 'e').filter((i) => i.severity === 'error')).toEqual([])
  })

  it('con el motor matemático, una clave que no se acepta a sí misma es un error', () => {
    const m = ContentValidator.withMath()
    const bad = ex('{"prompt":"¿?","level":1,"answer":{"kind":"numeric","value":"1/2","form":"decimal"}}')
    expect(m.math).toBe(MathKitChecker)
    expect(m.checkExercise(bad, 'e').some((i) => i.severity === 'error' && i.message.includes('no se acepta a sí misma'))).toBe(true)
  })

  it('ids repetidos en la habilidad', () => {
    const e = ex('{"prompt":"¿Cuánto es 1+1?","answer":{"kind":"numeric","value":"2"}}')
    const issues = v.checkSkill({ id: 's', title: 'S', objectives: [], prerequisites: [], lesson: [], exercises: [e, e], templates: [], cards: [], decks: [], mistakes: [], sources: [], status: 'draft', issues: [], revision: 1, updated: new Date().toISOString() })
    expect(issues.some((i) => i.message.includes('Id repetido'))).toBe(true)
  })

  it('plantillas: variables y restricciones', () => {
    const t = decodeTemplate({ id: 't', skill: 's', vars: [{ name: 'a', kind: 'int', min: 5, max: 1 }, { name: 'b', kind: 'banana' }], prompt: ['x'], answer: { kind: 'numeric', value: 'a' } })!
    const issues = ContentValidator.withMath().checkTemplate(t, 'templates[t]')
    expect(issues.some((i) => i.message.includes('min ≤ max'))).toBe(true)
    expect(issues.some((i) => i.message.includes('kind no válido'))).toBe(true)
  })
})

describe('ContentNormalizer', () => {
  const nex = (json: string): Exercise => ex(json, 's1', 'e9')

  it('opción múltiple abreviada con letra', () => {
    const e = nex('{"question":"¿Capital de Francia?","options":["Madrid","París","Roma"],"answer":"B"}')
    expect(e.answer.kind).toBe('choice')
    if (e.answer.kind !== 'choice') return
    expect(e.answer.options.map((o) => o.correct)).toEqual([false, true, false])
    expect(e.id).toBe('e9')
    expect(e.skill).toBe('s1')
  })

  it('opción múltiple con índice o con el texto de la respuesta', () => {
    const e1 = nex('{"prompt":"?","choices":["a","b","c"],"answer":2}')
    expect(e1.answer.kind === 'choice' && e1.answer.options.map((o) => o.correct)).toEqual([false, false, true])
    const e2 = nex('{"prompt":"?","choices":["Sí","No"],"answer":"No"}')
    expect(e2.answer.kind === 'choice' && e2.answer.options.map((o) => o.correct)).toEqual([false, true])
  })

  it('respuestas abreviadas', () => {
    const n1 = nex('{"prompt":"?","answer":"3/4"}').answer
    expect(n1.kind === 'numeric' && n1.value).toBe('3/4')
    const n2 = nex('{"prompt":"?","answer":42}').answer
    expect(n2.kind === 'numeric' && n2.value).toBe('42')
    const t = nex('{"prompt":"?","type":"true_false","answer":false}').answer
    expect(t.kind === 'truefalse' && t.value).toBe(false)
    const s = nex('{"prompt":"?","answer":"mitocondria"}').answer
    expect(s.kind === 'short' && s.accepted).toEqual(['mitocondria'])
  })

  it('palabras de dificultad y sinónimos de campos', () => {
    const e = nex('{"statement":"¿?","difficulty":"hard","answer":{"kind":"numeric","value":"1"},"hint":"piensa","solution_steps":["uno","dos"]}')
    expect(e.level).toBe(3)
    expect(e.hints).toEqual(['piensa'])
    expect(e.solution.length).toBe(1)
  })

  it('sinónimos de bloques', () => {
    const raw = JSON.parse('["Hola",{"type":"graph","functions":["x^2","sin(x)"],"x_range":[-3,3]},{"type":"callout","variant":"warning","content":"cuidado"},{"type":"interactive","sliders":[{"symbol":"a","range":[-2,2],"default":1}],"functions":["a*x"]}]')
    const b = ContentNormalizer.blocks(raw).map((x) => decodeBlock(x)!)
    expect(b.length).toBe(4)
    const p = b[1]
    expect(p.type).toBe('plot')
    if (p.type === 'plot') { expect(p.curves.map((c) => c.expr)).toEqual(['x^2', 'sin(x)']); expect(p.xMin).toBe(-3) }
    const c = b[2]
    expect(c.type === 'callout' && c.kind).toBe('warning')
    expect(c.type === 'callout' && c.md).toBe('cuidado')
    const e = b[3]
    expect(e.type).toBe('explore')
    if (e.type === 'explore') { expect(e.params[0]?.name).toBe('a'); expect(e.params[0]?.min).toBe(-2); expect(e.plot.curves[0]?.expr).toBe('a*x') }
  })

  it('los mapas de variables de las plantillas se convierten en lista', () => {
    const t = decodeTemplate(ContentNormalizer.template(JSON.parse('{"variables":{"a":{"type":"int","range":[2,9]},"c":{"expr":"a*2"}},"constraints":"a != 5","prompt":"{{a}}","answer":"x"}'), 's', 't1'))!
    expect(t.vars.map((x) => x.name)).toEqual(['a', 'c'])
    expect(t.vars[0].kind).toBe('int')
    expect(t.vars[0].min).toBe(2)
    expect(t.vars[1].kind).toBe('expr')
    expect(t.constraints).toEqual(['a != 5'])
  })

  it('las partes de una figura en porcentaje o como par', () => {
    const p = ContentNormalizer.figurePart({ name: 'a', pos: ['35%', 0.5], description: 'x' }) as Record<string, unknown>
    expect(p.x).toBeCloseTo(0.35)
    const q = ContentNormalizer.figurePart({ name: 'a', x: '35%', y: '50 %' }) as Record<string, unknown>
    expect(q.x).toBeCloseTo(0.35)
    expect(q.y).toBeCloseTo(0.5)
  })
})

describe('LaTeX (KaTeX, el mismo que dibuja la interfaz)', () => {
  const supported = [
    '\\frac{a}{b}', '\\dfrac{a}{b}', '\\sqrt[3]{x}', 'x_i^{2}', '\\sum_{i=1}^{n} i', '\\prod_{i=1}^{n} i', '\\int_0^1 x\\,dx', '\\lim_{x\\to 0}\\frac{\\sin x}{x}', '\\oint f', '\\binom{n}{k}',
    '\\alpha\\beta\\gamma\\delta\\epsilon\\varepsilon\\zeta\\eta\\theta\\vartheta\\iota\\kappa\\lambda\\mu\\nu\\xi\\pi\\rho\\sigma\\tau\\upsilon\\phi\\varphi\\chi\\psi\\omega', '\\Gamma\\Delta\\Theta\\Lambda\\Xi\\Pi\\Sigma\\Phi\\Psi\\Omega',
    '\\left( x \\right)\\left[ x \\right]\\left\\{ x \\right\\}\\left| x \\right|', '\\lfloor x \\rfloor\\lceil x \\rceil\\langle x,y \\rangle',
    '\\sin\\cos\\tan\\cot\\sec\\csc\\arcsin\\arccos\\arctan\\sinh\\cosh\\tanh\\ln\\log\\exp\\max\\min\\sup\\inf\\det\\gcd', '\\operatorname{lcm}(a,b)', '\\mathrm{H_2O}', '\\mathrm{Fe^{3+}}', '\\mathrm{SO_4^{2-}}', '\\mathbb{R}', '\\mathcal{L}', '\\mathbf{v}', '\\boldsymbol{v}',
    '\\text{si } x>0', '\\vec{v}', '\\overrightarrow{AB}', '\\overline{AB}', '\\underline{x}', '\\hat{x}\\bar{x}\\tilde{x}\\dot{x}\\widehat{abc}',
    '\\leq\\geq\\neq\\approx\\equiv\\sim\\propto\\in\\notin\\subset\\subseteq\\cup\\cap\\emptyset\\forall\\exists', '\\to\\rightarrow\\Rightarrow\\Leftrightarrow\\mapsto\\infty\\partial\\nabla\\angle\\triangle\\parallel\\perp', '\\cdot\\times\\div\\pm\\circ', '90^{\\circ}',
    'a\\,b\\;c\\quad d\\qquad e', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', '\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}', '\\begin{vmatrix}1&2\\\\3&4\\end{vmatrix}', '\\begin{matrix}1&2\\end{matrix}',
    '\\begin{cases}x&x>0\\\\0&\\text{otherwise}\\end{cases}', '\\begin{aligned}a&=b\\\\c&=d\\end{aligned}', '2\\,\\mathrm{H_2}+\\mathrm{O_2}\\rightarrow 2\\,\\mathrm{H_2O}', "f'(x)", '\\ldots\\cdots',
    '\\xrightarrow{a}', '\\overset{a}{=}', '\\underset{a}{=}', '\\stackrel{a}{=}', '\\underbrace{abc}_{n}', '\\overbrace{abc}^{n}', '\\cancel{x}', '\\boxed{x}', '\\mbox{x}', '\\mathscr{L}', '\\therefore',
    '\\because', '\\rightleftharpoons', '\\ce{H2O}', '\\ce{2H2 + O2 -> 2H2O}', '\\ce{N2 + 3H2 <=> 2NH3}', '\\begin{array}{c|c}1&2\\\\ \\hline 3&4\\end{array}', '\\phantom{x}', '\\hspace{1em}', '\\dots',
    '\\lVert x \\rVert', '\\color{red}{x}', '\\SI{9.8}{m/s^2}', '\\begin{align}a&=b\\end{align}'
  ]
  it('todo lo que promete la guía de autoría se dibuja', () => {
    for (const t of supported) expect(texProblems(t, 't').filter((i) => i.severity === 'error'), t).toEqual([])
  })
  const unsupported = ['\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}', '\\xymatrix{A \\ar[r] & B}', '\\chemfig{H-O-H}', '\\frac{a}{', 'x^{2', '\\foo{x}']
  it('lo que no se admite (dibujos dentro de LaTeX) y el LaTeX roto son errores', () => {
    for (const t of unsupported) expect(texProblems(t, 't').some((i) => i.severity === 'error'), t).toBe(true)
  })
})
