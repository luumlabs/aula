// La referencia del dibujo llega a la IA: `block_reference` la devuelve por su nombre y por sus alias, y la guía corta y el
// catálogo del tutor nombran los mismos tipos nuevos.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makePack } from '@shared/schema'
import { authoringGuide } from '@engine/pipeline'
import { BLOCK_CATALOG } from '../assistant/blockCatalog'
import { Library, type PackStore } from '../store'
import { boundValidator } from '../study/assets'
import { makeTools } from '.'

let root: string
let store: PackStore

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aula-drawref-'))
  store = new Library(root, { recordsHistory: false }).createPack(makePack({ id: '', title: 'Curso' }))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

async function reference(type: string): Promise<{ ok?: boolean; reference?: string }> {
  const tool = makeTools({ kind: 'all' }, { store, validator: () => boundValidator(store), notify: () => {}, runID: 'run-1' }, false).find((t) => t.name === 'block_reference')!
  const out = await tool.run({ type } as never, { signal: new AbortController().signal, callId: 'x' } as never)
  return JSON.parse(typeof out === 'string' ? out : out.text) as { ok?: boolean; reference?: string }
}

describe('referencia del dibujo', () => {
  it('block_reference la devuelve por «drawing» y por el alias «sketch»', async () => {
    for (const t of ['drawing', 'sketch', 'animation']) {
      const r = await reference(t)
      expect(r.ok).toBe(true)
      expect(r.reference).toMatch(/^# drawing/)
      expect(r.reference).toContain('"along":"orbit"')
      expect(r.reference).toContain('person, tree, cloud')
    }
  })
  it('la guía y el catálogo del tutor nombran los mismos tipos nuevos', () => {
    const guide = authoringGuide('guided')
    for (const kind of ['"kind":"angle","points"', '"kind":"measure"', '"kind":"brace"', '"kind":"axes"', '"kind":"grid"', '"kind":"object"', '"smooth":true', '"fillStyle":"hatch"', '"anchor":"auto"']) {
      expect(guide, kind).toContain(kind)
      expect(BLOCK_CATALOG, kind).toContain(kind)
    }
  })
})
