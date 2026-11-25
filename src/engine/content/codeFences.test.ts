// El código dentro de un Markdown: dónde hay vallas y código en línea, y que lo que trabaja con la prosa no lo toque.
import { describe, expect, it } from 'vitest'
import { codeRanges, fenceCloses, fenceOpening, fenceState, isClosedFence, mapOutsideCode, maskCode, withoutCode } from './codeFences'

describe('vallas de código', () => {
  it('reconoce la línea que abre (``` y ~~~, con su etiqueta y con sangría) y la que cierra', () => {
    expect(fenceOpening('```python')).toEqual({ char: '`', size: 3, info: 'python' })
    expect(fenceOpening('   ~~~~ c++ title=a.cpp')).toEqual({ char: '~', size: 4, info: 'c++ title=a.cpp' })
    expect(fenceOpening('``')).toBeUndefined()
    // una etiqueta de acentos graves con acentos graves no es valla (es código en línea)
    expect(fenceOpening('```a`b```')).toBeUndefined()
    expect(fenceCloses('```', { char: '`', size: 3 })).toBe(true)
    expect(fenceCloses('  `````  ', { char: '`', size: 3 })).toBe(true)
    expect(fenceCloses('``', { char: '`', size: 3 })).toBe(false)
    expect(fenceCloses('~~~', { char: '`', size: 3 })).toBe(false)
    expect(fenceCloses('```js', { char: '`', size: 3 })).toBe(false)
  })

  it('sabe si el texto acaba dentro de una valla y dónde acabó la última cerrada', () => {
    expect(fenceState('Hola\n```py\nx = 1')).toMatchObject({ open: { char: '`', size: 3, info: 'py', line: 1 }, lines: 3 })
    expect(fenceState('```py\nx\n```\nfin').open).toBeUndefined()
    expect(fenceState('```py\nx\n```\nfin').closedEnd).toBe('```py\nx\n```'.length)
    // un ``` de menos dentro de una valla de cuatro no la cierra
    expect(fenceState('````md\n```\nx\n```').open?.size).toBe(4)
    expect(fenceState('sin código').closedEnd).toBe(0)
  })

  it('un bloque se cierra si su última línea es la valla (uno sangrado también está completo)', () => {
    expect(isClosedFence('```py\nprint(1)\n```')).toBe(true)
    expect(isClosedFence('```py\nprint(1)\n```\n')).toBe(true)
    expect(isClosedFence('```py\nprint(1)')).toBe(false)
    expect(isClosedFence('```py')).toBe(false)
    expect(isClosedFence('    x = 1')).toBe(true)
    expect(isClosedFence('```py\n> x = 1\n> ```')).toBe(true)
    expect(isClosedFence('```py\n> x = 1')).toBe(false)
  })
})

describe('dónde hay código', () => {
  it('vallas enteras (también sin cerrar) y código en línea, en orden', () => {
    const md = 'Usa `x` y ``a`b``:\n```js\nlet $a = 1\n```\nfin `y`'
    const got = codeRanges(md).map(([a, b]) => md.slice(a, b))
    expect(got).toEqual(['`x`', '``a`b``', '```js\nlet $a = 1\n```', '`y`'])
    expect(codeRanges('Antes\n```py\nx = 1').map(([a, b]) => 'Antes\n```py\nx = 1'.slice(a, b))).toEqual(['```py\nx = 1'])
  })

  it('un acento grave suelto no abre código, ni cruza un párrafo; el escapado no cuenta', () => {
    expect(codeRanges('Cuesta 5 ` y ya')).toEqual([])
    expect(codeRanges('a `b\n\nc` d')).toEqual([])
    expect(codeRanges('a \\`b` c')).toEqual([])
  })

  it('tapar, quitar o saltarse el código', () => {
    const md = 'Fórmula $x$ y `$HOME`\n```sh\necho $PATH\n```'
    expect(maskCode(md)).toHaveLength(md.length)
    expect(maskCode(md)).not.toContain('HOME')
    expect(maskCode(md).split('\n')).toHaveLength(md.split('\n').length)
    expect(withoutCode(md)).toBe('Fórmula $x$ y \n')
    expect(mapOutsideCode(md, (s) => s.toUpperCase())).toBe('FÓRMULA $X$ Y `$HOME`\n```sh\necho $PATH\n```')
    expect(mapOutsideCode('sin nada', (s) => s + '!')).toBe('sin nada!')
  })

  it('vallas dentro de citas («> ```bash») y en línea de lista («- ```bash», «1. ```py»)', () => {
    const quoted = '> ```bash\n> echo "$HOME"\n> ls'
    expect(fenceState(quoted).open?.info).toBe('bash')
    expect(maskCode(quoted)).not.toContain('HOME')

    const listed = '- ```bash\n  echo "$HOME"\n  **x**\n  ```'
    expect(fenceState(listed).open).toBeUndefined()
    expect(withoutCode(listed)).toBe('')
  })
})
