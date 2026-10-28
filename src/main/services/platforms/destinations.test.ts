// J3-3: el navegador de Aula no llega a este equipo ni a la red local (tampoco por un nombre que resuelve a una IP privada).
import { describe, expect, it } from 'vitest'
import { accountIsOnLocalNetwork, createDestinationGuard, privateAllowedFor } from './destinations'

const dns: Record<string, string[]> = {
  'school.instructure.com': ['52.10.1.1'],
  'evil.example': ['93.184.216.34'],
  'rebind.example': ['93.184.216.34', '10.0.0.5'],
  'metadata.example': ['169.254.169.254'],
  'v6local.example': ['fd00::1'],
  'moodle.campus.edu': ['192.168.10.20']
}
const resolver = async (h: string): Promise<string[]> => dns[h] ?? []

describe('createDestinationGuard', () => {
  it('bloquea las direcciones del informe de J3 y las de la red local', async () => {
    const g = createDestinationGuard({ resolver })
    for (const u of [
      'http://192.168.1.1/admin', 'http://127.0.0.1:11434/api/tags', 'http://169.254.169.254/latest/meta-data/',
      'http://10.1.2.3/', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://[::1]:8080/', 'http://[fc00::1]/', 'http://[fe80::1]/',
      'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://0x7f.1/', 'http://localhost:3000/', 'http://printer.local/',
      'http://router/', 'https://rebind.example/', 'https://metadata.example/', 'https://v6local.example/', 'wss://127.0.0.1/ws'
    ]) {
      expect(await g.check(u, false), u).not.toBeNull()
    }
  })
  it('deja las públicas y lo que no sale del equipo (data:, blob:)', async () => {
    const g = createDestinationGuard({ resolver })
    for (const u of ['https://school.instructure.com/courses/1', 'https://evil.example/collect', 'https://8.8.8.8/', 'data:text/plain,hola', 'blob:app://aula/x']) {
      expect(await g.check(u, false), u).toBeNull()
    }
  })
  it('con permiso de red local (plataforma de la intranet), sí', async () => {
    const g = createDestinationGuard({ resolver })
    expect(await g.check('http://192.168.1.1/', true)).toBeNull()
  })
  it('recuerda el veredicto un rato y luego vuelve a resolver', async () => {
    let now = 0
    let calls = 0
    const g = createDestinationGuard({ resolver: async (h) => { calls++; return resolver(h) }, ttlMs: 1000, now: () => now })
    await g.check('https://evil.example/a', false)
    await g.check('https://evil.example/b', false)
    expect(calls).toBe(1)
    now = 2000
    await g.check('https://evil.example/c', false)
    expect(calls).toBe(2)
  })
})

describe('accountIsOnLocalNetwork', () => {
  it('una plataforma de la intranet sí; una en la nube, no', async () => {
    expect(await accountIsOnLocalNetwork('https://moodle.campus.edu', resolver)).toBe(true)
    expect(await accountIsOnLocalNetwork('http://canvas.localhost:5555', resolver)).toBe(true)
    expect(await accountIsOnLocalNetwork('https://school.instructure.com', resolver)).toBe(false)
  })
})

describe('A2-P2-10 · una plataforma de la intranet solo abre sus propios servidores', () => {
  it('su nombre y los de su sitio (su CAS, su SSO), sí; el router, este equipo u otros de la red local, no', () => {
    const base = 'https://moodle.uni.local/'
    expect(privateAllowedFor(base, 'https://moodle.uni.local/course/view.php?id=3')).toBe(true)
    expect(privateAllowedFor(base, 'https://cas.uni.local/login')).toBe(true)
    expect(privateAllowedFor(base, 'http://192.168.1.1/admin')).toBe(false)
    expect(privateAllowedFor(base, 'http://127.0.0.1:11434/api/tags')).toBe(false)
    expect(privateAllowedFor(base, 'http://router.lan/')).toBe(false)
    expect(privateAllowedFor(base, 'http://169.254.169.254/latest/meta-data/')).toBe(false)
    // una plataforma en una IP: solo esa IP
    expect(privateAllowedFor('http://10.0.0.5/moodle', 'http://10.0.0.5/moodle/login')).toBe(true)
    expect(privateAllowedFor('http://10.0.0.5/moodle', 'http://10.0.0.1/')).toBe(false)
    // un nombre de una sola palabra: solo ese
    expect(privateAllowedFor('http://moodle/', 'http://moodle/x')).toBe(true)
    expect(privateAllowedFor('http://moodle/', 'http://nas/')).toBe(false)
    // pruebas y desarrollo: la plataforma falsa y su SSO en *.localhost
    expect(privateAllowedFor('http://canvas.localhost:5555/', 'http://sso.localhost:5556/saml')).toBe(true)
  })
})
