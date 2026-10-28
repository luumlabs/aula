// Solo se leen los archivos que el estudiante soltó o eligió (y nunca lo interno de Aula ni del sistema).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { forbiddenUserPath, UserFileGrants } from './userFiles'

let base: string
let root: string
let grants: UserFileGrants
const put = (p: string, text = 'x'): string => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text); return p }

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'aula-userfiles-'))
  root = join(base, 'Aula')
  mkdirSync(root)
  grants = new UserFileGrants({ root: () => root })
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('archivos que dio el estudiante', () => {
  it('solo se aceptan las rutas apuntadas (soltadas o elegidas)', () => {
    const apuntes = put(join(base, 'Escritorio', 'apuntes.pdf'))
    const otro = put(join(base, 'Escritorio', 'otro.pdf'))
    expect(grants.grant(apuntes)).toBe(true)
    expect(grants.check([apuntes])).toEqual([apuntes])
    expect(() => grants.check([apuntes, otro])).toThrow(expect.objectContaining({ code: 'file_not_allowed', message: expect.stringContaining('otro.pdf') }))
    expect(grants.allows(join(base, 'Escritorio', '..', 'Escritorio', 'apuntes.pdf'))).toBe(true)
  })

  it('nunca lo interno de la carpeta de datos (sí los materiales de Packs/ y Documents/)', () => {
    for (const p of ['secrets.enc', 'settings.json', 'Browser Data/Cookies', 'tools/codex/home/auth.json', 'Local State', 'Logs/main.log']) {
      expect(grants.grant(put(join(root, p))), p).toBe(false)
    }
    expect(grants.grant(put(join(root, 'Packs', 'curso', 'sources', 's1', 'tema1.pdf')))).toBe(true)
    expect(grants.grant(put(join(root, 'Documents', 'sources', 'd1', 'libro.pdf')))).toBe(true)
    expect(grants.grant(put(join(root, 'Packs', 'curso', 'secrets.json')))).toBe(false)
  })

  it('ni por un enlace simbólico que apunta dentro', () => {
    const secret = put(join(root, 'Browser Data', 'Cookies'))
    const link = join(base, 'Escritorio', 'inocente.pdf')
    mkdirSync(join(base, 'Escritorio'), { recursive: true })
    symlinkSync(secret, link)
    expect(grants.grant(link)).toBe(false)
    expect(forbiddenUserPath(link, root)).toMatch(/internas/)
  })

  it('ni rutas relativas, inexistentes, raras o del sistema', () => {
    expect(grants.grant('apuntes.pdf')).toBe(false)
    expect(grants.grant(join(base, 'no-existe.pdf'))).toBe(false)
    expect(grants.grant(42)).toBe(false)
    expect(grants.grant(`${base}/a\0b`)).toBe(false)
    if (process.platform !== 'win32') {
      expect(grants.grant('/etc/passwd')).toBe(false)
      expect(forbiddenUserPath('/etc/hosts', root)).toMatch(/sistema/)
    }
  })

  it('si después cambia (el archivo pasa a ser un enlace a algo prohibido), ya no vale', () => {
    const p = put(join(base, 'Escritorio', 'a.pdf'))
    expect(grants.grant(p)).toBe(true)
    rmSync(p)
    symlinkSync(put(join(root, 'secrets.enc')), p)
    expect(grants.allows(p)).toBe(false)
  })

  it('recuerda un número limitado (las más antiguas se olvidan)', () => {
    const small = new UserFileGrants({ root: () => root, max: 2 })
    const [a, b, c] = ['a', 'b', 'c'].map((n) => put(join(base, `${n}.txt`)))
    for (const p of [a, b, c]) small.grant(p)
    expect(small.allows(a)).toBe(false)
    expect(small.allows(b) && small.allows(c)).toBe(true)
  })
})
