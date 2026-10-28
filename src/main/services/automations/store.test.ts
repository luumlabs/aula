// Almacén con datos escritos por la app Swift (mismas claves y formatos): se leen, se vuelven a escribir sin perder nada y se
// toleran entradas rotas y archivos ilegibles (port de testStoreIsTolerantAndPersistent y testDurableStoreKeepsABackup…).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultSchedule } from '@shared/automations'
import { AutomationStore, RUNS_KEPT } from './store'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'aula-auto-store-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

/** Como lo escribe `JSONCoders.makeEncoder()` de Swift (claves ordenadas, fechas ISO con milisegundos). */
const swiftAutomations = `{
  "automations" : [
    {
      "capabilities" : [ "platform", "calendar", "courses" ],
      "created" : "2026-10-01T08:00:00.000Z",
      "enabled" : true,
      "id" : "auto-k3j2h1g0",
      "instruction" : "Revisa mis notificaciones de Canvas y avísame si llegó algo",
      "notify" : "news",
      "origin" : "student",
      "platformIDs" : [ ],
      "schedule" : { "eventKinds" : [ ], "everyHours" : 8, "hoursBefore" : [ ], "kind" : "daily", "times" : [ "08:00", "20:30" ], "weekdays" : [ 2, 3, 4, 5, 6 ], "windowEnd" : "22:00", "windowStart" : "08:00" },
      "title" : "Revisar Canvas",
      "untilFound" : false,
      "updated" : "2026-10-02T08:00:00.000Z"
    },
    42,
    {
      "capabilities" : [ "calendar" ],
      "created" : "2026-10-01T08:00:00Z",
      "enabled" : true,
      "id" : "routine-deadlineReminders",
      "instruction" : "",
      "notify" : "always",
      "origin" : "routine",
      "platformIDs" : [ ],
      "routine" : "deadlineReminders",
      "schedule" : { "eventKinds" : [ ], "everyHours" : 8, "hoursBefore" : [ 24, 2 ], "kind" : "beforeEvents", "times" : [ ], "weekdays" : [ ], "windowEnd" : "22:00", "windowStart" : "08:00" },
      "title" : "Recordatorios de entregas y exámenes",
      "untilFound" : false,
      "updated" : "2026-10-01T08:00:00Z"
    }
  ],
  "version" : 1
}`

const swiftInbox = `{
  "entries" : [
    {
      "archived" : false, "automationID" : "auto-k3j2h1g0", "course" : "MATH112", "date" : "2026-10-13T06:00:12.345Z", "dedupeKey" : "platform:auto-k3j2h1g0:1a2b3c4d5e",
      "id" : "8F2C1A77-0D1E-4F6B-9E2A-3B4C5D6E7F80", "kind" : "platform", "notified" : true,
      "notice" : { "automationID" : "auto-k3j2h1g0", "body" : "Vence el jueves a las 23:59. ¿La organizamos juntos?", "dedupeKey" : "find:abc", "entryID" : "8F2C1A77-0D1E-4F6B-9E2A-3B4C5D6E7F80",
                   "entryIDs" : [ ], "group" : "platform.math112", "kind" : "platform", "level" : "active", "priority" : 2, "relevance" : 0.8, "routine" : false, "sound" : true,
                   "subtitle" : "Asignación nueva · MATH112", "summaryArgument" : "MATH112", "title" : "Tarea 3: Integrales" },
      "preview" : "Hay una tarea nueva en MAT101.", "priority" : 2, "read" : false, "resurfaced" : false, "runID" : "run-a1b2c3d4", "source" : "Automatización: Revisar Canvas",
      "symbol" : "globe.desk", "threadID" : "aula-novedades", "title" : "1 asignación nueva: «Tarea 3: Integrales»"
    },
    { "kind" : "summary" },
    { "date" : "2026-10-12T05:45:00.000Z", "id" : "m2", "kind" : "nuevo-tipo", "priority" : 7, "read" : true, "snoozedUntil" : "2026-10-20T06:00:00.000Z", "title" : "Buenos días" }
  ],
  "version" : 1
}`

const swiftState = `{
  "aiFailureStreak" : 0, "aiPauseLevel" : 0, "announced" : { "u:campus.test.edu/courses/7/assignments/3" : "2026-10-13T06:00:12.345Z" }, "budgetNotifiedDay" : "2026-10-12",
  "followups" : { "2026-10-12" : 1 }, "lastTick" : "2026-10-13T06:01:00.000Z",
  "notices" : { "held" : [ { "notice" : { "automationID" : "a", "body" : "", "dedupeKey" : "k", "kind" : "reminder", "level" : "active", "priority" : 1, "title" : "Más tarde" }, "until" : "2026-10-13T07:00:00.000Z" } ],
                "sent" : [ { "counted" : true, "date" : "2026-10-13T06:00:12.345Z", "key" : "find:abc" }, { "broken" : 1 } ] },
  "offeredEvents" : [ "platform:x:e" ], "recentCosts" : [ 4800, 6100 ], "signInNeeded" : { },
  "states" : {
    "auto-k3j2h1g0" : { "baselineDone" : true, "completed" : false, "consecutiveFailures" : 0, "failureNotified" : false, "firedKeys" : [ ], "lastChecked" : "2026-10-13T06:00:05.000Z",
                        "lastOutcome" : "news", "lastRun" : "2026-10-13T06:00:12.345Z", "retries" : 0, "runCount" : 2,
                        "seen" : [ { "due" : "2026-11-03T22:59:00.000Z", "firstSeen" : "2026-10-13T06:00:12.345Z", "identity" : "u:campus.test.edu/courses/7/assignments/3", "kind" : "assignment", "lastSeen" : "2026-10-13T06:00:12.345Z", "title" : "Tarea 3: Integrales" } ] },
    "roto" : "no es un estado"
  },
  "usage" : { "2026-10-12" : 9600, "2026-10-13" : 6100 }
}`

const swiftProactive = `{ "dailyTokenLimit" : 150000, "deadlineReminders" : true, "dockBadge" : true, "enabled" : true, "examOfferDays" : 21, "examOffers" : true, "followups" : true,
  "maxFollowupsPerDay" : 6, "morningBrief" : true, "morningTime" : "07:45", "noticesPerHour" : 2, "notifications" : true, "platformCheck" : true, "platformCheckDays" : [ 2, 3, 4, 5, 6 ],
  "platformCheckTime" : "20:00", "quiet" : { "enabled" : true, "from" : "22:30", "to" : "07:30" }, "reminderHours" : [ 24, 2 ], "style" : "balanced", "weeklyDay" : 1,
  "weeklySummary" : true, "weeklyTime" : "18:00", "activatedAt" : "2026-10-01T08:00:00.000Z" }`

function seed(): AutomationStore {
  const dir = join(root, 'Automations')
  mkdirSync(join(dir, 'runs'), { recursive: true })
  writeFileSync(join(dir, 'automations.json'), swiftAutomations)
  writeFileSync(join(dir, 'inbox.json'), swiftInbox)
  writeFileSync(join(dir, 'state.json'), swiftState)
  writeFileSync(join(dir, 'proactive.json'), swiftProactive)
  writeFileSync(join(dir, 'runs', 'auto-k3j2h1g0.json'), `[ { "automationID" : "auto-k3j2h1g0", "changedItems" : [ ], "created" : [ ], "finished" : "2026-10-13T06:00:12.345Z", "id" : "run-a1b2c3d4",
    "knownCount" : 2, "newItems" : [ { "fresh" : false, "key" : "https://campus.test.edu/courses/7/assignments/3", "kind" : "assignment", "title" : "Tarea 3: Integrales", "due" : "2026-11-03T22:59:00.000Z" } ],
    "notified" : true, "outcome" : "news", "skippedActions" : [ "Pulsar «Entregar tarea»" ], "started" : "2026-10-13T06:00:00.000Z", "summary" : "Hay una tarea nueva.", "title" : "Revisar Canvas",
    "tokens" : 6100, "tokensEstimated" : false, "trigger" : "scheduled" } ]`)
  return new AutomationStore(root)
}

describe('almacén con datos de la app Swift', () => {
  it('lee todo con tolerancia', () => {
    const s = seed()
    const autos = s.automations()
    expect(autos.map((a) => a.id)).toEqual(['auto-k3j2h1g0', 'routine-deadlineReminders']) // el 42 no se lleva a las demás
    expect(autos[0].schedule).toMatchObject({ kind: 'daily', times: ['08:00', '20:30'], weekdays: [2, 3, 4, 5, 6] })
    expect(autos[1]).toMatchObject({ routine: 'deadlineReminders', origin: 'routine', created: '2026-10-01T08:00:00.000Z' })
    const inbox = s.inbox()!
    expect(inbox.map((e) => e.id)).toEqual(['8F2C1A77-0D1E-4F6B-9E2A-3B4C5D6E7F80', 'm2']) // la entrada sin id no vale
    expect(inbox[0].notice).toMatchObject({ priority: 2, level: 'active', group: 'platform.math112', subtitle: 'Asignación nueva · MATH112' })
    expect(inbox[1]).toMatchObject({ kind: 'system', priority: 1, read: true, snoozedUntil: '2026-10-20T06:00:00.000Z' }) // tipo y prioridad desconocidos → por defecto
    const book = s.book()
    expect(Object.keys(book.states)).toEqual(['auto-k3j2h1g0'])
    expect(book.states['auto-k3j2h1g0'].seen[0].identity).toBe('u:campus.test.edu/courses/7/assignments/3')
    expect(book.notices.sent.length).toBe(1)
    expect(book.notices.held[0].notice.title).toBe('Más tarde')
    expect(book.usage['2026-10-12']).toBe(9600)
    const p = s.proactive()!
    expect([p.enabled, p.style, p.morningTime, p.quiet.from]).toEqual([true, 'balanced', '07:45', '22:30'])
    const runs = s.runs('auto-k3j2h1g0')
    expect(runs[0]).toMatchObject({ outcome: 'news', tokens: 6100, skippedActions: ['Pulsar «Entregar tarea»'] })
  })

  it('vuelve a escribir con las mismas claves (ida y vuelta sin pérdidas)', () => {
    const s = seed()
    const autos = s.automations(), inbox = s.inbox()!, book = s.book(), p = s.proactive()!
    s.saveAutomations(autos); s.saveInbox(inbox); s.saveBook(book); s.saveProactive(p)
    const again = new AutomationStore(root)
    expect(again.automations()).toEqual(autos)
    expect(again.inbox()).toEqual(inbox)
    expect(again.book()).toEqual(book)
    expect(again.proactive()).toEqual(p)
    const raw = JSON.parse(readFileSync(join(root, 'Automations', 'automations.json'), 'utf8'))
    expect(raw.version).toBe(1)
    expect(Object.keys(raw.automations[0]).sort()).toEqual(['capabilities', 'created', 'enabled', 'id', 'instruction', 'notify', 'origin', 'platformIDs', 'schedule', 'title', 'untilFound', 'updated'])
    const st = JSON.parse(readFileSync(join(root, 'Automations', 'state.json'), 'utf8'))
    expect(st.states['auto-k3j2h1g0'].seen[0].firstSeen).toBe('2026-10-13T06:00:12.345Z')
    expect(existsSync(join(root, 'Automations', 'automations.json.bak'))).toBe(true) // la versión anterior se guarda
  })

  it('aparta un archivo ilegible y usa la copia anterior', () => {
    const s = seed()
    s.saveAutomations(s.automations()) // deja un .bak bueno
    writeFileSync(join(root, 'Automations', 'automations.json'), '{ no es json')
    expect(s.automations().length).toBe(2)
    expect(existsSync(join(root, 'Automations', 'automations.json.damaged'))).toBe(true)
    writeFileSync(join(root, 'Automations', 'state.json'), '{ roto')
    rmSync(join(root, 'Automations', 'state.json.bak'), { force: true })
    expect(s.book().states).toEqual({})
  })

  it('historial: lo más reciente primero, con tope', () => {
    const s = new AutomationStore(root)
    const base = { automationID: 'a1', trigger: 'scheduled' as const, outcome: 'done' as const, summary: '', newItems: [], changedItems: [], knownCount: 0, tokens: 0, tokensEstimated: false, notified: false, created: [], skippedActions: [] }
    for (let i = 0; i < RUNS_KEPT + 5; i++) s.record({ ...base, id: `r${i}`, title: `r${i}`, started: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString() })
    expect(s.runs('a1').length).toBe(RUNS_KEPT)
    expect(s.runs('a1')[0].title).toBe(`r${RUNS_KEPT + 4}`)
    expect(s.recentRuns(3).map((r) => r.id)).toEqual([`r${RUNS_KEPT + 4}`, `r${RUNS_KEPT + 3}`, `r${RUNS_KEPT + 2}`])
    s.deleteData('a1')
    expect(s.runs('a1')).toEqual([])
    expect(defaultSchedule('beforeEvents').hoursBefore).toEqual([24, 2])
  })
})
