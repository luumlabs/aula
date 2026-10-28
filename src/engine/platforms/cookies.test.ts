import { describe, expect, it } from 'vitest'
import {
  cookieKey, describeSnapshot, makeSnapshot, parseSnapshot, planRestore, restoreExpiration, selectCookiesToSave, serializeSnapshot, toCookieSetDetails,
  type CookieLike, type SavedCookie
} from './cookies'

const NOW_MS = Date.UTC(2026, 9, 26, 12, 0, 0)
const NOW = Math.floor(NOW_MS / 1000)
const DAY = 86_400

const c = (o: Partial<CookieLike> & { name: string }): CookieLike => ({ value: 'v', domain: 'campus.uni.edu', path: '/', hostOnly: true, secure: true, httpOnly: true, sameSite: 'lax', ...o })
const saved = (o: Partial<SavedCookie> & { name: string }): SavedCookie => ({
  value: 'v', domain: 'campus.uni.edu', hostOnly: true, path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true, ...o
})

describe('qué cookies se guardan', () => {
  it('guarda las de sesión (sin caducidad) y las vigentes; tira las caducadas', () => {
    const out = selectCookiesToSave([
      c({ name: 'MoodleSession', session: true }),
      c({ name: 'persist', session: false, expirationDate: NOW + 3600 }),
      c({ name: 'old', session: false, expirationDate: NOW - 10 })
    ], NOW)
    expect(out.map((x) => [x.name, x.session])).toEqual([['MoodleSession', true], ['persist', false]])
    expect(out[1].expirationDate).toBe(NOW + 3600)
    expect(out[0].expirationDate).toBeUndefined()
  })

  it('una sin expirationDate cuenta como de sesión aunque no lo diga', () => {
    expect(selectCookiesToSave([c({ name: 'x', session: undefined, expirationDate: undefined })], NOW)[0].session).toBe(true)
  })

  it('normaliza el dominio (sin punto) y conserva host-only, secure, httpOnly y sameSite', () => {
    const [a, b] = selectCookiesToSave([
      c({ name: 'dom', domain: '.Uni.EDU', hostOnly: false, secure: false, httpOnly: false, sameSite: 'no_restriction', session: true }),
      c({ name: 'host', domain: 'campus.uni.edu', hostOnly: true, sameSite: undefined, path: '' , session: true })
    ], NOW)
    expect(a).toMatchObject({ domain: 'uni.edu', hostOnly: false, secure: false, httpOnly: false, sameSite: 'no_restriction' })
    expect(b).toMatchObject({ hostOnly: true, sameSite: 'unspecified', path: '/' })
  })

  it('quita duplicados, valores enormes y dominios vacíos', () => {
    const out = selectCookiesToSave([
      c({ name: 'a', session: true }), c({ name: 'a', session: true }), c({ name: 'big', value: 'x'.repeat(10_000), session: true }), c({ name: 'nodomain', domain: '', session: true })
    ], NOW)
    expect(out.map((x) => x.name)).toEqual(['a'])
  })

  it('con tope, primero las de la plataforma y del SSO', () => {
    const many = [
      c({ name: 'ad1', domain: 'ads.example.com', session: true }), c({ name: 'ad2', domain: 'ads.example.com', session: true }),
      c({ name: 'sso', domain: 'login.microsoftonline.com', session: true }), c({ name: 'lms', domain: 'campus.uni.edu', session: true })
    ]
    const out = selectCookiesToSave(many, NOW, { maxCookies: 2, priorityHosts: ['campus.uni.edu', 'login.microsoftonline.com'] })
    expect(out.map((x) => x.name).sort()).toEqual(['lms', 'sso'])
  })

  it('una cookie de sesión que Aula repuso con caducidad sigue siendo «de sesión» mientras no cambie', () => {
    const prev = makeSnapshot([c({ name: 'S', value: 'abc', session: true })], NOW_MS - 1000)
    const restored = c({ name: 'S', value: 'abc', session: false, expirationDate: NOW + 30 * DAY })
    expect(selectCookiesToSave([restored], NOW, {}, prev)[0].session).toBe(true)
    // si el servidor la cambió, ya es la suya
    expect(selectCookiesToSave([{ ...restored, value: 'new' }], NOW, {}, prev)[0].session).toBe(false)
  })
})

describe('caducidad al reponer', () => {
  it('de sesión → ahora + días configurados', () => {
    expect(restoreExpiration(saved({ name: 's' }), NOW)).toBe(NOW + 30 * DAY)
    expect(restoreExpiration(saved({ name: 's' }), NOW, { sessionCookieDays: 7 })).toBe(NOW + 7 * DAY)
    expect(restoreExpiration(saved({ name: 's' }), NOW, { sessionCookieDays: 1000 })).toBe(NOW + 400 * DAY)
  })

  it('la del servidor se respeta (nunca se alarga) con tope de 400 días', () => {
    expect(restoreExpiration(saved({ name: 'p', session: false, expirationDate: NOW + 5 * DAY }), NOW)).toBe(NOW + 5 * DAY)
    expect(restoreExpiration(saved({ name: 'p', session: false, expirationDate: NOW + 900 * DAY }), NOW)).toBe(NOW + 400 * DAY)
    expect(restoreExpiration(saved({ name: 'p', session: false, expirationDate: NOW - 1 }), NOW)).toBeNull()
  })
})

describe('detalles para session.cookies.set', () => {
  it('host-only: sin `domain` (Chromium la crea solo para ese host)', () => {
    const d = toCookieSetDetails(saved({ name: 'MoodleSession', value: 'abc', path: '/moodle' }), NOW)!
    expect(d).toEqual({
      url: 'https://campus.uni.edu/moodle', name: 'MoodleSession', value: 'abc', path: '/moodle', secure: true, httpOnly: true,
      expirationDate: NOW + 30 * DAY, sameSite: 'lax'
    })
    expect('domain' in d).toBe(false)
  })

  it('de dominio: `domain` con punto (vale para los subdominios)', () => {
    const d = toCookieSetDetails(saved({ name: 'ESTSAUTH', domain: 'login.microsoftonline.com', hostOnly: false, sameSite: 'no_restriction' }), NOW)!
    expect(d.domain).toBe('.login.microsoftonline.com')
    expect(d.sameSite).toBe('no_restriction')
  })

  it('prefijos __Host- y __Secure- exigen secure (y __Host- ruta / y host-only)', () => {
    const h = toCookieSetDetails(saved({ name: '__Host-sid', secure: false, hostOnly: false, path: '/x' }), NOW)!
    expect(h).toMatchObject({ secure: true, path: '/', url: 'https://campus.uni.edu/' })
    expect('domain' in h).toBe(false)
    expect(toCookieSetDetails(saved({ name: '__Secure-x', secure: false }), NOW)!.secure).toBe(true)
  })

  it('SameSite=None sin Secure se deja sin especificar; localhost por http', () => {
    const d = toCookieSetDetails(saved({ name: 'a', secure: false, sameSite: 'no_restriction', domain: 'localhost' }), NOW)!
    expect(d.sameSite).toBe('unspecified')
    expect(d.url).toBe('http://localhost/')
    expect(toCookieSetDetails(saved({ name: 'b', secure: false }), NOW)!.url).toBe('https://campus.uni.edu/')
  })

  it('dominios raros o caducadas no se reponen', () => {
    expect(toCookieSetDetails(saved({ name: 'a', domain: 'bad domain' }), NOW)).toBeNull()
    expect(toCookieSetDetails(saved({ name: 'a', session: false, expirationDate: NOW - 5 }), NOW)).toBeNull()
  })
})

describe('plan de reposición al arrancar', () => {
  const snap = { v: 1 as const, savedAt: NOW_MS - 3600_000, cookies: [saved({ name: 'S', value: 'sess' }), saved({ name: 'P', value: 'p', session: false, expirationDate: NOW + DAY })] }

  it('repone solo las que faltan', () => {
    const plan = planRestore(snap, [c({ name: 'P', value: 'p', session: false, expirationDate: NOW + DAY })], NOW_MS)
    expect(plan.map((d) => d.name)).toEqual(['S'])
  })

  it('lo que ya hay en la sesión es más nuevo y no se pisa', () => {
    const plan = planRestore(snap, [c({ name: 'S', value: 'newer', session: true })], NOW_MS)
    expect(plan.map((d) => d.name)).toEqual(['P'])
  })

  it('renueva una de sesión repuesta a la que le queda menos de la mitad de su vida', () => {
    const present = [c({ name: 'S', value: 'sess', session: false, expirationDate: NOW + 5 * DAY }), c({ name: 'P', value: 'p', session: false, expirationDate: NOW + DAY })]
    const plan = planRestore(snap, present, NOW_MS)
    expect(plan.map((d) => [d.name, d.expirationDate])).toEqual([['S', NOW + 30 * DAY]])
    const fresh = [c({ name: 'S', value: 'sess', session: false, expirationDate: NOW + 25 * DAY }), present[1]]
    expect(planRestore(snap, fresh, NOW_MS)).toEqual([])
  })

  it('una copia demasiado vieja solo repone las que traían caducidad del servidor', () => {
    const old = { ...snap, savedAt: NOW_MS - 40 * DAY * 1000, cookies: [snap.cookies[0], saved({ name: 'P', value: 'p', session: false, expirationDate: NOW + 3 * DAY })] }
    expect(planRestore(old, [], NOW_MS).map((d) => d.name)).toEqual(['P'])
    expect(planRestore(null, [], NOW_MS)).toEqual([])
  })

  it('distingue host-only de dominio con el mismo nombre', () => {
    const s = { v: 1 as const, savedAt: NOW_MS, cookies: [saved({ name: 'X', hostOnly: true }), saved({ name: 'X', hostOnly: false })] }
    const plan = planRestore(s, [c({ name: 'X', hostOnly: true, session: true })], NOW_MS)
    expect(plan).toHaveLength(1)
    expect(plan[0].domain).toBe('.campus.uni.edu')
    expect(cookieKey({ name: 'X', domain: '.A.com', path: '', hostOnly: false })).toBe(cookieKey({ name: 'X', domain: 'a.com', path: '/', hostOnly: false }))
  })
})

describe('almacén', () => {
  it('ida y vuelta, y lectura tolerante', () => {
    const s = makeSnapshot([c({ name: 'A', session: true })], NOW_MS)
    expect(parseSnapshot(serializeSnapshot(s))).toEqual(s)
    expect(parseSnapshot('no json')).toBeNull()
    expect(parseSnapshot('{"v":2,"savedAt":1,"cookies":[]}')).toBeNull()
    const tolerant = parseSnapshot(JSON.stringify({ v: 1, savedAt: 5, cookies: [{ name: 'ok', value: 'v', domain: '.X.com', sameSite: 'rare', path: 'bad' }, { name: 1 }, null] }))
    expect(tolerant?.cookies).toEqual([{ name: 'ok', value: 'v', domain: 'x.com', hostOnly: false, path: '/', secure: false, httpOnly: false, sameSite: 'unspecified', session: false }])
  })

  it('el resumen nunca lleva valores', () => {
    const s = makeSnapshot([c({ name: 'A', value: 'SECRETVALUE', session: true }), c({ name: 'B', value: 'OTHER', domain: 'login.microsoftonline.com', session: false, expirationDate: NOW + 60 })], NOW_MS)
    const text = describeSnapshot(s)
    expect(text).toContain('2 cookies (1 de sesión)')
    expect(text).not.toContain('SECRETVALUE')
    expect(text).not.toContain('OTHER')
    expect(describeSnapshot(null)).toBe('sin copia')
  })
})
