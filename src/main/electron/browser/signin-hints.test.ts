import { afterEach, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import {
  blockedAddressKind, blockedHint, blockedHintRelevant, blockedPageURL, devicePolicyHint, externalAppHint, externalSchemeOf, hopForLog, hopKeyForLog, loopHint,
  passkeyHint, passkeyHintDue, stepHint
} from './signin-hints'

afterEach(() => setAILocale('es'))

describe('avisos de la ventana de acceso', () => {
  it('llaves de acceso: sin interfaz de passkeys (macOS, Linux) al pedirse; en Windows solo si falló', () => {
    expect(passkeyHintDue('asked', true)).toBe(true)
    expect(passkeyHintDue('failed', true)).toBe(true)
    expect(passkeyHintDue('asked', false)).toBe(false)
    expect(passkeyHintDue('failed', false)).toBe(true)
    expect(passkeyHintDue('', true)).toBe(false)
    expect(passkeyHintDue(undefined, false)).toBe(false)
  })

  it('textos en español e inglés, con un tipo sin espacios', () => {
    setAILocale('es')
    expect(passkeyHint().title).toContain('Otras formas de iniciar sesión')
    expect(stepHint().title).toContain('la ventana se cerrará sola')
    expect(loopHint().title).toContain('Safari o Chrome')
    setAILocale('en')
    expect(passkeyHint().title).toContain('Other ways to sign in')
    expect(stepHint().title).toContain('close by itself')
    for (const h of [passkeyHint(), stepHint(), loopHint(), devicePolicyHint('AADSTS53003'), externalAppHint('msauth'), blockedHint('login.microsoftonline.com', 'fakeIP', 'x')]) {
      expect(h.kind).toMatch(/^\S+$/)
    }
  })

  it('política de dispositivo: nombra el código solo si es un código de Entra', () => {
    expect(devicePolicyHint('aadsts53003').title).toContain('(AADSTS53003)')
    expect(devicePolicyHint('<b>').title).not.toContain('<b>')
  })

  it('otra aplicación: solo el esquema, y nunca para la web, correo o teléfono', () => {
    expect(externalSchemeOf('msauth://login?code=secreto')).toBe('msauth')
    expect(externalSchemeOf('ms-outlook:compose')).toBe('ms-outlook')
    expect(externalSchemeOf('companyportal://x')).toBe('companyportal')
    for (const u of ['https://x.edu', 'http://x', 'about:blank', 'javascript:void(0)', 'data:text/html,x', 'mailto:a@b.c', 'tel:123', 'file:///etc/passwd', 'blob:x', '']) {
      expect(externalSchemeOf(u)).toBeNull()
    }
    expect(externalAppHint('msauth').title).toContain('(msauth)')
  })
})

describe('direcciones cortadas por la guarda', () => {
  it('reconoce el motivo probable por las direcciones', () => {
    expect(blockedAddressKind('login.microsoftonline.com', ['198.18.0.7'])).toBe('fakeIP')
    expect(blockedAddressKind('login.microsoftonline.com', ['198.19.255.1'])).toBe('fakeIP')
    expect(blockedAddressKind('adfs.uni.edu', ['10.1.2.3'])).toBe('private')
    expect(blockedAddressKind('adfs.uni.edu', ['172.20.0.1'])).toBe('private')
    expect(blockedAddressKind('adfs.uni.edu', ['192.168.1.10', '20.190.1.1'])).toBe('private')
    expect(blockedAddressKind('adfs.uni.edu', ['fd00::1'])).toBe('private')
    expect(blockedAddressKind('vpn.uni.edu', ['100.100.1.1'])).toBe('cgnat')
    expect(blockedAddressKind('tracker.com', ['0.0.0.0'])).toBe('loopback')
    expect(blockedAddressKind('tracker.com', ['::'])).toBe('loopback')
    expect(blockedAddressKind('tracker.com', ['::ffff:127.0.0.1'])).toBe('loopback')
    expect(blockedAddressKind('moodle.lan', [])).toBe('localName')
    expect(blockedAddressKind('router', [])).toBe('localName')
    expect(blockedAddressKind('10.0.0.5', [])).toBe('private')
    expect(blockedAddressKind('x.edu', [])).toBe('other')
    // el fake-IP gana aunque alguna dirección sea de otro tipo
    expect(blockedAddressKind('a.com', ['10.0.0.1', '198.18.3.4'])).toBe('fakeIP')
  })

  it('la página entera siempre merece aviso; de los recursos, solo los del acceso y los de la plataforma', () => {
    const platformHosts = ['moodle.uni.edu']
    expect(blockedHintRelevant({ host: 'www.googletagmanager.com', mainFrame: true, kind: 'loopback', platformHosts })).toBe(true)
    expect(blockedHintRelevant({ host: 'www.googletagmanager.com', mainFrame: false, kind: 'loopback', platformHosts })).toBe(false)
    expect(blockedHintRelevant({ host: 'analytics.example.net', mainFrame: false, kind: 'fakeIP', platformHosts })).toBe(false)
    expect(blockedHintRelevant({ host: 'aadcdn.msftauth.net', mainFrame: false, kind: 'fakeIP', platformHosts })).toBe(true)
    expect(blockedHintRelevant({ host: 'logincdn.msauth.net', mainFrame: false, kind: 'fakeIP', platformHosts })).toBe(true)
    expect(blockedHintRelevant({ host: 'login.microsoftonline.com', mainFrame: false, kind: 'fakeIP', platformHosts })).toBe(true)
    expect(blockedHintRelevant({ host: 'cdn.uni.edu', mainFrame: false, kind: 'private', platformHosts })).toBe(true)
    expect(blockedHintRelevant({ host: 'stats.uni.edu', mainFrame: false, kind: 'loopback', platformHosts })).toBe(false)
  })

  it('el aviso nombra el host y el consejo según el motivo', () => {
    setAILocale('es')
    const fake = blockedHint('login.microsoftonline.com', 'fakeIP', 'x')
    expect(fake.kind).toBe('blocked:login.microsoftonline.com')
    expect(fake.title).toContain('login.microsoftonline.com')
    expect(fake.detail).toContain('fake-IP')
    expect(fake.detail).toContain('*.msftauth.net')
    expect(blockedHint('adfs.uni.edu', 'private', 'x').detail).toContain('DNS del campus')
    expect(blockedHint('t.com', 'loopback', 'x').detail).toContain('bloqueador')
    expect(blockedHint('h.edu', 'other', '«h.edu» apunta a una dirección local o privada').detail).toContain('«h.edu»')
    setAILocale('en')
    expect(blockedHint('login.microsoftonline.com', 'fakeIP', 'x').detail).toContain('Turn it off')
  })

  it('la página local escapa lo que muestra y no lleva guiones', () => {
    const url = blockedPageURL({ kind: 'blocked:x', title: 'A <script>alert(1)</script>', detail: '"b" & c' }, 'es')
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    const html = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length))
    expect(html).not.toContain('<script')
    expect(html).toContain('&#60;script&#62;')
    expect(html).toContain('&#34;b&#34; &#38; c')
    expect(html).toContain('lang="es"')
  })
})

describe('registro de saltos', () => {
  it('host y ruta, nunca la consulta', () => {
    expect(hopForLog('https://Login.MicrosoftOnline.com/tenant/oauth2/authorize?client_id=x&state=secreto#f')).toEqual({ host: 'login.microsoftonline.com', path: '/tenant/oauth2/authorize' })
    expect(hopForLog('data:text/html,x')).toBeNull()
    expect(hopForLog('nada')).toBeNull()
    expect(hopForLog('https://x.edu/' + 'a/'.repeat(100))?.path.length).toBeLessThanOrEqual(121)
  })

  it('sin identificadores de sesión ni claves en la ruta', () => {
    expect(hopForLog('https://idp.uni.edu/idp/profile/SAML2/Redirect/SSO;jsessionid=ABC123?x=1')?.path).toBe('/idp/profile/SAML2/Redirect/SSO')
    expect(hopForLog('https://login.microsoftonline.com/0b7a1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d/oauth2/authorize')?.path).toBe('/…/oauth2/authorize')
    expect(hopForLog('https://x.edu/reset/' + 'k'.repeat(40) + '/done')?.path).toBe('/reset/…/done')
    expect(hopKeyForLog('login.microsoftonline.com/0b7a1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d/oauth2/authorize')).toBe('login.microsoftonline.com/…/oauth2/authorize')
    expect(hopKeyForLog('moodle.uni.edu')).toBe('moodle.uni.edu')
  })
})
