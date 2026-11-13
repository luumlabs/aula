// Acceso desde los dispositivos del estudiante: emparejar con un código, qué se puede pedir a distancia y los archivos
// que sube un dispositivo.
import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { DeviceRegistry, MAX_ATTEMPTS, PAIRING_MINUTES, PairingError, TOKEN_DAYS } from './devices'
import { noopValue, ownerVerdict, remoteAIChoice, remoteCall, remoteForget, remoteSettingsPatch, remoteVerdict, rewriteAssets } from './policy'
import { hostLabel, installServerCrashHandlers, isAulaHostname, isDeviceHostname, isServerMode, serverHostname } from './server-mode'
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
  it('lo que sigue abierto pregunta si su dispositivo aún vale: retirado o caducado, no (y preguntar no cuenta como usarlo)', () => {
    let now = Date.parse('2026-11-10T10:00:00Z')
    const reg = new DeviceRegistry(join(tmp(), 'd.json'), () => now)
    const a = reg.completePairing(reg.startPairing().code, 'iPhone', 'iphone')
    const b = reg.completePairing(reg.startPairing().code, 'iPad', 'ipad')
    expect(reg.active(a.device.id)?.name).toBe('iPhone')
    expect(reg.active('ffffffffffff')).toBeUndefined()
    reg.revoke(a.device.id)
    expect(reg.active(a.device.id)).toBeUndefined()
    now += TOKEN_DAYS * 86_400_000 - 1
    expect(reg.active(b.device.id)?.lastSeen).toBe(b.device.lastSeen)
    now += 2
    expect(reg.active(b.device.id)).toBeUndefined()
  })
})

describe('propietario (Aula como servidor)', () => {
  const reg = (): DeviceRegistry => new DeviceRegistry(join(mkdtempSync(join(tmpdir(), 'aula-owner-')), 'devices.json'))
  it('solo es propietario quien usa un código de propietario; queda guardado y se ve', () => {
    const r = reg()
    expect(r.hasOwner()).toBe(false)
    const first = r.startPairing({ owner: true })
    expect(first.owner).toBe(true)
    const a = r.completePairing(first.code, 'iPad de Ana', 'ipad')
    expect(a.device.owner).toBe(true)
    expect(r.hasOwner()).toBe(true)
    const second = r.startPairing()
    const b = r.completePairing(second.code, 'Móvil', 'android')
    expect(b.device.owner).toBeUndefined()
    expect(b.device.platform).toBe('android')
    expect(r.authenticate(a.token)?.owner).toBe(true)
    expect(r.authenticate(b.token)?.owner).toBeUndefined()
    // otra lectura del archivo: lo mismo
    const file = join(mkdtempSync(join(tmpdir(), 'aula-owner-')), 'devices.json')
    const r1 = new DeviceRegistry(file)
    const t = r1.completePairing(r1.startPairing({ owner: true }).code, 'x', 'web').token
    expect(new DeviceRegistry(file).authenticate(t)?.owner).toBe(true)
  })
  it('un propietario pide lo que la ventana, menos lo que necesita la pantalla del servidor o deja fuera a todos', () => {
    for (const m of ['ai.setKey', 'ai.configure', 'platforms.add', 'platforms.remove', 'remote.startPairing', 'remote.revoke', 'remote.status', 'local.download', 'courses.delete', 'memory.clear', 'secrets.status', 'settings.update'])
      expect([m, ownerVerdict(m)]).toEqual([m, 'allow'])
    for (const m of ['documents.pick', 'documents.reveal', 'courses.export', 'courses.import', 'calendar.importICS', 'calendar.exportICS', 'data.exportAll', 'data.deleteAll', 'memory.export',
      'updates.install', 'updates.check', 'remote.setEnabled', 'remote.tailnetLogout', 'remote.tailnetLogin', 'app.showItemInFolder', 'app.openLicenses', 'nada', ''])
      expect([m, ownerVerdict(m)]).toEqual([m, 'deny'])
    expect(ownerVerdict('app.setTheme')).toBe('noop')
    // sin acotar: la clave y la dirección pasan tal cual (un dispositivo normal no puede ni pedirlo)
    expect(remoteCall('ai.configure', { providerId: 'custom', baseURL: 'https://x.example/v1', key: 'k' }, { owner: true })).toEqual({ verdict: 'allow', args: { providerId: 'custom', baseURL: 'https://x.example/v1', key: 'k' } })
    expect(remoteCall('ai.configure', { providerId: 'custom', baseURL: 'https://x.example/v1' }).verdict).toBe('deny')
    expect(remoteCall('settings.update', { privacy: { telemetry: false } }, { owner: true }).verdict).toBe('allow')
    expect(remoteCall('settings.update', { privacy: { telemetry: false } }).verdict).toBe('deny')
    expect(remoteCall('remote.startPairing', { owner: true }).verdict).toBe('deny')
    // ChatGPT: solo con el código de un solo uso (la página normal vuelve al propio servidor)
    expect(remoteCall('agents.codexLogin', { deviceAuth: true }, { owner: true })).toEqual({ verdict: 'allow', args: { deviceAuth: true } })
    expect(remoteCall('agents.codexLogin', undefined, { owner: true }).verdict).toBe('deny')
    expect(remoteCall('agents.codexLogin', { deviceAuth: true, extra: 1 }, { owner: true }).verdict).toBe('deny')
    expect(remoteCall('agents.codexLogin', { deviceAuth: true }).verdict).toBe('deny')
  })
  it('los códigos de propietario que el servidor da solo tienen un tope de intentos fallidos entre todos (también tras reiniciar)', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'aula-owner-')), 'devices.json')
    const r = new DeviceRegistry(file)
    const wrongFor = (c: string): string => (c === '000000' ? '111111' : '000000')
    // cada código caduca o se cambia antes de agotar sus intentos: aun así, los fallos se suman
    let offered = r.offerOwnerCode()!
    expect(offered.owner).toBe(true)
    for (let i = 0; i < MAX_ATTEMPTS - 2; i++) expect(code(() => r.completePairing(wrongFor(offered.code), 'x', 'web'))).toBe('wrong')
    offered = r.offerOwnerCode()!
    expect(code(() => r.completePairing(wrongFor(offered.code), 'x', 'web'))).toBe('wrong')
    // el que llega al tope anula el código abierto aunque a este le quedaran intentos, y no se dan más solos
    expect(code(() => r.completePairing(wrongFor(offered.code), 'x', 'web'))).toBe('tooMany')
    expect(code(() => r.completePairing(offered.code, 'x', 'web'))).toBe('noCode')
    expect(r.ownerCodesBlocked()).toBe(true)
    expect(r.offerOwnerCode()).toBeNull()
    // reiniciar no da más intentos
    const again = new DeviceRegistry(file)
    expect(again.offerOwnerCode()).toBeNull()
    // los códigos normales no cuentan ni se bloquean
    const plain = again.startPairing()
    expect(code(() => again.completePairing(wrongFor(plain.code), 'x', 'web'))).toBe('wrong')
    expect(again.completePairing(plain.code, 'Móvil', 'android').device.owner).toBeUndefined()
    // pedirlo a mano (la consola o un propietario) vuelve a dar intentos
    const manual = again.startPairing({ owner: true })
    expect(again.ownerCodesBlocked()).toBe(false)
    expect(again.completePairing(manual.code, 'iPad', 'ipad').device.owner).toBe(true)
    expect(new DeviceRegistry(file).offerOwnerCode()?.owner).toBe(true)
  })
  it('vincular al propietario deja el tope a cero', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'aula-owner-')), 'devices.json')
    const r = new DeviceRegistry(file)
    const offered = r.offerOwnerCode()!
    expect(code(() => r.completePairing(offered.code === '000000' ? '111111' : '000000', 'x', 'web'))).toBe('wrong')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ ownerMisses: 1 })
    r.completePairing(offered.code, 'iPad', 'ipad')
    expect(JSON.parse(readFileSync(file, 'utf8')).ownerMisses).toBeUndefined()
  })
  it('modo servidor y nombres en la red: «aula-…» es un equipo con Aula, salvo los de los dispositivos', () => {
    expect(isServerMode(['electron', '.', '--server'], {})).toBe(true)
    expect(isServerMode(['aula'], { AULA_SERVER: '1' })).toBe(true)
    expect(isServerMode(['aula'], { AULA_SERVER: 'true' })).toBe(true)
    expect(isServerMode(['aula'], {})).toBe(false)
    expect(isServerMode(['aula'], { AULA_SERVER: '0' })).toBe(false)
    expect(serverHostname(undefined)).toBe('aula-server')
    expect(serverHostname('aula-casa')).toBe('aula-casa')
    expect(serverHostname(' Aula-NAS ')).toBe('aula-nas')
    expect(serverHostname('aula-casa.lan')).toBe('aula-server') // una sola etiqueta: con puntos se ignora (docs/SERVER.md)
    expect(serverHostname('aula-casa.')).toBe('aula-server')
    expect(serverHostname('aula-' + 'x'.repeat(58))).toBe('aula-' + 'x'.repeat(58)) // 63: el máximo de una etiqueta
    for (const bad of ['casa', 'aula-', 'aula-ipad', 'aula-android-2', 'aula-device', 'aula-device-2', 'aula-a_b', 'aula-x-', 'aula--', 'aula-' + 'x'.repeat(59), '-aula-x', 'casa.aula-x', 'aula-caf\u00e9', 'aula-\u212a'])
      expect([bad, serverHostname(bad)]).toEqual([bad, 'aula-server'])
    expect(isDeviceHostname('aula-iphone-3')).toBe(true)
    expect(isDeviceHostname('aula-device')).toBe(true)
    expect(isDeviceHostname('AULA-IPAD-2.tail1234.ts.net.')).toBe(true)
    expect(isDeviceHostname('aula-iphones')).toBe(false)
    expect(isDeviceHostname('aula-ipad-')).toBe(false)
    expect(hostLabel('AULA-Mac.tail1234.ts.net.')).toBe('aula-mac')
    expect(hostLabel('aula-\u212a')).toBe('') // la «K» de Kelvin no pasa a ser una «k»: no es ASCII, no vale
    expect(hostLabel('aula-mac.caf\u00e9')).toBe('aula-mac') // solo cuenta la primera etiqueta
    for (const yes of ['aula-mac', 'aula-mac-1', 'aula-mac-3', 'aula-server', 'aula-server-2', 'aula-casa', 'AULA-SERVER', 'aula-mac.tail1234.ts.net.', 'aula-ipadx', 'aula-ipad-x', 'aula-' + 'x'.repeat(58)])
      expect([yes, isAulaHostname(yes)]).toEqual([yes, true])
    for (const no of ['aula-ipad', 'aula-ipad-2', 'aula-iphone-12', 'aula-android-1', 'aula-device', 'aula-device-7', 'AULA-IPAD', 'aula-ipad.tail1234.ts.net', 'mac', 'aulaserver', 'aula', 'aula-', 'aula--', 'aula-x-', 'aula-ipad-', 'aula_x', 'aula-a_b',
      'aula-caf\u00e9', 'aula-\u2172', 'aula-\u212a', 'aula-' + 'x'.repeat(59), '', '.aula-mac'])
      expect([no, isAulaHostname(no)]).toEqual([no, false])
  })
  it('como servidor, un error sin capturar se apunta y el proceso termina (una sola vez); una promesa rechazada solo se apunta', () => {
    const proc = new EventEmitter()
    const out = new EventEmitter()
    const logged: string[] = []
    const written: string[] = []
    const exits: number[] = []
    installServerCrashHandlers({ process: proc, streams: [out], log: (m) => { logged.push(m) }, stderr: (t) => { written.push(t) }, exit: (c) => { exits.push(c) } })
    proc.emit('unhandledRejection', new Error('sin red'))
    expect([logged.length, exits]).toEqual([1, []])
    // la consola cerrada no tumba nada
    expect(() => out.emit('error', Object.assign(new Error('EPIPE'), { code: 'EPIPE' }))).not.toThrow()
    proc.emit('uncaughtException', new Error('roto'))
    proc.emit('uncaughtException', new Error('otra vez'))
    expect(exits).toEqual([1])
    expect(written).toHaveLength(1)
    expect(written[0]).toContain('roto')
    expect(logged).toHaveLength(2)
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
    expect(aula).toMatchObject({ owner: false, server: false })
  })
  it('el puente sabe si el dispositivo es propietario, si Aula es un servidor y si es un Android; los enlaces se abren en él', async () => {
    const opened: string[] = []
    const fetched: string[] = []
    const metas: Record<string, string> = { 'aula-device': 'owner', 'aula-host': 'server' }
    const doc = { querySelector: (sel: string) => { const name = /name="([^"]+)"/.exec(sel)?.[1] ?? ''; return metas[name] ? { getAttribute: () => metas[name] } : null } }
    const win: Record<string, unknown> = { screen: { width: 412, height: 915 }, open: (u: string) => { opened.push(u) } }
    const fetch = (url: string): Promise<never> => { fetched.push(url); return new Promise(() => {}) }
    new Function('window', 'fetch', 'crypto', 'navigator', 'location', 'document', 'setTimeout', REMOTE_BRIDGE_JS)(win, fetch, { getRandomValues: (a: Uint8Array) => a, randomUUID: () => 'x' }, { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36', platform: 'Linux armv8l', maxTouchPoints: 5, clipboard: {} }, { pathname: '/', replace: () => {} }, doc, () => 0)
    const aula = win.aula as { platform: string; owner: boolean; server: boolean; invoke: (m: string, a?: unknown) => Promise<{ ok: boolean }> }
    expect(aula).toMatchObject({ platform: 'android', owner: true, server: true })
    expect(await aula.invoke('app.openExternal', { url: 'https://platform.deepseek.com/api_keys' })).toEqual({ ok: true, value: null })
    expect(await aula.invoke('app.openExternal', { url: 'file:///etc/passwd' })).toEqual({ ok: true, value: null })
    expect(opened).toEqual(['https://platform.deepseek.com/api_keys'])
    expect(fetched).toEqual(['/events'])
  })
  it('los avisos del puente van en el idioma de la interfaz', async () => {
    const run = (lang: string, host: string | null, rpc: () => Promise<unknown>): { invoke: (m: string) => Promise<{ error?: { message: string; code: string } }> } => {
      const doc = { documentElement: { lang }, querySelector: (sel: string) => (host && sel.includes('aula-host') ? { getAttribute: () => host } : null) }
      const win: Record<string, unknown> = { screen: { width: 390, height: 844 } }
      const fetch = (url: string): Promise<unknown> => (url === '/rpc' ? rpc() : new Promise(() => {}))
      new Function('window', 'fetch', 'crypto', 'navigator', 'location', 'document', 'setTimeout', REMOTE_BRIDGE_JS)(win, fetch, { getRandomValues: (a: Uint8Array) => a, randomUUID: () => 'x' }, { clipboard: {} }, { pathname: '/', replace: () => {} }, doc, () => 0)
      return win.aula as never
    }
    const offline = (): Promise<never> => Promise.reject(new Error('sin red'))
    const gone = (): Promise<unknown> => Promise.resolve({ status: 401 })
    expect((await run('en', 'server', offline).invoke('courses.list')).error).toEqual({ message: 'Could not reach your Aula server.', code: 'offline' })
    expect((await run('es', 'server', offline).invoke('courses.list')).error?.message).toBe('No se pudo conectar con tu servidor de Aula.')
    expect((await run('en', null, offline).invoke('courses.list')).error?.message).toBe('Could not reach Aula on your Mac.')
    expect((await run('es-ES', null, offline).invoke('courses.list')).error?.message).toBe('No se pudo conectar con Aula en tu Mac.')
    expect((await run('en', null, gone).invoke('courses.list')).error).toEqual({ message: 'This device is no longer linked.', code: 'forbidden' })
    expect((await run('es', null, gone).invoke('courses.list')).error?.message).toBe('Este dispositivo ya no está vinculado.')
  })
  it('la página para vincular va en el idioma de Aula y con su nonce', () => {
    const es = pairingPage('es', 'N0NCE')
    expect(es).toContain('Vincula este dispositivo')
    expect(es.match(/nonce="N0NCE"/g)?.length).toBe(2)
    expect(pairingPage('en', 'x')).toContain('Link this device')
    // como servidor no hay Mac: el código sale del servidor (o de un propietario)
    expect(pairingPage('es', 'x', 'server')).toContain('aula-server link')
    expect(pairingPage('es', 'x', 'server')).not.toContain('En tu Mac')
    expect(pairingPage('en', 'x', 'server')).toContain('your Aula server')
    expect(JSON.parse(REMOTE_MANIFEST)).toMatchObject({ display: 'standalone', start_url: '/' })
  })
})
