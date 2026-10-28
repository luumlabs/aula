// El progreso de ejemplo (solo desarrollo) se genera con el motor real y llena Inicio y Estadísticas.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { statsData } from '@engine/study'
import { setDataRoot } from '@main/services/paths'
import { getLibrary } from '@main/services/store'
import { seedDemoProgress } from './seed'

const fixture = fileURLToPath(new URL('../../../resources/demo-course', import.meta.url))
let root = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'aula-seed-'))
  cpSync(fixture, root, { recursive: true })
  setDataRoot(root)
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('seedDemoProgress', () => {
  it('simula semanas de estudio y las estadísticas lo reflejan', () => {
    const now = new Date()
    seedDemoProgress(now)
    const store = getLibrary().openPack('exam-2-math112')!
    const progress = store.loadProgress()
    expect(progress.attempts.length).toBeGreaterThan(50)
    const data = statsData([{ pack: store.loadPack(), skills: store.loadSkills(), progress }], now)
    const c = data.courses[0]
    expect(c.days.filter((d) => d.minutes > 0).length).toBeGreaterThan(10)
    expect(c.topics.length).toBeGreaterThan(0)
    // cada semana con intentos tiene temas que ya no están «sin ver»
    const firstAttempt = progress.attempts.map((a) => a.date).sort()[0].slice(0, 10)
    const after = c.levels.filter((p) => p.date >= firstAttempt)
    for (const p of after.slice(1)) expect(p.counts.unseen).toBeLessThan(c.skillCount)
    // el examen queda en unos días, con su título de siempre
    const exam = store.loadPack().exam!
    expect(exam.title).toBe('Exam #2 — Trigonometry')
    const days = (Date.parse(exam.date!) - now.getTime()) / 86_400_000
    expect(days).toBeGreaterThan(10)
    expect(days).toBeLessThan(25)
    // y no vuelve a sembrar si ya hay progreso
    const n = progress.attempts.length
    seedDemoProgress(now)
    expect(store.loadProgress().attempts.length).toBe(n)
  })
})
