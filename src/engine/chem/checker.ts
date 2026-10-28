// Corrección de fórmulas, nombres, ecuaciones y configuraciones escritas por el alumno, con explicaciones concretas
// (localizadas: las ve el alumno).

import { balanceEquation } from './balancer'
import { ElectronConfiguration } from './electron-config'
import { localizedElementName, PeriodicTable } from './elements'
import { ChemicalEquation, effectiveCoefficient, type Term } from './equation'
import { errorMessage } from './errors'
import { AtomKey, compositionsEqual, Formula, localizedPhysicalStateTitle } from './formula'
import { elementComposition } from './ion-table'
import { L } from './l10n'
import { formulaForName, nameOf } from './nomenclature'
import { parseFormula } from './parser'
import { Rational } from './rational'
import { SigFigs } from './sigfigs'
import { chargeText, fold, trimSpaces } from './text'
import type { ChemCheck } from './types'

const tryParse = (text: string): Formula | null => {
  try {
    return parseFormula(text)
  } catch {
    return null
  }
}

// MARK: Fórmulas

/**
 * Compara la fórmula del alumno con la esperada.
 * - `correct`: la misma fórmula (o la desarrollada de la fórmula molecular pedida).
 * - `partial`: los mismos átomos escritos de otra forma (CH3COOH ↔ C2H4O2), o estado/coeficiente distintos.
 * - `incorrect`: otra sustancia (con el detalle de qué falta o sobra).
 * - `invalid`: no se puede leer.
 */
export function checkFormula(student: string, expected: string): ChemCheck {
  let e: Formula
  try {
    e = parseFormula(expected)
  } catch (error) {
    // La referencia puede venir como nombre («sulfato de hierro(III)»).
    const byName = formulaForName(expected)
    if (!byName) return { status: 'invalid', feedback: L('La fórmula de referencia «%@» no se puede leer: %@', expected, errorMessage(error, '')) }
    e = byName
  }
  let s: Formula
  try {
    s = parseFormula(student)
  } catch (error) {
    const named = formulaForName(student)
    if (named) {
      const ok = named.isSameSpecies(e)
      return ok
        ? { status: 'partial', feedback: L('Has escrito el nombre; se pide la fórmula: %@.', e.withoutCoefficient().unicodeText) }
        : { status: 'incorrect', feedback: L('Has escrito un nombre (%@) y además no es la sustancia pedida.', named.unicodeText) }
    }
    return { status: 'invalid', feedback: L('No puedo leer tu fórmula: %@', errorMessage(error, '')) }
  }
  const eText = e.text('unicode', false, false)
  const sText = s.text('unicode', false, false)
  const extra: string[] = []
  let downgrade = false
  if (e.coefficient && !(s.coefficient ?? Rational.ONE).equals(e.coefficient)) {
    extra.push(L('El coeficiente debería ser %@.', e.coefficient.toString()))
    downgrade = true
  }
  if (e.state && s.state && e.state !== s.state) {
    extra.push(L('El estado debería ser (%@), %@, no (%@).', e.state, localizedPhysicalStateTitle(e.state), s.state))
    downgrade = true
  }
  // Frases completas añadidas detrás.
  const tail = extra.length === 0 ? '' : ' ' + extra.join(' ')
  switch (s.compare(e)) {
    case 'identical':
      return downgrade
        ? { status: 'partial', feedback: L('La fórmula %@ está bien.', sText) + tail }
        : { status: 'correct', feedback: L('¡Correcto! %@.', sText) }
    case 'sameComposition':
      // ¿Se pedía la fórmula molecular «plana»? Entonces la desarrollada también vale.
      if (e.identityKey === e.condensed.identityKey) {
        return {
          status: downgrade ? 'partial' : 'correct',
          feedback: L('Correcto: %@ tiene los mismos átomos que %@ (la has escrito de forma desarrollada).', sText, eText) + tail,
        }
      }
      return {
        status: 'partial',
        feedback:
          L('Tiene los mismos átomos, pero está escrita de otra forma: se esperaba %@, no %@. Comprueba si te piden la fórmula desarrollada o la molecular.', eText, sText) +
          tail,
      }
    case 'sameEmpiricalFormula':
      return {
        status: 'incorrect',
        feedback: L(
          'La proporción de átomos es correcta, pero no el número: %@ tiene %lld átomos y %@ tiene %lld. ¿Has escrito la fórmula empírica en lugar de la molecular (o al revés)?',
          sText,
          s.atomCount,
          eText,
          e.atomCount,
        ),
      }
    case 'differentCharge': {
      const want = chargeText(e.charge)
      const have = chargeText(s.charge)
      let feedback: string
      if (e.charge === 0) feedback = L('Los átomos están bien, pero la especie debería ser neutra y la has escrito con carga %@.', have)
      else if (s.charge === 0) feedback = L('Los átomos están bien, pero la especie debería ser de carga %@ y la has escrito sin carga.', want)
      else feedback = L('Los átomos están bien, pero la especie debería ser de carga %@ y la has escrito con carga %@.', want, have)
      return { status: 'incorrect', feedback }
    }
    case 'different': {
      const problems: string[] = []
      if (fold(trimSpaces(student)) === fold(trimSpaces(expected))) {
        problems.push(L('Revisa las mayúsculas: en química «Co» (cobalto) no es lo mismo que «CO» (monóxido de carbono).'))
      }
      const sc = elementComposition(s.composition)
      const ec = elementComposition(e.composition)
      const order = Formula.conventionalOrder([...new Set([...sc.keys(), ...ec.keys()])].map((z) => AtomKey.of(z)))
      for (const k of order) {
        const z = k.atomicNumber
        const sym = k.element.symbol
        const have = sc.get(z)
        const want = ec.get(z)
        if (have === undefined && want !== undefined) problems.push(L('Falta el %@ (debería haber %lld).', sym, want))
        else if (have !== undefined && want === undefined) problems.push(L('Sobra el %@: no forma parte de %@.', sym, eText))
        else if (have !== undefined && want !== undefined && have !== want) problems.push(L('Debería haber %lld %@ y tienes %lld.', want, sym, have))
      }
      if (s.charge !== e.charge) problems.push(L('La carga debería ser %@.', e.charge === 0 ? '0' : chargeText(e.charge)))
      if (problems.length === 0) problems.push(L('No es la fórmula esperada (%@).', eText))
      return { status: 'incorrect', feedback: L('No es correcta: %@', problems.join(' ')) }
    }
  }
}

// MARK: Nombres

/**
 * Corrige el nombre de un compuesto. `expected` puede ser la fórmula («Fe2(SO4)3») o un nombre válido. Se acepta
 * cualquier nomenclatura correcta (Stock, tradicional o sistemática) de la misma sustancia (vocabulario en español).
 */
export function checkName(student: string, expected: string): ChemCheck {
  const parsed = tryParse(expected)
  const target = parsed ? parsed.withoutCoefficient() : formulaForName(expected)
  if (!target) return { status: 'invalid', feedback: L('No entiendo la referencia «%@».', expected) }
  const reference = nameOf(target)
  const studentFormula = formulaForName(student)
  if (!studentFormula) {
    if (tryParse(student)) {
      if (reference) return { status: 'incorrect', feedback: L('Has escrito una fórmula; se pide el nombre: %@.', reference.name) }
      return { status: 'incorrect', feedback: L('Has escrito una fórmula; se pide el nombre.') }
    }
    return {
      status: 'invalid',
      feedback: L('No reconozco «%@» como nombre de un compuesto. Revisa la ortografía (por ejemplo «sulfato de hierro(III)»).', student),
    }
  }
  if (studentFormula.isSameSpecies(target) && studentFormula.charge === target.charge) {
    if (reference && fold(reference.name) !== fold(student)) return { status: 'correct', feedback: L('¡Correcto! (también se llama %@)', reference.name) }
    return { status: 'correct', feedback: L('¡Correcto!') }
  }
  const sentences = [L('Ese nombre corresponde a %@, no a %@.', studentFormula.withoutCoefficient().unicodeText, target.unicodeText)]
  if (reference) sentences.push(L('El nombre correcto es %@.', reference.name))
  const sameElements =
    studentFormula.elements.length === target.elements.length && studentFormula.elements.every((x, i) => x === target.elements[i])
  if (sameElements && !compositionsEqual(studentFormula.composition, target.composition)) {
    sentences.push(L('Revisa los subíndices o el número de oxidación (romano) del metal.'))
  }
  return { status: 'incorrect', feedback: sentences.join(' ') }
}

// MARK: Ecuaciones

/** Coeficientes por especie y lado, sumando las repetidas («2H2+2H2+2O2→4H2O» es «4H2+2O2→4H2O»). */
function coefficientMap(eq: ChemicalEquation): Map<string, Rational> {
  const d = new Map<string, Rational>()
  const add = (prefix: string, terms: readonly Term[]): void => {
    for (const t of terms) {
      const key = prefix + t.formula.condensed.identityKey
      d.set(key, (d.get(key) ?? Rational.ZERO).add(effectiveCoefficient(t)))
    }
  }
  add('R:', eq.reactants)
  add('P:', eq.products)
  return d
}

function mapsEqual(a: Map<string, Rational>, b: Map<string, Rational>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (!v.equals(b.get(k))) return false
  return true
}

/**
 * Compara la ecuación del alumno con la esperada: especies, lados, balanceo (átomos y carga) y si los coeficientes son
 * los mínimos o un múltiplo. Los mensajes son concretos («Hay 4 O a la izquierda y 3 a la derecha»).
 */
export function checkEquation(student: string, expected: string): ChemCheck {
  let exp: ChemicalEquation
  try {
    exp = ChemicalEquation.parse(expected)
  } catch (error) {
    return { status: 'invalid', feedback: L('La ecuación de referencia no se puede leer: %@', errorMessage(error, '')) }
  }
  let stu: ChemicalEquation
  try {
    stu = ChemicalEquation.parse(student)
  } catch (error) {
    return { status: 'invalid', feedback: L('No puedo leer tu ecuación: %@', errorMessage(error, '')) }
  }
  const notes: string[] = []
  // 1. Especies y lados.
  const keys = (terms: readonly Term[]): Set<string> => new Set(terms.map((t) => t.formula.condensed.identityKey))
  const sR = keys(stu.reactants)
  const sP = keys(stu.products)
  const eR = keys(exp.reactants)
  const eP = keys(exp.products)
  const setEq = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x))
  const display = (key: string, eq: ChemicalEquation): string =>
    eq.terms.find((t) => t.formula.condensed.identityKey === key)?.formula.text('unicode', false, false) ?? key
  if (!setEq(sR, eR) || !setEq(sP, eP)) {
    if (setEq(sR, eP) && setEq(sP, eR)) {
      const reactants = exp.reactants.map((t) => t.formula.unicodeText).join(' + ')
      const products = exp.products.map((t) => t.formula.unicodeText).join(' + ')
      return { status: 'incorrect', feedback: L('Has escrito la reacción al revés: los reactivos son %@ y los productos %@.', reactants, products) }
    }
    const problems: string[] = []
    for (const k of eR) {
      if (sR.has(k)) continue
      const species = display(k, exp)
      problems.push(sP.has(k) ? L('El %@ es un reactivo, no un producto.', species) : L('Falta el %@ en los reactivos.', species))
    }
    for (const k of eP) {
      if (sP.has(k)) continue
      const species = display(k, exp)
      problems.push(sR.has(k) ? L('El %@ es un producto, no un reactivo.', species) : L('Falta el %@ en los productos.', species))
    }
    for (const k of sR) if (!eR.has(k) && !eP.has(k)) problems.push(L('Sobra el %@ en los reactivos.', display(k, stu)))
    for (const k of sP) if (!eP.has(k) && !eR.has(k)) problems.push(L('Sobra el %@ en los productos.', display(k, stu)))
    problems.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    return { status: 'incorrect', feedback: L('Las especies no coinciden con las de la reacción: %@', problems.join(' ')) }
  }
  if (stu.terms.some((t) => !exp.terms.some((x) => x.formula.identityKey === t.formula.identityKey))) {
    notes.push(L('Alguna fórmula está escrita de otra forma, pero representa la misma sustancia.'))
  }
  // 2. Balanceo con los coeficientes del alumno.
  const l = stu.atomTotals('reactants')
  const r = stu.atomTotals('products')
  const issues: string[] = []
  for (const k of Formula.conventionalOrder([...new Set([...l.keys(), ...r.keys()])])) {
    const a = l.get(k) ?? Rational.ZERO
    const b = r.get(k) ?? Rational.ZERO
    if (!a.equals(b)) issues.push(L('Hay %@ %@ a la izquierda y %@ a la derecha.', a.toString(), k.symbol, b.toString()))
  }
  const ql = stu.chargeTotal('reactants')
  const qr = stu.chargeTotal('products')
  if (!ql.equals(qr)) {
    issues.push(L('La carga total es %@ a la izquierda y %@ a la derecha: no se conserva.', ql.signedString(), qr.signedString()))
  }
  if (issues.length > 0) {
    return { status: 'incorrect', feedback: [L('Las especies son las correctas, pero no está balanceada.'), ...issues].join(' ') }
  }
  // 3. ¿Coeficientes mínimos?
  if (stu.arrow !== exp.arrow) {
    notes.push(exp.arrow === 'reversible' ? L('Es un equilibrio: usa la doble flecha (⇌).') : L('Esta reacción se escribe con una flecha simple (→).'))
  }
  // Los estados se comparan con la especie del MISMO lado: H₂O(s) → H₂O(l) es un cambio de fase válido.
  for (const [studentTerms, expectedTerms] of [
    [stu.reactants, exp.reactants],
    [stu.products, exp.products],
  ] as const) {
    for (const t of studentTerms) {
      const st = t.formula.state
      const et = expectedTerms.find((x) => x.formula.condensed.identityKey === t.formula.condensed.identityKey)?.formula.state
      if (st && et && st !== et) notes.push(L('Revisa el estado del %@: debería ser (%@).', t.formula.withoutState().unicodeText, et))
    }
  }
  const noteText = notes.length === 0 ? '' : ' ' + notes.join(' ')
  const studentCoefs = coefficientMap(stu)
  const expectedCoefs = coefficientMap(exp)
  // Si la referencia ya trae coeficientes balanceados (aunque sean fraccionarios), deben coincidir.
  if (exp.isBalanced && exp.terms.some((t) => t.coefficient !== null) && mapsEqual(expectedCoefs, studentCoefs)) {
    return { status: 'correct', feedback: L('¡Correcto! Está bien balanceada.') + noteText }
  }
  // Clave balanceada con algún coeficiente fraccionario (ecuación de formación: H2 + 1/2 O2 → H2O): esa proporción
  // concreta es lo que se pide; un múltiplo está balanceado, pero no es la respuesta.
  if (exp.isBalanced && [...expectedCoefs.values()].some((v) => !v.isInteger)) {
    let ratio: Rational | null = null
    let proportional = true
    for (const [k, sc] of studentCoefs) {
      const ec = expectedCoefs.get(k)
      const q = ec ? sc.div(ec) : null
      if (!q || (ratio && !ratio.equals(q))) {
        proportional = false
        break
      }
      ratio = q
    }
    if (proportional && ratio && !ratio.equals(Rational.ONE)) {
      return {
        status: 'partial',
        feedback: L('Está balanceada, pero aquí se piden los coeficientes de la clave (por ejemplo, por mol de la sustancia que se forma): %@.', exp.unicodeText) + noteText,
      }
    }
  }
  const reference = balanceEquation(exp)
  const minimal = reference.equation
  if (!(reference.status === 'balanced' || reference.status === 'alreadyBalanced') || !minimal) {
    // Varias soluciones: cualquier balanceo válido vale.
    return { status: 'correct', feedback: L('¡Correcto! Está balanceada (esta reacción admite más de un juego de coeficientes válido).') + noteText }
  }
  const minimalCoefs = coefficientMap(minimal)
  // Razón alumno / mínimo (constante si está balanceada con las mismas especies). Si no coincide (redox con otra
  // reacción sumada), crédito parcial y la ecuación de referencia.
  let ratio: Rational | null = null
  let comparable = true
  for (const [k, sc] of studentCoefs) {
    const mc = minimalCoefs.get(k) ?? Rational.ZERO
    if (mc.isZero) {
      if (sc.isZero) continue
      comparable = false
      break
    }
    const q = sc.div(mc) as Rational
    if (ratio && !ratio.equals(q)) {
      comparable = false
      break
    }
    ratio = q
  }
  if (!comparable || !ratio) {
    return {
      status: 'partial',
      feedback: L('Los átomos y la carga cuadran, pero los coeficientes no guardan la proporción de esta reacción: con los mínimos queda %@.', minimal.unicodeText) + noteText,
    }
  }
  if (ratio.equals(Rational.ONE)) return { status: 'correct', feedback: L('¡Correcto! Está balanceada con los coeficientes mínimos.') + noteText }
  if (ratio.isInteger) {
    return {
      status: 'partial',
      feedback: L('Está balanceada, pero los coeficientes no son los mínimos: divídelos todos entre %@ → %@.', ratio.toString(), minimal.unicodeText) + noteText,
    }
  }
  return { status: 'partial', feedback: L('Está balanceada, pero con coeficientes fraccionarios; con enteros mínimos queda %@.', minimal.unicodeText) + noteText }
}

// MARK: Números y configuraciones

/** Corrige un resultado numérico (valor y, si se pide, cifras significativas). */
export function checkNumber(student: string, expected: number, sigFigs: number | null = null, relativeTolerance = 0.01): ChemCheck {
  return SigFigs.check(student, expected, sigFigs, relativeTolerance)
}

/**
 * Corrige una configuración electrónica (da igual el orden de las subcapas y si está abreviada). `expected` puede ser
 * una configuración o un elemento/ion («Fe3+»).
 */
export function checkElectronConfiguration(student: string, expected: string): ChemCheck {
  let target: ElectronConfiguration | null = null
  let label = expected
  try {
    target = ElectronConfiguration.parse(expected)
  } catch {
    target = null
  }
  if (!target) {
    const e = PeriodicTable.search(expected)
    if (e) {
      target = ElectronConfiguration.groundState(e)
      label = `${localizedElementName(e)} (${e.symbol})`
    } else {
      const f = tryParse(expected)
      const el = f && f.composition.size === 1 && f.atomCount === 1 ? f.elements[0] : null
      if (f && el) {
        try {
          target = ElectronConfiguration.ion(el, f.charge)
          label = f.unicodeText
        } catch {
          target = null
        }
      }
    }
  }
  if (!target) return { status: 'invalid', feedback: L('No entiendo la referencia «%@».', expected) }
  let s: ElectronConfiguration
  try {
    s = ElectronConfiguration.parse(student)
  } catch (error) {
    return { status: 'invalid', feedback: errorMessage(error, L('No puedo leer tu configuración.')) }
  }
  // Configuración para enseñársela al alumno (la de un ion sin electrones, como H⁺, se nombra con palabras).
  const shown = target.occupancy.size === 0 ? L('(sin electrones)') : target.text({ abbreviated: true, notation: 'unicode' })
  if (s.equals(target)) return { status: 'correct', feedback: L('¡Correcto! %@', shown) }
  const problems = [L('No es correcta.')]
  if (s.electronCount !== target.electronCount) problems.push(L('Tienes %lld electrones y %@ tiene %lld.', s.electronCount, label, target.electronCount))
  const subshells = [...new Set([...s.occupancy.keys(), ...target.occupancy.keys()])].sort((a, b) => a.n + a.l - (b.n + b.l) || a.n - b.n)
  for (const k of subshells) {
    if (s.occupancy.get(k) !== target.occupancy.get(k)) {
      problems.push(L('En %@ deberían ir %lld y has puesto %lld.', k.toString(), target.get(k), s.get(k)))
    }
  }
  if (s.electronCount === target.electronCount && s.equals(ElectronConfiguration.aufbau(s.electronCount))) {
    problems.push(L('Has aplicado la regla de Madelung, pero este caso es una excepción (o es un ion, que pierde primero los electrones ns).'))
  }
  problems.push(L('La correcta es %@.', shown))
  return { status: 'incorrect', feedback: problems.join(' ') }
}

/** API con los nombres de la app Swift. */
export const ChemChecker = { checkFormula, checkName, checkEquation, checkNumber, checkElectronConfiguration }
