// Suscripciones a calendarios .ics con un servidor simulado: el enlace va al almacén de secretos (nunca al archivo), lo leído
// se guarda para verlo sin conexión, al volver a leer lo nuevo sustituye a lo de antes (sin perder lo marcado como hecho) y
// los eventos se juntan con los de las plataformas sin repetirse. También importar un .ics desde el servicio.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isSubscriptionID } from '@shared/calendar'
import { toEventView, type CampusEvent } from '@engine/calendar'
import { MemorySecretStore } from '../secrets'
import type { FetchLike } from './feeds'
import { StudyCalendarService } from './service'
import { calendarNameOf, CalendarSubscriptions, mergeFeedEvents, startSubscriptionRefresh, subscriptionSecretKey, SUBSCRIPTIONS_FILE } from './subscriptions'

const TZ = 'Europe/Madrid'
const NOW = new Date('2026-10-26T10:00:00Z')
const URL_TEXT = 'webcal://calendar.example.edu/feeds/user_SECRET123.ics'
const roots: string[] = []
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })

function tmpRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'aula-subs-'))
  roots.push(r)
  return r
}

function ics(events: { uid: string; title: string; start: string; end?: string }[], name = 'Horario de la universidad'): string {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Uni//ES', `X-WR-CALNAME:${name}`,
    ...events.flatMap((e) => ['BEGIN:VEVENT', `UID:${e.uid}`, `SUMMARY:${e.title}`, `DTSTART:${e.start}`, ...(e.end ? [`DTEND:${e.end}`] : []), 'END:VEVENT']),
    'END:VCALENDAR'
  ].join('\r\n')
}

/** Servidor simulado: devuelve lo que diga `body` (o falla con `status`). */
class FakeServer {
  body = ics([
    { uid: 'examen-1', title: 'Examen parcial de Física', start: '20261103T090000Z', end: '20261103T110000Z' },
    { uid: 'entrega-1', title: 'Entrega de la práctica 2', start: '20261029T225900Z' }
  ])
  status = 200
  calls = 0
  readonly fetch: FetchLike = async () => {
    this.calls += 1
    if (this.status !== 200) return new Response(null, { status: this.status })
    return new Response(this.body, { status: 200, headers: { 'Content-Type': 'text/calendar' } })
  }
}

function setup() {
  const root = tmpRoot()
  const server = new FakeServer()
  const store = new MemorySecretStore()
  let n = 0
  const subs = new CalendarSubscriptions({ root, secrets: () => store, fetch: server.fetch, now: () => NOW, timeZone: TZ, newID: () => `sub-test${++n}` })
  return { root, server, store, subs }
}

describe('Suscripciones a calendarios', () => {
  it('se suscribe: el enlace va cifrado a los secretos, nunca al archivo, y el nombre sale del calendario', async () => {
    const { root, store, subs } = setup()
    const v = await subs.add({ url: URL_TEXT })
    expect(v).toMatchObject({ id: 'sub-test1', name: 'Horario de la universidad', host: 'calendar.example.edu', events: 2 })
    expect(v.refreshedAt).toBe(NOW.toISOString())
    expect(store.get(subscriptionSecretKey('sub-test1'))).toBe('https://calendar.example.edu/feeds/user_SECRET123.ics')
    const file = readFileSync(join(root, SUBSCRIPTIONS_FILE), 'utf8')
    expect(file).not.toContain('SECRET123')
    expect(JSON.stringify(subs.list())).not.toContain('SECRET123')
    expect(existsSync(subs.cacheFile('sub-test1'))).toBe(true)
  })

  it('rechaza un enlace que no vale, el mismo dos veces y uno que no se puede leer (sin guardar nada)', async () => {
    const { server, store, subs } = setup()
    await expect(subs.add({ url: 'ftp://x.org/cal.ics' })).rejects.toMatchObject({ code: 'calendar_invalid_url' })
    await subs.add({ url: URL_TEXT, name: 'Uni' })
    await expect(subs.add({ url: 'https://calendar.example.edu/feeds/user_SECRET123.ics' })).rejects.toMatchObject({ code: 'calendar_duplicate' })
    server.status = 403
    await expect(subs.add({ url: 'https://otro.example.com/privado.ics' })).rejects.toMatchObject({ code: 'calendar_private' })
    expect(subs.list().map((s) => s.name)).toEqual(['Uni'])
    expect(store.keys()).toHaveLength(1)
  })

  it('al volver a leer, lo nuevo sustituye a lo de antes; si falla, siguen los eventos de la última lectura buena', async () => {
    const { server, subs } = setup()
    await subs.add({ url: URL_TEXT })
    const from = new Date('2026-10-01T00:00:00Z'), to = new Date('2026-12-31T00:00:00Z')
    expect(subs.events(from, to).map((e) => e.title)).toEqual(['Entrega de la práctica 2', 'Examen parcial de Física'])
    // el examen cambia de día, la entrega desaparece y llega una tutoría
    server.body = ics([
      { uid: 'examen-1', title: 'Examen parcial de Física', start: '20261105T090000Z', end: '20261105T110000Z' },
      { uid: 'tutoria-1', title: 'Tutoría', start: '20261028T150000Z' }
    ])
    const ok = await subs.refresh('sub-test1')
    expect(ok.events).toBe(2)
    expect(ok.error).toBeUndefined()
    expect(subs.events(from, to).map((e) => [e.title, e.start.toISOString()])).toEqual([
      ['Tutoría', '2026-10-28T15:00:00.000Z'], ['Examen parcial de Física', '2026-11-05T09:00:00.000Z']
    ])
    // sin conexión: el error se apunta y los eventos siguen
    server.status = 500
    const bad = await subs.refresh('sub-test1')
    expect(bad.errorCode).toBe('calendar_server')
    expect(bad.error).toContain('500')
    expect(bad.refreshedAt).toBe(NOW.toISOString())
    expect(subs.events(from, to)).toHaveLength(2)
    // una lectura buena quita el error
    server.status = 200
    expect((await subs.refresh('sub-test1')).error).toBeUndefined()
  })

  it('un calendario con demasiadas repeticiones para enseguida con un error claro (y siguen los eventos de antes)', async () => {
    const { server, store, subs } = setup()
    const hostile = ['BEGIN:VCALENDAR', 'VERSION:2.0',
      ...Array.from({ length: 800 }, (_, i) => `BEGIN:VEVENT\r\nUID:x${i}\r\nDTSTART:19800101T100000Z\r\nRRULE:FREQ=DAILY;COUNT=20000\r\nSUMMARY:a\r\nEND:VEVENT`),
      'END:VCALENDAR'].join('\r\n')
    const good = server.body
    server.body = hostile
    const t0 = Date.now()
    await expect(subs.add({ url: URL_TEXT })).rejects.toMatchObject({ code: 'calendar_too_complex' })
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(subs.list()).toEqual([])
    expect(store.get(subscriptionSecretKey('sub-test1'))).toBeNull()
    // ya suscrito: al volver a leer se apunta el error y no se pierde lo de la última lectura buena
    server.body = good
    await subs.add({ url: URL_TEXT })
    server.body = hostile
    const bad = await subs.refresh('sub-test2')
    expect(bad.errorCode).toBe('calendar_too_complex')
    expect(subs.events(new Date('2026-10-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z'))).toHaveLength(2)
  })

  it('cambia el nombre (también el de sus eventos) y al quitarla se van su enlace, su copia y sus eventos', async () => {
    const { store, subs } = setup()
    await subs.add({ url: URL_TEXT })
    subs.rename('sub-test1', '  Física y Química ')
    const from = new Date('2026-10-01T00:00:00Z'), to = new Date('2026-12-31T00:00:00Z')
    expect(subs.events(from, to).every((e) => e.platformLabel === 'Física y Química')).toBe(true)
    expect(() => subs.rename('sub-test1', '   ')).toThrow()
    subs.remove('sub-test1')
    expect(subs.list()).toEqual([])
    expect(store.get(subscriptionSecretKey('sub-test1'))).toBeNull()
    expect(existsSync(subs.cacheFile('sub-test1'))).toBe(false)
    expect(subs.events(from, to)).toEqual([])
    expect(() => subs.remove('sub-test1')).toThrow()
  })

  it('refreshAll solo vuelve a leer las que tocan', async () => {
    const { server, subs } = setup()
    await subs.add({ url: URL_TEXT })
    const before = server.calls
    expect((await subs.refreshAll({ olderThanMs: 3_600_000 })).refreshed).toHaveLength(0)
    expect(server.calls).toBe(before)
    expect((await subs.refreshAll()).refreshed).toHaveLength(1)
    expect(server.calls).toBe(before + 1)
  })

  it('cada cierto tiempo vuelve a leerlas y avisa', async () => {
    vi.useFakeTimers()
    try {
      const refreshAll = vi.fn(async () => ({ refreshed: [{ id: 'sub-x' }] as never[] }))
      const onRefreshed = vi.fn()
      const timer = startSubscriptionRefresh({ refreshAll }, { everyMs: 1000, maxAgeMs: 5000, firstAfterMs: 100, onRefreshed })
      await vi.advanceTimersByTimeAsync(100)
      expect(refreshAll).toHaveBeenCalledWith({ olderThanMs: 5000 })
      await vi.advanceTimersByTimeAsync(2000)
      expect(refreshAll).toHaveBeenCalledTimes(3)
      expect(onRefreshed).toHaveBeenCalledTimes(3)
      timer.stop()
      await vi.advanceTimersByTimeAsync(5000)
      expect(refreshAll).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('el nombre del calendario (X-WR-CALNAME), si lo trae', () => {
    expect(calendarNameOf(ics([], 'Festivos\\, Madrid'))).toBe('Festivos, Madrid')
    expect(calendarNameOf('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBeNull()
  })
})

describe('Suscripciones en el calendario', () => {
  it('sus eventos son de solo lectura, dicen de dónde vienen y lo marcado como hecho sigue tras volver a leer', async () => {
    const { root, server, subs } = setup()
    await subs.add({ url: URL_TEXT, name: 'Uni' })
    const cal = new StudyCalendarService({ root, library: null, platforms: null, subscriptions: subs, timeZone: TZ, now: () => NOW })
    const from = new Date('2026-10-01T00:00:00Z'), to = new Date('2026-12-31T00:00:00Z')
    const evs = (await cal.events(from, to)).events
    expect(evs.map((e) => e.title)).toEqual(['Entrega de la práctica 2', 'Examen parcial de Física'])
    const exam = evs[1]
    expect(exam.kind).toBe('exam')
    expect(exam.origin).toBe('platform')
    expect(exam.id).toBe('platform:sub-test1:examen-1')
    const v = toEventView(exam, { timeZone: TZ })
    expect(v.editable).toBe(false)
    expect(v.subscriptionID).toBe('sub-test1')
    expect(isSubscriptionID(v.subscriptionID)).toBe(true)
    expect(v.platformLabel).toBe('Uni')
    expect(() => cal.update(exam.id, { title: 'x' })).toThrow(/Examen parcial de Física/)
    expect(() => cal.delete(exam.id)).toThrow()
    // la entrega se marca como hecha y sigue hecha tras volver a leer el calendario
    cal.setDone(evs[0].id, true)
    server.body = server.body.replace('Entrega de la práctica 2', 'Entrega de la práctica 2 (ampliada)')
    await cal.refreshFeeds()
    const after = (await cal.events(from, to)).events
    expect(after[0].title).toBe('Entrega de la práctica 2 (ampliada)')
    expect(after[0].task?.done).toBe(true)
  })

  it('un evento que ya llega de una plataforma no sale dos veces', () => {
    const base = { allDay: false, isExam: true, kind: 'exam' }
    const platform: CampusEvent[] = [{ ...base, id: 'examen-1', title: 'Parcial', start: new Date('2026-11-03T09:00:00Z'), platformID: 'canvas1' }]
    const subscribed: CampusEvent[] = [
      { ...base, id: 'examen-1', title: 'Parcial', start: new Date('2026-11-03T09:00:00Z'), platformID: 'sub-a' },
      { ...base, id: 'examen-1', title: 'Parcial (otro día)', start: new Date('2026-11-04T09:00:00Z'), platformID: 'sub-a' },
      { ...base, id: 'otro', title: 'Otro', start: new Date('2026-11-05T09:00:00Z'), platformID: 'sub-a' },
      { ...base, id: 'otro', title: 'Otro', start: new Date('2026-11-05T09:00:00Z'), platformID: 'sub-b' }
    ]
    expect(mergeFeedEvents(platform, subscribed).map((e) => `${e.platformID}:${e.title}`)).toEqual(['canvas1:Parcial', 'sub-a:Parcial (otro día)', 'sub-a:Otro'])
  })

  it('importa un .ics como eventos propios y avisa del cambio; dos veces no duplica', () => {
    const root = tmpRoot()
    const changes: string[] = []
    const cal = new StudyCalendarService({ root, library: null, platforms: null, timeZone: TZ, now: () => NOW, onChange: (c) => changes.push(c.reason) })
    const file = ics([{ uid: 'clase@uni', title: 'Clase de Química', start: '20261102T090000Z', end: '20261102T100000Z' }])
    const r = cal.importICS(file)
    expect(r.added).toHaveLength(1)
    expect(changes).toEqual(['events'])
    expect(cal.ownEvents()[0]).toMatchObject({ title: 'Clase de Química', kind: 'lecture', origin: 'own' })
    expect(cal.importICS(new TextEncoder().encode(file))).toMatchObject({ added: [], skipped: 1 })
    expect(changes).toEqual(['events'])
  })
})
