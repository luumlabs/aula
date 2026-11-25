// El código con la app real (issue #67): un ``` en una lección, en el enunciado y las opciones del simulacro y en una respuesta
// del chat que llega por partes sale en la misma tarjeta que el bloque `code` (lenguaje, colores, «Copiar», números desde 3
// líneas, las líneas largas se desplazan dentro de la tarjeta); el código en línea sigue siendo una pastilla; en una opción la
// tarjeta no lleva botones; en el enunciado la salida no se ve; y en el chat la tarjeta no se rehace ni cambia de nombre
// mientras se escribe. Con AULA_E2E_SHOTS=<carpeta>, deja capturas en claro y en oscuro.
// (Las páginas se leen con cadenas: este proyecto de pruebas no carga los tipos del DOM.)
import { test, expect, type Locator, type Page } from 'playwright/test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { go, homeWithDemoCourse, launch } from './helpers'

const PACK = 'exam-2-math112'
const LONG = 'a comment that is much wider than the reading column, so the line scrolls sideways inside the card'

const FENCE_TEXT = {
  id: 'e2e-code-text', type: 'text',
  md: `A worked example in TypeScript: \`area(r)\` returns $\\pi r^2$ (and water is $\\ce{H2O}$).\n\n\`\`\`ts\nexport function area(r: number): number {\n  // ${LONG}\n  return Math.PI * r ** 2\n}\n\`\`\`\n\nThat is all.`
}
const CODE_BLOCK = { id: 'e2e-code-block', type: 'code', language: 'python', code: 'def squares(n):\n    return [i ** 2 for i in range(n)]\n\nprint(squares(4))', output: '[0, 1, 4, 9]', caption: 'Python 3.12' }

/** El curso de ejemplo con código al principio de la primera lección (en modo lectura). */
function homeWithLesson(): string {
  const home = homeWithDemoCourse()
  const skills = join(home, 'Packs', PACK, 'skills')
  for (const f of readdirSync(skills)) {
    const p = join(skills, f)
    const s = JSON.parse(readFileSync(p, 'utf8'))
    if (s.id === 'reference-angles') s.lesson = [FENCE_TEXT, CODE_BLOCK, ...s.lesson]
    writeFileSync(p, JSON.stringify(s))
  }
  const prog = join(home, 'Packs', PACK, 'progress.json')
  const pr = JSON.parse(readFileSync(prog, 'utf8'))
  pr.settings = { ...(pr.settings ?? {}), lessonMode: 'reading' }
  writeFileSync(prog, JSON.stringify(pr))
  return home
}

/** El curso de ejemplo con todas sus preguntas de código: enunciado con ``` y un bloque con salida; opciones con código. */
function homeWithCodeExam(): string {
  const home = homeWithDemoCourse()
  const skills = join(home, 'Packs', PACK, 'skills')
  for (const f of readdirSync(skills)) {
    const p = join(skills, f)
    const s = JSON.parse(readFileSync(p, 'utf8'))
    s.exercises = (s.exercises ?? []).map((e: { id: string }) => ({
      ...e,
      prompt: [
        { id: `${e.id}-q`, type: 'text', md: `What does this print?\n\n\`\`\`python\nnums = [3, 1, 2]\nnums.sort()\n# ${LONG}\nprint(nums[0])\n\`\`\`` },
        { id: `${e.id}-c`, type: 'code', language: 'python', code: 'print(sorted([3, 1, 2])[0])', output: '1' }
      ],
      answer: {
        kind: 'choice',
        options: [
          { id: 'a', md: '`1`', correct: true, why: 'sort() orders the list in place.' },
          { id: 'b', md: '```python\nprint(None)\n```', correct: false, why: 'sort() returns None, but nums is sorted.' },
          { id: 'c', md: 'It prints 3', correct: false, why: 'The first element after sorting is the smallest.' }
        ]
      },
      hints: [],
      solution: [{ id: `${e.id}-s`, type: 'text', md: '`nums.sort()` sorts in place: `nums[0]` is `1`.' }],
      wrongs: []
    }))
    writeFileSync(p, JSON.stringify(s))
  }
  return home
}

/** Capturas en claro y en oscuro (solo con AULA_E2E_SHOTS). */
async function shots(page: Page, target: Locator, name: string): Promise<void> {
  const dir = process.env.AULA_E2E_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  for (const theme of ['light', 'dark']) {
    await page.evaluate(`window.__aula.setTheme('${theme}')`)
    await page.waitForTimeout(400)
    await target.screenshot({ path: join(dir, `${name}-${theme}.png`) })
  }
  await page.evaluate(`window.__aula.setTheme('light')`)
}

interface Overflow { scroll: number; client: number; cardRight: number; boxRight: number }

/** ¿Desborda de lado lo que se desplaza, sin que la tarjeta se salga de su sitio (`within`, su contenedor)? Todo en el mismo
 *  fotograma: la pregunta del simulacro entra deslizándose. */
async function scrollsInside(card: Locator, within: string): Promise<void> {
  const o = (await card.evaluate((el, sel) => {
    const e = el as unknown as { querySelector(s: string): { scrollWidth: number; clientWidth: number }; getBoundingClientRect(): { right: number }; closest(s: string): { getBoundingClientRect(): { right: number } } }
    const s = e.querySelector('.aula-code-scroll')
    return { scroll: s.scrollWidth, client: s.clientWidth, cardRight: e.getBoundingClientRect().right, boxRight: e.closest(sel).getBoundingClientRect().right }
  }, within)) as Overflow
  expect(o.scroll).toBeGreaterThan(o.client + 20)
  expect(o.cardRight).toBeLessThanOrEqual(o.boxRight + 0.5)
}

/** El fondo de una pastilla de código en línea (no transparente). */
const pillBackground = (code: Locator): Promise<string> => code.evaluate((e) => (globalThis as unknown as { getComputedStyle(x: unknown): { backgroundColor: string } }).getComputedStyle(e).backgroundColor)

test('lección: un ``` y el bloque code salen en la misma tarjeta, con colores, números, «Copiar» y desplazamiento', async () => {
  const { app, page } = await launch({ home: homeWithLesson() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: PACK, mode: 'learn', skill: 'reference-angles' })
  const text = page.locator('[data-block="text"]').filter({ hasText: 'A worked example in TypeScript' }).first()
  const fence = text.locator('.aula-code').first()
  await fence.scrollIntoViewIfNeeded()
  await expect(fence.locator('.aula-code-label')).toHaveText('TypeScript')
  // highlight.js llega aparte y colorea al acercarse a la vista
  await expect.poll(() => fence.locator('.hljs-keyword').count()).toBeGreaterThan(1)
  await expect(fence.locator('.aula-code-gutter')).toHaveAttribute('data-lines', '1\n2\n3\n4')
  await expect(fence.getByRole('button', { name: 'Copy code' })).toBeVisible()
  await expect(fence).toHaveAttribute('role', 'group')
  await scrollsInside(fence, '[data-block]')
  // el código en línea, una pastilla; las fórmulas y \ce, con KaTeX
  const pill = text.locator('.aula-rich :not(pre) > code').first()
  await expect(pill).toHaveText('area(r)')
  expect(await pillBackground(pill)).not.toBe('rgba(0, 0, 0, 0)')
  expect(await text.locator('.katex').count()).toBeGreaterThanOrEqual(2)
  await expect(text.locator('.katex-error')).toHaveCount(0)

  // el bloque `code`: la misma tarjeta, con su salida; «Copiar» copia el código (sin tocar el portapapeles del sistema)
  const block = page.locator('[data-block="code"] .aula-code').first()
  await expect(block.locator('.aula-code-label')).toHaveText('Python')
  await expect(block.locator('.aula-code-output')).toContainText('[0, 1, 4, 9]')
  await expect.poll(() => block.locator('.hljs-keyword').count()).toBeGreaterThan(0)
  await page.evaluate(`(() => { window.__copied = []; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (t) => { window.__copied.push(t) } }) })()`)
  await block.getByRole('button', { name: 'Copy code' }).click()
  await expect(block.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate('window.__copied')).toEqual([CODE_BLOCK.code])
  // con el foco en «Copiar» o en la zona desplazable, Espacio y flechas no cambian de página de la lección
  await block.getByRole('button', { name: 'Copy code' }).focus()
  await page.keyboard.press('Space')
  await expect(fence).toBeVisible()
  await fence.locator('.aula-code-scroll').focus()
  await page.keyboard.press('ArrowRight')
  await expect(fence).toBeVisible()

  await shots(page, text, 'lesson-fence')
  await shots(page, page.locator('[data-block="code"]').first(), 'lesson-code-block')
  expect(errors).toEqual([])
  await app.close()
})

test('simulacro: código en el enunciado y en las opciones; en una opción, sin botones; la salida del enunciado no se ve', async () => {
  const { app, page } = await launch({ home: homeWithCodeExam() })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'study', id: PACK, mode: 'exam' })
  await page.getByRole('button', { name: 'Start the mock exam' }).first().click()
  const question = page.locator('[data-block="text"]').filter({ hasText: 'What does this print?' }).first()
  const fence = question.locator('.aula-code').first()
  await expect(fence.locator('.aula-code-label')).toHaveText('Python')
  // `print` y el comentario, coloreados (no hay palabras clave en este trozo)
  await expect.poll(() => fence.locator('.hljs-built_in, .hljs-comment').count()).toBeGreaterThan(1)
  await scrollsInside(fence, '[data-block]')
  // el bloque con salida del enunciado: la tarjeta sí, su salida no (sería la respuesta)
  const block = page.locator('[data-block="code"] .aula-code').first()
  await expect(block).toBeVisible()
  await expect(page.locator('.aula-code-output')).toHaveCount(0)
  // la opción con código: la tarjeta sin cabecera (no da pistas de lenguaje) ni botones; la de `1`, una pastilla
  const option = page.locator('[role="radio"]').filter({ has: page.locator('.aula-code') }).first()
  await expect(option.locator('.aula-code-embedded')).toBeVisible()
  await expect(option.locator('.aula-code-embedded .aula-code-head')).toHaveCount(0)
  await expect(page.locator('[role="radio"] button')).toHaveCount(0)
  await expect.poll(() => option.locator('.hljs-built_in').count()).toBeGreaterThan(0)
  const pill = page.locator('[role="radio"]').filter({ hasText: '1' }).locator('code').first()
  await expect(pill).toHaveText('1')
  expect(await pillBackground(pill)).not.toBe('rgba(0, 0, 0, 0)')
  // pulsar en la tarjeta elige la opción
  await option.locator('.aula-code').click()
  await expect(option).toHaveAttribute('aria-checked', 'true')
  await shots(page, page.locator('main').first(), 'exam')
  expect(errors).toEqual([])
  await app.close()
})

test('chat: el código llega por partes sin rehacerse ni cambiar de nombre, y queda coloreado', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch({ home: homeWithDemoCourse(), env: { AULA_FAKE_AI_DELAY_MS: '45' } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'chat' })
  // un vigía: cada tarjeta que entra o sale y cada nombre que llega a tener su cabecera
  await page.evaluate(`(() => {
    const w = window.__codeWatch = { added: 0, removed: 0, labels: [], raw: false }
    const cards = (n) => n.nodeType === 1 ? (n.matches('.aula-code') ? [n] : [...n.querySelectorAll('.aula-code')]) : []
    new MutationObserver((list) => {
      for (const m of list) {
        for (const n of m.addedNodes) w.added += cards(n).length
        for (const n of m.removedNodes) w.removed += cards(n).length
      }
      for (const l of document.querySelectorAll('[data-role="assistant"] .aula-code-label')) if (!w.labels.includes(l.textContent)) w.labels.push(l.textContent)
      for (const c of document.querySelectorAll('[data-role="assistant"] .aula-code-text')) if (c.textContent.includes('\`\`')) w.raw = true
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })()`)
  const box = page.getByRole('textbox', { name: 'Message Aula…' })
  await box.fill('Show me some Python code')
  await box.press('Enter')
  const reply = page.locator('[data-role="assistant"]').last()
  await expect(reply.locator('.aula-code').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-streaming="true"]')).toHaveCount(0, { timeout: 60_000 })
  await page.waitForTimeout(300)
  const watch = (await page.evaluate('window.__codeWatch')) as { added: number; removed: number; labels: string[]; raw: boolean }
  expect(watch.removed).toBe(0)
  expect(watch.added).toBe(3)
  expect(watch.labels.sort()).toEqual(['Bash', 'Output', 'Python'])
  expect(watch.raw).toBe(false)
  const cards = reply.locator('.aula-code')
  await expect(cards).toHaveCount(3)
  const py = cards.nth(0)
  await expect(py.locator('.aula-code-gutter')).toHaveAttribute('data-lines', '1\n2\n3\n4\n5\n6')
  await expect.poll(() => py.locator('.hljs-keyword').count()).toBeGreaterThan(1)
  await expect(cards.nth(2).locator('.aula-code-text')).toContainText('"$HOME/squares.txt"')
  await scrollsInside(py, '[data-role="assistant"]')
  await expect(reply.locator('.aula-rich :not(pre) > code').first()).toHaveText('squares(n)')
  await expect(reply.locator('.katex').first()).toBeVisible()
  await shots(page, reply, 'chat')
  expect(errors).toEqual([])
  await app.close()
})

test('tarjetas a 375 px: una línea larga de código se desplaza dentro de la cara sin salirse ni recortarse', async () => {
  const home = homeWithDemoCourse()
  const skills = join(home, 'Packs', PACK, 'skills')
  for (const f of readdirSync(skills)) {
    const p = join(skills, f)
    const s = JSON.parse(readFileSync(p, 'utf8'))
    if (Array.isArray(s.cards) && s.cards.length > 0) {
      s.cards = s.cards.map((c: Record<string, unknown>) => ({
        ...c,
        kind: 'basic',
        front: `What does this print?\n\n\`\`\`python\nprint(sorted(nums)[0])  # ${LONG}\n\`\`\``,
        back: '`1`'
      }))
      writeFileSync(p, JSON.stringify(s))
    }
  }
  const { app, page } = await launch({ home })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 375, height: 800 })
  await go(page, { name: 'study', id: PACK, mode: 'cards' })
  const card = page.locator('[role="button"][aria-pressed="false"] .aula-code').first()
  await expect(card).toBeVisible()
  await expect(card.locator('.aula-code-head')).toHaveCount(0)
  await scrollsInside(card, '[role="button"][aria-pressed]')
  expect(errors).toEqual([])
  await app.close()
})
