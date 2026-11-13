import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deviceRole, keySafeNote, settingsElsewhere, type DeviceRole } from './device'

const ROLES: DeviceRole[] = ['window', 'owner', 'macDevice', 'serverDevice']

describe('deviceRole', () => {
  it('la ventana no es un dispositivo, aunque el resto diga otra cosa', () => {
    expect(deviceRole({ remote: false, owner: false, server: false })).toBe('window')
    expect(deviceRole({ remote: false, owner: true, server: true })).toBe('window')
  })
  it('distingue el propietario de un servidor de los demás dispositivos', () => {
    expect(deviceRole({ remote: true, owner: true, server: true })).toBe('owner')
    expect(deviceRole({ remote: true, owner: false, server: true })).toBe('serverDevice')
    expect(deviceRole({ remote: true, owner: false, server: false })).toBe('macDevice')
  })
})

describe('settingsElsewhere', () => {
  it('la ventana y el propietario lo arreglan aquí; los demás, en el Mac o el propietario', () => {
    expect(settingsElsewhere('window')).toBeNull()
    expect(settingsElsewhere('owner')).toBeNull()
    expect(settingsElsewhere('macDevice')).toBe('mac')
    expect(settingsElsewhere('serverDevice')).toBe('owner')
  })
})

describe('keySafeNote', () => {
  it('sin saber cómo se protegen los secretos no promete nada', () => {
    for (const role of ROLES) expect(keySafeNote(role, undefined)).toBeNull()
  })
  it('en la ventana: cifrada en este ordenador, o sin cifrar si no hay llavero', () => {
    expect(keySafeNote('window', 'os')).toBe('keySafe')
    expect(keySafeNote('window', 'basic')).toBe('keySafeBasic')
  })
  it('el propietario guarda la clave en el servidor, que sin llavero la deja sin cifrar', () => {
    expect(keySafeNote('owner', 'basic')).toBe('keySafeServerBasic')
    expect(keySafeNote('owner', 'os')).toBe('keySafeServer')
  })
  it('los dispositivos que no guardan claves no llevan nota', () => {
    expect(keySafeNote('macDevice', 'os')).toBeNull()
    expect(keySafeNote('serverDevice', 'basic')).toBeNull()
  })
  it('cada nota existe en es y en', () => {
    for (const lang of ['es', 'en']) {
      const ai = (JSON.parse(readFileSync(join(__dirname, '../i18n/locales', lang, 'settings.json'), 'utf8')) as { ai: Record<string, unknown> }).ai
      for (const role of ROLES) {
        for (const p of ['os', 'basic'] as const) {
          const note = keySafeNote(role, p)
          if (note) expect(typeof ai[note], `${lang}: ai.${note}`).toBe('string')
        }
      }
    }
  })
})
