// Plantillas paramétricas → ejercicios concretos. El muestreo, los `{{…}}` y la sustitución en las respuestas son los de
// `TemplateInstantiator` del motor matemático (port de StudyEngine/Math/MathServices.swift); aquí se pasa la plantilla del
// modelo de curso a JSON, se instancia y se vuelve a leer como ejercicio (con la semilla UInt64 exacta como texto).
import { decodeExercise, encodeTemplate, type Exercise, type ExerciseTemplate, type TemplateVarSpec } from '@shared/schema'
import { TemplateFailure, TemplateInstantiator, type TemplateContext, type TemplateVar, type VarKind } from '@engine/math'

export { TemplateFailure }

/** Tamaño máximo de una plantilla (JSON): con miles de bloques cada instanciación tardaba segundos. */
export const MAX_TEMPLATE_BYTES = TemplateInstantiator.maxTemplateBytes

/** El tipo de una variable de la plantilla (undefined si no se conoce). */
export function templateVarKind(v: TemplateVarSpec): VarKind | undefined {
  return TemplateInstantiator.varKind(v) ?? undefined
}

/** Intentos de muestreo según el coste de cada uno. */
export function maxTries(vars: readonly TemplateVar[], constraints: readonly string[]): number {
  return TemplateInstantiator.maxTries(vars, constraints)
}

/** Valores de las variables para una semilla. Lanza `TemplateFailure`. */
export function templateContext(t: ExerciseTemplate, seed: bigint): TemplateContext {
  return TemplateInstantiator.context(t, seed)
}

/** `{{dec(N):…}}` / `{{sig(N):…}}` con N enorme escribía millones de ceros: se acota N a 15. */
export function clampDirectiveDigits(text: string): string {
  return TemplateInstantiator.clampDirectiveDigits(text)
}

/** Sustituye las variables de la plantilla por sus valores en una expresión (deja libres las demás, p. ej. `x`). */
export function substituteTemplateValues(text: string, ctx: TemplateContext): string {
  try { return TemplateInstantiator.substitute(text, ctx) } catch { return text }
}

/** Normaliza la semilla a UInt64. */
function seedBig(seed: bigint | number | string): bigint {
  const b = typeof seed === 'bigint' ? seed : typeof seed === 'number' ? BigInt(Math.trunc(Math.max(0, Number.isFinite(seed) ? seed : 0))) : BigInt(/^\d+$/.test(seed) ? seed : '0')
  return BigInt.asUintN(64, b)
}

/** Instancia una plantilla con una semilla. Lanza `TemplateFailure` si no se puede. */
export function instantiateTemplateOrThrow(t: ExerciseTemplate, seed: bigint | number | string): Exercise {
  const s = seedBig(seed)
  let json: Record<string, unknown>
  try { json = TemplateInstantiator.instantiateJSON(t, encodeTemplate(t), s) } catch (err) {
    if (err instanceof TemplateFailure) throw err
    throw new TemplateFailure('render', err instanceof Error ? err.message : String(err))
  }
  const ex = decodeExercise(json)
  if (!ex) throw new TemplateFailure('decode', 'La plantilla no produce un ejercicio válido.')
  ex.id = `${t.id}#${s}`
  ex.templateID = t.id
  // la semilla exacta (el JSON del motor la guarda como número y por encima de 2^53 perdería precisión)
  ex.seed = s.toString()
  return ex
}

/** Instancia una plantilla con una semilla (undefined si con esa semilla no se puede). */
export function instantiateTemplate(t: ExerciseTemplate, seed: bigint | number | string): Exercise | undefined {
  try { return instantiateTemplateOrThrow(t, seed) } catch { return undefined }
}
