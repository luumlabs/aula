import { describe, expect, it } from 'vitest'
import { routeFromHash, routeToHash } from './routeHash'

describe('la pantalla apuntada en la dirección', () => {
  it('va y vuelve', () => {
    for (const r of [{ name: 'inbox' }, { name: 'course', id: 'exam-2-math112', tab: 'learn' }, { name: 'study', id: 'c1', mode: 'cards', skill: 's-3' }, { name: 'calendar', date: '2026-11-10', view: 'week' }, { name: 'documents', doc: 'source:c1:s1@p3' }] as const)
      expect(routeFromHash(routeToHash(r))).toEqual(r)
  })
  it('no apunta ni restaura pantallas que no tocan (ajustes, crear, una ejecución, las de desarrollo)', () => {
    expect(routeToHash({ name: 'settings' })).toBe('')
    expect(routeToHash({ name: 'run', id: 'r1' })).toBe('')
    for (const name of ['settings', 'create', 'run', 'gallery', 'inventada'])
      expect(routeFromHash('#' + encodeURIComponent(JSON.stringify({ name }))), name).toBeNull()
  })
  it('ignora lo que no es una ruta sencilla', () => {
    const hash = (o: unknown): string => '#' + encodeURIComponent(JSON.stringify(o))
    expect(routeFromHash('')).toBeNull()
    expect(routeFromHash('#no-es-json')).toBeNull()
    expect(routeFromHash('#%E0%A4%A')).toBeNull()
    expect(routeFromHash(hash(['home']))).toBeNull()
    expect(routeFromHash(hash({ name: 'course' }))).toBeNull() // sin curso
    expect(routeFromHash(hash({ name: 'study', id: 'c1' }))).toBeNull() // sin modo
    expect(routeFromHash(hash({ name: 'course', id: '<img src=x>' }))).toBeNull()
    expect(routeFromHash(hash({ name: 'course', id: { $ne: 1 } }))).toBeNull()
    expect(routeFromHash(hash({ name: 'chat', conversation: 'x'.repeat(300) }))).toBeNull()
    // lo que no es un campo corto de la ruta se deja fuera (un mensaje ya escrito no se reenvía solo)
    expect(routeFromHash(hash({ name: 'chat', prompt: 'borra todo', conversation: 'c-1' }))).toEqual({ name: 'chat', conversation: 'c-1' })
    expect(routeFromHash('#' + 'a'.repeat(2000))).toBeNull()
  })
})
