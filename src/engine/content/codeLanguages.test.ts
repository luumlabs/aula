// Los lenguajes del código: lo que escriben los cursos y la IA llega a una gramática y a un nombre en la cabecera.
import { describe, expect, it } from 'vitest'
import { CODE_LANGUAGES, codeLanguage, codeLanguageInfo, languageToken } from './codeLanguages'

describe('lenguaje de un bloque de código', () => {
  it('entiende el nombre, los alias y las versiones', () => {
    const cases: Array<[string, string]> = [
      ['python', 'python'], ['Python', 'python'], ['py', 'python'], ['python3', 'python'], ['Python 3.12', 'python'], ['pycon', 'python-repl'],
      ['ts', 'typescript'], ['tsx', 'typescript'], ['js', 'javascript'], ['es2020', 'javascript'], ['node', 'javascript'],
      ['c++', 'cpp'], ['c++17', 'cpp'], ['cpp20', 'cpp'], ['C#', 'csharp'], ['c99', 'c'], ['html', 'xml'], ['html5', 'xml'], ['svg', 'xml'],
      ['sh', 'bash'], ['zsh', 'bash'], ['shell', 'bash'], ['console', 'console'], ['terminal', 'console'], ['golang', 'go'], ['rs', 'rust'], ['pascal', 'delphi'],
      ['octave', 'matlab'], ['f90', 'fortran'], ['racket', 'scheme'], ['mysql', 'sql'], ['toml', 'ini'], ['yml', 'yaml'], ['tex', 'latex'],
      ['asm', 'x86asm'], ['mips', 'mipsasm'], ['proto3', 'protobuf'], ['pl/sql', 'sql'], ['vb.net', 'vbnet']
    ]
    for (const [raw, lang] of cases) expect(codeLanguage(raw), raw).toBe(lang)
  })

  it('las etiquetas de las vallas con atributos, llaves o nombre de archivo', () => {
    expect(languageToken('{r echo=FALSE}')).toBe('r')
    expect(languageToken('{.python}')).toBe('python')
    expect(languageToken('language-ts')).toBe('ts')
    expect(languageToken('py:main.py')).toBe('py')
    expect(languageToken('js title="a.js"')).toBe('js')
    expect(codeLanguage('{r}')).toBe('r')
  })

  it('todos los nombres de CODE_LANGUAGES se reconocen como tales', () => {
    for (const l of CODE_LANGUAGES) expect(codeLanguage(l), l).toBe(l)
  })

  it('el nombre de la cabecera: el del lenguaje, el que escribió el curso o uno genérico', () => {
    expect(codeLanguageInfo('py')).toEqual({ language: 'python', label: { name: 'Python' }, declared: true })
    expect(codeLanguageInfo('html').label).toEqual({ name: 'HTML' })
    expect(codeLanguageInfo('xml').label).toEqual({ name: 'XML' })
    expect(codeLanguageInfo('postgresql').label).toEqual({ name: 'PostgreSQL' })
    expect(codeLanguageInfo('c++17').label).toEqual({ name: 'C++' })
    expect(codeLanguageInfo('pascal').label).toEqual({ name: 'Pascal' })
    // lo que no se colorea: con nombre genérico (la interfaz lo traduce)
    expect(codeLanguageInfo('text')).toEqual({ language: 'plaintext', label: { generic: 'text' }, declared: true })
    expect(codeLanguageInfo('Pseudocódigo').label).toEqual({ generic: 'pseudocode' })
    expect(codeLanguageInfo('output').label).toEqual({ generic: 'output' })
    // un lenguaje que Aula no conoce: su nombre tal cual, sin gramática (no se adivina otro)
    expect(codeLanguageInfo('COBOL')).toEqual({ label: { name: 'COBOL' }, declared: true })
    // sin decir nada: «Código», y se adivinará para colorear
    expect(codeLanguageInfo(undefined)).toEqual({ label: { generic: 'code' }, declared: false })
    expect(codeLanguageInfo('   ')).toEqual({ label: { generic: 'code' }, declared: false })
  })

  it('nombres de varias palabras, pares con barra («/») y desconocidos completos', () => {
    expect(codeLanguageInfo('Visual Basic')).toEqual({ language: 'vbnet', label: { name: 'Visual Basic' }, declared: true })
    expect(codeLanguageInfo('C Sharp')).toEqual({ language: 'csharp', label: { name: 'C#' }, declared: true })
    expect(codeLanguageInfo('Common Lisp').language).toBe('lisp')
    expect(codeLanguageInfo('Standard ML').language).toBe('sml')
    expect(codeLanguageInfo('Object Pascal')).toEqual({ language: 'delphi', label: { name: 'Object Pascal' }, declared: true })
    expect(codeLanguageInfo('Objective C').language).toBe('objectivec')
    expect(codeLanguageInfo('C/C++').language).toBe('c')
    expect(codeLanguageInfo('HTML/CSS').language).toBe('xml')
    expect(codeLanguageInfo('Bash/Shell').language).toBe('bash')
    expect(codeLanguageInfo('Matlab/Octave').language).toBe('matlab')
    expect(codeLanguageInfo('My Custom Lang')).toEqual({ label: { name: 'My Custom Lang' }, declared: true })
  })
})
