import { describe, expect, it } from 'vitest'
import { nextReveal, safeCut, splitParagraphs, tidyStreamingTail } from './smoothText'

describe('splitParagraphs', () => {
  it('parte por líneas en blanco', () => {
    expect(splitParagraphs('Hola.\n\nAdiós.\n\n\nFin')).toEqual(['Hola.', 'Adiós.', 'Fin'])
  })
  it('no parte código, fórmulas grandes ni lo sangrado', () => {
    const code = '```py\na = 1\n\nb = 2\n```'
    expect(splitParagraphs(`Antes\n\n${code}\n\nDespués`)).toEqual(['Antes', code, 'Después'])
    const math = '$$\na = b\n\nc = d\n$$'
    expect(splitParagraphs(`x\n\n${math}`)).toEqual(['x', math])
    expect(splitParagraphs('1. uno\n\n   sigue el uno\n\n2. dos')).toEqual(['1. uno\n\n   sigue el uno', '2. dos'])
  })
})

describe('tidyStreamingTail', () => {
  it('esconde la fórmula sin cerrar y cierra la negrita', () => {
    expect(tidyStreamingTail('El vértice es $x_v = -\\dfrac').text).toBe('El vértice es ')
    expect(tidyStreamingTail('Vale $x$ y **muy imp').text).toBe('Vale $x$ y **muy imp**')
    expect(tidyStreamingTail('Esto es **').text).toBe('Esto es ')
    expect(tidyStreamingTail('Usa `npm').text).toBe('Usa `npm`')
    expect(tidyStreamingTail('Cuesta \\$5 y ya').text).toBe('Cuesta \\$5 y ya')
  })
  it('esconde la fórmula grande sin cerrar', () => {
    expect(tidyStreamingTail('Mira:\n\n$$\nx^2 +').text).toBe('Mira:\n\n')
  })
  it('un bloque visual a medias deja su hueco', () => {
    const r = tidyStreamingTail('Mira la gráfica:\n\n```aula-block\n{"type":"plot","ti')
    expect(r).toEqual({ text: 'Mira la gráfica:\n\n', pendingBlock: true })
    const done = 'A\n\n```aula-block\n{}\n```\n\nB'
    expect(tidyStreamingTail(done)).toEqual({ text: done, pendingBlock: false })
  })
  it('dentro de un bloque de código abierto no toca nada', () => {
    expect(tidyStreamingTail('```js\nconst a = "$x').text).toBe('```js\nconst a = "$x')
  })
})

describe('nextReveal', () => {
  it('avanza siempre y alcanza lo que falta', () => {
    expect(nextReveal(0, 10, 16)).toBeGreaterThanOrEqual(1)
    expect(nextReveal(10, 10, 16)).toBe(10)
    expect(nextReveal(0, 2000, 16)).toBeGreaterThan(150)
    let n = 0
    for (let i = 0; i < 60 && n < 600; i++) n = nextReveal(n, 600, 16)
    expect(n).toBe(600)
  })
  it('no parte un emoji', () => {
    const s = 'a😀b'
    expect(safeCut(s, 2)).toBe(3)
    expect(safeCut(s, 1)).toBe(1)
  })
})
