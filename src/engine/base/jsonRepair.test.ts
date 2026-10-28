// Pruebas de JSONRepair (port de JSONRepairTests en la app Swift anterior: Tests/BaseKitTests/BaseKitTests.swift).
import { describe, expect, it } from 'vitest'
import { isJSONObject, type JSONValue } from './json'
import { JSONRepair } from './jsonRepair'

const get = (v: JSONValue, key: string): JSONValue | undefined => (isJSONObject(v) ? v[key] : undefined)
const str = (json: string, key = 't'): string => {
  const v = get(JSONRepair.parse(json), key)
  if (typeof v !== 'string') throw new Error(`«${key}» no es una cadena en ${json}`)
  return v
}

describe('JSONRepair', () => {
  it('deja intacto el JSON válido', () => {
    expect(str(String.raw`{"t":"\\frac{1}{2} y \\theta"}`)).toBe(String.raw`\frac{1}{2} y \theta`)
    expect(str('{"t":"línea 1\\nlínea 2"}')).toBe('línea 1\nlínea 2')
  })

  it('arregla el LaTeX con una sola barra', () => {
    // \f \t \r \b \n son escapes JSON válidos pero aquí son LaTeX
    expect(str(String.raw`{"t":"\frac{1}{2}"}`)).toBe(String.raw`\frac{1}{2}`)
    expect(str(String.raw`{"t":"\theta + \times"}`)).toBe(String.raw`\theta + \times`)
    expect(str(String.raw`{"t":"\beta \neq \nu"}`)).toBe(String.raw`\beta \neq \nu`)
    expect(str(String.raw`{"t":"\left( x \right)"}`)).toBe(String.raw`\left( x \right)`)
    expect(str(String.raw`{"t":"\rho \rightarrow \text{si}"}`)).toBe(String.raw`\rho \rightarrow \text{si}`)
  })

  it('los escapes inválidos se vuelven LaTeX', () => {
    expect(str(String.raw`{"t":"\sqrt{3} \pi \cdot \alpha \sum_{i}"}`)).toBe(String.raw`\sqrt{3} \pi \cdot \alpha \sum_{i}`)
    expect(str(String.raw`{"t":"\underline{x} \upsilon \(x\) \, \;"}`)).toBe(String.raw`\underline{x} \upsilon \(x\) \, \;`)
  })

  it('los saltos de línea de verdad sobreviven', () => {
    expect(str('{"t":"hola\\nunidad"}')).toBe('hola\nunidad') // «nunidad» no es un comando
    expect(str('{"t":"a\\n\\nb\\tc"}')).toBe('a\n\nb\tc')
    expect(str('{"t":"- uno\\n- dos"}')).toBe('- uno\n- dos')
  })

  // Regresión (IR-08): un salto de línea seguido de «u», «e» o «i» se tomaba por `\nu`, `\ne` o `\ni`.
  it('un salto de línea antes de una letra no es LaTeX', () => {
    const cases: Array<[string, string]> = [
      ['{"t":"$$\\nu = v_0 + a t\\n$$"}', '$$\nu = v_0 + a t\n$$'],
      ['{"t":"$$\\ne^{i\\\\pi}+1=0\\n$$"}', '$$\ne^{i\\pi}+1=0\n$$'],
      ['{"t":"Opciones:\\ni) primera\\nii) segunda"}', 'Opciones:\ni) primera\nii) segunda'],
      ['{"t":"a)\\nb)\\nc)\\nd)\\ne) cinco"}', 'a)\nb)\nc)\nd)\ne) cinco'],
      ['{"t":"Sea\\n$$\\nu = 3x+2\\n$$"}', 'Sea\n$$\nu = 3x+2\n$$'],
      ['{"t":"siete\\nu ocho"}', 'siete\nu ocho']
    ]
    for (const [json, expected] of cases) {
      expect(str(json), json).toBe(expected)
      expect(JSONRepair.fixDecodedLaTeX(expected), `ya decodificado: ${json}`).toBe(expected)
      expect(JSONRepair.hasSuspiciousControlChars(expected), json).toBe(false)
    }
    // aunque la misma respuesta traiga LaTeX con una sola barra en otra parte, un salto tras «:» o «)» sigue siendo un salto
    expect(JSONRepair.fixDecodedLaTeX('\u000Crac{1}{2}\nOpciones:\ni) uno\ne) dos')).toBe('\\frac{1}{2}\nOpciones:\ni) uno\ne) dos')
  })

  it('con pistas de LaTeX los comandos de una letra sí se arreglan', () => {
    expect(str(String.raw`{"t":"$\nu$ y $v = \nu t$"}`)).toBe(String.raw`$\nu$ y $v = \nu t$`)
    expect(str(String.raw`{"t":"\frac{\nu}{2} y x_\ni"}`)).toBe(String.raw`\frac{\nu}{2} y x_\ni`)
    expect(str(String.raw`{"t":"\beta \neq \nu"}`)).toBe(String.raw`\beta \neq \nu`)
    expect(str(String.raw`{"t":"a \ne b, \sqrt{2}"}`)).toBe(String.raw`a \ne b, \sqrt{2}`)
    expect(JSONRepair.fixDecodedLaTeX('$\nu$ y \u0008eta')).toBe('$\\nu$ y \\beta')
    expect(JSONRepair.fixDecodedLaTeX('\theta \to 0, x\nu'), 'tras una letra, sin más pistas, es un salto').toBe('\\theta \\to 0, x\nu')
    // los comandos que no dan lugar a dudas, como siempre
    expect(JSONRepair.fixDecodedLaTeX('a\neq b\nabla')).toBe('a\\neq b\\nabla')
    expect(JSONRepair.fixDecodedLaTeX('línea\r\neq'), '«\\r\\n» es un fin de línea de Windows').toBe('línea\r\neq')
  })

  it('acepta caracteres de control sin escapar dentro de las cadenas', () => {
    expect(str('{"t":"a\nb\tc"}')).toBe('a\nb\tc')
  })

  it('quita comas finales, comentarios y vallas', () => {
    const v = JSONRepair.parse('Aquí va:\n```json\n{\n // comentario\n "a": [1, 2, 3,], "b": {"c": true,},\n}\n```\nListo.')
    expect(get(v, 'a')).toEqual([1, 2, 3])
    expect(get(get(v, 'b')!, 'c')).toBe(true)
  })

  it('conserva las vallas que van dentro de las cadenas', () => {
    // una lección con un bloque de código dentro de la cadena (con saltos de línea sin escapar)
    const raw = '{"md":"Ejemplo:\n```python\nprint(1)\n```\nFin"}'
    expect(str(raw.replace('"md"', '"t"'))).toBe('Ejemplo:\n```python\nprint(1)\n```\nFin')
    // envuelta además en una valla exterior
    expect(get(JSONRepair.parse('```json\n' + raw + '\n```'), 'md')).toBe('Ejemplo:\n```python\nprint(1)\n```\nFin')
    // valla sin salto de línea y respuesta cortada con valla de cierre suelta
    expect(get(JSONRepair.parse('```json{"a":1}```'), 'a')).toBe(1)
    expect(get(JSONRepair.parse('```\n{"a":[1,2\n```'), 'a')).toEqual([1, 2])
  })

  // Regresión (auditoría de robustez): cientos de niveles de anidamiento desbordaban la pila.
  it('un JSON demasiado anidado falla en vez de reventar', () => {
    const deep = '['.repeat(600) + ']'.repeat(600)
    expect(() => JSONRepair.parse(deep)).toThrow()
    const ok = '['.repeat(60) + '1' + ']'.repeat(60)
    expect(() => JSONRepair.parse(ok)).not.toThrow()
  })

  it('entiende los literales de Python', () => {
    const v = JSONRepair.parse('{"a": True, "b": None, "c": False}')
    expect(get(v, 'a')).toBe(true)
    expect(get(v, 'b')).toBeNull()
    expect(get(v, 'c')).toBe(false)
  })

  it('cierra un JSON cortado', () => {
    const v = JSONRepair.parse(String.raw`{"title":"Lección","blocks":[{"type":"text","md":"Hola \frac{1}{2`)
    expect(get(v, 'title')).toBe('Lección')
    const blocks = get(v, 'blocks') as JSONValue[]
    expect(get(blocks[0], 'type')).toBe('text')
    expect(String(get(blocks[0], 'md')).startsWith(String.raw`Hola \frac{1}{2`)).toBe(true)
  })

  it('cierra un JSON cortado tras los dos puntos', () => {
    const v = JSONRepair.parse('{"a":1,"b":')
    expect(get(v, 'a')).toBe(1)
    expect(get(v, 'b')).toBeNull()
  })

  it('arregla el LaTeX ya decodificado', () => {
    const mangled = '\u000Crac{1}{2} + \theta \u0008eta' // \f \t \b ya decodificados
    expect(JSONRepair.fixDecodedLaTeX(mangled)).toBe(String.raw`\frac{1}{2} + \theta \beta`)
    expect(JSONRepair.fixDecodedLaTeX('col1\tcol2\nfila')).toBe('col1\tcol2\nfila')
  })

  it('repara un JSON válido con el LaTeX estropeado', () => {
    // JSON válido, pero el modelo olvidó duplicar la barra (\t → tabulador)
    expect(str('{"t":"x \\times y"}')).toBe(String.raw`x \times y`)
  })

  it('falla con un texto que no es JSON', () => {
    expect(() => JSONRepair.parse('esto no es json')).toThrow()
  })
})
