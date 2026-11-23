import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { makeExercise, textBlock, type Answer, type Exercise } from '@shared/schema'
import '@renderer/i18n'

// los tooltips abren un portal en `document` (aquí no hay DOM): se deja lo de dentro tal cual
vi.mock('@renderer/design', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@renderer/design')>()
  return { ...mod, Tooltip: ({ children }: { children: ReactNode }) => children }
})

import { ExerciseActions } from './ExerciseView'
import { useExercise } from './useExercise'

function Actions({ exercise }: { exercise: Exercise }) {
  const c = useExercise(exercise)
  return <ExerciseActions controller={c} />
}

const exercise = (answer: Answer): Exercise => makeExercise({ id: `e-${answer.kind}`, skill: 's', level: 1, prompt: [textBlock('¿?')], answer })

/** La tecla que acompaña a «Comprobar». */
function checkKey(answer: Answer): string {
  const html = renderToStaticMarkup(<Actions exercise={exercise(answer)} />)
  const button = html.split('<button').find((b) => /Check|Comprobar/.test(b)) ?? ''
  return button.match(/data-keycap[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? ''
}

describe('la pista del botón Comprobar dice la verdad', () => {
  it('respuesta corta (aunque admita varias líneas): Intro a secas, que es lo que comprueba', () => {
    const key = checkKey({ kind: 'short', accepted: ['osmosis'], keywords: [], typoTolerance: true, aiGrade: false })
    expect(key).toContain('<svg')
    expect(key).not.toMatch(/⌘|Ctrl/)
  })

  it('respuesta numérica: Intro a secas', () => {
    expect(checkKey({ kind: 'numeric', value: '2', alternatives: [], absTol: 1e-6, relTol: 1e-6, form: 'any', unitMode: 'ignore', angle: 'radians' })).not.toMatch(/⌘|Ctrl/)
  })

  it('respuesta abierta: ⌘/Ctrl+Intro (Intro hace un salto de línea)', () => {
    expect(checkKey({ kind: 'open', modelAnswer: 'x', rubric: [] })).toMatch(/⌘|Ctrl/)
  })
})
