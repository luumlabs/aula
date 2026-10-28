// J3-15: la carpeta de datos es solo del usuario (0700), también si ya existía más abierta.
import { describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setDataRoot } from './paths'

describe.skipIf(process.platform === 'win32')('setDataRoot', () => {
  it('crea la carpeta con 0700', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'aula-paths-')), 'Aula')
    setDataRoot(p)
    expect(statSync(p).mode & 0o777).toBe(0o700)
  })
  it('cierra una carpeta que ya existía abierta (0755)', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'aula-paths-')), 'Aula')
    mkdirSync(p)
    chmodSync(p, 0o755)
    setDataRoot(p)
    expect(statSync(p).mode & 0o777).toBe(0o700)
  })
})
