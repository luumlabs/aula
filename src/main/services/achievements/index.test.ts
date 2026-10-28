// Logros en disco: la primera vez se apuntan en silencio; después solo se celebra lo nuevo, una vez.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { decodeProgress, makePack } from '@shared/schema'
import { setDataRoot } from '../paths'
import { getLibrary } from '../store'
import { checkAchievements, listAchievements } from './index'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'aula-logros-'))
  setDataRoot(root)
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const now = new Date(2026, 9, 26, 18)
const days = (n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(now)
  d.setDate(d.getDate() - i)
  return { day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, minutes: 15, attempts: 5, correct: 4 }
})

describe('logros guardados', () => {
  it('apunta en silencio lo ya conseguido y celebra solo lo nuevo', () => {
    const store = getLibrary().createPack(makePack({ id: 'mio', title: 'Mi curso' }))
    store.saveProgress(decodeProgress({ days: days(3) }))
    expect(checkAchievements(now)).toEqual([])
    const saved = JSON.parse(readFileSync(join(root, 'achievements.json'), 'utf8')) as { earned: Record<string, string> }
    expect(Object.keys(saved.earned)).toEqual(expect.arrayContaining(['firstAnswer', 'creator', 'streak3']))
    // una semana seguida: llega la racha de 7 (y solo se celebra una vez)
    store.saveProgress(decodeProgress({ days: days(7) }))
    expect(checkAchievements(now)).toEqual(['streak7', 'hour1'])
    expect(checkAchievements(now)).toEqual([])
    const shelf = listAchievements(now)
    expect(shelf.find((a) => a.id === 'streak7')).toMatchObject({ earned: true, earnedAt: now.toISOString() })
    expect(shelf.find((a) => a.id === 'streak30')).toMatchObject({ earned: false, value: 7 })
  })
})
