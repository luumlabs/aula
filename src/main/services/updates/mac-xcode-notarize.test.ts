import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Options = {
  team: string
  version: string
  verifyApp: (path: string, options: { version: string }) => void
  runProcess: (args: string[]) => Promise<{ code: number; tail: string }>
  runTool: (command: string, args: string[]) => void
  wait: () => Promise<void>
  tempRoot: string
  getIdentity: () => string
}
const { notarizeWithXcode } = createRequire(import.meta.url)('../../../../scripts/build/mac-xcode-notarize.cjs') as {
  notarizeWithXcode(path: string, options: Options): Promise<void>
}

describe('Xcode notarization gate', () => {
  const dirs: string[] = []
  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function fixture(options: { changedCode?: boolean; changedUnpacked?: boolean; changedArchCode?: boolean; changedArchUnpacked?: boolean; addedArchive?: boolean; removedArchive?: boolean; rejected?: boolean; failFinalVerification?: boolean } = {}) {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = mkdtempSync(join(tmpdir(), 'aula-xcode-test-'))
    dirs.push(root)
    const app = join(root, 'Aula.app')
    mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
    writeFileSync(join(app, 'Contents', 'Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.luumlabs.aula</string><key>CFBundleShortVersionString</key><string>0.1.4</string><key>CFBundleVersion</key><string>0.1.4</string></dict></plist>')
    writeFileSync(join(app, 'Contents', 'Resources', 'app.asar'), 'original code')
    mkdirSync(join(app, 'Contents', 'Resources', 'app.asar.unpacked'), { recursive: true })
    writeFileSync(join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'worker.js'), 'original worker')
    writeFileSync(join(app, 'Contents', 'Resources', 'app-x64.asar'), 'intel code')
    writeFileSync(join(app, 'Contents', 'Resources', 'app-arm64.asar'), 'arm code')
    mkdirSync(join(app, 'Contents', 'Resources', 'app-arm64.asar.unpacked'), { recursive: true })
    writeFileSync(join(app, 'Contents', 'Resources', 'app-arm64.asar.unpacked', 'worker.js'), 'arm worker')
    writeFileSync(join(app, 'marker'), 'original')
    let exports = 0
    const runProcess = vi.fn(async (args: string[]) => {
      if (args[0] === '-exportArchive') return { code: 0, tail: 'uploaded' }
      if (options.rejected) return { code: 65, tail: 'error: notarization was rejected' }
      if (exports++ === 0) return { code: 65, tail: 'error: Archive "Aula.xcarchive" is processing and not ready for distribution.' }
      const archive = args[args.indexOf('-archivePath') + 1]
      const exportDir = args[args.indexOf('-exportPath') + 1]
      mkdirSync(exportDir, { recursive: true })
      const result = join(exportDir, 'Aula.app')
      cpSync(join(archive, 'Products', 'Applications', 'Aula.app'), result, { recursive: true })
      writeFileSync(join(result, 'marker'), 'notarized')
      if (options.changedCode) writeFileSync(join(result, 'Contents', 'Resources', 'app.asar'), 'different code')
      if (options.changedUnpacked) writeFileSync(join(result, 'Contents', 'Resources', 'app.asar.unpacked', 'worker.js'), 'different worker')
      if (options.changedArchCode) writeFileSync(join(result, 'Contents', 'Resources', 'app-x64.asar'), 'different intel code')
      if (options.changedArchUnpacked) writeFileSync(join(result, 'Contents', 'Resources', 'app-arm64.asar.unpacked', 'worker.js'), 'different arm worker')
      if (options.addedArchive) writeFileSync(join(result, 'Contents', 'Resources', 'extra.asar'), 'unexpected code')
      if (options.removedArchive) rmSync(join(result, 'Contents', 'Resources', 'app-arm64.asar'))
      return { code: 0, tail: 'exported' }
    })
    const runTool = vi.fn((command: string, args: string[]) => {
      if (command.endsWith('/ditto')) cpSync(args[0], args[1], { recursive: true })
    })
    let verified = 0
    const verifyApp = vi.fn(() => {
      if (++verified === 2 && options.failFinalVerification) throw new Error('final app failed verification')
    })
    const wait = vi.fn(async () => {})
    return { root, app, runProcess, runTool, verifyApp, wait, invoke: () => notarizeWithXcode(app, {
      team: 'TEAM123456', version: '0.1.4', verifyApp, runProcess, runTool, wait, tempRoot: root,
      getIdentity: () => 'Developer ID Application: Aula (TEAM123456)'
    }) }
  }

  it('waits for Apple, staples and verifies the returned app before replacing the build', async () => {
    const f = fixture()
    await f.invoke()
    expect(f.runProcess).toHaveBeenCalledTimes(3)
    expect(f.wait).toHaveBeenCalledTimes(1)
    expect(f.runTool).toHaveBeenCalledWith('/usr/bin/xcrun', ['stapler', 'staple', expect.any(String)])
    expect(f.verifyApp).toHaveBeenCalledTimes(2)
    expect(readFileSync(join(f.app, 'marker'), 'utf8')).toBe('notarized')
    expect(existsSync(`${f.app}.before-xcode-notarization`)).toBe(false)
  })

  it('leaves the build untouched if Apple rejects it or returns different app code', async () => {
    for (const option of [{ rejected: true }, { changedCode: true }, { changedUnpacked: true }, { changedArchCode: true }, { changedArchUnpacked: true }, { addedArchive: true }, { removedArchive: true }]) {
      const f = fixture(option)
      await expect(f.invoke()).rejects.toThrow()
      expect(readFileSync(join(f.app, 'marker'), 'utf8')).toBe('original')
      expect(f.verifyApp).not.toHaveBeenCalled()
    }
  })

  it('restores the original build if verification fails in the final location', async () => {
    const f = fixture({ failFinalVerification: true })
    await expect(f.invoke()).rejects.toThrow('final app failed verification')
    expect(readFileSync(join(f.app, 'marker'), 'utf8')).toBe('original')
    expect(existsSync(`${f.app}.before-xcode-notarization`)).toBe(false)
  })
})
