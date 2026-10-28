// Validador de contenido (port de StudyEngine/Content/Validator.swift): estructura, referencias, LaTeX y (con el motor
// matemático) expresiones y autoverificación de las respuestas. Los mensajes son precisos y en español: los lee la IA que
// escribe el contenido para corregirlo (con la ruta exacta del fallo).
import {
  answerForGrading, blockTypeName, BLOCK_TYPES, canonicalDeckTheme, encodeTemplate, TOO_DEEP_TYPE,
  type Answer, type Block, type ContentIssue, type Deck, type Exercise, type ExerciseTemplate, type Flashcard, type IssueSeverity, type Pack, type PlotSpec,
  type Skill, type SourceRef
} from '@shared/schema'
import { compactJSON } from '@engine/base/json'
import { MAX_TEMPLATE_BYTES, MathKitChecker, NoMathChecker, chemNumber, gradeChem, type MathChecking } from '@engine/grading'
import { LearningController } from '@engine/study/learning'
import { renderCloze } from '@engine/study/cloze'
import type { AssetMeta } from './asset-meta'
import { latexIssues, texProblems } from './tex'
import { approximateDataIssues, blocksPlainText, hintRevealsBlankIssues } from './answer-hygiene'
import {
  checkCardFigure, checkCredit, checkDiagramSteps, checkLabelAnswer, checkLabeled, checkMap, checkModel3D, checkSimulation, checkSlide, checkTimeline
} from './visual-validation'

const issue = (severity: IssueSeverity, path: string, message: string): ContentIssue => ({ severity, path, message })

/** Lo que el validador sabe del curso (por defecto, que todo existe). */
export interface ValidatorOptions {
  math?: MathChecking
  assetExists?: (id: string) => boolean
  sourceExists?: (id: string) => boolean
  /** Ficha de un archivo del curso (medidas, autor, licencia); undefined si no se conoce. */
  assetInfo?: (id: string) => AssetMeta | undefined
  /** ¿Se puede dibujar la página de un material como figura (PDF con esa página o foto)? */
  sourcePageDrawable?: (ref: SourceRef) => boolean
}

/** ¿Ruta de un contenido anidado a demasiada profundidad? (tryit → ejercicio → tryit…, partes dentro de partes) */
export function pathTooDeep(path: string): boolean {
  return new TextEncoder().encode(path).length > 4000 || (path.match(/\[/g)?.length ?? 0) > 40
}

/** ¿Palabras de verdad (no variables ni funciones)? «bacteria» sí; «x», «2a», «sqrt(2)», «pi/2», «theta» no. */
export function looksLikeWords(s: string): boolean {
  const mathWords = new Set(['sqrt', 'cbrt', 'sin', 'cos', 'tan', 'sen', 'log', 'exp', 'abs', 'theta', 'alpha', 'beta', 'gamma', 'delta', 'lambda', 'sigma', 'omega', 'infinity', 'inf', 'frac', 'pi'])
  return s.split(/[^\p{L}]+/u).map((w) => w.toLowerCase()).some((w) => Array.from(w).length >= 4 && !mathWords.has(w))
}

/** Texto con aspecto de expresión matemática (π, raíces, fracciones, potencias…); no fórmulas químicas como H2O. */
export function looksMathematical(s: string): boolean {
  const t = s.trim()
  if (!t || Array.from(t).length > 60 || !(/\p{N}/u.test(t) || t.includes('π'))) return false
  const markers = ['π', 'pi', 'sqrt', '√', '/', '^', '*', '\\frac', '\\pi']
  if (!markers.some((m) => t.toLowerCase().includes(m))) return false
  // palabras de más de 4 letras (salvo funciones) indican una frase, no una expresión
  return !t.split(/[^\p{L}]+/u).map((w) => w.toLowerCase()).some((w) => Array.from(w).length > 4 && !['sqrt', 'frac', 'arcsin', 'arccos', 'arctan'].includes(w))
}

/**
 * LaTeX de una tarjeta cloze tal como se ve: con los huecos ocultos y resueltos (un hueco dentro de una fórmula se dibuja con
 * TeX; si la fórmula no se puede dibujar así, el estudiante vería un error rojo o puntos).
 */
export function clozeTexIssues(front: string, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  const seen = new Set<string>()
  for (const revealed of [false, true]) {
    for (const i of latexIssues(renderCloze(front, revealed), path)) {
      if (seen.has(i.message)) continue
      seen.add(i.message)
      out.push({ ...i, message: `${i.message} (con los huecos ${revealed ? 'resueltos' : 'ocultos'})` })
    }
  }
  return out
}

export class ContentValidator {
  readonly math: MathChecking
  readonly assetExists: (id: string) => boolean
  readonly sourceExists: (id: string) => boolean
  readonly assetInfo: (id: string) => AssetMeta | undefined
  readonly sourcePageDrawable: (ref: SourceRef) => boolean

  constructor(o: ValidatorOptions = {}) {
    this.math = o.math ?? NoMathChecker
    this.assetExists = o.assetExists ?? (() => true)
    this.sourceExists = o.sourceExists ?? (() => true)
    this.assetInfo = o.assetInfo ?? (() => undefined)
    this.sourcePageDrawable = o.sourcePageDrawable ?? (() => true)
  }

  /** El validador con el motor matemático (el que usa la app). */
  static withMath(o: ValidatorOptions = {}): ContentValidator {
    return new ContentValidator({ ...o, math: o.math ?? MathKitChecker })
  }

  /** El mismo validador con otras comprobaciones del curso. */
  with(o: ValidatorOptions): ContentValidator {
    return new ContentValidator({ math: this.math, assetExists: this.assetExists, sourceExists: this.sourceExists, assetInfo: this.assetInfo, sourcePageDrawable: this.sourcePageDrawable, ...o })
  }

  // MARK: Textos

  latexIssues(md: string, path: string): ContentIssue[] {
    return latexIssues(md, path)
  }

  tex(t: string, path: string): ContentIssue[] {
    const s = t.trim()
    if (!s) return [issue('error', path, 'El LaTeX está vacío.')]
    return texProblems(s, path)
  }

  text(s: string, path: string, required = true, max = 6000): ContentIssue[] {
    const out: ContentIssue[] = []
    if (required && !s.trim()) return [issue('error', path, 'El texto está vacío.')]
    const n = Array.from(s).length
    if (n > max) out.push(issue('warning', path, `Texto muy largo (${n} caracteres); divídelo en varios bloques.`))
    out.push(...latexIssues(s, path))
    return out
  }

  // MARK: Bloques

  checkBlock(b: Block, path: string, skill?: Skill): ContentIssue[] {
    if (pathTooDeep(path)) return [issue('error', path, 'Contenido anidado a demasiada profundidad: aplánalo (no pongas ejercicios dentro de ejercicios).')]
    const out: ContentIssue[] = []
    const add = (...xs: ContentIssue[]): void => { out.push(...xs) }
    switch (b.type) {
      case 'text': add(...this.text(b.md, path)); break
      case 'math': add(...this.tex(b.tex, path + '.tex')); if (b.note !== undefined) add(...this.text(b.note, path + '.note', false)); break
      case 'callout': add(...this.text(b.md, path + '.md')); if (b.title !== undefined) add(...latexIssues(b.title, path + '.title')); break
      case 'example':
        add(...this.text(b.problem, path + '.problem'))
        if (!b.steps.length) add(issue('error', path + '.steps', 'Un ejemplo resuelto necesita pasos.'))
        else if (b.steps.length === 1) add(issue('warning', path + '.steps', 'Solo hay un paso; divide el desarrollo en pasos pequeños.'))
        b.steps.forEach((s, i) => add(...this.text(s.md, `${path}.steps[${i}]`)))
        if (b.answer === undefined) add(issue('warning', path + '.answer', 'Falta la respuesta final del ejemplo.'))
        else add(...latexIssues(b.answer, path + '.answer'))
        break
      case 'plot': add(...this.checkPlot(b, path, new Set())); break
      case 'explore': {
        if (!b.params.length) add(issue('error', path + '.params', 'Un bloque explore necesita al menos un parámetro (deslizador).'))
        const seen = new Set<string>()
        b.params.forEach((p, i) => {
          const pp = `${path}.params[${i}]`
          if (Array.from(p.name).length !== 1 || !/^\p{L}$/u.test(p.name)) add(issue('error', pp, 'El nombre del parámetro debe ser una sola letra (a, b, k…).'))
          if (p.name === 'x') add(issue('error', pp, 'El parámetro no puede llamarse x (es la variable de la gráfica).'))
          if (seen.has(p.name)) add(issue('error', pp, `Parámetro repetido «${p.name}».`))
          seen.add(p.name)
          if (!(p.min < p.max)) add(issue('error', pp, 'min debe ser menor que max.'))
          if (p.step <= 0 || p.step > p.max - p.min) add(issue('warning', pp, 'Paso inadecuado.'))
          if (p.value < p.min || p.value > p.max) add(issue('warning', pp, 'El valor inicial está fuera del rango.'))
        })
        add(...this.checkPlot(b.plot, path + '.plot', new Set(b.params.map((p) => p.name))))
        b.prompts.forEach((q, i) => add(...latexIssues(q, `${path}.prompts[${i}]`)))
        break
      }
      case 'table':
        if (!b.headers.length) add(issue('error', path + '.headers', 'La tabla no tiene encabezados.'))
        if (!b.rows.length) add(issue('error', path + '.rows', 'La tabla no tiene filas.'))
        b.rows.forEach((r, i) => { if (r.length !== b.headers.length) add(issue('warning', `${path}.rows[${i}]`, `La fila tiene ${r.length} celdas y hay ${b.headers.length} columnas.`)) })
        b.headers.forEach((h, i) => add(...latexIssues(h, `${path}.headers[${i}]`)))
        b.rows.forEach((r, i) => r.forEach((c, j) => add(...latexIssues(c, `${path}.rows[${i}][${j}]`))))
        break
      case 'chart':
        if (!b.series.length || b.series.every((s) => !s.points.length)) add(issue('error', path + '.series', 'El gráfico no tiene datos.'))
        b.series.forEach((s, i) => s.points.forEach((p, j) => { if (!Number.isFinite(p.y)) add(issue('error', `${path}.series[${i}].points[${j}]`, 'Valor no numérico.')) }))
        if (b.kind === 'pie' && (b.series[0]?.points.length ?? 0) < 2) add(issue('warning', path, 'Un gráfico de sectores necesita al menos 2 partes.'))
        break
      case 'numberline':
        if (!(b.min < b.max)) add(issue('error', path, 'min debe ser menor que max.'))
        if (!b.points.length && !b.intervals.length) add(issue('warning', path, 'La recta numérica está vacía (sin puntos ni intervalos).'))
        b.points.forEach((p, i) => { const e = this.math.checkExpression(p.value, new Set()); if (e) add(issue('error', `${path}.points[${i}].value`, `Valor no válido: ${e}`)) })
        break
      case 'diagram': {
        if (b.nodes.length < 2) add(issue('warning', path + '.nodes', 'Un diagrama necesita al menos 2 nodos.'))
        const ids = b.nodes.map((n) => n.id)
        if (new Set(ids).size !== ids.length) add(issue('error', path + '.nodes', 'Ids de nodo repetidos.'))
        b.edges.forEach((e, i) => { if (!ids.includes(e.from) || !ids.includes(e.to)) add(issue('error', `${path}.edges[${i}]`, `La flecha ${e.from}→${e.to} usa un nodo que no existe.`)) })
        if (b.nodes.length > 14) add(issue('warning', path, 'Más de 14 nodos: se verá apretado; divide el diagrama.'))
        b.nodes.forEach((n, i) => add(...latexIssues(n.label, `${path}.nodes[${i}].label`)))
        add(...checkDiagramSteps(b, path))
        break
      }
      case 'drawing':
        if (!b.items.length) add(issue('error', path + '.items', 'El dibujo está vacío.'))
        if (b.width < 50 || b.height < 50 || b.width > 1200 || b.height > 900) add(issue('warning', path, 'Tamaño de lienzo raro (usa por ejemplo 400×300).'))
        b.items.forEach((it, i) => {
          const p = `${path}.items[${i}]`
          const has = (...v: Array<number | undefined>): boolean => v.every((x) => x !== undefined)
          switch (it.kind) {
            case 'line': case 'arrow': case 'tick': if (!has(it.x1, it.y1, it.x2, it.y2)) add(issue('error', p, `«${it.kind}» necesita x1,y1,x2,y2.`)); break
            case 'polyline': case 'polygon': if ((it.points?.length ?? 0) < 2 || (it.points ?? []).some((q) => q.length < 2)) add(issue('error', p, `«${it.kind}» necesita points: [[x,y],…] con al menos 2 puntos.`)); break
            case 'rect': if (!has(it.x, it.y)) add(issue('error', p, 'rect necesita x, y, w, h.')); break
            case 'circle': case 'dot': case 'arc': case 'angle': if ((it.cx ?? it.x) === undefined || (it.cy ?? it.y) === undefined) add(issue('error', p, `«${it.kind}» necesita cx, cy (y r).`)); break
            case 'ellipse': if ((it.cx ?? it.x) === undefined || (it.cy ?? it.y) === undefined) add(issue('error', p, 'ellipse necesita cx, cy, rx, ry.')); break
            case 'text': {
              const t = it.text ?? it.label ?? ''
              if (!t || !has(it.x, it.y)) add(issue('error', p, 'text necesita x, y y text.'))
              else add(...latexIssues(t, p))
              break
            }
            case 'curve': if ((it.points?.length ?? 0) < 3) add(issue('error', p, 'curve necesita 3 puntos (inicio, control, fin).')); break
            case 'rightAngle': if ((it.cx ?? it.x) === undefined || (it.cy ?? it.y) === undefined) add(issue('error', p, 'rightAngle necesita cx, cy.')); break
          }
          const limit = Math.max(b.width, b.height) + 50
          for (const v of [it.x1, it.y1, it.x2, it.y2, it.x, it.y, it.cx, it.cy]) {
            if (v !== undefined && (v < -50 || v > limit)) { add(issue('warning', p, `Coordenada fuera del lienzo (${v}).`)); break }
          }
        })
        break
      case 'timeline':
        if (b.events.length < 2) add(issue('warning', path, 'Una línea de tiempo necesita al menos 2 eventos.'))
        b.events.forEach((e, i) => add(...latexIssues(e.title, `${path}.events[${i}]`)))
        add(...checkTimeline(this, b, path))
        break
      case 'image':
        if (b.asset === undefined && b.source === undefined) add(issue('error', path, 'La imagen necesita un `asset` o una `source`.'))
        if (b.asset !== undefined && !this.assetExists(b.asset)) add(issue('error', path + '.asset', `El archivo «${b.asset}» no existe en el curso.`))
        if (b.source && !this.sourceExists(b.source.source)) add(issue('error', path + '.source', `La fuente «${b.source.source}» no existe.`))
        if (!b.alt) add(issue('warning', path + '.alt', 'Falta el texto alternativo (alt).'))
        add(...checkCredit(this, b.asset, b.credit, b.caption, path))
        break
      case 'steps':
        if (b.steps.length < 2) add(issue('warning', path, 'Una lista de pasos necesita al menos 2.'))
        b.steps.forEach((s, i) => add(...this.text(s.md, `${path}.steps[${i}]`)))
        break
      case 'compare':
        if (!b.rows.length) add(issue('error', path + '.rows', 'La comparación no tiene filas.'))
        b.rows.forEach((r, i) => add(...latexIssues(r.left, `${path}.rows[${i}].left`), ...latexIssues(r.right, `${path}.rows[${i}].right`)))
        break
      case 'formulas':
        if (!b.items.length) add(issue('error', path + '.items', 'La lista de fórmulas está vacía.'))
        b.items.forEach((it, i) => { add(...this.tex(it.tex, `${path}.items[${i}].tex`)); it.vars.forEach((v, j) => add(...this.tex(v.symbol, `${path}.items[${i}].vars[${j}].symbol`))) })
        break
      case 'predict': {
        add(...this.text(b.question, path + '.question'))
        if (b.options.length < 2) add(issue('error', path + '.options', 'Una pregunta de predicción necesita al menos 2 opciones.'))
        const n = b.options.filter((o) => o.correct).length
        if (n !== 1) add(issue('error', path + '.options', `Debe haber exactamente 1 opción correcta (hay ${n}).`))
        b.options.forEach((o, i) => add(...this.text(o.md, `${path}.options[${i}]`)))
        if (b.explanation === undefined) add(issue('warning', path + '.explanation', 'Falta la explicación que se muestra tras responder.'))
        break
      }
      case 'spot':
        if (b.lines.length < 3) add(issue('warning', path + '.lines', 'Un «encuentra el error» necesita al menos 3 líneas.'))
        if (b.wrongIndex < 0 || b.wrongIndex >= b.lines.length) add(issue('error', path + '.wrongIndex', `wrongIndex debe ser un índice entre 0 y ${Math.max(0, b.lines.length - 1)} (empieza en 0).`))
        b.lines.forEach((l, i) => add(...latexIssues(l, `${path}.lines[${i}]`)))
        add(...this.text(b.explanation, path + '.explanation'))
        break
      case 'tryit':
        if (!b.exerciseIDs.length && !b.inline.length) add(issue('error', path, 'tryit necesita exerciseIDs o inline.'))
        if (skill) for (const id of b.exerciseIDs) if (!skill.exercises.some((e) => e.id === id)) add(issue('error', path + '.exerciseIDs', `El ejercicio «${id}» no existe en esta habilidad (añádelo con add_exercises antes o antes de validar).`))
        b.inline.forEach((e, i) => add(...this.checkExercise(e, `${path}.inline[${i}]`)))
        break
      case 'recap':
        if (b.points.length < 2) add(issue('warning', path, 'Un resumen necesita al menos 2 puntos.'))
        b.points.forEach((p, i) => add(...this.text(p, `${path}.points[${i}]`)))
        break
      case 'code': if (!b.code.trim()) add(issue('error', path, 'El código está vacío.')); break
      case 'quote':
        add(...this.text(b.md, path))
        if (b.source && !this.sourceExists(b.source.source)) add(issue('error', path + '.source', `La fuente «${b.source.source}» no existe.`))
        break
      case 'labeled': add(...checkLabeled(this, b, path)); break
      case 'model3d': add(...checkModel3D(this, b, path)); break
      case 'simulation': add(...checkSimulation(this, b, path)); break
      case 'map': add(...checkMap(b, path)); break
      case 'unknown':
        if (b.rawType === TOO_DEEP_TYPE) add(issue('error', path, 'Contenido anidado a demasiada profundidad (se recortó): aplánalo (no pongas ejercicios dentro de ejercicios).'))
        else add(issue('error', path, `Tipo de bloque desconocido «${blockTypeName(b)}». Tipos válidos: ${BLOCK_TYPES.join(', ')}.`))
        break
    }
    return out
  }

  checkPlot(p: PlotSpec, path: string, params: ReadonlySet<string>): ContentIssue[] {
    const out: ContentIssue[] = []
    if (!p.curves.length && !p.parametric.length && !p.polar.length && !p.points.length && !p.lines.length && !p.regions.length) out.push(issue('error', path, 'La gráfica está vacía: añade curves, points, lines…'))
    if (p.xMin !== undefined && p.xMax !== undefined && p.xMin >= p.xMax) out.push(issue('error', path, 'xMin debe ser menor que xMax.'))
    if (p.yMin !== undefined && p.yMax !== undefined && p.yMin >= p.yMax) out.push(issue('error', path, 'yMin debe ser menor que yMax.'))
    const vars = new Set([...params, 'x'])
    const plus = (extra: string): Set<string> => new Set([...params, extra])
    p.curves.forEach((c, i) => { const e = this.math.checkExpression(c.expr, vars); if (e) out.push(issue('error', `${path}.curves[${i}].expr`, `Expresión «${c.expr}» no válida: ${e}. Usa sintaxis tipo calculadora: 2*sin(3*x), x^2, sqrt(x), abs(x), pi.`)) })
    p.parametric.forEach((c, i) => {
      for (const [n, s] of [['x', c.x], ['y', c.y]] as const) { const e = this.math.checkExpression(s, plus('t')); if (e) out.push(issue('error', `${path}.parametric[${i}].${n}`, `Expresión «${s}» no válida: ${e}.`)) }
      if (c.tMin >= c.tMax) out.push(issue('error', `${path}.parametric[${i}]`, 'tMin debe ser menor que tMax.'))
    })
    p.polar.forEach((c, i) => { const e = this.math.checkExpression(c.r, plus('theta')); if (e) out.push(issue('error', `${path}.polar[${i}].r`, `Expresión «${c.r}» no válida: ${e} (usa theta).`)) })
    p.points.forEach((pt, i) => { for (const s of [pt.x, pt.y]) { const e = this.math.checkExpression(s, params); if (e) out.push(issue('error', `${path}.points[${i}]`, `Coordenada «${s}» no válida: ${e}.`)) } })
    p.lines.forEach((l, i) => {
      const lp = `${path}.lines[${i}]`
      if (l.kind === 'vertical') { if (l.x === undefined) out.push(issue('error', lp, 'La recta vertical necesita x.')) }
      else if (l.kind === 'horizontal') { if (l.y === undefined) out.push(issue('error', lp, 'La recta horizontal necesita y.')) }
      else if (l.x1 === undefined || l.y1 === undefined || l.x2 === undefined || l.y2 === undefined) out.push(issue('error', lp, 'Necesita x1,y1,x2,y2.'))
      for (const s of [l.x, l.y, l.x1, l.y1, l.x2, l.y2]) { if (s === undefined) continue; const e = this.math.checkExpression(s, params); if (e) out.push(issue('error', lp, `Valor «${s}» no válido: ${e}.`)) }
    })
    p.regions.forEach((r, i) => {
      for (const s of [r.upper, r.lower]) {
        if (r.upper === 'inf' || r.upper === 'top') continue
        const e = this.math.checkExpression(s, vars)
        if (e) out.push(issue('error', `${path}.regions[${i}]`, `Expresión «${s}» no válida: ${e}.`))
      }
    })
    p.labels.forEach((l, i) => out.push(...latexIssues(l.tex, `${path}.labels[${i}]`)))
    return out
  }

  // MARK: Ejercicios

  /** `lessonText`: el texto de la lección de su habilidad (para «con los datos de la lección»). */
  checkExercise(e: Exercise, path: string, lessonText = ''): ContentIssue[] {
    if (pathTooDeep(path)) return [issue('error', path, 'Contenido anidado a demasiada profundidad: aplánalo (no pongas ejercicios dentro de ejercicios).')]
    const out: ContentIssue[] = []
    if (!e.prompt.length) out.push(issue('error', path + '.prompt', 'El enunciado está vacío.'))
    e.prompt.forEach((b, i) => out.push(...this.checkBlock(b, `${path}.prompt[${i}]`)))
    if (!(e.level >= 1 && e.level <= 3)) out.push(issue('error', path + '.level', 'level debe ser 1, 2 o 3.'))
    out.push(...this.checkAnswer(e.answer, path + '.answer', e.prompt))
    if (e.hints.length > 4) out.push(issue('warning', path + '.hints', 'Más de 4 pistas; usa 2 o 3, de la más sutil a la más directa.'))
    e.hints.forEach((h, i) => out.push(...this.text(h, `${path}.hints[${i}]`)))
    if (!e.solution.length && e.level >= 2) out.push(issue('warning', path + '.solution', 'Falta la solución paso a paso (importante en niveles 2 y 3).'))
    e.solution.forEach((b, i) => out.push(...this.checkBlock(b, `${path}.solution[${i}]`)))
    if (e.wrongs.length > 20) out.push(issue('warning', path + '.wrongs', `Hay ${e.wrongs.length} errores típicos: deja los más frecuentes (como mucho 20).`))
    e.wrongs.forEach((w, i) => {
      if (!w.input || !w.why) out.push(issue('error', `${path}.wrongs[${i}]`, 'Cada error típico necesita `input` y `why`.'))
      out.push(...latexIssues(w.why, `${path}.wrongs[${i}].why`))
    })
    if (e.points <= 0 || e.points > 100) out.push(issue('warning', path + '.points', 'Puntos fuera de rango.'))
    if (e.source && !this.sourceExists(e.source.source)) out.push(issue('warning', path + '.source', `La fuente «${e.source.source}» no existe.`))
    out.push(...approximateDataIssues(e, path, lessonText), ...hintRevealsBlankIssues(e, path))
    if (!out.some((i) => i.severity === 'error')) out.push(...this.math.selfCheck(e))
    return out
  }

  checkAnswer(raw: Answer, path: string, prompt: readonly Block[]): ContentIssue[] {
    if (pathTooDeep(path)) return [issue('error', path, 'Respuesta anidada a demasiada profundidad: no se permiten partes dentro de partes.')]
    const out: ContentIssue[] = []
    const a = answerForGrading(raw)
    switch (a.kind) {
      case 'choice': {
        if (a.options.length < 2) out.push(issue('error', path + '.options', 'Una opción múltiple necesita al menos 2 opciones.'))
        const n = a.options.filter((o) => o.correct).length
        if (n === 0) out.push(issue('error', path + '.options', 'Ninguna opción está marcada como correcta (correct: true).'))
        if (n > 1 && !a.multi) out.push(issue('error', path + '.options', `Hay ${n} opciones correctas pero multi es false.`))
        if (new Set(a.options.map((o) => o.md.trim().toLowerCase())).size !== a.options.length) out.push(issue('warning', path + '.options', 'Hay opciones repetidas.'))
        if (new Set(a.options.map((o) => o.id)).size !== a.options.length) out.push(issue('error', path + '.options', 'Ids de opción repetidos.'))
        a.options.forEach((o, i) => {
          out.push(...this.text(o.md, `${path}.options[${i}]`))
          if (!o.correct && !o.why) out.push(issue('info', `${path}.options[${i}]`, 'Conviene explicar por qué esta opción es incorrecta (`why`).'))
        })
        if (a.options.length > 6) out.push(issue('warning', path, 'Más de 6 opciones es mucho; usa 3–5.'))
        break
      }
      case 'numeric': {
        const e = this.math.checkNumericValue(a.value)
        if (e) out.push(issue('error', path + '.value', `Valor correcto no válido «${a.value}»: ${e}.`))
        a.alternatives.forEach((alt, i) => { const x = this.math.checkNumericValue(alt); if (x) out.push(issue('error', `${path}.alternatives[${i}]`, `«${alt}»: ${x}.`)) })
        if (!['any', 'fraction', 'reducedFraction', 'integer', 'decimal', 'scientific', 'percent', 'mixedNumber'].includes(a.form)) out.push(issue('error', path + '.form', `form no válido «${a.form}».`))
        if (!['required', 'optional', 'ignore'].includes(a.unitMode)) out.push(issue('error', path + '.unitMode', 'unitMode debe ser required, optional o ignore.'))
        if (a.absTol < 0 || a.relTol < 0) out.push(issue('error', path, 'Las tolerancias no pueden ser negativas.'))
        break
      }
      case 'expression': { const e = this.math.checkExpression(a.expected, null); if (e) out.push(issue('error', path + '.expected', `Expresión «${a.expected}» no válida: ${e}.`)); break }
      case 'equation': if (!a.expected.includes('=')) out.push(issue('error', path + '.expected', 'Una ecuación debe contener «=».')); break
      case 'set':
        // «selecciona todos los que…» con palabras no es un conjunto matemático: plurales y sinónimos fallarían
        if (a.expected.some(looksLikeWords)) out.push(issue('warning', path, `Las respuestas de \`set\` son palabras («${a.expected[0] ?? ''}»): para «selecciona todos los que…» usa \`choice\` con \`multi: true\` (o \`short\` con sinónimos); \`set\` es para conjuntos matemáticos como las soluciones de una ecuación.`))
        if (!a.expected.length) out.push(issue('error', path + '.expected', 'El conjunto de respuestas está vacío.'))
        a.expected.forEach((x, i) => {
          const e = this.math.checkExpression(x, null)
          if (e && !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(x.trim())) out.push(issue('warning', `${path}.expected[${i}]`, `«${x}»: ${e}. (Si es texto, usa una respuesta \`short\` o \`cloze\`.)`))
        })
        break
      case 'interval': if (!a.expected.trim()) out.push(issue('error', path, 'Intervalo vacío.')); break
      case 'point': if (a.expected.length < 2 || a.expected.length > 3) out.push(issue('error', path + '.expected', 'Un punto necesita 2 o 3 coordenadas.')); break
      case 'short': {
        if (!a.accepted.length && !a.keywords.length && !a.aiGrade) out.push(issue('error', path, 'Respuesta corta sin `accepted` ni `keywords` ni `aiGrade`.'))
        // una respuesta matemática como texto solo acepta las formas listadas: mejor `expression`/`numeric`
        const first = a.accepted[0]
        if (first !== undefined && a.accepted.every(looksMathematical) && this.math.checkExpression(first, null) === undefined) {
          out.push(issue('warning', path, `«${first}» es una respuesta matemática: usa \`kind: expression\` (o \`numeric\`) con \`expected\` para aceptar cualquier forma equivalente (3π/2, 3*pi/2, 1.5π…) y reconocer los errores típicos con \`wrongs\`.`))
        }
        break
      }
      case 'cloze': {
        const source = a.text === '' ? prompt.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.md).join(' ') : a.text
        const markers = source.match(/\[\[(\d+)\]\]/g)?.length ?? 0
        if (!a.blanks.length) out.push(issue('error', path + '.blanks', 'No hay huecos definidos.'))
        if (markers !== a.blanks.length) out.push(issue('error', path, `El texto tiene ${markers} marcas [[n]] y hay ${a.blanks.length} huecos definidos.`))
        a.blanks.forEach((b, i) => { if (!b.accepted.length) out.push(issue('error', `${path}.blanks[${i}]`, 'El hueco no tiene respuestas aceptadas.')) })
        break
      }
      case 'ordering':
        if (a.items.length < 2) out.push(issue('error', path + '.items', 'Ordenar necesita al menos 2 elementos.'))
        if (new Set(a.items).size !== a.items.length) out.push(issue('error', path + '.items', 'Hay elementos repetidos (no se podría calificar el orden).'))
        if (a.items.length > 8) out.push(issue('warning', path + '.items', 'Más de 8 elementos es difícil de ordenar.'))
        break
      case 'matching':
        if (a.pairs.length < 2) out.push(issue('error', path + '.pairs', 'Relacionar necesita al menos 2 pares.'))
        if (new Set(a.pairs.map((p) => p.left)).size !== a.pairs.length) out.push(issue('error', path + '.pairs', 'Hay elementos de la izquierda repetidos.'))
        if (new Set(a.pairs.map((p) => p.right)).size !== a.pairs.length) out.push(issue('warning', path + '.pairs', 'Hay elementos de la derecha repetidos; la relación podría ser ambigua.'))
        break
      case 'truefalse': break
      case 'chem': {
        const key = a.expected.trim()
        if (!key) { out.push(issue('error', path + '.expected', 'Falta la respuesta esperada (`expected`).')); break }
        if (a.mode === 'number') {
          if (chemNumber(key) === undefined) out.push(issue('error', path + '.expected', `«${key}» no es un número (para \`mode: number\` escribe solo el valor; la unidad va en \`unit\`).`))
          break
        }
        // la clave debe entenderse y corregirse a sí misma como correcta
        const self = gradeChem(a, key)
        if (self.status !== 'correct') {
          const why = self.feedback[0]?.markdown ?? 'no se reconoce'
          out.push(issue('error', path + '.expected', `La clave «${Array.from(key).slice(0, 60).join('')}» no es válida para \`mode: ${a.mode}\`: ${why} (compruébala con la herramienta \`chemistry\`).`))
        }
        break
      }
      case 'label': out.push(...checkLabelAnswer(this, a, path)); break
      case 'open':
        if (!a.rubric.length) out.push(issue('error', path + '.rubric', 'Una respuesta abierta necesita una rúbrica.'))
        if (!a.modelAnswer) out.push(issue('error', path + '.modelAnswer', 'Falta la respuesta modelo.'))
        break
      case 'multi':
        if (a.parts.length < 2) out.push(issue('error', path + '.parts', 'Un ejercicio de varias partes necesita al menos 2 partes.'))
        if (new Set(a.parts.map((p) => p.label)).size !== a.parts.length) out.push(issue('error', path + '.parts', 'Etiquetas de parte repetidas.'))
        a.parts.forEach((p, i) => {
          if (p.answer.kind === 'multi') out.push(issue('error', `${path}.parts[${i}]`, 'No se permiten partes dentro de partes.'))
          p.prompt.forEach((b, j) => out.push(...this.checkBlock(b, `${path}.parts[${i}].prompt[${j}]`)))
          out.push(...this.checkAnswer(p.answer, `${path}.parts[${i}].answer`, p.prompt))
        })
        break
    }
    return out
  }

  // MARK: Plantillas, tarjetas, presentaciones

  checkTemplate(t: ExerciseTemplate, path: string): ContentIssue[] {
    const out: ContentIssue[] = []
    const size = new TextEncoder().encode(compactJSON(encodeTemplate(t))).length
    if (size > MAX_TEMPLATE_BYTES) out.push(issue('error', path, `La plantilla es demasiado grande (${Math.floor(size / 1000)} KB; máximo ${MAX_TEMPLATE_BYTES / 1000} KB): divídela.`))
    if (!t.vars.length) out.push(issue('warning', path + '.vars', 'Una plantilla sin variables produce siempre el mismo ejercicio; usa un ejercicio normal.'))
    const names = new Set<string>()
    t.vars.forEach((v, i) => {
      const p = `${path}.vars[${i}]`
      if (!v.name || !/^[\p{L}\p{N}_]+$/u.test(v.name) || /^\p{N}/u.test(v.name)) out.push(issue('error', p, `Nombre de variable no válido «${v.name}» (letras, números y _).`))
      if (names.has(v.name)) out.push(issue('error', p, `Variable repetida «${v.name}».`))
      names.add(v.name)
      switch (v.kind) {
        case 'int': if (v.min === undefined || v.max === undefined || v.min > v.max) out.push(issue('error', p, 'int necesita min ≤ max.')); break
        case 'real': if (v.min === undefined || v.max === undefined || v.min >= v.max) out.push(issue('error', p, 'real necesita min < max.')); break
        case 'pick': if (!v.values.length) out.push(issue('error', p, 'pick necesita `values`.')); break
        case 'fraction': if (v.minDen === undefined || v.maxDen === undefined) out.push(issue('error', p, 'fraction necesita minDen y maxDen.')); break
        case 'expr':
          if (v.expr === undefined) out.push(issue('error', p, 'expr necesita `expr`.'))
          else { const err = this.math.checkExpression(v.expr, names); if (err) out.push(issue('error', p, `Expresión «${v.expr}»: ${err}`)) }
          break
        default: out.push(issue('error', p, `kind no válido «${v.kind}» (int, real, pick, fraction, expr).`))
      }
    })
    if (t.vars.length > 60 || t.constraints.length > 60) out.push(issue('error', path, `Demasiadas variables o restricciones (${t.vars.length} y ${t.constraints.length}); usa como mucho 60 de cada.`))
    t.constraints.slice(0, 60).forEach((c, i) => {
      const err = this.math.checkExpression(c.split('==').join('=').split('!=').join('='), names)
      if (err) out.push(issue('warning', `${path}.constraints[${i}]`, `Restricción «${c}»: ${err}`))
    })
    // las plantillas contienen {{…}}: no se comprueba el LaTeX de los textos sin instanciar, solo la estructura
    if (!t.prompt.length) out.push(issue('error', path + '.prompt', 'El enunciado está vacío.'))
    if (!(t.level >= 1 && t.level <= 3)) out.push(issue('error', path + '.level', 'level debe ser 1, 2 o 3.'))
    return out
  }

  checkCard(c: Flashcard, path: string): ContentIssue[] {
    const out: ContentIssue[] = []
    if (!c.front.trim()) out.push(issue('error', path + '.front', 'El frente está vacío.'))
    if (c.kind === 'cloze') { if (!c.front.includes('{{c1::')) out.push(issue('error', path + '.front', 'Una tarjeta cloze necesita «{{c1::respuesta}}».')) }
    else if (!c.back.trim()) out.push(issue('error', path + '.back', 'El reverso está vacío.'))
    out.push(...(c.kind === 'cloze' ? clozeTexIssues(c.front, path + '.front') : latexIssues(c.front, path + '.front')), ...latexIssues(c.back, path + '.back'))
    if (Array.from(c.front).length > 400 || Array.from(c.back).length > 800) out.push(issue('warning', path, 'Tarjeta demasiado larga: una idea por tarjeta.'))
    if (c.figure) out.push(...checkCardFigure(this, c.figure, path + '.figure'))
    return out
  }

  checkDeck(d: Deck, path: string, skill?: Skill): ContentIssue[] {
    const out: ContentIssue[] = []
    if (!d.slides.length) out.push(issue('error', path + '.slides', 'La presentación no tiene diapositivas.'))
    if (d.theme && canonicalDeckTheme(d.theme) === 'aula' && !['aula', 'default'].includes(d.theme.toLowerCase())) {
      out.push(issue('warning', path + '.theme', `Tema «${d.theme}» desconocido: se usará «aula». Temas: aula, minimal, academic, midnight, chalk.`))
    }
    d.slides.forEach((s, i) => {
      const p = `${path}.slides[${i}]`
      if (!s.blocks.length && s.layout !== 'title' && s.layout !== 'section' && !(s.layout === 'image' && s.image !== undefined)) out.push(issue('warning', p, 'Diapositiva sin contenido.'))
      if (s.layout === 'twoColumn' && !s.right.length) out.push(issue('warning', p, 'twoColumn necesita contenido en `right`.'))
      out.push(...checkSlide(this, s, p))
      s.blocks.forEach((b, j) => out.push(...this.checkBlock(b, `${p}.blocks[${j}]`, skill)))
      s.right.forEach((b, j) => out.push(...this.checkBlock(b, `${p}.right[${j}]`, skill)))
    })
    return out
  }

  // MARK: Habilidad completa

  checkSkill(s: Skill, _pack?: Pack): ContentIssue[] {
    const out: ContentIssue[] = []
    s.lesson.forEach((b, i) => out.push(...this.checkBlock(b, `lesson[${i}]`, s)))
    const lessonText = blocksPlainText(s.lesson)
    for (const e of s.exercises) out.push(...this.checkExercise(e, `exercises[${e.id}]`, lessonText))
    for (const t of s.templates) out.push(...this.checkTemplate(t, `templates[${t.id}]`))
    for (const c of s.cards) out.push(...this.checkCard(c, `cards[${c.id}]`))
    for (const d of s.decks) out.push(...this.checkDeck(d, `decks[${d.id}]`, s))
    // duplicados
    const dupes = (ids: string[], kind: string): void => {
      const seen = new Set<string>()
      for (const id of ids) { if (seen.has(id)) out.push(issue('error', kind, `Id repetido «${id}».`)); seen.add(id) }
    }
    dupes([...s.exercises.map((e) => e.id), ...s.templates.map((t) => t.id)], 'exercises/templates')
    dupes(s.cards.map((c) => c.id), 'cards')
    const plain = (blocks: readonly Block[]): string => blocks.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.md).join(' ').toLowerCase().replace(/\s+/g, '')
    const seenPrompts = new Map<string, string>()
    for (const e of s.exercises) {
      const k = plain(e.prompt)
      const other = seenPrompts.get(k)
      if (Array.from(k).length > 20 && other !== undefined) out.push(issue('warning', `exercises[${e.id}]`, `Enunciado idéntico al de «${other}».`))
      else seenPrompts.set(k, e.id)
    }
    // cobertura
    const kinds = new Set(s.lesson.map(blockTypeName))
    if (!s.lesson.length) out.push(issue('warning', 'lesson', 'La habilidad no tiene lección.'))
    else {
      if (!kinds.has('predict') && !kinds.has('spot')) out.push(issue('info', 'lesson', 'Conviene incluir al menos una pregunta de predicción (predict) para activar el conocimiento previo.'))
      if (!kinds.has('example')) out.push(issue('warning', 'lesson', 'Falta un ejemplo resuelto (example).'))
      if (!kinds.has('tryit')) out.push(issue('info', 'lesson', 'Conviene incluir ejercicios incrustados (tryit) dentro de la lección.'))
      if (!kinds.has('recap')) out.push(issue('info', 'lesson', 'Falta un resumen final (recap).'))
    }
    // modo guiado: dos aciertos con preguntas distintas, y tras un error la fallada no vuelve
    for (const concept of LearningController.concepts(s)) {
      const n = LearningController.objectiveCheckCount(concept, s)
      if (!(n > 0 && n < 4)) continue
      out.push(issue('warning', `lesson[${concept.id}]`, `El concepto «${concept.title}» solo tiene ${n} preguntas que se corrigen solas y ninguna plantilla: el modo guiado pide dos aciertos y, tras un error, la fallada no vuelve. Enlaza al menos 4 en su tryit o añade una plantilla.`))
    }
    const n = s.exercises.length + s.templates.length
    if (n < 8) out.push(issue('warning', 'exercises', `Solo hay ${n} ejercicios/plantillas (se recomiendan 10 o más).`))
    const levels = new Set([...s.exercises.map((e) => e.level), ...s.templates.map((t) => t.level)])
    if (!levels.has(1) || !levels.has(3)) out.push(issue('info', 'exercises', `Conviene cubrir los niveles 1 (básico) y 3 (nivel examen); hay [${[...levels].sort((a, b) => a - b).join(', ')}].`))
    if (s.cards.length < 5) out.push(issue('info', 'cards', `Pocas tarjetas (${s.cards.length}); se recomiendan 8 o más.`))
    return out
  }

  /** Ids de esta habilidad que también usa OTRA del curso (el progreso los indexa por id en todo el curso). */
  static crossSkillDuplicates(s: Skill, exerciseIDs: ReadonlySet<string>, cardIDs: ReadonlySet<string>): ContentIssue[] {
    const out: ContentIssue[] = []
    for (const id of [...s.exercises.map((e) => e.id), ...s.templates.map((t) => t.id)]) {
      if (exerciseIDs.has(id)) out.push(issue('warning', `exercises[${id}]`, `El id «${id}» también lo usa otra habilidad del curso: dale uno propio (p. ej. «${s.id}-${id}») y borra el viejo.`))
    }
    for (const id of s.cards.map((c) => c.id)) {
      if (cardIDs.has(id)) out.push(issue('warning', `cards[${id}]`, `El id de tarjeta «${id}» también lo usa otra habilidad del curso: dale uno propio y borra el viejo.`))
    }
    return out
  }
}
