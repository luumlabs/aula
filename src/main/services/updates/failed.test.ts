import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blocksAutoRetry, errorOfFailure, fingerprintOf, MAX_CORRUPT, readFailed, recordFailure } from './failed'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aula-failed-'))
  file = join(dir, 'Updates', 'failed.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('versiones que fallaron', () => {
  it('una firma no válida o un fallo al instalar bloquean esa versión (y solo esa)', () => {
    recordFailure(file, '2.0.1', 'signature')
    expect(blocksAutoRetry(readFailed(file), '2.0.1')).toBe(true)
    expect(blocksAutoRetry(readFailed(file), '2.0.2')).toBe(false)
  })
  it('una descarga dañada se reintenta unas pocas veces', () => {
    for (let i = 1; i < MAX_CORRUPT; i++) {
      recordFailure(file, '2.0.1', 'corrupt')
      expect(blocksAutoRetry(readFailed(file), '2.0.1')).toBe(false)
    }
    recordFailure(file, '2.0.1', 'corrupt')
    expect(readFailed(file)?.attempts).toBe(MAX_CORRUPT)
    expect(blocksAutoRetry(readFailed(file), '2.0.1')).toBe(true)
  })
  it('lo que escribe el vigilante (sin intentos) también bloquea', () => {
    writeFileSync(join(dir, 'f.json'), '{"version":"2.0.1","reason":"start","at":"2026-10-27T03:03:30Z"}\n')
    expect(blocksAutoRetry(readFailed(join(dir, 'f.json')), '2.0.1')).toBe(true)
  })
  it('sin archivo o ilegible: nada bloqueado', () => {
    expect(readFailed(file)).toBeNull()
    writeFileSync(join(dir, 'roto.json'), '{no')
    expect(readFailed(join(dir, 'roto.json'))).toBeNull()
  })
  it('A1-P2-9 · la misma versión vuelta a subir corregida (otra huella) se intenta sola; la misma huella, no', () => {
    const bad = fingerprintOf({ files: [{ url: 'Aula-2.0.1-mac.zip', sha512: 'B' }, { url: 'Aula-2.0.1-mac.dmg', sha512: 'A' }] })
    expect(bad).toBe('A,B')
    recordFailure(file, '2.0.1', 'signature', bad)
    expect(blocksAutoRetry(readFailed(file), '2.0.1', bad)).toBe(true)
    expect(blocksAutoRetry(readFailed(file), '2.0.1', 'C,D')).toBe(false)
    // sin huella (lo apuntado por versiones viejas o por el vigilante sin ella): se bloquea por número, como antes
    expect(blocksAutoRetry(readFailed(file), '2.0.1')).toBe(true)
    // dañada: los intentos se cuentan por huella
    recordFailure(file, '2.0.2', 'corrupt', 'X')
    recordFailure(file, '2.0.2', 'corrupt', 'Y')
    expect(readFailed(file)?.attempts).toBe(1)
    expect(fingerprintOf({ sha512: 'Z' })).toBe('Z')
    expect(fingerprintOf({})).toBeUndefined()
  })
  it('cada fallo apuntado se explica con su código', () => {
    expect(errorOfFailure('signature')).toBe('signature')
    expect(errorOfFailure('start')).toBe('install')
    expect(errorOfFailure('system')).toBe('system')
    expect(errorOfFailure('raro')).toBe('install')
  })
})
