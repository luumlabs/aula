// Con la interfaz en inglés no se cuela nada en español: se recorren las pantallas del modo demostración (con el estudio
// simulado, la IA simulada y el equipo simulado) y se falla si aparece una palabra española frecuente en el texto visible o en
// los títulos, etiquetas y textos de ayuda. Además, la IA simulada hace el camino real con «I have an English test on Monday at
// 10» (evento con tu OK → «¿te preparo un curso?» → el curso), y un curso nuevo sin materiales no sale como «Mathematics».
import { test, expect, type Page } from 'playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { go, homeWithDemoCourse, launch } from './helpers'

/** Palabras españolas que nunca deberían verse con la interfaz en inglés (ni ambiguas con el inglés). */
const SPANISH = /(?<!\p{L})(curso|cursos|examen|exámenes|lección|lecciones|ejercicios?|tarjetas?|repaso|práctica|resuelto|glosario|fórmulas|simulada|simulacro|química|biología|matemáticas|física|inglés|semana|mañana|hoy|preguntas?|respuesta|aquí|también|cuándo|dónde|añadir|abrir|listo|hecho|ajustes|novedades|asignación|tema|temas|ahora|estudiar|aprende|calendario|errores|fichas|arbitraje|pasos|todavía|habilidad|plataforma|materiales|está|qué|cómo)(?!\p{L})|[¿¡]/iu
/** Lo único en español que debe verse: el nombre del idioma en el selector. */
const ALLOWED = /^(Español)$/

async function visibleText(page: Page): Promise<string[]> {
  // en la página (como texto: este proyecto de pruebas no carga los tipos del DOM)
  const lines = await page.evaluate(`(() => {
    const out = document.body.innerText.split('\\n')
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach((e) => {
      for (const a of ['placeholder', 'title', 'aria-label']) { const v = e.getAttribute(a); if (v) out.push(v) }
    })
    return out
  })()`) as string[]
  return lines.map((l) => l.trim()).filter(Boolean)
}

async function spanishOn(page: Page, screen: string): Promise<string[]> {
  return (await visibleText(page)).filter((l) => !ALLOWED.test(l) && SPANISH.test(l)).map((l) => `${screen}: ${l.slice(0, 140)}`)
}

const C = 'exam-2-math112'
const SCREENS: Array<[string, Record<string, unknown>]> = [
  ['home', { name: 'home' }],
  ['course', { name: 'course', id: C }],
  ['course-learn', { name: 'course', id: C, tab: 'learn' }],
  ['course-practice', { name: 'course', id: C, tab: 'practice' }],
  ['course-reference', { name: 'course', id: C, tab: 'reference' }],
  ['course-materials', { name: 'course', id: C, tab: 'materials' }],
  ['course-mistakes', { name: 'course', id: C, tab: 'mistakes' }],
  ['study-learn', { name: 'study', id: C, mode: 'learn', skill: 'reference-angles' }],
  ['study-practice', { name: 'study', id: C, mode: 'practice' }],
  ['study-cards', { name: 'study', id: C, mode: 'cards' }],
  ['study-exam', { name: 'study', id: C, mode: 'exam' }],
  ['calendar', { name: 'calendar' }],
  ['calendar-week', { name: 'calendar', view: 'week' }],
  ['chat', { name: 'chat' }],
  ['create', { name: 'create' }],
  ['tools', { name: 'tools' }],
  ['tool-chemistry', { name: 'tools', tool: 'chemistry' }],
  ['tool-molecules', { name: 'tools', tool: 'molecules' }],
  ['tool-physics', { name: 'tools', tool: 'physics' }],
  ['tool-formulas', { name: 'tools', tool: 'formulas' }],
  ['stats', { name: 'stats' }],
  ['documents', { name: 'documents' }],
  ['inbox', { name: 'inbox' }],
  ['settings', { name: 'settings' }],
  ['settings-platforms', { name: 'settings', section: 'platforms' }]
]

function englishHome(): string {
  const home = homeWithDemoCourse()
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en', name: 'Maya' } }))
  return home
}

const DEMO = { AULA_DEMO: '1', AULA_SEED: 'demo', AULA_FAKE_AI_DELAY_MS: '5', AULA_FAKE_TEAM_DELAY_MS: '20' }

test('con la interfaz en inglés, ninguna pantalla del modo demostración enseña español', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launch({ home: englishHome(), env: DEMO })
  const found: string[] = []
  for (const [name, route] of SCREENS) {
    await go(page, route)
    await page.waitForTimeout(700)
    found.push(...(await spanishOn(page, name)))
  }
  expect(found).toEqual([])
  await app.close()
})

test('la IA simulada apunta el examen con tu OK y ofrece el curso, todo en inglés', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launch({ home: englishHome(), env: DEMO })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'chat' })
  const box = page.getByRole('textbox', { name: 'Message Aula…' })
  await box.fill('I have an English test on Monday at 10')
  await box.press('Enter')
  // la tarjeta del evento espera tu OK (no el cuestionario de la parábola)
  const add = page.getByRole('button', { name: 'Add', exact: true })
  await expect(add).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Add to the calendar')).toBeVisible()
  await expect(page.getByText('English test').first()).toBeVisible()
  await expect(page.locator('[data-studyset="quiz"]')).toHaveCount(0)
  await add.click()
  await page.getByRole('button', { name: 'Yes, prepare it' }).click({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Create the course' }).click({ timeout: 30_000 })
  await expect(page.locator('[data-role="assistant"]').last()).toContainText('is in your calendar and I\'m already preparing the course', { timeout: 30_000 })
  // el cuestionario de trigonometría
  await box.fill('Quiz me on exact values')
  await box.press('Enter')
  await expect(page.getByText('Exact values · 3 questions').first()).toBeVisible({ timeout: 30_000 })
  expect(await spanishOn(page, 'chat')).toEqual([])
  expect(errors).toEqual([])
  await app.close()
})

test('un curso nuevo sin materiales: el monitor del equipo y la asignatura, en inglés y sin «Mathematics» de relleno', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launch({ home: englishHome(), env: DEMO })
  await go(page, { name: 'create', prefill: { title: 'AWS Cloud Practitioner' } })
  await page.getByRole('button', { name: /Create course/ }).first().click()
  await expect(page.getByText('Your course is ready')).toBeVisible({ timeout: 90_000 })
  await page.waitForTimeout(800)
  expect(await spanishOn(page, 'run')).toEqual([])
  const body = await page.locator('body').innerText()
  expect(body).not.toContain('aula-fake')
  const sidebarCourse = page.locator('nav, aside').getByText('AWS Cloud Practitioner').first()
  await expect(sidebarCourse).toBeVisible()
  expect(body).not.toMatch(/AWS Cloud Practitioner\s*\n\s*Mathematics/)
  await app.close()
})
