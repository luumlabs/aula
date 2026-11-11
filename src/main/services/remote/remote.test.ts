// Acceso desde los dispositivos del estudiante: emparejar con un código, qué se puede pedir a distancia y los archivos
// que sube un dispositivo.
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { DeviceRegistry, MAX_ATTEMPTS, PAIRING_MINUTES, PairingError, TOKEN_DAYS } from './devices'
import { noopValue, remoteAIChoice, remoteCall, remoteForget, remoteSettingsPatch, remoteVerdict, rewriteAssets } from './policy'
import { safeUploadName, UploadError, UploadStore } from './uploads'
import { pairingPage, REMOTE_BRIDGE_JS, REMOTE_MANIFEST } from './bridge'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'aula-remote-'))
const code = (fn: () => unknown): string => { try { fn() } catch (e) { return e instanceof PairingError || e instanceof UploadError ? e.code : String(e) } return 'ok' }

describe('emparejar un dispositivo', () => {
  it('con el código queda vinculado y su ficha vale; en disco solo queda la huella', () => {
    const file = join(tmp(), 'devices.json')
    const reg = new DeviceRegistry(file)
    const { code: c } = reg.startPairing()
    expect(c).toMatch(/^\d{6}$/)
    const { token, device } = reg.completePairing(c, '  iPad de Ana\u0007 ', 'ipad')
    expect(device).toMatchObject({ name: 'iPad de Ana', platform: 'ipad' })
    expect(reg.authenticate(token)?.id).toBe(device.id)
    expect(readFileSync(file, 'utf8')).not.toContain(token)
    // otra instancia (Aula se reinicia) reconoce al dispositivo
    expect(new DeviceRegistry(file).authenticate(token)?.id).toBe(device.id)
    // el código es de un solo uso
    expect(code(() => reg.completePairing(c, 'otro', 'web'))).toBe('noCode')
  })
  it('acepta el código con espacios o un punto en medio, y una plataforma rara pasa a «web»', () => {
    const reg = new DeviceRegistry(join(tmp(), 'd.json'))
    const { code: c } = reg.startPairing()
    expect(reg.completePairing(`${c.slice(0, 3)} · ${c.slice(3)}`, '', 'nevera').device).toMatchObject({ name: 'Dispositivo', platform: 'web' })
  })
  it('sin código, con uno equivocado, caducado o tras demasiados intentos, no entra', () => {
    let now = Date.parse('2026-11-10T10:00:00Z')
    const reg = new DeviceRegistry(join(tmp(), 'd.json'), () => now)
    expect(code(() => reg.completePairing('123456', 'x', 'web'))).toBe('noCode')
    const first = reg.startPairing().code
    const wrong = first === '000000' ? '111111' : '000000'
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect(code(() => reg.completePairing(wrong, 'x', 'web'))).toBe('wrong')
    expect(code(() => reg.completePairing(wrong, 'x', 'web'))).toBe('tooMany')
    // tras anularse, ni el bueno vale
    expect(code(() => reg.completePairing(first, 'x', 'web'))).toBe('noCode')
    const second = reg.startPairing().code
    expect(reg.pairingOpen()).toBe(true)
    now += PAIRING_MINUTES * 60_000 + 1
    expect(reg.pairingOpen()).toBe(false)
    expect(code(() => reg.completePairing(second, 'x', 'web'))).toBe('expired')
    expect(reg.list()).toEqual([])
  })
  it('una ficha inventada no vale; la de un dispositivo retirado o sin usar 90 días, tampoco', () => {
    let now = Date.parse('2026-11-10T10:00:00Z')
    const reg = new DeviceRegistry(join(tmp(), 'd.json'), () => now)
    const a = reg.completePairing(reg.startPairing().code, 'iPhone', 'iphone')
    const b = reg.completePairing(reg.startPairing().code, 'iPad', 'ipad')
    expect(reg.authenticate('x'.repeat(43))).toBeUndefined()
    expect(reg.authenticate(undefined)).toBeUndefined()
    expect(reg.revoke(a.device.id)).toBe(true)
    expect(reg.authenticate(a.token)).toBeUndefined()
    expect(reg.authenticate(b.token)?.name).toBe('iPad')
    now += TOKEN_DAYS * 86_400_000 + 3_600_000 + 1
    expect(reg.authenticate(b.token)).toBeUndefined()
    expect(reg.list()).toEqual([])
  })
})

describe('qué puede pedir un dispositivo', () => {
  it('estudiar, hablar con Aula, el calendario y las novedades: sí', () => {
    for (const m of ['courses.list', 'study.record', 'chat.send', 'calendar.snapshot', 'automations.inbox', 'automations.setProactive', 'create.addFiles', 'create.start', 'generation.run', 'documents.open', 'settings.get'])
      expect(remoteVerdict(m), m).toBe('allow')
  })
  it('lo de Ajustes que se usa a diario: ver las IA listas y sus modelos, y añadir, corregir o pausar la memoria', () => {
    for (const m of ['ai.status', 'ai.choices', 'ai.models', 'memory.list', 'memory.status', 'memory.add', 'memory.edit', 'memory.pause', 'app.info', 'automations.snapshot'])
      expect(remoteVerdict(m), m).toBe('allow')
  })
  it('claves, ajustes, diálogos del Mac, exportar o borrar todo, actualizaciones y el propio acceso remoto: no', () => {
    for (const m of ['ai.setKey', 'ai.removeKey', 'ai.configure', 'ai.providers', 'ai.test', 'ai.chatStream', 'secrets.get', 'settings.update', 'settings.reset', 'data.exportAll', 'data.deleteAll',
      'app.openDataFolder', 'app.showItemInFolder', 'app.openLicenses', 'app.openExternal', 'updates.install', 'updates.check', 'platforms.connect', 'platforms.add', 'platforms.remove', 'platforms.signOut',
      'remote.status', 'remote.startPairing', 'remote.setEnabled', 'remote.revoke', 'courses.import', 'courses.delete', 'agents.install', 'agents.detect', 'agents.codexLogin', 'agents.codexLogout',
      'local.catalog', 'local.download', 'local.delete', 'local.start', 'memory.clear', 'memory.export', 'memory.restore', 'memory.forget', 'ai.choose', 'sinpunto', '.x', ''])
      expect(remoteVerdict(m), m).toBe('deny')
  })
  it('lo que solo tiene sentido en la ventana del Mac no hace nada', () => {
    expect(remoteVerdict('app.setTheme')).toBe('noop')
    expect(noopValue('app.setTheme')).toBeNull()
    expect(noopValue('secrets.status')).toEqual({ state: 'ok' })
  })
  it('el interruptor de «Aula siempre activa» pasa como siempre', () => {
    expect(remoteSettingsPatch({ persistent: { enabled: false } })).toEqual({ persistent: { enabled: false } })
    expect(remoteSettingsPatch({ persistent: { enabled: true } })).toEqual({ persistent: { enabled: true } })
    expect(remoteSettingsPatch({ persistent: { enabled: 'sí' } })).toBeNull()
  })
  it('de los ajustes pasa lo de uso diario, campo a campo', () => {
    const ok: [string, string, unknown[]][] = [
      ['general', 'theme', ['system', 'light', 'dark']],
      ['general', 'textScale', [0.85, 1, 1.15, 1.3]],
      ['general', 'motion', ['system', 'full', 'reduced']],
      ['general', 'name', ['', 'Ana', 'x'.repeat(80)]],
      ['general', 'language', ['system', 'es', 'en']],
      ['general', 'reminders', [true, false]],
      ['general', 'reminderTime', ['00:00', '18:30', '23:59']],
      ['persistent', 'enabled', [true, false]],
      ['persistent', 'quietHours', [null, { from: '22:00', to: '08:00' }]]
    ]
    for (const [section, field, values] of ok)
      for (const v of values) expect(remoteSettingsPatch({ [section]: { [field]: v } }), `${section}.${field} = ${JSON.stringify(v)}`).toEqual({ [section]: { [field]: v } })
    // varios campos y las dos secciones a la vez
    const both = { general: { theme: 'dark', language: 'en', name: 'Ana' }, persistent: { enabled: true, quietHours: { from: '23:00', to: '07:00' } } }
    expect(remoteSettingsPatch(both)).toEqual(both)
  })
  it('cada campo, con su tipo y su rango', () => {
    const bad: [string, string, unknown[]][] = [
      ['general', 'theme', ['sepia', '', 1, null, ['dark']]],
      ['general', 'textScale', [0.84, 1.31, 1.4, 5, -1, '1', null, NaN]],
      ['general', 'motion', ['none', true]],
      ['general', 'name', ['x'.repeat(81), 7, null, { toString: 'x' }]],
      ['general', 'language', ['fr', 'EN', 3]],
      ['general', 'reminders', ['true', 1, null]],
      ['general', 'reminderTime', ['24:00', '9:00', '18:60', '18:00:00', 1800, null]],
      ['persistent', 'enabled', ['sí', 1, null]],
      ['persistent', 'quietHours', ['22:00', { from: '22:00' }, { from: '22:00', to: '25:00' }, { from: '22:00', to: '08:00', days: [1] }, ['22:00', '08:00'], 0]]
    ]
    for (const [section, field, values] of bad)
      for (const v of values) expect(remoteSettingsPatch({ [section]: { [field]: v } }), `${section}.${field} = ${JSON.stringify(v)}`).toBeNull()
  })
  it('lo del Mac no pasa: la IA y sus claves, las plataformas, los datos, abrir al iniciar sesión, el cursor…', () => {
    const closed: unknown[] = [
      { ai: { activeProvider: 'openai' } },
      { ai: { providers: [{ id: 'custom', kind: 'openai-compatible', label: 'x', baseURL: 'https://malo.example/v1', secretRef: 'ai.key.openai' }] } },
      { ai: { dailyBudgetUSD: 0 } },
      { ai: { maxParallel: 8 } },
      { data: { memory: false } },
      { data: { webSearch: false } },
      { data: { autoUpdate: false } },
      { platforms: { keepSignedIn: false } },
      { platforms: { accounts: [] } },
      { persistent: { openAtLogin: true } },
      { persistent: { style: 'attentive' } },
      { persistent: { budget: 99 } },
      // el cursor es de la ventana del Mac: un dispositivo táctil no tiene, y sus Ajustes no lo enseñan
      { general: { cursor: 'system' } },
      { general: { inventado: 1 } },
      { onboarded: false },
      { version: 1 },
      { remote: { enabled: true } },
      { secrets: { 'ai.key.openai': 'sk-x' } },
      JSON.parse('{"__proto__":{"enabled":true}}'),
      JSON.parse('{"general":{"__proto__":{"theme":"dark"}}}'),
      { constructor: { name: 'x' } },
      { general: {} },
      { general: 'dark' },
      { general: null },
      { general: [{ theme: 'dark' }] },
      {}, [], null, undefined, 'general', 7
    ]
    for (const patch of closed) expect(remoteSettingsPatch(patch), JSON.stringify(patch)).toBeNull()
  })
  it('un campo que no vale anula el cambio entero (no se aplica «lo que sí vale»)', () => {
    expect(remoteSettingsPatch({ general: { theme: 'dark', cursor: 'system' } })).toBeNull()
    expect(remoteSettingsPatch({ general: { theme: 'dark' }, data: { memory: false } })).toBeNull()
    expect(remoteSettingsPatch({ general: { theme: 'dark' }, ai: { dailyBudgetUSD: 0 } })).toBeNull()
    expect(remoteSettingsPatch({ general: { language: 'en', textScale: 9 } })).toBeNull()
    expect(remoteSettingsPatch({ persistent: { enabled: true, openAtLogin: true } })).toBeNull()
    expect(remoteSettingsPatch({ persistent: { enabled: true, budget: 99 } })).toBeNull()
    expect(remoteSettingsPatch({ persistent: { enabled: true }, general: { language: 'klingon' } })).toBeNull()
    expect(remoteSettingsPatch({ persistent: { enabled: true }, general: {} })).toBeNull()
  })
  it('olvidar un recuerdo, de uno en uno (una lista entera sería «eliminar todo»)', () => {
    expect(remoteForget({ ids: ['m1'] })).toEqual({ ids: ['m1'] })
    for (const bad of [{ ids: ['m1', 'm2'] }, { ids: [] }, { ids: 'm1' }, { ids: [7] }, { ids: [''] }, { ids: ['x'.repeat(101)] }, { ids: ['m1'], all: true }, { all: true }, {}, null, ['m1']])
      expect(remoteForget(bad), JSON.stringify(bad)).toBeNull()
  })
  it('elegir la IA: solo cuál, su modelo y su razonamiento; con una dirección, una clave o cualquier otro campo, no', () => {
    expect(remoteAIChoice({ providerId: 'deepseek' })).toEqual({ providerId: 'deepseek' })
    expect(remoteAIChoice({ providerId: 'deepseek', model: 'deepseek-v4-pro', reasoning: 'high', activate: false })).toEqual({ providerId: 'deepseek', model: 'deepseek-v4-pro', reasoning: 'high', activate: false })
    expect(remoteAIChoice({ providerId: 'deepseek', model: '' })).toEqual({ providerId: 'deepseek', model: '' })
    const bad: unknown[] = [
      { providerId: 'custom', baseURL: 'https://malo.example/v1' },
      { providerId: 'openai', key: 'sk-1234567890abcdef' },
      { providerId: 'custom', baseURL: 'https://malo.example/v1', key: 'sk-1234567890abcdef', model: 'm' },
      { providerId: 'openai', label: 'x' },
      { providerId: 'openai', enabled: false },
      { providerId: 'openai', executable: '/usr/bin/true' },
      { providerId: 'openai', secretRef: 'ai.key.anthropic' },
      { providerId: 'openai', headers: { authorization: 'x' } },
      { providerId: null },
      { providerId: '' },
      { providerId: 'x'.repeat(101) },
      { providerId: ['openai'] },
      { providerId: 'openai', model: 7 },
      { providerId: 'openai', model: 'x'.repeat(501) },
      { providerId: 'openai', reasoning: true },
      { providerId: 'openai', activate: 'no' },
      { model: 'gpt' }, {}, null, 'openai', ['openai']
    ]
    for (const args of bad) expect(remoteAIChoice(args), JSON.stringify(args)).toBeNull()
  })
  it('una llamada acotada pasa solo con sus argumentos comprobados; las demás, por la lista', () => {
    expect(remoteCall('settings.update', { general: { theme: 'dark' } })).toEqual({ verdict: 'allow', args: { general: { theme: 'dark' } } })
    expect(remoteCall('settings.update', { data: { memory: false } })).toEqual({ verdict: 'deny', args: undefined })
    expect(remoteCall('settings.update', undefined).verdict).toBe('deny')
    expect(remoteCall('memory.forget', { ids: ['m1'] })).toEqual({ verdict: 'allow', args: { ids: ['m1'] } })
    expect(remoteCall('memory.forget', { ids: ['m1', 'm2'] }).verdict).toBe('deny')
    expect(remoteCall('ai.choose', { providerId: 'deepseek' })).toEqual({ verdict: 'allow', args: { providerId: 'deepseek' } })
    expect(remoteCall('ai.choose', { providerId: 'custom', baseURL: 'https://malo.example/v1' }).verdict).toBe('deny')
    expect(remoteCall('memory.add', { text: 'hola' })).toEqual({ verdict: 'allow', args: { text: 'hola' } })
    expect(remoteCall('app.setTheme', { theme: 'dark' }).verdict).toBe('noop')
    for (const m of ['memory.clear', 'memory.export', 'data.deleteAll', 'data.exportAll', 'ai.configure', 'ai.setKey', 'toString', 'constructor', '__proto__'])
      expect(remoteCall(m, {}).verdict, m).toBe('deny')
  })
  it('las direcciones de la ventana pasan a ser rutas del servidor', () => {
    expect(rewriteAssets('{"src":"aula-asset://pack/c/assets/f.png"}')).toBe('{"src":"/asset/pack/c/assets/f.png"}')
  })
})

describe('archivos que sube un dispositivo', () => {
  const body = (text: string): Readable => Readable.from([Buffer.from(text)])
  const ID = 'a'.repeat(32)
  it('guarda la copia, la apunta como dada por el estudiante y solo se la resuelve a su dispositivo', async () => {
    const granted: string[] = []
    const store = new UploadStore(tmp(), { grant: (p) => { granted.push(p); return true } })
    const path = await store.receive('aabbccddeeff', ID, '../../etc/Apuntes: tema 1?.pdf', body('hola'))
    expect(path.endsWith('Apuntes tema 1.pdf')).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('hola')
    expect(granted).toEqual([path])
    const ref = `aula-upload://${ID}/Apuntes.pdf`
    expect(store.resolve('aabbccddeeff', { paths: [ref, '/otra/ruta'], draftId: 'd1', nested: { file: ref } })).toEqual({ paths: [path, '/otra/ruta'], draftId: 'd1', nested: { file: path } })
    // otro dispositivo no puede usar esa subida: la dirección se queda como está (y la app la rechazará)
    expect(store.resolve('112233445566', { paths: [ref] })).toEqual({ paths: [ref] })
    expect(store.resolve('aabbccddeeff', `aula-upload://${'b'.repeat(32)}/x.pdf`)).toBe(`aula-upload://${'b'.repeat(32)}/x.pdf`)
  })
  it('rechaza identificadores raros, repetir uno y lo que pasa del tamaño (sin dejar restos)', async () => {
    const dir = tmp()
    const store = new UploadStore(dir, { maxBytes: 8 })
    await expect(store.receive('aabbccddeeff', '../x', 'a.txt', body('x'))).rejects.toMatchObject({ code: 'invalid' })
    await expect(store.receive('../../x', ID, 'a.txt', body('x'))).rejects.toMatchObject({ code: 'invalid' })
    await store.receive('aabbccddeeff', ID, 'a.txt', body('12345678'))
    await expect(store.receive('aabbccddeeff', ID, 'b.txt', body('x'))).rejects.toMatchObject({ code: 'invalid' })
    const big = 'c'.repeat(32)
    await expect(store.receive('aabbccddeeff', big, 'grande.bin', body('123456789'))).rejects.toMatchObject({ code: 'tooBig' })
    expect(existsSync(join(dir, 'aabbccddeeff', big))).toBe(false)
  })
  it('borra las copias viejas y todas las de un dispositivo retirado', async () => {
    const dir = tmp()
    const store = new UploadStore(dir)
    const old = await store.receive('aabbccddeeff', ID, 'viejo.txt', body('x'))
    const fresh = await store.receive('aabbccddeeff', 'b'.repeat(32), 'nuevo.txt', body('x'))
    const other = await store.receive('112233445566', ID, 'otro.txt', body('x'))
    const longAgo = new Date(Date.now() - 9 * 86_400_000)
    utimesSync(join(dir, 'aabbccddeeff', ID), longAgo, longAgo)
    store.sweep()
    expect([existsSync(old), existsSync(fresh), existsSync(other)]).toEqual([false, true, true])
    store.sweep(Date.now(), '112233445566')
    expect(existsSync(other)).toBe(false)
  })
  it('deja nombres seguros', () => {
    expect(safeUploadName('C:\\Users\\ana\\clase 3.mp4')).toBe('clase 3.mp4')
    expect(safeUploadName('.../.oculto')).toBe('oculto')
    expect(safeUploadName('\u0000')).toBe('archivo')
  })
})

describe('lo que recibe el dispositivo', () => {
  it('el puente es JavaScript válido y define window.aula', () => {
    const fetched: string[] = []
    const win: Record<string, unknown> = { screen: { width: 390, height: 844 } }
    const fetch = (url: string): Promise<never> => { fetched.push(url); return new Promise(() => {}) }
    new Function('window', 'fetch', 'crypto', 'navigator', 'location', 'document', 'setTimeout', REMOTE_BRIDGE_JS)(win, fetch, { getRandomValues: (a: Uint8Array) => a.fill(7), randomUUID: () => 'x' }, { clipboard: {} }, { pathname: '/' }, {}, () => 0)
    const aula = win.aula as { platform: string; remote: boolean; pathForFile: (f: unknown) => string }
    expect(aula).toMatchObject({ platform: 'ios', remote: true })
    expect(fetched).toEqual(['/events'])
    expect(aula.pathForFile({ name: 'apuntes.pdf' })).toBe(`aula-upload://${'07'.repeat(16)}/apuntes.pdf`)
    expect(fetched[1]).toBe(`/upload/${'07'.repeat(16)}`)
  })
  it('la página para vincular va en el idioma de Aula y con su nonce', () => {
    const es = pairingPage('es', 'N0NCE')
    expect(es).toContain('Vincula este dispositivo')
    expect(es.match(/nonce="N0NCE"/g)?.length).toBe(2)
    expect(pairingPage('en', 'x')).toContain('Link this device')
    expect(JSON.parse(REMOTE_MANIFEST)).toMatchObject({ display: 'standalone', start_url: '/' })
  })
})
