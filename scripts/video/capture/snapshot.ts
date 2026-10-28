// La app que se captura, congelada: mientras se graba, otros pueden recompilar out/ o tener el código a medias sin que la
// toma mezcle versiones. Tres fuentes:
//   out   — la compilación que ya hay en out/ (por defecto);
//   tree  — compila el código actual en una carpeta propia (no toca out/);
//   <ref> — compila una versión de git (HEAD, una rama o un commit) extraída aparte: estable aunque el árbol esté a medias.
// La huella identifica la compilación (invalida la caché de tomas).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

export function buildFingerprint(outDir: string): string {
  const h = createHash('sha1')
  for (const file of walk(outDir)) h.update(file.slice(outDir.length)).update(readFileSync(file))
  return h.digest('hex').slice(0, 12)
}

function electronVite(cwd: string, outDir: string, log: (m: string) => void): void {
  log(`compilando la app en ${outDir}…`)
  execFileSync(join(cwd, 'node_modules', '.bin', 'electron-vite'), ['build', '--outDir', outDir], { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
}

/** Carpeta de out/ que se va a congelar según la fuente pedida. */
function compiled(root: string, workDir: string, source: string, log: (m: string) => void): { out: string; resources: string } {
  if (source === 'out') return { out: join(root, 'out'), resources: join(root, 'resources') }
  if (source === 'tree') {
    const out = join(workDir, 'build-tree')
    rmSync(out, { recursive: true, force: true })
    electronVite(root, out, log)
    return { out, resources: join(root, 'resources') }
  }
  const sha = execFileSync('git', ['-C', root, 'rev-parse', source], { encoding: 'utf8' }).trim().slice(0, 12)
  const src = join(workDir, 'src', sha)
  if (!existsSync(join(src, 'out', 'main', 'index.js'))) {
    rmSync(src, { recursive: true, force: true })
    mkdirSync(src, { recursive: true })
    log(`extrayendo ${source} (${sha})…`)
    execFileSync('sh', ['-c', `git -C "${root}" archive ${sha} | tar -x -C "${src}"`])
    symlinkSync(join(root, 'node_modules'), join(src, 'node_modules'))
    electronVite(src, join(src, 'out'), log)
  }
  return { out: join(src, 'out'), resources: join(src, 'resources') }
}

export function appSnapshot(root: string, workDir: string, source = 'out', log: (m: string) => void = () => {}): { dir: string; fingerprint: string } {
  const { out, resources } = compiled(root, workDir, source, log)
  if (!existsSync(join(out, 'main', 'index.js'))) throw new Error(`No hay compilación en ${out}: ejecuta \`npm run build\` o usa --app tree|HEAD.`)
  const fingerprint = buildFingerprint(out)
  const dir = join(workDir, 'app', fingerprint)
  if (!existsSync(join(dir, 'ready'))) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    cpSync(out, join(dir, 'out'), { recursive: true })
    cpSync(resources, join(dir, 'resources'), { recursive: true })
    cpSync(join(root, 'package.json'), join(dir, 'package.json'))
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'))
    // si out/ cambió mientras se copiaba, la huella ya no coincide: mejor fallar que capturar una mezcla
    if (buildFingerprint(join(dir, 'out')) !== fingerprint) throw new Error('out/ cambió durante la copia; vuelve a intentarlo')
    writeFileSync(join(dir, 'ready'), fingerprint)
  }
  return { dir, fingerprint }
}
