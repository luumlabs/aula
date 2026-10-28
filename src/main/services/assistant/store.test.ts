// Conversaciones en disco: una conversación dañada o a medias se lee de su versión anterior, borrar quita también la copia y
// las copias ocultas nunca aparecen como conversaciones.
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupPath } from '../fs'
import { newMessage, newThread } from './models'
import { AssistantStore } from './store'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'aula-chat-store-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('conversaciones en disco', () => {
  it('una conversación dañada se lee de su versión anterior y borrar quita las dos', () => {
    const store = new AssistantStore(join(root, 'Assistant'))
    const t = newThread({ id: 'c1', title: 'Repaso de química' })
    t.messages.push(newMessage('user', 'Hola'))
    store.save(t)
    t.messages.push(newMessage('assistant', '¡Hola! ¿Qué repasamos?'))
    store.save(t)
    writeFileSync(store.path('c1'), '{"id":"c1","messages":[{"ro') // a medias
    const back = store.thread('c1')
    expect(back?.title).toBe('Repaso de química')
    expect(back?.messages.map((m) => m.text)).toEqual(['Hola'])
    // la lista ve una sola conversación (ni la copia oculta ni la del dañado cuentan)
    expect(store.summaries().map((x) => x.id)).toEqual(['c1'])
    expect(store.summaries().map((x) => x.id)).toEqual(['c1'])
    // una sola copia del dañado, por muchas veces que se lea
    expect(readdirSync(store.threadsDirectory).filter((n) => n.includes('.damaged-'))).toHaveLength(1)
    store.delete('c1')
    expect(existsSync(store.path('c1'))).toBe(false)
    expect(existsSync(backupPath(store.path('c1')))).toBe(false)
    expect(store.thread('c1')).toBeUndefined()
  })
})
