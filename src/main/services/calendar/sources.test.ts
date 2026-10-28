// Las fechas de las plataformas: enlaces de las cuentas (uno por línea en el secreto), lectura a la vez, sin repetir y con el
// estado de cada calendario (como LiveCampus.swift).
import { describe, expect, it } from 'vitest'
import type { PlatformAccount } from '@shared/settings/platforms'
import { MemorySecretStore } from '../secrets'
import { feedSourcesFor, IcsPlatformSource, linksIn } from './sources'
import type { FetchLike } from './feeds'

const account = (id: string, label: string): PlatformAccount => ({ id, kind: 'canvas', label, baseURL: 'https://x.edu', calendarSecretRef: `platform.calendar.${id}` })
const ics = (uid: string, title: string, start = '20261021T090000Z') =>
  `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${start}\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`

describe('Plataformas · calendarios de las cuentas', () => {
  it('los enlaces del secreto, uno por línea y sin repetir', () => {
    expect(linksIn(' https://a/1.ics \n\nhttps://a/2.ics\r\n')).toEqual(['https://a/1.ics', 'https://a/2.ics'])
    const secrets = new MemorySecretStore()
    secrets.set('platform.calendar.c1', 'https://canvas.x.edu/feed.ics\nhttps://google.com/cal.ics')
    secrets.set('platform.calendar.m1', 'HTTPS://CANVAS.X.EDU/feed.ics\nhttps://moodle.x.edu/export.ics')
    const sources = feedSourcesFor([account('c1', 'Canvas'), account('m1', 'Moodle'), account('z', 'Sin calendario')], secrets)
    expect(sources.map((s) => `${s.accountId}:${s.url}`)).toEqual([
      'c1:https://canvas.x.edu/feed.ics', 'c1:https://google.com/cal.ics', 'm1:https://moodle.x.edu/export.ics'
    ])
  })

  it('se leen a la vez; un fallo suelto no se lleva lo demás', async () => {
    const fetch: FetchLike = async (url) => {
      if (url.includes('roto')) return new Response('', { status: 404 })
      const which = new URL(url).pathname.slice(1)
      return new Response(ics(`ev-${which}`, `Examen ${which}`), { status: 200 })
    }
    const source = new IcsPlatformSource(() => [
      { accountId: 'c1', label: 'Canvas', url: 'https://cal.x.edu/a' },
      { accountId: 'c1', label: 'Canvas', url: 'webcal://cal.x.edu/b' },
      { accountId: 'm1', label: 'Moodle', url: 'https://cal.x.edu/roto' },
      { accountId: 'm1', label: 'Moodle', url: 'no es un enlace' }
    ], { fetch, timeZone: 'UTC', now: () => new Date('2026-10-01T00:00:00Z') })
    expect(source.isConfigured()).toBe(true)
    const events = await source.events(new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'))
    expect(events.map((e) => `${e.platformID}:${e.title}`)).toEqual(['c1:Examen a', 'c1:Examen b'])
    expect(events[0].platformLabel).toBe('Canvas')
    expect(events[0].isExam).toBe(true)
    const status = source.lastStatus()
    expect(status.filter((s) => s.ok).map((s) => s.events)).toEqual([1, 1])
    expect(status.filter((s) => !s.ok)).toHaveLength(2)
    expect(status.every((s) => !(s.error ?? '').includes('roto'))).toBe(true)
  })

  it('si no se pudo leer nada, el primer error', async () => {
    const source = new IcsPlatformSource(() => [{ accountId: 'c1', label: 'Canvas', url: 'https://cal.x.edu/a' }], { fetch: async () => new Response('', { status: 401 }) })
    await expect(source.events(new Date(0), new Date())).rejects.toMatchObject({ code: 'calendar_private' })
    expect(new IcsPlatformSource(() => []).isConfigured()).toBe(false)
  })
})
