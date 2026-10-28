import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('./api', () => ({ api: { invoke: vi.fn(), on: vi.fn() } }))
const { updateNotice, updateView, noticeKey } = await import('./updates')

const es = JSON.parse(readFileSync(join(__dirname, '../i18n/locales/es/updates.json'), 'utf8'))
const en = JSON.parse(readFileSync(join(__dirname, '../i18n/locales/en/updates.json'), 'utf8'))
const lookup = (o: Record<string, unknown>, key: string): unknown => key.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], o)

describe('updateView', () => {
  it('una búsqueda automática que falla no molesta; si la pidió, se explica', () => {
    const s = { status: 'error', error: 'offline', errorStage: 'check' } as const
    expect(updateView(s, false, '0.1.0').message).toBeNull()
    expect(updateView(s, true, '0.1.0')).toMatchObject({ message: 'error.offline', primary: 'check' })
  })
  it('un fallo al instalar se cuenta siempre y ofrece descargarla a mano', () => {
    const v = updateView({ status: 'error', error: 'install', errorStage: 'install', version: '0.1.1' }, false, '0.1.0')
    expect(v).toMatchObject({ message: 'error.install', primary: 'download', secondary: 'retry', tone: 'warning' })
    expect(v.params).toMatchObject({ version: '0.1.1', current: '0.1.0' })
  })
  it('descargando, comprobando y lista', () => {
    expect(updateView({ status: 'downloading', version: '0.1.1', progress: 0.42 }, false, '0.1.0')).toMatchObject({ message: 'status.downloading', params: { percent: 42 } })
    expect(updateView({ status: 'downloading', version: '0.1.1', progress: 1 }, false, '0.1.0').message).toBe('status.verifying')
    expect(updateView({ status: 'ready', version: '0.1.1', notes: 'x' }, false, '0.1.0')).toMatchObject({ message: 'status.ready', primary: 'restart', hasNotes: true })
  })
  it('macOS desde Descargas: avisa de mover la app y ofrece descargar', () => {
    expect(updateView({ status: 'available', version: '0.1.1', blocked: 'translocated' }, false, '0.1.0')).toMatchObject({ message: 'available.translocated', primary: 'download' })
    expect(updateView({ status: 'available', version: '0.1.1', blocked: 'failedBefore' }, false, '0.1.0')).toMatchObject({ secondary: 'retry' })
  })
  it('tras actualizarse lo dice una vez', () => {
    expect(updateView({ status: 'upToDate', updatedFrom: '0.1.0' }, false, '0.1.1')).toMatchObject({ message: 'status.updatedFrom', params: { from: '0.1.0' } })
  })
  it('todas las claves existen en es y en', () => {
    const states = [
      { status: 'checking' },
      { status: 'upToDate' },
      { status: 'downloading', progress: 0.5 },
      { status: 'downloading', progress: 1 },
      { status: 'ready' },
      ...(['translocated', 'readOnly', 'failedBefore', 'package'] as const).map((blocked) => ({ status: 'available', blocked })),
      { status: 'available', blocked: 'failedBefore', error: 'system' },
      ...(['offline', 'unavailable', 'corrupt', 'signature', 'permission', 'disk', 'install', 'system', 'unknown'] as const).map((error) => ({ status: 'error', error, errorStage: 'download' })),
      { status: 'error', error: 'offline', errorStage: 'check' },
      ...(['dev', 'package', 'readOnly'] as const).map((blocked) => ({ status: 'unsupported', blocked })),
      { status: 'idle', updatedFrom: '1' }
    ] as const
    for (const s of states) {
      const v = updateView(s as never, true, '0.1.0')
      if (!v.message) continue
      expect(typeof lookup(es, v.message), `${v.message} (es)`).toBe('string')
      expect(typeof lookup(en, v.message), `${v.message} (en)`).toBe('string')
    }
    for (const key of ['notice.ready', 'notice.restart', 'notice.manual', 'notice.why', 'notice.download', 'notice.how', 'notice.dismiss']) {
      expect(typeof lookup(es, key), `${key} (es)`).toBe('string')
      expect(typeof lookup(en, key), `${key} (en)`).toBe('string')
    }
  })
  it('A1-P1-6 · sin firma válida: ni «Descargar» ni notas, y lo dice claro (también si ya falló antes)', () => {
    const e = updateView({ status: 'error', error: 'signature', errorStage: 'download', version: '0.1.1', notes: '[x](https://evil)' }, false, '0.1.0')
    expect(e).toMatchObject({ message: 'error.signature', primary: 'check', hasNotes: false })
    expect(e.secondary).toBeUndefined()
    const f = updateView({ status: 'available', blocked: 'failedBefore', error: 'signature', version: '0.1.1', notes: 'x' }, false, '0.1.0')
    expect(f).toMatchObject({ message: 'error.signature', primary: 'check', hasNotes: false })
    // los demás fallos siguen ofreciendo la descarga
    expect(updateView({ status: 'available', blocked: 'failedBefore', error: 'install', version: '0.1.1' }, false, '0.1.0')).toMatchObject({ primary: 'download', secondary: 'retry' })
  })
  it('A1-P2-18 · sin conexión a mitad de descarga, macOS demasiado antiguo y la .deb', () => {
    expect(updateView({ status: 'error', error: 'offline', errorStage: 'download', version: '0.1.1' }, false, '0.1.0').message).toBe('error.offlineDownload')
    expect(updateView({ status: 'error', error: 'system', errorStage: 'download', version: '0.1.1' }, false, '0.1.0')).toMatchObject({ message: 'error.system', primary: 'check' })
    expect(updateView({ status: 'available', blocked: 'package', version: '0.1.1' }, false, '0.1.0')).toMatchObject({ message: 'available.package', primary: 'download' })
  })
  it('A1-P1-3 · la barra lateral avisa cuando la versión no puede instalarse sola (no solo cuando está lista)', () => {
    expect(updateNotice({ status: 'ready', version: '0.1.1' })).toEqual({ kind: 'ready', version: '0.1.1' })
    for (const blocked of ['translocated', 'readOnly', 'failedBefore'] as const) expect(updateNotice({ status: 'available', blocked, version: '0.1.1' })?.kind, blocked).toBe('manual')
    expect(updateNotice({ status: 'available', blocked: 'package', version: '0.1.1' })?.kind).toBe('download')
    for (const error of ['install', 'signature', 'permission', 'disk', 'system'] as const) {
      expect(updateNotice({ status: 'error', error, errorStage: 'install', version: '0.1.1' })?.kind, error).toBe('manual')
    }
    // lo que se arregla solo o no es de esta copia: nada
    expect(updateNotice({ status: 'error', error: 'corrupt', errorStage: 'download', version: '0.1.1' })).toBeNull()
    expect(updateNotice({ status: 'error', error: 'offline', errorStage: 'download', version: '0.1.1' })).toBeNull()
    expect(updateNotice({ status: 'error', error: 'install', errorStage: 'check', version: '0.1.1' })).toBeNull()
    expect(updateNotice({ status: 'available', blocked: 'dev', version: '0.1.1' })).toBeNull()
    expect(updateNotice({ status: 'upToDate' })).toBeNull()
    expect(updateNotice({ status: 'unsupported', blocked: 'dev' })).toBeNull()
    // se descarta por versión y tipo
    expect(noticeKey({ kind: 'manual', version: '0.1.1' })).not.toBe(noticeKey({ kind: 'manual', version: '0.1.2' }))
  })
})
