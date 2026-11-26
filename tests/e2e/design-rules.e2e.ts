// Las reglas del diseño, en la app de verdad (demo en inglés): en cada pantalla, como mucho un botón ladrillo a la vista; el
// pigmento solo para el examen (una muestra como mucho, y solo en el curso o en el simulacro); sin la gota flotante de Aula; y
// nunca un cero enseñado como dato («0 min», «0 flashcards»…), tampoco tras un ejercicio de un momento. Las mismas pantallas
// que `english.e2e.ts`. (Las páginas se leen con cadenas: este proyecto de pruebas no carga los tipos del DOM.)
import { test, expect, type Page } from 'playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { go, homeWithDemoCourse, launch } from './helpers'

const C = 'exam-2-math112'
const SCREENS: Array<[string, Record<string, unknown>]> = [
  ['home', { name: 'home' }],
  ['courses', { name: 'courses' }],
  ['course', { name: 'course', id: C }],
  ['course-learn', { name: 'course', id: C, tab: 'learn' }],
  ['course-review', { name: 'course', id: C, tab: 'review' }],
  ['course-exam', { name: 'course', id: C, tab: 'exam' }],
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

/** Un cero enseñado como dato. */
const ZERO = /(^|\s)0 (min|minutes|annotations|days|flashcards|mistakes)\b/

interface Seen {
  primary: string[]
  pigments: number
  orbs: number
  zeros: string[]
}

/** Lo que se ve de la pantalla de delante (sin la que se está yendo) y del marco. */
async function look(page: Page): Promise<Seen> {
  // la pantalla anterior se queda un momento mientras entra la nueva: se espera a que se vaya
  await page.waitForFunction(`document.querySelectorAll('[data-screen][data-active="false"]').length === 0`, null, { timeout: 5_000 }).catch(() => undefined)
  return page.evaluate(`(() => {
    const shown = (el) => !el.closest('[data-active="false"]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
    const primary = [...document.querySelectorAll('[data-variant="primary"]')].filter(shown).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 60))
    const pigments = [...document.querySelectorAll('.pigment-mark')].filter(shown).length
    const orbs = document.querySelectorAll('.aula-orb').length
    const zeros = document.body.innerText.split('\\n').map((l) => l.trim()).filter((l) => ${ZERO}.test(l))
    return { primary, pigments, orbs, zeros }
  })()`) as Promise<Seen>
}

test('en cada pantalla: un botón ladrillo como mucho, pigmento solo para el examen, sin la gota y sin ceros', async () => {
  test.setTimeout(300_000)
  const home = homeWithDemoCourse()
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en', name: 'Maya' } }))
  const { app, page } = await launch({ home, env: { AULA_DEMO: '1', AULA_SEED: 'demo', AULA_FAKE_AI_DELAY_MS: '5', AULA_FAKE_TEAM_DELAY_MS: '20' } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const found: string[] = []
  for (const [name, route] of SCREENS) {
    await go(page, route)
    await page.waitForTimeout(900)
    const seen = await look(page)
    if (seen.primary.length > 1) found.push(`${name}: ${seen.primary.length} botones ladrillo (${seen.primary.join(' | ')})`)
    // el pigmento es el examen: la tarjeta del Resumen del curso o la portada del simulacro
    const pigmentHere = name === 'course' || name === 'study-exam'
    if (seen.pigments > (pigmentHere ? 1 : 0)) found.push(`${name}: ${seen.pigments} muestras de pigmento`)
    if (seen.orbs) found.push(`${name}: la gota de Aula`)
    for (const z of seen.zeros) found.push(`${name}: un cero, «${z.slice(0, 80)}»`)
  }
  // un ejercicio respondido en un momento (menos de un minuto de estudio): Hoy y Estadísticas siguen sin enseñar «0 min»
  await go(page, { name: 'study', id: C, mode: 'practice' })
  await page.waitForTimeout(900)
  // el primer ejercicio sale al azar (la semilla es la hora) y puede ser de unir, de ordenar…: «No lo sé» vale para todos y
  // también cuenta como intento
  await page.getByRole('button', { name: /^I don’t know/ }).click()
  await expect(page.getByRole('button', { name: /^(Try again|Continue|Next)/ }).first()).toBeVisible()
  // el ratón, fuera de la cuadrícula de la constancia: su línea de abajo dice entonces el día de hoy
  await page.mouse.move(130, 640)
  for (const [name, route] of [['home', { name: 'home' }], ['stats', { name: 'stats' }]] as const) {
    await go(page, route)
    await page.waitForTimeout(900)
    for (const z of (await look(page)).zeros) found.push(`${name} (tras un ejercicio): un cero, «${z.slice(0, 80)}»`)
  }
  expect(found).toEqual([])
  expect(errors).toEqual([])
  await app.close()
})
