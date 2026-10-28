// Concurrencia de verdad entre procesos: varios procesos de Node (como la app y el ayudante MCP, o dos ventanas de una app
// abierta dos veces) escriben a la vez el progreso de un curso, su pack.json y la memoria del estudiante. Ninguna escritura se
// pierde y ningún archivo queda a medias. Los procesos ejecutan el código real (empaquetado con esbuild, que ya trae vite).
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildSync } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makePack } from '@shared/schema'
import { MemoryService } from '../memory/service'
import { Library } from './library'

const SRC = resolve(__dirname, '../../..')
let work: string
let worker: string

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'aula-conc-'))
  const entry = join(work, 'worker.ts')
  writeFileSync(entry, `
import { join } from 'node:path'
import { Library } from ${JSON.stringify(join(SRC, 'main/services/store/library'))}
import { MemoryService } from ${JSON.stringify(join(SRC, 'main/services/memory/service'))}
async function main(): Promise<void> {
  const [root, tag, count] = process.argv.slice(2)
  const n = Number(count)
  const store = new Library(root, { recordsHistory: false }).openPack('curso')!
  const memory = new MemoryService({ folder: join(root, 'Memory') })
  for (let i = 0; i < n; i++) {
    store.updateProgress((p) => { p.xp += 1; p.notes[tag + '-' + i] = 'nota ' + i })
    store.updatePack((p) => { p.glossary.push({ term: tag + '-' + i, definition: 'd' } as never) })
    const r = await memory.remember({ kind: 'subject', text: 'Cursa la asignatura número ' + (Number(tag.slice(1)) * 1000 + i), source: 'student' })
    if (r.status !== 'created') throw new Error('memoria: ' + r.status + ' ' + r.message)
  }
}
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1) })
`)
  worker = join(work, 'worker.cjs')
  buildSync({
    entryPoints: [entry], outfile: worker, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent',
    alias: { '@shared': join(SRC, 'shared'), '@engine': join(SRC, 'engine'), '@main': join(SRC, 'main') }
  })
})
afterAll(() => rmSync(work, { recursive: true, force: true }))

function run(root: string, tag: string, n: number): Promise<{ code: number | null; err: string }> {
  return new Promise((done) => {
    const p = spawn(process.execPath, [worker, root, tag, String(n)], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, AULA_HOME: root } })
    let err = ''
    p.stderr.on('data', (d: Buffer) => { err += d.toString() })
    p.on('close', (code) => done({ code, err }))
  })
}

describe('varios procesos a la vez', () => {
  it('no pierden escrituras del progreso, del curso ni de la memoria', async () => {
    const root = mkdtempSync(join(work, 'datos-'))
    const lib = new Library(root, { recordsHistory: false })
    lib.createPack(makePack({ id: 'curso', title: 'Curso' }))
    const procs = 4, each = 12
    const results = await Promise.all(Array.from({ length: procs }, (_, k) => run(root, `p${k + 1}`, each)))
    for (const r of results) expect(r.err, r.err).toBe('')
    expect(results.map((r) => r.code)).toEqual(Array(procs).fill(0))
    const store = lib.openPack('curso')!
    const progress = store.loadProgress()
    expect(progress.xp).toBe(procs * each)
    expect(Object.keys(progress.notes)).toHaveLength(procs * each)
    expect(store.loadPack().glossary).toHaveLength(procs * each)
    const memory = new MemoryService({ folder: join(root, 'Memory') })
    expect(new Set(memory.records(true).map((r) => r.text)).size).toBe(procs * each)
    // sin temporales ni cerrojos olvidados
    const leftovers = (dir: string): string[] => readdirSync(dir).filter((n) => n.endsWith('.tmp') || n.includes('lock'))
    expect(leftovers(store.directory)).toEqual([])
    expect(leftovers(join(root, 'Memory'))).toEqual([])
  }, 60_000)
})
