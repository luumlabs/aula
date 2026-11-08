import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Run = (command: string, args: string[]) => string
type Options = { env?: NodeJS.ProcessEnv; platform?: string; exec?: Run; version?: string }
const checks = createRequire(import.meta.url)('../../../../scripts/build/mac-release-preflight.cjs') as {
  preflight(config: Record<string, unknown>, options?: Options): string
  verifyApp(path: string, options?: Options): string
  verifyRelease(folder: string, version: string, options?: Options): void
  beforePack(context: { electronPlatformName: string }): void
}
const config = {
  appId: 'com.luumlabs.aula',
  mac: { forceCodeSigning: true, hardenedRuntime: true, notarize: true, strictVerify: true }
}
const env = { APPLE_TEAM_ID: 'TEAM123456', APPLE_KEYCHAIN_PROFILE: 'aula-notary' }
const identity = '1) 1234567890123456789012345678901234567890 "Developer ID Application: Aula (TEAM123456)"'
const details = 'Authority=Developer ID Application: Aula (TEAM123456)\nTeamIdentifier=TEAM123456\nTimestamp=Nov 8, 2026 at 2:00:00 PM\nCodeDirectory v=20500 size=400 flags=0x10000(runtime) hashes=4+7 location=embedded'
const plist = JSON.stringify({ CFBundleIdentifier: 'com.luumlabs.aula', CFBundleShortVersionString: '0.1.4' })

function fakeVerification(overrides: { details?: string; plist?: string; fail?: string } = {}): Run {
  return vi.fn((cmd: string, args: string[]) => {
    if (overrides.fail && `${cmd} ${args.join(' ')}`.includes(overrides.fail)) throw new Error('rejected')
    if (cmd.endsWith('/codesign') && args[0] === '--display') return overrides.details ?? details
    if (cmd.endsWith('/plutil')) return overrides.plist ?? plist
    return ''
  })
}

describe('public Mac release signing gate', () => {
  it('requires a valid Developer ID for the expected team, not Apple Development', () => {
    const exec = vi.fn(() => identity)
    expect(checks.preflight(config, { env, platform: 'darwin', exec })).toBe('TEAM123456')
    expect(checks.preflight(config, { env: { ...env, CSC_NAME: '1234567890123456789012345678901234567890' }, platform: 'darwin', exec })).toBe('TEAM123456')
    expect(exec).toHaveBeenCalledWith('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'])
    for (const output of [identity.replace('Developer ID Application', 'Apple Development'), identity.replace('TEAM123456', 'OTHER12345'), '0 valid identities found']) {
      expect(() => checks.preflight(config, { env, platform: 'darwin', exec: () => output })).toThrow('No valid Developer ID')
    }
  })

  it('rejects absent/malformed teams and unsigned or development overrides before packaging', () => {
    for (const team of ['', 'TEAM', 'TEAM123456"']) {
      expect(() => checks.preflight(config, { env: { ...env, APPLE_TEAM_ID: team }, platform: 'darwin' })).toThrow('APPLE_TEAM_ID')
    }
    for (const override of [{ identity: null }, { identity: '-' }, { sign: 'old-sign.cjs' }, { type: 'development' }, { notarize: false }, { hardenedRuntime: false }, { forceCodeSigning: false }, { strictVerify: false }]) {
      expect(() => checks.preflight({ ...config, mac: { ...config.mac, ...override } }, { env, platform: 'darwin' })).toThrow()
    }
    for (const override of [{ AULA_MAC_ADHOC: '1' }, { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, { AULA_AUDIT_BUILD: '1' }]) {
      expect(() => checks.preflight(config, { env: { ...env, ...override }, platform: 'darwin' })).toThrow()
    }
  })

  it('requires complete notarization credentials, even if another complete route is present', () => {
    const base = { APPLE_TEAM_ID: env.APPLE_TEAM_ID, CSC_LINK: '/private/distribution.p12' }
    expect(() => checks.preflight(config, { env: base, platform: 'darwin' })).toThrow('notarization credentials')
    expect(() => checks.preflight(config, { env: { ...base, APPLE_KEYCHAIN_PROFILE: 'ok', APPLE_ID: 'private@example.test' }, platform: 'darwin' })).toThrow('both APPLE_ID')
    expect(() => checks.preflight(config, { env: { ...base, APPLE_KEYCHAIN_PROFILE: 'ok', APPLE_API_KEY: '/private/key.p8' }, platform: 'darwin' })).toThrow('APPLE_API_KEY, APPLE_API_KEY_ID')
    for (const credentials of [
      { APPLE_KEYCHAIN_PROFILE: 'aula' },
      { APPLE_ID: 'private@example.test', APPLE_APP_SPECIFIC_PASSWORD: 'never-output-this' },
      { APPLE_API_KEY: '/private/key.p8', APPLE_API_KEY_ID: 'KEY', APPLE_API_ISSUER: 'ISSUER' }
    ]) {
      expect(checks.preflight(config, { env: { ...base, ...credentials }, platform: 'darwin' })).toBe(env.APPLE_TEAM_ID)
    }
  })

  it('leaves Windows/Linux builds alone and does not mistake MAS for a direct-download release', () => {
    expect(() => checks.beforePack({ electronPlatformName: 'win32' })).not.toThrow()
    expect(() => checks.beforePack({ electronPlatformName: 'linux' })).not.toThrow()
    expect(() => checks.beforePack({ electronPlatformName: 'mas' })).toThrow('sandboxed configuration')
    expect(() => checks.preflight(config, { env, platform: 'linux' })).toThrow('macOS')
  })

  it('requires Apple trust, the exact team and app, hardened runtime, a stapled ticket and Gatekeeper approval', () => {
    const exec = fakeVerification()
    checks.verifyApp('/tmp/Aula.app', { env, version: '0.1.4', exec })
    expect(exec).toHaveBeenCalledWith('/usr/bin/codesign', [
      '--verify', '--deep', '--strict', '--all-architectures',
      '-R=identifier "com.luumlabs.aula" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "TEAM123456"',
      '/tmp/Aula.app'
    ])
    expect(exec).toHaveBeenCalledWith('/usr/bin/xcrun', ['stapler', 'validate', '/tmp/Aula.app'])
    expect(exec).toHaveBeenCalledWith('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', '/tmp/Aula.app'])
  })

  it('rejects a foreign certificate, development signature, missing runtime or wrong version', () => {
    for (const metadata of [details.replace('TEAM123456', 'OTHER12345'), details.replace('Developer ID Application:', 'Apple Development:'), details.replace('flags=0x10000(runtime)', 'flags=0x0(none)'), details.replace(/Timestamp=.+\n/, ''), details.replace(/Timestamp=.+/, 'Timestamp=none')]) {
      expect(() => checks.verifyApp('/tmp/Aula.app', { env, version: '0.1.4', exec: fakeVerification({ details: metadata }) })).toThrow()
    }
    for (const badPlist of [plist.replace('com.luumlabs.aula', 'com.other.app'), plist.replace('0.1.4', '0.1.3')]) {
      expect(() => checks.verifyApp('/tmp/Aula.app', { env, version: '0.1.4', exec: fakeVerification({ plist: badPlist }) })).toThrow('wrong bundle ID or version')
    }
  })

  it('never passes when codesign, ticket validation or Gatekeeper fails', () => {
    for (const fail of ['--verify', 'stapler validate', 'spctl']) {
      expect(() => checks.verifyApp('/tmp/Aula.app', { env, exec: fakeVerification({ fail }) })).toThrow('rejected')
    }
  })
})

describe('Mac release artifact verification', () => {
  const dirs: string[] = []
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

  it('rejects stale Mac artifacts that the upload glob would otherwise include', () => {
    const folder = mkdtempSync(join(tmpdir(), 'aula-artifact-test-'))
    dirs.push(folder)
    for (const filename of ['Aula-0.1.4-mac.zip', 'Aula-0.1.4-mac.dmg', 'Aula-0.1.3-mac.dmg']) writeFileSync(join(folder, filename), 'fixture')
    const exec = vi.fn(() => '')
    expect(() => checks.verifyRelease(folder, '0.1.4', { env, platform: 'darwin', exec })).toThrow('different version')
    expect(exec).not.toHaveBeenCalled()
  })

  it('checks the actual ZIP and DMG contents and detaches even when the DMG app is invalid', () => {
    const folder = mkdtempSync(join(tmpdir(), 'aula-artifact-test-'))
    dirs.push(folder)
    for (const ext of ['zip', 'dmg']) writeFileSync(join(folder, `Aula-0.1.4-mac.${ext}`), 'fixture')
    const verification = fakeVerification()
    const exec = vi.fn((cmd: string, args: string[]) => {
      if (cmd.endsWith('/ditto')) mkdirSync(join(args[3], 'Aula.app'), { recursive: true })
      if (cmd.endsWith('/hdiutil') && args[0] === 'attach') mkdirSync(join(args[5], 'Aula.app'), { recursive: true })
      if (cmd.endsWith('/plutil') && args.at(-1)?.includes(`${sep}image${sep}`)) throw new Error('bad DMG app')
      return verification(cmd, args)
    })
    expect(() => checks.verifyRelease(folder, '0.1.4', { env, platform: 'darwin', exec })).toThrow('bad DMG app')
    expect(exec.mock.calls.some(([cmd, args]) => cmd.endsWith('/hdiutil') && args[0] === 'detach')).toBe(true)
    expect(exec.mock.calls.some(([cmd, args]) => cmd.endsWith('/codesign') && args.at(-1) === join(folder, 'Aula-0.1.4-mac.dmg'))).toBe(true)
  })
})
