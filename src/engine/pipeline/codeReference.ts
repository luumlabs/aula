// Referencia del bloque `code` (herramienta `block_reference`): qué lenguajes resalta Aula, cómo se rellena, qué hace la
// salida en un enunciado y cuándo basta un ``` dentro de un texto. En inglés: lo lee el modelo. Puro.
import { CODE_LANGUAGE_ALIAS_HINTS, CODE_LANGUAGES } from '@engine/content/codeLanguages'

const F = '```'
const B = '`'

export const CODE_REFERENCE = String.raw`# code — program listing
A program listing in its own card: the language's name in the header, syntax highlighting, line numbers from 3 lines on, a copy button, long lines that scroll sideways inside the card, and the program's exact output in its own pane. Use it whenever the code IS the content: a language course, an algorithm, a query, a script or a compiler error the student has to read.
Schema:
{"type":"code","language":"python","code":"…","output":"…","caption":"md"}
- language: recommended. One of the names below or an alias; case and versions do not matter ("Python 3", "c++17", "es2020"). A language Aula does not know is shown by its name, without colours. Use "pseudocode", "text" or "output" for listings that are not a real language.
- code: the exact source, with real line breaks (\n inside the JSON string). Never wrap it in ${F} fences and never number the lines yourself: the app numbers them.
- output: optional. Exactly what the program prints (or the error), one line per line, as plain text: it has its own pane, without colours. In an unsolved exercise statement, Aula hides it automatically when it matches the answer (as in "what does it print?"), and keeps it when it is part of the problem (such as an error or traceback the student must explain).
- caption: optional markdown under the card: the version ("Python 3.12"), what to look at, or the flag that matters.
Languages: ${CODE_LANGUAGES.filter((l) => l !== 'plaintext').join(', ')}.
Aliases: ${CODE_LANGUAGE_ALIAS_HINTS}.
Code inside a text: every md field (text blocks, callouts, worked examples, exercise statements, options, solutions, hints, chat replies) renders a fenced block in the same card, coloured with the language written after the backticks: ${F}python … ${F}. Write the language there, except when the question asks to identify the language or naming it would give away the answer (leave the fence and ${B}language${B} blank in that case). A fence is right for a short snippet inside prose or inside an option; this block is for code that is the content or that has an output. Inline ${B}code${B} stays in the sentence: a name, a keyword, a short expression.
Rules
- The code must run as written (or fail exactly as the exercise says); no "…" elisions unless the caption says so.
- Keep lines under ~80 characters: longer lines scroll sideways on screen and wrap on paper.
- Inside the JSON string, double every backslash and escape double quotes (\n, \t, \\, \").
- One idea per block: split a long program into the steps you would explain, each with its own caption.
- Code is not maths: never put code inside $…$, and a $ inside code (${B}$HOME${B}, ${B}$x = 1;${B}) needs no escaping.
- A cloze gap ([[1]]) cannot go inside code. For "complete the code", show the code with ____ in the statement and ask for the missing piece with a short exact answer (or a choice).
Examples
1. Predict the output (Python):
{"type":"code","language":"python","code":"def add(a, b=[]):\n    b.append(a)\n    return b\n\nprint(add(1))\nprint(add(2))","output":"[1]\n[1, 2]","caption":"The default list is created once, not on every call."}
2. Does it compile? (TypeScript, strict):
{"type":"code","language":"typescript","code":"interface User { name: string }\n\nconst u: User = { name: \"Ana\", age: 30 };","caption":"Why does ${B}tsc${B} reject line 3?"}
3. Read the query (SQL):
{"type":"code","language":"sql","code":"SELECT name, AVG(grade) AS avg\nFROM students\nGROUP BY name\nHAVING AVG(grade) < 5\nORDER BY avg;","caption":"Which students are below a 5 average?"}
4. A terminal session (the prompts and what they print):
{"type":"code","language":"console","code":"$ python3 -m venv .venv\n$ source .venv/bin/activate\n(.venv) $ pip install numpy","caption":"Create and activate a virtual environment."}
5. A snippet inside a text block:
{"type":"text","md":"The loop adds the first ${B}n${B} numbers:\n\n${F}java\nfor (int i = 0; i < n; i++) {\n    total += i;\n}\n${F}"}
`
