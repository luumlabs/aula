// El servicio de agentes que usa la interfaz: detección de todo lo que hay en el ordenador (CLIs, servidores locales, ficha,
// modelo recomendado) y «Conectar con ChatGPT» con el Codex oficial que instala Aula (aquí, un paquete falso servido en local).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CodexLoginEvent, HardwareProfile } from '@shared/agents'
import { FakeServer, reply } from '../local-ai/__fixtures__/fake-server'
import { tar, tarEntry } from '../local-ai/__fixtures__/tar'
import { Downloader } from '../local-ai/downloader'
import { LocalAIService } from '../local-ai/service'
import { codexTriple, ManagedCodex, pickCodexAsset, PINNED_CODEX_SHA256 } from './codex-installer'
import { locatorOverrides } from './locator'
import { AgentsService, modelIdArg } from './service'
import { cleanupTempDirs, makeTempDir, writeExecutable } from './__fixtures__/support'

const GB = 1_073_741_824
const HW: HardwareProfile = {
  platform: 'darwin', arch: 'arm64', chip: 'Apple M4 Pro', isAppleSilicon: true, performanceCores: 10, efficiencyCores: 4, logicalCores: 14, gpuCores: 16,
  memoryBytes: 24 * GB, gpuWorkingSetBytes: 19_069_670_000, freeDiskBytes: 200 * GB, osVersion: '27.0'
}

/** `codex` falsa (como la de las pruebas de CodexAccount): `login` deja `auth.json` en `$CODEX_HOME`. */
const FAKE_CODEX = `#!/bin/bash
case "$*" in
  *"--version"*) echo "codex-cli 0.162.1" ;;
  *"login status"*) if [ -f "$CODEX_HOME/auth.json" ]; then echo "Logged in using ChatGPT" >&2; exit 0; else echo "Not logged in" >&2; exit 1; fi ;;
  *"logout"*) rm -f "$CODEX_HOME/auth.json"; exit 0 ;;
  *"login"*) echo "If your browser did not open, navigate to this URL to authenticate: https://auth.openai.com/oauth/authorize?x=1" >&2; sleep 0.2; echo '{}' > "$CODEX_HOME/auth.json"; echo "Successfully logged in" >&2; exit 0 ;;
esac
exit 2
`

let root: string
let servers: FakeServer[] = []

beforeEach(() => {
  root = makeTempDir('agents-service')
  locatorOverrides.loginPATH = () => '/usr/bin:/bin:/usr/sbin:/sbin'
  locatorOverrides.searchDirectories = [join(root, 'bin')]
  mkdirSync(join(root, 'bin'), { recursive: true })
})
afterEach(async () => {
  locatorOverrides.loginPATH = undefined
  locatorOverrides.searchDirectories = undefined
  await Promise.all(servers.splice(0).map((s) => s.stop()))
  cleanupTempDirs()
})

async function codexPackage(): Promise<ManagedCodex> {
  const data = gzipSync(tar(tarEntry(`codex-${codexTriple()}`, { data: FAKE_CODEX, mode: 0o755 })))
  const server = new FakeServer((r) => (r.path.endsWith('.tar.gz') ? reply.file(data, r) : reply.notFound()))
  servers.push(server)
  const origin = await server.start()
  return new ManagedCodex({
    root,
    asset: { name: 'codex.tar.gz', url: `${origin}/codex.tar.gz`, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') },
    downloader: new Downloader({ attempts: 1, retryDelayMs: 0, diskMargin: 0, freeSpace: () => 2 ** 40 })
  })
}

function local(serverOrigins: Record<string, string> = {}): LocalAIService {
  return new LocalAIService({ root: join(root, 'Models'), hardware: async () => HW, serverOrigins })
}

describe('AgentsService.detect', () => {
  it('CLIs, servidores locales, ficha, recomendado y motor (con caché)', async () => {
    writeExecutable(join(root, 'bin', 'claude'), `#!/bin/bash
case "$1 $2" in
  "--version ") echo "2.1.288 (Claude Code)";;
  "auth status") echo '{"loggedIn": true, "authMethod": "claude.ai"}';;
esac`)
    const ollama = new FakeServer((r) => (r.path === '/api/tags' ? reply.json({ models: [{ name: 'qwen3.5:9b', model: 'qwen3.5:9b' }] }) : r.path === '/api/version' ? reply.json({ version: '0.40' }) : reply.notFound()))
    servers.push(ollama)
    const service = new AgentsService({ local: local({ ollama: await ollama.start() }), codex: new ManagedCodex({ root }) })
    const d = await service.detect()
    expect(d.clis.map((c) => [c.kind, c.installed, c.loggedIn])).toEqual([['claude', true, true], ['codex', false, null], ['opencode', false, null]])
    expect(d.servers.map((s) => s.kind)).toEqual(['ollama'])
    expect(d.servers[0].models[0].id).toBe('qwen3.5:9b')
    expect(d.hardware.chip).toBe('Apple M4 Pro')
    expect(d.hardware.budgetBytes).toBeGreaterThan(10 * GB)
    expect(d.recommendedModel?.id).toBe('qwen3.5-9b')
    expect(d.engine).toEqual({ installed: false, build: 'b11429' })
    expect(d.codexManagedLoggedIn).toBe(false)
    expect(Array.isArray(d.installedApps)).toBe(true)
    expect(await service.detect()).toBe(d) // de la caché
    expect(await service.detect(true)).not.toBe(d)
  })
})

describe('Conectar con ChatGPT', () => {
  it('sin Codex: instala el oficial, inicia sesión en la carpeta de Aula y queda conectado', async () => {
    const codex = await codexPackage()
    const service = new AgentsService({ local: local(), codex })
    const events: CodexLoginEvent[] = []
    const result = await service.connectChatGPT({ onEvent: (e) => events.push(e) })
    expect(result).toEqual({ connected: true, executable: codex.binary, managedHome: true })
    expect(codex.binary).toBe(join(root, 'tools', 'codex', '0.162.1', process.platform === 'win32' ? 'codex.exe' : 'codex'))
    expect(existsSync(join(codex.sessionFolder, 'auth.json'))).toBe(true) // nunca en ~/.codex
    expect(events.some((e) => e.type === 'downloading')).toBe(true)
    expect(events).toContainEqual({ type: 'waitingForBrowser', url: 'https://auth.openai.com/oauth/authorize?x=1' })
    expect(events[events.length - 1]).toEqual({ type: 'finished' })
    expect((await service.detect(true)).codexManagedLoggedIn).toBe(true)
    // la segunda vez ya hay sesión: no vuelve a abrir el inicio de sesión
    const again: CodexLoginEvent[] = []
    await service.connectChatGPT({ onEvent: (e) => again.push(e) })
    expect(again.filter((e) => e.type !== 'downloading')).toEqual([])
    await service.logoutChatGPT()
    expect(existsSync(join(codex.sessionFolder, 'auth.json'))).toBe(false)
  })

  it('si el Codex del usuario ya tiene sesión, se usa tal cual', async () => {
    const home = join(root, 'home-usuario')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'auth.json'), '{}')
    const exe = writeExecutable(join(root, 'bin', 'codex'), FAKE_CODEX.replace('#!/bin/bash\n', `#!/bin/bash\nCODEX_HOME="\${CODEX_HOME:-${home}}"\n`))
    const service = new AgentsService({ local: local(), codex: new ManagedCodex({ root }) })
    expect(await service.connectChatGPT()).toEqual({ connected: true, executable: exe, managedHome: false })
  })

  it('cancelar el inicio de sesión termina sin quedar a medias', async () => {
    const codex = await codexPackage()
    await codex.install()
    writeFileSync(codex.binary!, FAKE_CODEX.replace('sleep 0.2', 'sleep 30'))
    const service = new AgentsService({ local: local(), codex })
    const run = service.connectChatGPT({ onEvent: (e) => e.type === 'waitingForBrowser' && service.cancelChatGPTLogin() })
    expect((await run.catch((e) => e))?.name).toBe('AbortError')
    expect(existsSync(join(codex.sessionFolder, 'auth.json'))).toBe(false)
  })

  it('elige el paquete oficial de Codex de cada sistema', () => {
    expect(codexTriple('darwin', 'arm64')).toBe('aarch64-apple-darwin')
    expect(codexTriple('linux', 'x64')).toBe('x86_64-unknown-linux-musl')
    expect(codexTriple('win32', 'x64')).toBe('x86_64-pc-windows-msvc')
    expect(codexTriple('linux', 'ia32')).toBeUndefined()
    const assets = [
      { name: 'codex-x86_64-pc-windows-msvc.exe.zip', size: 10, browser_download_url: 'https://github.com/openai/codex/releases/download/rust-v0.162.1/codex-x86_64-pc-windows-msvc.exe.zip', digest: 'sha256:' + 'a'.repeat(64) },
      { name: 'codex-x86_64-unknown-linux-musl.tar.gz', size: 10, browser_download_url: 'https://evil.example/codex.tar.gz', digest: 'sha256:' + 'b'.repeat(64) }
    ]
    // A2-P2-21: la huella fijada manda; si GitHub publica otra para ese nombre, el paquete no se usa
    expect(pickCodexAsset(assets, 'x86_64-pc-windows-msvc')).toBeUndefined()
    const real = [{ ...assets[0], digest: 'sha256:' + PINNED_CODEX_SHA256['codex-x86_64-pc-windows-msvc.exe.zip'] }]
    expect(pickCodexAsset(real, 'x86_64-pc-windows-msvc')?.sha256).toBe(PINNED_CODEX_SHA256['codex-x86_64-pc-windows-msvc.exe.zip'])
    expect(pickCodexAsset([{ ...assets[0], digest: null }], 'x86_64-pc-windows-msvc')?.sha256).toBe(PINNED_CODEX_SHA256['codex-x86_64-pc-windows-msvc.exe.zip'])
    expect(pickCodexAsset(assets, 'x86_64-unknown-linux-musl')).toBeUndefined() // solo desde github.com
  })
})

describe('Argumentos de la interfaz', () => {
  it('modelId válido', () => {
    expect(modelIdArg({ modelId: 'qwen3.5-9b' })).toBe('qwen3.5-9b')
    expect(modelIdArg({ modelId: 'hf:unsloth/Qwen3-8B-GGUF' })).toBe('hf:unsloth/Qwen3-8B-GGUF')
    for (const bad of [undefined, null, {}, { modelId: '' }, { modelId: 5 }, { modelId: 'a b' }, { modelId: 'x'.repeat(300) }]) expect(() => modelIdArg(bad)).toThrow()
  })
})

