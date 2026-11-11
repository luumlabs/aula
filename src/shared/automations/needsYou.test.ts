// «Te necesita»: qué novedades piden algo del estudiante (van arriba en Novedades y tienen su filtro).
import { describe, expect, it } from 'vitest'
import type { InboxEntry } from './types'
import { matchesFilter, needsYou, visibleEntries } from './inbox'

const entry = (over: Partial<InboxEntry>): InboxEntry => ({
  id: 'e', threadID: 't', kind: 'summary', priority: 0, title: 'x', preview: '', source: 'Rutina', date: '2026-11-10T10:00:00.000Z',
  read: false, archived: false, resurfaced: false, dedupeKey: 'k', notified: false, ...over
})

describe('te necesita', () => {
  it('un problema que Aula no puede arreglar sola, aunque ya lo hayas leído', () => {
    expect(needsYou(entry({ kind: 'problem', read: true }))).toBe(true)
  })
  it('lo urgente y los exámenes sin preparar, mientras no los hayas leído', () => {
    expect(needsYou(entry({ kind: 'reminder', priority: 2 }))).toBe(true)
    expect(needsYou(entry({ kind: 'offer' }))).toBe(true)
    expect(needsYou(entry({ kind: 'reminder', priority: 2, read: true }))).toBe(false)
    expect(needsYou(entry({ kind: 'offer', read: true }))).toBe(false)
  })
  it('un resumen, una novedad de la plataforma o algo archivado, no', () => {
    expect(needsYou(entry({ kind: 'summary' }))).toBe(false)
    expect(needsYou(entry({ kind: 'platform', priority: 1 }))).toBe(false)
    expect(needsYou(entry({ kind: 'problem', archived: true }))).toBe(false)
  })
  it('tiene su filtro', () => {
    const list = [entry({ id: 'a', kind: 'problem' }), entry({ id: 'b', kind: 'summary' }), entry({ id: 'c', kind: 'offer' })]
    expect(matchesFilter(list[1], 'attention')).toBe(false)
    expect(visibleEntries(list, { filter: 'attention', now: Date.parse('2026-11-10T12:00:00Z') }).map((e) => e.id).sort()).toEqual(['a', 'c'])
  })
})
