// Cómo encuentran las copias instaladas una versión nueva, probado con el código real de electron-updater contra un
// servidor que imita GitHub (scripts/dev/fake-github-releases.mjs): borradores y prerelease no se ofrecen, cada sistema
// lee su latest*.yml. Y que la configuración de empaquetado sigue dando lo que el actualizador necesita.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const root = join(__dirname, '../../../..')
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider') as { GitHubProvider: new (...a: unknown[]) => { getLatestVersion(): Promise<{ version: string; tag: string; releaseNotes?: unknown }> } }
const { NodeHttpExecutor } = require('builder-util/out/nodeHttpExecutor') as { NodeHttpExecutor: new () => unknown }
const semver = require('semver') as { parse(v: string): unknown }
const yaml = require('js-yaml') as { load(s: string): unknown }

const PORT = 18765 + Math.floor(Math.random() * 500)
let dir: string
let server: ChildProcess

type Rel = { tag: string; draft?: boolean; prerelease?: boolean; title?: string }
function publish(releases: Rel[]): void {
  writeFileSync(join(dir, 'releases.json'), JSON.stringify(releases))
  for (const r of releases) {
    const v = r.tag.slice(1)
    const d = join(dir, r.tag)
    mkdirSync(d, { recursive: true })
    const yml = (file: string) => `version: ${v}\nfiles:\n  - url: ${file}\n    sha512: x\n    size: 1\npath: ${file}\nsha512: x\nreleaseNotes: notas ${v}\n`
    writeFileSync(join(d, 'latest-mac.yml'), yml(`Aula-${v}-mac.zip`))
    writeFileSync(join(d, 'latest.yml'), yml(`Aula-Setup-${v}.exe`))
    writeFileSync(join(d, 'latest-linux.yml'), yml(`Aula-${v}-linux-x86_64.AppImage`))
    writeFileSync(join(d, 'latest-linux-arm64.yml'), yml(`Aula-${v}-linux-arm64.AppImage`))
  }
}

function latest(platform: 'darwin' | 'win32' | 'linux', current = '2.0.0', allowPrerelease = false) {
  const updater = { allowPrerelease, channel: null, currentVersion: semver.parse(current), fullChangelog: false }
  const p = new GitHubProvider({ provider: 'github', owner: 'luumlabs', repo: 'aula', host: `127.0.0.1:${PORT}`, protocol: 'http' }, updater, { isUseMultipleRangeRequest: false, platform, executor: new NodeHttpExecutor() })
  return p.getLatestVersion()
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'aula-feed-'))
  server = spawn(process.execPath, [join(root, 'scripts/dev/fake-github-releases.mjs'), dir, String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise<void>((resolve) => server.stdout!.once('data', () => resolve()))
})
afterAll(() => {
  server?.kill()
  rmSync(dir, { recursive: true, force: true })
})

describe('qué versión se ofrece', () => {
  it('un borrador no se ofrece; al publicarlo, sí', async () => {
    publish([{ tag: 'v2.0.1', draft: true }, { tag: 'v2.0.0' }])
    expect((await latest('darwin')).version).toBe('2.0.0')
    publish([{ tag: 'v2.0.1', draft: false }, { tag: 'v2.0.0' }])
    expect((await latest('darwin')).version).toBe('2.0.1')
  })
  it('una prerelease no se ofrece a la versión estable', async () => {
    publish([{ tag: 'v2.1.0-beta.1', prerelease: true }, { tag: 'v2.0.1' }, { tag: 'v2.0.0' }])
    expect((await latest('darwin')).version).toBe('2.0.1')
    expect((await latest('win32')).version).toBe('2.0.1')
  })
  it('cada sistema lee su archivo (latest-mac.yml, latest.yml, latest-linux*.yml)', async () => {
    publish([{ tag: 'v2.0.1' }])
    const mac = (await latest('darwin')) as unknown as { path: string }
    const win = (await latest('win32')) as unknown as { path: string }
    const linux = (await latest('linux')) as unknown as { path: string }
    expect(mac.path).toBe('Aula-2.0.1-mac.zip')
    expect(win.path).toBe('Aula-Setup-2.0.1.exe')
    expect(linux.path).toMatch(process.arch === 'arm64' ? /linux-arm64\.AppImage$/ : /linux-x86_64\.AppImage$/)
  })
  it('sin ninguna versión publicada (todo en borrador o repo privado) falla con un código que se explica', async () => {
    publish([{ tag: 'v2.0.1', draft: true }])
    await expect(latest('darwin')).rejects.toMatchObject({ code: expect.stringMatching(/^ERR_UPDATER_(LATEST_VERSION_NOT_FOUND|NO_PUBLISHED_VERSIONS)|ERR_XML_MISSED_ELEMENT$/) })
  })
  it('una release publicada sin el archivo de este sistema no se ofrece (404 → «no disponible»)', async () => {
    publish([{ tag: 'v2.0.1' }])
    rmSync(join(dir, 'v2.0.1', 'latest-mac.yml'))
    await expect(latest('darwin')).rejects.toMatchObject({ code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' })
  })
})

describe('configuración de empaquetado', () => {
  const cfg = yaml.load(readFileSync(join(root, 'electron-builder.yml'), 'utf8')) as Record<string, Record<string, unknown> & { target?: Array<{ target: string; arch: string[] }> }>
  it('publica en GitHub como borrador', () => {
    expect(cfg.publish).toMatchObject({ provider: 'github', owner: 'luumlabs', repo: 'aula', releaseType: 'draft' })
  })
  it('macOS: zip universal (lo que descargan las actualizaciones) y dmg', () => {
    const t = cfg.mac.target!.map((x) => `${x.target}:${x.arch.join(',')}`)
    expect(t).toEqual(expect.arrayContaining(['zip:universal', 'dmg:universal']))
    expect(cfg.mac.artifactName).toBe('Aula-${version}-mac.${ext}')
  })
  it('Windows: NSIS por usuario (actualiza sin pedir permisos de administrador)', () => {
    expect(cfg.win.target!.map((x) => x.target)).toContain('nsis')
    expect(cfg.nsis).toMatchObject({ oneClick: true, perMachine: false, deleteAppDataOnUninstall: false })
  })
  it('Linux: AppImage x64 y arm64 (la .deb la actualiza el gestor de paquetes)', () => {
    const app = cfg.linux.target!.find((x) => x.target === 'AppImage')
    expect(app?.arch).toEqual(expect.arrayContaining(['x64', 'arm64']))
  })
  it('no empaqueta @napi-rs/canvas (nativo: rompe la app universal; pdf.ts lee sin él)', () => {
    expect(cfg.files as unknown as string[]).toContain('!**/node_modules/@napi-rs/**')
  })
  it('las notas de la versión existen', () => {
    const notes = (cfg.releaseInfo as { releaseNotesFile: string }).releaseNotesFile
    expect(readFileSync(join(root, notes), 'utf8')).toMatch(/<!-- lang:es -->/)
  })
})

describe('electron-updater: lo que cambiamos en macOS sigue en su sitio', () => {
  // si una versión nueva de electron-updater lo renombra, esta prueba avisa antes de que se vuelva a usar Squirrel.Mac
  it('MacUpdater descarga y luego llama a this.updateDownloaded(zip, event)', () => {
    const { MacUpdater } = require('electron-updater/out/MacUpdater') as { MacUpdater: { prototype: Record<string, unknown> } }
    expect(typeof MacUpdater.prototype.updateDownloaded).toBe('function')
    expect(typeof MacUpdater.prototype.quitAndInstall).toBe('function')
    expect(String(MacUpdater.prototype.doDownloadUpdate)).toContain('this.updateDownloaded(zipFileInfo, event)')
    const { AppUpdater } = require('electron-updater/out/AppUpdater') as { AppUpdater: { prototype: Record<string, unknown> } }
    expect(typeof AppUpdater.prototype.dispatchUpdateDownloaded).toBe('function')
  })
})
