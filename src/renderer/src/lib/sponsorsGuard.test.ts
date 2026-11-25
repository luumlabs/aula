// GitHub Sponsors se ofrece en un solo sitio: «Apoya a Aula», al final de Ajustes → Acerca de, y lib/supportLink.ts decide
// si se enseña (en la app del iPhone y el iPad, solo con la tienda de EE. UU.: guía 3.1.1(a) del App Store). Ni avisos, ni
// ventanas, ni el menú abriendo la web: si su dirección o SPONSORS_URL aparecen en otro sitio de la app, esto falla.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..', '..')
const DEFINED = 'src/renderer/src/lib/supportLink.ts'
const SECTION = 'src/renderer/src/screens/settings/index.tsx'

/** El código de la app (escritorio, servidor y apps nativas), sin pruebas (las nativas, en _verify), compilados ni
 *  dependencias. */
function* files(dir: string): Generator<string> {
  for (const f of readdirSync(dir)) {
    if (f.startsWith('.') || f === 'node_modules' || f === 'build' || f === '_verify') continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) yield* files(p)
    else if (/\.(tsx?|m?js|json|html|swift|java)$/.test(f) && !/\.test\.tsx?$/.test(f)) yield p
  }
}

const app = ['src', 'native', 'server'].flatMap((d) => [...files(join(ROOT, d))]).map((p) => ({ path: relative(ROOT, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }))
const using = (pattern: RegExp): string[] => app.filter((f) => pattern.test(f.text)).map((f) => f.path).sort()

describe('GitHub Sponsors, solo en «Apoya a Aula»', () => {
  it('la dirección solo está escrita en lib/supportLink.ts', () => {
    expect(using(/github\.com\/sponsors/i)).toEqual([DEFINED])
  })

  it('SPONSORS_URL solo se usa ahí y en el apartado de Ajustes → Acerca de', () => {
    expect(using(/\bSPONSORS_URL\b/)).toEqual([DEFINED, SECTION].sort())
    // dentro de Ajustes, además de importarlo, solo en «Apoya a Aula» (SupportAula)
    const text = (app.find((f) => f.path === SECTION)?.text ?? '').replace(/\r\n/g, '\n')
    const imported = /^import \{[^}]*\} from '@renderer\/lib\/supportLink'$/m.exec(text)
    const start = text.indexOf('function SupportAula(')
    const end = text.indexOf('\n}\n', start)
    expect(imported).not.toBeNull()
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const lineOf = (at: number): number => text.slice(0, at).split('\n').length
    const elsewhere = [...text.matchAll(/\bSPONSORS_URL\b/g)]
      .map((m) => m.index)
      .filter((at) => !(imported && at >= imported.index && at < imported.index + imported[0].length) && !(at > start && at < end))
    expect(elsewhere.map((at) => `${SECTION}:${lineOf(at)}`)).toEqual([])
  })
})
