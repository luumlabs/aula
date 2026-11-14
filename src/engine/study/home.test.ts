// Inicio con un curso que aún se está creando: lo que ya está listo entra en el plan de hoy (también si la creación se paró
// por un límite); lo que se está escribiendo, no. Con el curso de tests/fixtures en el formato real del disco.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJSON } from '@engine/base/json'
import { decodePack, decodeSkill, emptyProgress, type ContentStatus, type Pack, type Skill } from '@shared/schema'
import { buildHomeSummary } from './home'

const DIR = join(__dirname, '../../../tests/fixtures/demo-course/exam-2-math112')
const now = new Date(2026, 10, 13, 10)
const settings = { name: 'Ana', aiReady: true, dailyMinutes: 600, planLimit: 20, lang: 'es' as const }

function fixture(): [Pack, Skill[]] {
  const pack = decodePack(parseJSON(readFileSync(join(DIR, 'pack.json'), 'utf8')))
  // sin fecha de examen: el plan no depende del día en que se pasen las pruebas
  delete pack.exam
  const skills = pack.skills.map((r) => decodeSkill(parseJSON(readFileSync(join(DIR, 'skills', `${r.id}.json`), 'utf8'))))
  return [pack, skills]
}

/** El curso a medio crear: los `ready` primeros temas listos, el siguiente escribiéndose y el resto en cola. */
function building(ready: number): [Pack, Skill[]] {
  const [pack, skills] = fixture()
  const state = (i: number): ContentStatus => (i < ready ? 'ready' : i === ready ? 'draft' : 'empty')
  const refs = pack.skills.map((r, i) => {
    const status = state(i)
    return status === 'empty' ? { ...r, status, counts: { lessonBlocks: 0, exercises: 0, templates: 0, cards: 0, decks: 0 } } : { ...r, status }
  })
  const written = skills.map((s, i) => (state(i) === 'empty' ? { ...s, lesson: [], exercises: [], templates: [], cards: [] } : s))
  return [{ ...pack, skills: refs }, written]
}

const topics = (items: { skillId?: string }[]): string[] => items.map((i) => i.skillId).filter((x): x is string => !!x)

describe('Inicio con un curso que se está creando', () => {
  it('con temas listos, el plan de hoy los propone (solo esos, no el que se está escribiendo)', () => {
    const [pack, skills] = building(2)
    const home = buildHomeSummary([{ pack, skills, generating: true }], { [pack.id]: emptyProgress() }, [], settings, now)
    const ids = topics(home.plan)
    expect(ids.length).toBeGreaterThan(0)
    const ready = new Set(pack.skills.slice(0, 2).map((r) => r.id))
    expect(ids.every((id) => ready.has(id))).toBe(true)
    // el que se está escribiendo ya tiene algo escrito, pero aún no está listo
    expect(home.courses[0]).toMatchObject({ generating: true, readyCount: 2, writtenCount: 3, skillCount: pack.skills.length })
  })

  it('lo que propone dice lo mismo que con el curso terminado: los temas que faltan siguen contando para los pesos', () => {
    const [pack, skills] = building(2)
    const home = buildHomeSummary([{ pack, skills, generating: true }], { [pack.id]: emptyProgress() }, [], settings, now)
    const [fullPack, fullSkills] = fixture()
    const done = buildHomeSummary([{ pack: fullPack, skills: fullSkills }], { [fullPack.id]: emptyProgress() }, [], settings, now)
    const detail = (items: { skillId?: string; detail: string }[], id: string): string | undefined => items.find((i) => i.skillId === id)?.detail
    // con solo los dos listos en la cuenta, «Vale 10 puntos» pasaba a «Pesa el 50 % del examen»
    expect(detail(home.plan, 'reference-angles')).toMatch(/^Vale 10 puntos/)
    expect(detail(home.plan, 'reference-angles')).toBe(detail(done.plan, 'reference-angles'))
  })

  it('sin ningún tema listo no hay plan (no se manda a un tema vacío)', () => {
    const [pack, skills] = building(0)
    const home = buildHomeSummary([{ pack, skills, generating: true }], { [pack.id]: emptyProgress() }, [], settings, now)
    expect(home.plan).toEqual([])
    expect(home.courses[0].readyCount).toBe(0)
  })

  it('un curso terminado sigue igual: todos sus temas cuentan', () => {
    const [pack, skills] = fixture()
    const home = buildHomeSummary([{ pack, skills }], { [pack.id]: emptyProgress() }, [], settings, now)
    expect(home.plan.length).toBeGreaterThan(0)
    expect(home.courses[0].readyCount).toBe(pack.skills.length)
    expect(home.courses[0].writtenCount).toBe(pack.skills.length)
  })
})
