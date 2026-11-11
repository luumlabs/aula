import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renameOver, writeFileAtomic } from './fs'

const busy = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: operation not permitted, rename`), { code })

describe('escritura atómica', () => {
  it('escribe el archivo entero y no deja temporales', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aula-fs-'))
    const file = join(dir, 'datos.json')
    writeFileAtomic(file, '{"a":1}\n')
    writeFileAtomic(file, '{"a":2}\n')
    expect(readFileSync(file, 'utf8')).toBe('{"a":2}\n')
  })

  it('en Windows reintenta el cambio de nombre si otro proceso tiene abierto el destino un instante', () => {
    let calls = 0
    const rename = (): void => {
      calls += 1
      if (calls < 3) throw busy(calls === 1 ? 'EPERM' : 'EBUSY')
    }
    renameOver('a.tmp', 'a', { rename, platform: 'win32' })
    expect(calls).toBe(3)
  })

  it('en Windows no espera para siempre: pasado el plazo, el fallo sale tal cual', () => {
    let calls = 0
    const rename = (): void => {
      calls += 1
      throw busy('EACCES')
    }
    expect(() => renameOver('a.tmp', 'a', { rename, platform: 'win32', maxWaitMs: 30 })).toThrow(/EACCES/)
    expect(calls).toBeGreaterThan(1)
  })

  it('un fallo que no es de «ocupado» no se reintenta, ni en Windows', () => {
    let calls = 0
    const rename = (): void => {
      calls += 1
      throw busy('ENOSPC')
    }
    expect(() => renameOver('a.tmp', 'a', { rename, platform: 'win32' })).toThrow(/ENOSPC/)
    expect(calls).toBe(1)
  })

  it('fuera de Windows no se reintenta', () => {
    let calls = 0
    const rename = (): void => {
      calls += 1
      throw busy('EPERM')
    }
    expect(() => renameOver('a.tmp', 'a', { rename, platform: 'darwin' })).toThrow(/EPERM/)
    expect(calls).toBe(1)
  })
})
