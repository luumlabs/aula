import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LockTimeoutError, lockIsBusy, withFileLock } from './lock'

const err = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

describe('cerrojo entre procesos', () => {
  it('«ya existe» es «lo tiene otro» en cualquier sistema', () => {
    expect(lockIsBusy(err('EEXIST'), 'darwin')).toBe(true)
    expect(lockIsBusy(err('EEXIST'), 'win32')).toBe(true)
  })

  it('en Windows, una carpeta que otro proceso está borrando también cuenta como ocupada', () => {
    for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
      expect(lockIsBusy(err(code), 'win32'), code).toBe(true)
      expect(lockIsBusy(err(code), 'linux'), code).toBe(false)
    }
  })

  it('otro fallo (sin espacio, ruta mala) no se toma por ocupado', () => {
    expect(lockIsBusy(err('ENOSPC'), 'win32')).toBe(false)
    expect(lockIsBusy(err('ENOENT'), 'win32')).toBe(false)
    expect(lockIsBusy(undefined, 'win32')).toBe(false)
  })

  it('es reentrante, se suelta al acabar y avisa si otro lo tiene demasiado', () => {
    const lock = join(mkdtempSync(join(tmpdir(), 'aula-lock-')), '.aula-lock')
    expect(withFileLock(lock, () => withFileLock(lock, () => 7))).toBe(7)
    expect(withFileLock(lock, () => 8)).toBe(8)
    // tomado por «otro» proceso vivo (este mismo pid, pero sin pasar por withFileLock)
    withFileLock(lock, () => {
      const other = join(lock, '..', 'otro', '.aula-lock')
      expect(withFileLock(other, () => 1)).toBe(1)
    })
    expect(LockTimeoutError.name).toBe('LockTimeoutError')
  })
})
