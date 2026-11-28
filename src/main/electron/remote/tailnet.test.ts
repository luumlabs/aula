// Resolución del ejecutable, nombre en la red privada y arranque del proceso auxiliar de Tailscale en macOS, Windows y Linux.
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import {
  defaultTailnetHostname,
  resolveTailnetBinary,
  Tailnet,
  TAILNET_HOSTNAME,
  tailnetBinaryName,
  tailnetSpawnOptions,
  WINDOWS_TAILNET_HOSTNAME
} from './tailnet'
import { isAulaHostname, isDeviceHostname } from '@main/services/remote/server-mode'

describe('componente de Tailscale por plataforma', () => {
  it('elige el nombre en la tailnet: aula-windows en Windows y aula-mac en macOS/Linux', () => {
    expect(defaultTailnetHostname('win32')).toBe(WINDOWS_TAILNET_HOSTNAME)
    expect(defaultTailnetHostname('win32')).toBe('aula-windows')
    expect(defaultTailnetHostname('darwin')).toBe(TAILNET_HOSTNAME)
    expect(defaultTailnetHostname('darwin')).toBe('aula-mac')
    expect(defaultTailnetHostname('linux')).toBe('aula-mac')
    // el nombre de Windows es reconocido por las apps de iOS y Android sin cambios adicionales
    expect(isAulaHostname(WINDOWS_TAILNET_HOSTNAME)).toBe(true)
    expect(isDeviceHostname(WINDOWS_TAILNET_HOSTNAME)).toBe(false)
  })

  it('resuelve el ejecutable correcto en empaquetado y en desarrollo (con .exe en Windows)', () => {
    expect(tailnetBinaryName('win32')).toBe('aula-tsnet.exe')
    expect(tailnetBinaryName('darwin')).toBe('aula-tsnet')
    expect(tailnetBinaryName('linux')).toBe('aula-tsnet')

    const res = '/app/resources'
    const root = '/repo'
    expect(resolveTailnetBinary({ isPackaged: true, resourcesPath: res, appPath: root, platform: 'win32', arch: 'x64' }))
      .toBe(join(res, 'bin', 'aula-tsnet.exe'))
    expect(resolveTailnetBinary({ isPackaged: true, resourcesPath: res, appPath: root, platform: 'darwin', arch: 'arm64' }))
      .toBe(join(res, 'bin', 'aula-tsnet'))
    expect(resolveTailnetBinary({ isPackaged: true, resourcesPath: res, appPath: root, platform: 'linux', arch: 'x64' }))
      .toBe(join(res, 'bin', 'aula-tsnet'))

    // en desarrollo: Windows busca win-<arch>/aula-tsnet.exe y cae a bin/aula-tsnet.exe y al empaquetado
    const winX64 = join(root, 'native', 'tsnet', 'bin', 'win-x64', 'aula-tsnet.exe')
    const winArm64 = join(root, 'native', 'tsnet', 'bin', 'win-arm64', 'aula-tsnet.exe')
    const winFlat = join(root, 'native', 'tsnet', 'bin', 'aula-tsnet.exe')
    expect(resolveTailnetBinary({ isPackaged: false, resourcesPath: res, appPath: root, platform: 'win32', arch: 'x64', exists: (p) => p === winX64 }))
      .toBe(winX64)
    expect(resolveTailnetBinary({ isPackaged: false, resourcesPath: res, appPath: root, platform: 'win32', arch: 'arm64', exists: (p) => p === winArm64 }))
      .toBe(winArm64)
    expect(resolveTailnetBinary({ isPackaged: false, resourcesPath: res, appPath: root, platform: 'win32', arch: 'x64', exists: (p) => p === winFlat }))
      .toBe(winFlat)
    expect(resolveTailnetBinary({ isPackaged: false, resourcesPath: res, appPath: root, platform: 'win32', arch: 'x64', exists: () => false }))
      .toBe(join(res, 'bin', 'aula-tsnet.exe'))

    // macOS y Linux conservan sus rutas
    const macDev = join(root, 'native', 'tsnet', 'bin', 'aula-tsnet')
    const linuxDev = join(root, 'native', 'tsnet', 'bin', 'linux-x64', 'aula-tsnet')
    expect(resolveTailnetBinary({ isPackaged: false, resourcesPath: res, appPath: root, platform: 'darwin', arch: 'arm64', exists: (p) => p === macDev }))
      .toBe(macDev)
    expect(resolveTailnetBinary({ isPackaged: false, resourcesPath: res, appPath: root, platform: 'linux', arch: 'x64', exists: (p) => p === linuxDev }))
      .toBe(linuxDev)
  })

  it('oculta la ventana de consola en Windows y pasa la clave solo por stdin', async () => {
    expect(tailnetSpawnOptions()).toEqual({ stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

    const dir = mkdtempSync(join(tmpdir(), 'aula-tailnet-test-'))
    const fakeBin = join(dir, 'aula-tsnet.exe')
    writeFileSync(fakeBin, 'stub')
    const stateDir = join(dir, 'state')
    const proxyKey = 'k'.repeat(48)

    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let stdinText = ''
    let stdinEnded = false
    stdin.on('data', (chunk: Buffer) => { stdinText += chunk.toString('utf8') })
    stdin.on('end', () => { stdinEnded = true })

    const child = Object.assign(new EventEmitter(), {
      stdin,
      stdout,
      stderr,
      exitCode: null as number | null,
      kill: vi.fn()
    }) as unknown as ChildProcess

    let spawnCall: { command: string; args: readonly string[]; options: SpawnOptions } | null = null
    const fakeSpawn = ((command: string, args: readonly string[], options: SpawnOptions) => {
      spawnCall = { command, args, options }
      return child
    }) as unknown as typeof import('node:child_process').spawn

    const states: string[] = []
    const tailnet = new Tailnet({
      binary: fakeBin,
      stateDir,
      proxyKey,
      hostname: defaultTailnetHostname('win32'),
      spawn: fakeSpawn,
      onChange: () => { states.push(tailnet.status.state) }
    })

    try {
      expect(tailnet.available).toBe(true)
      expect(tailnet.hostname).toBe('aula-windows')
      expect(tailnet.status.state).toBe('off')

      tailnet.start(41234)
      expect(spawnCall).not.toBeNull()
      expect(spawnCall!.command).toBe(fakeBin)
      expect(spawnCall!.args).toEqual(['--state-dir', stateDir, '--hostname', 'aula-windows', '--target', '127.0.0.1:41234', '--listen-port', '80'])
      expect(spawnCall!.args.join(' ')).not.toContain(proxyKey)
      expect(spawnCall!.options).toMatchObject({ windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })

      stdout.write(JSON.stringify({ type: 'needs_login', authURL: 'https://login.tailscale.com/a/test' }) + '\n')
      stdout.write(JSON.stringify({ type: 'running', hostname: 'aula-windows', dnsName: 'aula-windows.tail1.ts.net', ips: ['100.64.0.9'], user: 'boris@example.com' }) + '\n')
      await new Promise((r) => setImmediate(r))

      expect(JSON.parse(stdinText.trim())).toEqual({ proxyKey })
      expect(tailnet.status).toMatchObject({
        state: 'running',
        name: 'aula-windows',
        dnsName: 'aula-windows.tail1.ts.net',
        ips: ['100.64.0.9'],
        user: 'boris@example.com'
      })
      expect(states).toContain('needsLogin')
      expect(states).toContain('running')

      tailnet.stop()
      await new Promise((r) => setImmediate(r))
      expect(stdinEnded).toBe(true)
      expect(tailnet.status.state).toBe('off')
      // si el proceso aún no ha salido cuando llega will-quit (p. ej. actualización NSIS en Windows), terminateNow lo cierra
      expect(child.kill).not.toHaveBeenCalled()
      tailnet.terminateNow()
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
