// highlight.js con las gramáticas de Aula (CODE_LANGUAGES). Va en su propio trozo: lo carga la primera tarjeta de código que
// se ve (useHighlight) y las demás lo encuentran listo. Puro (sin React ni DOM) y con caché: volver a una pregunta del
// simulacro o redibujar el chat no vuelve a resaltar lo mismo.
import core from 'highlight.js/lib/core'
import type { LanguageFn } from 'highlight.js'
import armasm from 'highlight.js/lib/languages/armasm'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import clojure from 'highlight.js/lib/languages/clojure'
import cmake from 'highlight.js/lib/languages/cmake'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dart from 'highlight.js/lib/languages/dart'
import delphi from 'highlight.js/lib/languages/delphi'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import dos from 'highlight.js/lib/languages/dos'
import elixir from 'highlight.js/lib/languages/elixir'
import erlang from 'highlight.js/lib/languages/erlang'
import excel from 'highlight.js/lib/languages/excel'
import fortran from 'highlight.js/lib/languages/fortran'
import fsharp from 'highlight.js/lib/languages/fsharp'
import go from 'highlight.js/lib/languages/go'
import graphql from 'highlight.js/lib/languages/graphql'
import groovy from 'highlight.js/lib/languages/groovy'
import haskell from 'highlight.js/lib/languages/haskell'
import http from 'highlight.js/lib/languages/http'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import julia from 'highlight.js/lib/languages/julia'
import kotlin from 'highlight.js/lib/languages/kotlin'
import latex from 'highlight.js/lib/languages/latex'
import lisp from 'highlight.js/lib/languages/lisp'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import matlab from 'highlight.js/lib/languages/matlab'
import mipsasm from 'highlight.js/lib/languages/mipsasm'
import nginx from 'highlight.js/lib/languages/nginx'
import objectivec from 'highlight.js/lib/languages/objectivec'
import ocaml from 'highlight.js/lib/languages/ocaml'
import perl from 'highlight.js/lib/languages/perl'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import powershell from 'highlight.js/lib/languages/powershell'
import prolog from 'highlight.js/lib/languages/prolog'
import protobuf from 'highlight.js/lib/languages/protobuf'
import python from 'highlight.js/lib/languages/python'
import pythonRepl from 'highlight.js/lib/languages/python-repl'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sas from 'highlight.js/lib/languages/sas'
import scala from 'highlight.js/lib/languages/scala'
import scheme from 'highlight.js/lib/languages/scheme'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sml from 'highlight.js/lib/languages/sml'
import sql from 'highlight.js/lib/languages/sql'
import stata from 'highlight.js/lib/languages/stata'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import vbnet from 'highlight.js/lib/languages/vbnet'
import verilog from 'highlight.js/lib/languages/verilog'
import vhdl from 'highlight.js/lib/languages/vhdl'
import x86asm from 'highlight.js/lib/languages/x86asm'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import type { CodeLanguage } from '@engine/content/codeLanguages'

/** Una gramática por cada nombre de CODE_LANGUAGES (el tipo obliga a que no falte ni sobre ninguna). */
const GRAMMARS: Record<CodeLanguage, LanguageFn> = {
  armasm, bash, c, clojure, cmake, console: shell, cpp, csharp, css, dart, delphi, diff, dockerfile, dos, elixir, erlang, excel, fortran, fsharp, go,
  graphql, groovy, haskell, http, ini, java, javascript, json, julia, kotlin, latex, lisp, lua, makefile, markdown, matlab, mipsasm,
  nginx, objectivec, ocaml, perl, php, plaintext, powershell, prolog, protobuf, python, 'python-repl': pythonRepl, r, ruby, rust, sas,
  scala, scheme, scss, sml, sql, stata, swift, typescript, vbnet, verilog, vhdl, x86asm, xml, yaml
}

// una instancia propia: nada de fuera cambia su configuración ni sus gramáticas
const hljs = core.newInstance()
for (const [name, grammar] of Object.entries(GRAMMARS)) hljs.registerLanguage(name, grammar)

/** Los nombres registrados (para las pruebas: tienen que ser los de CODE_LANGUAGES). */
export const registeredLanguages = (): string[] => hljs.listLanguages()

/** Entre los que se adivina cuando el curso no dice el lenguaje: los de clase (sin CSS: con «x: y» se cree que la prosa y el
 *  pseudocódigo son hojas de estilo). */
const GUESSES = ['python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'csharp', 'sql', 'bash', 'r', 'matlab', 'php', 'json', 'xml']
/** Por debajo de esta relevancia lo adivinado no es fiable: la prosa, el pseudocódigo o una salida dan 0–2 y se quedan sin
 *  colores; un SELECT o una función de cuatro líneas ya dan 3–4. */
const MIN_RELEVANCE = 3
/** Adivinar prueba todas las gramáticas: con textos muy largos, no. */
const MAX_GUESS = 8000

export interface Highlighted {
  /** HTML ya escapado, con los <span class="hljs-…"> del resaltado. */
  html: string
  /** La gramática con la que se coloreó (la pedida o la adivinada). */
  language: CodeLanguage
}

const cache = new Map<string, Highlighted | null>()
const CACHE_LIMIT = 400

function compute(code: string, language: CodeLanguage | undefined): Highlighted | null {
  try {
    if (language) return { html: hljs.highlight(code, { language, ignoreIllegals: true }).value, language }
    if (code.length > MAX_GUESS) return null
    const auto = hljs.highlightAuto(code, GUESSES)
    const found = auto.language as CodeLanguage | undefined
    return found && auto.relevance >= MIN_RELEVANCE ? { html: auto.value, language: found } : null
  } catch {
    return null
  }
}

/**
 * El código resaltado con `language`; sin lenguaje, con el que se adivine si es fiable. undefined: se enseña tal cual
 * (texto plano, un lenguaje que Aula no conoce o nada fiable que adivinar). `live`: lo que llega por partes (sin adivinar,
 * porque el lenguaje cambiaría a medio escribir, y sin guardarlo: cada trozo es distinto).
 */
export function highlight(code: string, language: CodeLanguage | undefined, live = false): Highlighted | undefined {
  if (!code.trim() || language === 'plaintext' || (!language && live)) return undefined
  if (live) return compute(code, language) ?? undefined
  const key = `${language ?? '?'}\u0000${code}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    // lo último usado queda al final (lo que sale primero es lo más viejo)
    cache.delete(key)
    cache.set(key, hit)
    return hit ?? undefined
  }
  const value = compute(code, language)
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(key, value)
  return value ?? undefined
}
