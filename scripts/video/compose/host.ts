// Lado Node del compositor: empaqueta la página (esbuild, que ya viene con vite) y lanza el Electron del compositor
// (nunca la app Aula) con un trabajo. Devuelve el resultado que la página manda con vt.done().
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

export interface ComposeJob {
  /** Módulo que exporta `run(payload)` para la página (p. ej. compose/page.ts). */
  entry: string
  workDir: string
  outDir: string
  musicDir?: string
  payload: unknown
  onLog?: (msg: Record<string, unknown>) => void
}

export async function bundleCompositor(buildDir: string, entry: string): Promise<void> {
  mkdirSync(buildDir, { recursive: true })
  const common = { bundle: true, logLevel: 'error' as const, sourcemap: 'inline' as const, legalComments: 'none' as const }
  await build({ ...common, entryPoints: [join(HERE, 'electron-main.ts')], outfile: join(buildDir, 'main.cjs'), platform: 'node', format: 'cjs', external: ['electron'] })
  await build({ ...common, entryPoints: [join(HERE, 'preload.ts')], outfile: join(buildDir, 'preload.cjs'), platform: 'node', format: 'cjs', external: ['electron'] })
  const boot = join(buildDir, 'boot.ts')
  writeFileSync(boot, `import { run } from ${JSON.stringify(resolve(entry))}\nrun()\n`)
  await build({ ...common, entryPoints: [boot], outfile: join(buildDir, 'page.js'), platform: 'browser', format: 'iife', target: 'chrome140' })
  writeFileSync(join(buildDir, 'page.html'), '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><script src="page.js"></script>\n')
}

/** Lanza el compositor y espera a que termine. */
export async function runCompositor(job: ComposeJob): Promise<unknown> {
  const buildDir = join(job.outDir, '.build')
  await bundleCompositor(buildDir, job.entry)
  const jobFile = join(buildDir, 'job.json')
  writeFileSync(jobFile, JSON.stringify({ buildDir, workDir: job.workDir, outDir: job.outDir, musicDir: job.musicDir, payload: job.payload }))
  const electronBin = require('electron') as unknown as string
  return new Promise((ok, fail) => {
    const child = spawn(electronBin, [join(buildDir, 'main.cjs'), '--job', jobFile], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '' } })
    let result: unknown
    let error: string | null = null
    let pending = ''
    child.stdout.on('data', (b: Buffer) => {
      pending += b.toString()
      let i: number
      while ((i = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, i)
        pending = pending.slice(i + 1)
        if (!line.startsWith('@vt ')) continue
        const msg = JSON.parse(line.slice(4)) as Record<string, unknown>
        if ('done' in msg) result = msg.done
        else if ('error' in msg) error = String(msg.error)
        else job.onLog?.(msg)
      }
    })
    let stderr = ''
    child.stderr.on('data', (b: Buffer) => (stderr = (stderr + b.toString()).slice(-4000)))
    child.on('exit', (code) => {
      const r = result as { error?: string } | undefined
      if (error || code !== 0 || r?.error) fail(new Error(error ?? r?.error ?? `el compositor terminó con ${code}\n${stderr}`))
      else ok(result)
    })
  })
}
