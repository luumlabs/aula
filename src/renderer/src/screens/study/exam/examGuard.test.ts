import { describe, expect, it } from 'vitest'
import { createExamGuard } from './examGuard'

describe('menú de examen', () => {
  it('se enciende al tomarlo y se apaga al soltarlo', () => {
    const sent: boolean[] = []
    const release = createExamGuard((on) => sent.push(on)).hold()
    expect(sent).toEqual([true])
    release()
    expect(sent).toEqual([true, false])
  })
  it('de un simulacro a otro: la capa que se va lo suelta tarde y sigue encendido para el nuevo', () => {
    const sent: boolean[] = []
    const guard = createExamGuard((on) => sent.push(on))
    const leaving = guard.hold()
    const next = guard.hold()
    leaving()
    expect(sent).toEqual([true])
    next()
    expect(sent).toEqual([true, false])
  })
  it('soltarlo dos veces no apaga el de otro', () => {
    const sent: boolean[] = []
    const guard = createExamGuard((on) => sent.push(on))
    const a = guard.hold()
    a()
    const b = guard.hold()
    a()
    expect(sent).toEqual([true, false, true])
    b()
    expect(sent).toEqual([true, false, true, false])
  })
})
