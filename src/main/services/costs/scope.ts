// Para qué se usa la IA en cada tarea (port de `AIUseScope`/`AIUseContext` de CostMeter.swift). En Swift era un `@TaskLocal`;
// aquí, un `AsyncLocalStorage`: todo lo que se ejecute dentro de `withAIUse(…)` (también las promesas hijas) hereda el ámbito.
import { AsyncLocalStorage } from 'node:async_hooks'

/** Para qué se usó la IA (mismas claves que la app Swift). */
export type AIUsePurpose = 'chat' | 'tutor' | 'course' | 'automation' | 'grading' | 'memory' | 'documents' | 'other'

export const AI_USE_PURPOSES: readonly AIUsePurpose[] = ['chat', 'tutor', 'course', 'automation', 'grading', 'memory', 'documents', 'other']

export function isAIUsePurpose(v: unknown): v is AIUsePurpose {
  return typeof v === 'string' && (AI_USE_PURPOSES as readonly string[]).includes(v)
}

/** A qué se atribuye el coste de una llamada. */
export interface AIUseScope {
  purpose: AIUsePurpose
  courseID?: string
  /** Qué era («Pedir cambios: añade ejercicios de…»), para la interfaz. */
  label?: string
}

const storage = new AsyncLocalStorage<AIUseScope>()

/** Ejecuta `fn` con este ámbito: las llamadas a la IA que haga (aunque sea en promesas hijas) se apuntan a él. */
export function withAIUse<T>(scope: AIUseScope, fn: () => T): T {
  return storage.run({ ...scope }, fn)
}

/** El ámbito actual (o `undefined`: se apunta como «Otros»). */
export function currentAIUse(): AIUseScope | undefined {
  return storage.getStore()
}
