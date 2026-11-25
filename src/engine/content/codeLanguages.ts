// Los lenguajes del código: los que resalta Aula (nombres de highlight.js), lo que escriben de verdad los cursos y la IA en
// el campo `language` o en la etiqueta de una valla («py», «c++17», «Python 3», «{r}», «html»…) y cómo se llaman en la
// cabecera de la tarjeta. Puro: lo usan la interfaz (el resaltado) y la guía de autoría (la lista para el modelo).

/** Las gramáticas que resalta Aula (las registra `lib/code/highlighter.ts`, que se carga aparte). Son los nombres de highlight.js
 *  salvo `console`, su «shell» (una sesión con «$ »): así «shell» puede ser un guion de bash, como en GitHub. */
export const CODE_LANGUAGES = [
  'armasm', 'bash', 'c', 'clojure', 'cmake', 'console', 'cpp', 'csharp', 'css', 'dart', 'delphi', 'diff', 'dockerfile', 'dos', 'elixir',
  'erlang', 'excel', 'fortran', 'fsharp', 'go', 'graphql', 'groovy', 'haskell', 'http', 'ini', 'java', 'javascript', 'json',
  'julia', 'kotlin', 'latex', 'lisp', 'lua', 'makefile', 'markdown', 'matlab', 'mipsasm', 'nginx', 'objectivec', 'ocaml', 'perl',
  'php', 'plaintext', 'powershell', 'prolog', 'protobuf', 'python', 'python-repl', 'r', 'ruby', 'rust', 'sas', 'scala', 'scheme',
  'scss', 'sml', 'sql', 'stata', 'swift', 'typescript', 'vbnet', 'verilog', 'vhdl', 'x86asm', 'xml', 'yaml'
] as const

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]

const KNOWN: ReadonlySet<string> = new Set(CODE_LANGUAGES)

/** Lo que se escribe en lugar del nombre de highlight.js. */
const ALIASES: Readonly<Record<string, CodeLanguage>> = {
  py: 'python', py3: 'python', py2: 'python', ipython: 'python', sage: 'python', gyp: 'python',
  pycon: 'python-repl', 'python-console': 'python-repl', pyrepl: 'python-repl',
  js: 'javascript', node: 'javascript', nodejs: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', es: 'javascript',
  ecmascript: 'javascript', javascriptreact: 'javascript', json5: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', typescriptreact: 'typescript',
  h: 'c', 'ansi-c': 'c',
  'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp', hh: 'cpp', 'h++': 'cpp', cplusplus: 'cpp', cuda: 'cpp', cu: 'cpp', arduino: 'cpp', ino: 'cpp',
  'c#': 'csharp', cs: 'csharp', csx: 'csharp', csharp: 'csharp',
  golang: 'go', rs: 'rust', kt: 'kotlin', kts: 'kotlin', rb: 'ruby', sbt: 'scala', jl: 'julia',
  f: 'fortran', f77: 'fortran', f90: 'fortran', f95: 'fortran', f03: 'fortran', f08: 'fortran',
  hs: 'haskell', ml: 'ocaml', mli: 'ocaml', 'f#': 'fsharp', fs: 'fsharp', fsx: 'fsharp', fsharp: 'fsharp',
  scm: 'scheme', racket: 'scheme', rkt: 'scheme', guile: 'scheme',
  'common-lisp': 'lisp', commonlisp: 'lisp', elisp: 'lisp', 'emacs-lisp': 'lisp', emacslisp: 'lisp',
  clj: 'clojure', cljs: 'clojure', cljc: 'clojure', edn: 'clojure',
  ex: 'elixir', exs: 'elixir', erl: 'erlang', hrl: 'erlang', swipl: 'prolog',
  pl: 'perl', pm: 'perl',
  objc: 'objectivec', 'obj-c': 'objectivec', 'objective-c': 'objectivec', mm: 'objectivec',
  gradle: 'groovy',
  vb: 'vbnet', 'vb.net': 'vbnet', 'visual-basic': 'vbnet', visualbasic: 'vbnet', vba: 'vbnet',
  pascal: 'delphi', pas: 'delphi', 'object-pascal': 'delphi', objectpascal: 'delphi', freepascal: 'delphi', lazarus: 'delphi',
  sh: 'bash', shell: 'bash', zsh: 'bash', ksh: 'bash', fish: 'bash', 'shell-script': 'bash', shellscript: 'bash',
  terminal: 'console', 'shell-session': 'console', shellsession: 'console', 'sh-session': 'console', 'bash-session': 'console',
  ps1: 'powershell', pwsh: 'powershell', ps: 'powershell', psm1: 'powershell',
  bat: 'dos', batch: 'dos', cmd: 'dos',
  mysql: 'sql', mariadb: 'sql', postgresql: 'sql', postgres: 'sql', pgsql: 'sql', psql: 'sql', sqlite: 'sql', plsql: 'sql', 'pl/sql': 'sql',
  tsql: 'sql', 't-sql': 'sql', mssql: 'sql', hiveql: 'sql', sparksql: 'sql',
  jsonc: 'json', geojson: 'json', jsonl: 'json', ipynb: 'json',
  yml: 'yaml',
  html: 'xml', htm: 'xml', xhtml: 'xml', svg: 'xml', xsl: 'xml', xslt: 'xml', rss: 'xml', plist: 'xml', xaml: 'xml', vue: 'xml', svelte: 'xml',
  sass: 'scss',
  md: 'markdown', mdx: 'markdown', rmd: 'markdown', gfm: 'markdown', commonmark: 'markdown',
  tex: 'latex', bib: 'latex', bibtex: 'latex',
  toml: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', env: 'ini', dotenv: 'ini', editorconfig: 'ini', gitconfig: 'ini',
  patch: 'diff', udiff: 'diff',
  docker: 'dockerfile', containerfile: 'dockerfile',
  make: 'makefile', mk: 'makefile', mak: 'makefile',
  https: 'http', gql: 'graphql', proto: 'protobuf',
  asm: 'x86asm', nasm: 'x86asm', masm: 'x86asm', x86: 'x86asm', 'x86-64': 'x86asm', x64: 'x86asm', assembly: 'x86asm',
  arm: 'armasm', arm64: 'armasm', aarch64: 'armasm', mips: 'mipsasm', spim: 'mipsasm',
  sv: 'verilog', systemverilog: 'verilog', vhd: 'vhdl',
  ado: 'stata', xls: 'excel', xlsx: 'excel', 'excel-formula': 'excel',
  'standard-ml': 'sml', standardml: 'sml', smlnj: 'sml',
  octave: 'matlab'
}

/** Lo que no se resalta: texto, pseudocódigo o la salida de un programa (cada uno con su nombre en la cabecera). */
const PLAIN: Readonly<Record<string, GenericLabel>> = {
  plaintext: 'text', text: 'text', txt: 'text', plain: 'text', none: 'text', nohighlight: 'text', 'no-highlight': 'text', raw: 'text',
  log: 'text', ascii: 'text', tree: 'text', texto: 'text',
  pseudocode: 'pseudocode', pseudocódigo: 'pseudocode', pseudocodigo: 'pseudocode', pseudo: 'pseudocode', algorithm: 'pseudocode',
  algoritmo: 'pseudocode', pseint: 'pseudocode',
  output: 'output', out: 'output', stdout: 'output', result: 'output', salida: 'output', resultado: 'output'
}

/** El nombre en la cabecera cuando lo escrito es un alias con nombre propio («html» no es «XML»). */
const RAW_LABELS: Readonly<Record<string, string>> = {
  html: 'HTML', htm: 'HTML', xhtml: 'XHTML', svg: 'SVG', vue: 'Vue', svelte: 'Svelte', xaml: 'XAML', plist: 'plist',
  jsx: 'JSX', tsx: 'TSX', json5: 'JSON5', jsonc: 'JSON', geojson: 'GeoJSON',
  pascal: 'Pascal', pas: 'Pascal', freepascal: 'Pascal', 'object-pascal': 'Object Pascal', objectpascal: 'Object Pascal', lazarus: 'Pascal',
  octave: 'Octave', toml: 'TOML', env: '.env', dotenv: '.env', properties: 'Properties',
  mysql: 'MySQL', mariadb: 'MariaDB', postgresql: 'PostgreSQL', postgres: 'PostgreSQL', pgsql: 'PostgreSQL', psql: 'PostgreSQL',
  sqlite: 'SQLite', plsql: 'PL/SQL', 'pl/sql': 'PL/SQL', tsql: 'T-SQL', 't-sql': 'T-SQL', mssql: 'T-SQL',
  racket: 'Racket', rkt: 'Racket', vba: 'VBA', vb: 'Visual Basic', 'visual-basic': 'Visual Basic', visualbasic: 'Visual Basic',
  sass: 'Sass', zsh: 'Zsh', fish: 'Fish', cuda: 'CUDA', cu: 'CUDA', arduino: 'Arduino', ino: 'Arduino', gradle: 'Gradle',
  systemverilog: 'SystemVerilog', sv: 'SystemVerilog', elisp: 'Emacs Lisp', 'emacs-lisp': 'Emacs Lisp', sage: 'SageMath',
  rmd: 'R Markdown', bib: 'BibTeX', bibtex: 'BibTeX', x64: 'x86-64', 'x86-64': 'x86-64', arm64: 'ARM64', aarch64: 'ARM64'
}

/** Cómo se llama cada gramática en la cabecera (nombres propios: los mismos en todos los idiomas). */
const LABELS: Readonly<Record<CodeLanguage, string>> = {
  armasm: 'ARM ASM', bash: 'Bash', c: 'C', clojure: 'Clojure', cmake: 'CMake', console: 'Terminal', cpp: 'C++', csharp: 'C#', css: 'CSS', dart: 'Dart',
  delphi: 'Delphi', diff: 'Diff', dockerfile: 'Dockerfile', dos: 'Batch', elixir: 'Elixir', erlang: 'Erlang', excel: 'Excel',
  fortran: 'Fortran', fsharp: 'F#', go: 'Go', graphql: 'GraphQL', groovy: 'Groovy', haskell: 'Haskell', http: 'HTTP', ini: 'INI',
  java: 'Java', javascript: 'JavaScript', json: 'JSON', julia: 'Julia', kotlin: 'Kotlin', latex: 'LaTeX', lisp: 'Lisp', lua: 'Lua',
  makefile: 'Makefile', markdown: 'Markdown', matlab: 'MATLAB', mipsasm: 'MIPS ASM', nginx: 'nginx', objectivec: 'Objective-C',
  ocaml: 'OCaml', perl: 'Perl', php: 'PHP', plaintext: '', powershell: 'PowerShell', prolog: 'Prolog', protobuf: 'Protobuf',
  python: 'Python', 'python-repl': 'Python', r: 'R', ruby: 'Ruby', rust: 'Rust', sas: 'SAS', scala: 'Scala', scheme: 'Scheme',
  scss: 'SCSS', sml: 'SML', sql: 'SQL', stata: 'Stata', swift: 'Swift', typescript: 'TypeScript',
  vbnet: 'VB.NET', verilog: 'Verilog', vhdl: 'VHDL', x86asm: 'x86 ASM', xml: 'XML', yaml: 'YAML'
}

/** Nombres que no son de un lenguaje concreto: la interfaz los traduce. */
export type GenericLabel = 'code' | 'text' | 'pseudocode' | 'output'

export interface CodeLanguageInfo {
  /** La gramática con la que se resalta (ninguna si es texto, si no se conoce o si no se dijo). */
  language?: CodeLanguage
  /** El nombre de la cabecera: el del lenguaje, lo que escribió el curso o uno genérico (que traduce la interfaz). */
  label: { name: string } | { generic: GenericLabel }
  /** El curso dijo qué es (aunque Aula no lo conozca): entonces no se adivina. */
  declared: boolean
}

/** La palabra que importa de una etiqueta: «{python echo=FALSE}» → python, «language-ts» → ts, «py:main.py» → py. */
export function languageToken(raw: string | undefined): string {
  let s = (raw ?? '').trim().toLowerCase()
  const braces = /^\{\s*\.?([^\s,}]+)/.exec(s)
  if (braces) s = braces[1]
  s = s.replace(/^language-/, '').replace(/^\./, '')
  return (s.split(/[\s,:;=]/)[0] ?? '').slice(0, 40)
}

/** La gramática de lo escrito, también con versión («python3», «c++17», «es2020», «html5», «Python 3.12»). */
export function codeLanguage(raw: string | undefined): CodeLanguage | undefined {
  return resolve(raw)?.language
}

function lookup(token: string): CodeLanguage | 'plain' | undefined {
  if (PLAIN[token]) return 'plain'
  if (KNOWN.has(token)) return token as CodeLanguage
  return ALIASES[token]
}

function lookupToken(token: string): { token: string; language?: CodeLanguage; plain?: GenericLabel } | undefined {
  if (!token) return undefined
  // sin la versión pegada al nombre («python3» → python, «c++17» → c++); «Python 3.12» ya se quedó en la primera palabra
  const bare = token.replace(/[_-]?v?\d+(\.\d+)*$/, '')
  for (const t of bare && bare !== token ? [token, bare] : [token]) {
    const hit = lookup(t)
    if (hit === 'plain') return { token: t, plain: PLAIN[t], language: 'plaintext' }
    if (hit) return { token: t, language: hit }
  }
  return undefined
}

function resolve(raw: string | undefined): { token: string; language?: CodeLanguage; plain?: GenericLabel } | undefined {
  const cleaned = (raw ?? '').trim()
  if (!cleaned) return undefined
  // primero la cadena entera sin espacios ni guiones («Visual Basic», «C Sharp», «Common Lisp», «Object Pascal», «Objective C»)
  const compact = cleaned.toLowerCase().replace(/^\{\s*\.?/, '').replace(/\}$/, '').replace(/^language-/, '').replace(/[\s_-]+/g, '')
  if (compact && compact.length <= 40) {
    const whole = lookupToken(compact)
    if (whole) return whole
  }
  const token = languageToken(raw)
  if (!token) return undefined
  const direct = lookupToken(token)
  if (direct) return direct
  // pares separados por «/» («C/C++», «HTML/CSS», «Bash/Shell», «Matlab/Octave»): gana la primera gramática conocida
  if (token.includes('/')) {
    for (const part of token.split('/')) {
      const hit = lookupToken(part)
      if (hit) return hit
    }
  }
  return { token }
}

/** Qué gramática y qué nombre lleva un bloque de código según lo que escribió el curso (o la valla). */
export function codeLanguageInfo(raw: string | undefined): CodeLanguageInfo {
  const r = resolve(raw)
  if (!r) return { label: { generic: 'code' }, declared: false }
  if (r.plain) return { language: 'plaintext', label: { generic: r.plain }, declared: true }
  if (r.language) return { language: r.language, label: { name: RAW_LABELS[r.token] ?? LABELS[r.language] }, declared: true }
  // un lenguaje que Aula no resalta: su nombre completo tal cual lo escribió el curso (≤ 24), sin adivinar otro
  const full = (raw ?? '').trim().replace(/^\{\s*\.?/, '').replace(/\}$/, '').split(/[,;=]/)[0]?.trim() ?? ''
  const shown = full.slice(0, 24).trim()
  return shown ? { label: { name: shown }, declared: true } : { label: { generic: 'code' }, declared: false }
}

/** Los alias más útiles, para la guía de la IA: «py → python · js → javascript · …». */
export const CODE_LANGUAGE_ALIAS_HINTS = 'py → python · js/node → javascript · ts/tsx → typescript · sh/shell/zsh → bash · terminal/shell-session → console (a session with $ prompts) · pycon → python-repl · c++ → cpp · c# → csharp · html/svg → xml · tex → latex · md → markdown · yml → yaml · rb → ruby · rs → rust · kt → kotlin · golang → go · pascal → delphi · octave → matlab · objc → objectivec · asm/nasm → x86asm · mips → mipsasm · arm → armasm · ps1/pwsh → powershell · bat/cmd → dos · toml/cfg/conf → ini · patch → diff · gql → graphql · proto → protobuf · racket → scheme · text/txt → plain text · pseudocode → pseudocode · output → program output'
