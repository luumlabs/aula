// A1-P2-10: las prereleases no se ofrecen solas aunque GitHub no las marque; comparar versiones sin dependencias.
import { describe, expect, it } from 'vitest'
import { compareVersions, isPrerelease, versionCore } from './version'

describe('versiones', () => {
  it('compara por cifras', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('v1.0.0', '1.0')).toBe(0)
    expect(compareVersions('13.6.1', '14.0')).toBeLessThan(0)
    expect(compareVersions('basura', '1.0.0')).toBe(0)
    expect(versionCore('26.1')).toEqual([26, 1, 0])
  })
  it('reconoce una prerelease', () => {
    expect(isPrerelease('0.2.0-beta')).toBe(true)
    expect(isPrerelease('1.0.0-rc.1')).toBe(true)
    expect(isPrerelease('0.1.1')).toBe(false)
    expect(isPrerelease('v0.1.1')).toBe(false)
  })
})
