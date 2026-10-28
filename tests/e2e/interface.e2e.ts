// Interfaz (auditoría final A4/A5, FIX2-UI): el curso de ejemplo se marca, las fórmulas van en el idioma de la interfaz, el
// menú «Explore» no se corta, las tarjetas se abren con el teclado, «Inbox» no se confunde con las actualizaciones, la píldora
// de las pestañas va debajo de las etiquetas, el monitor no se solapa al terminar, el foco no sale de las capas modales, la
// gota no tapa controles, el movimiento reducido no deja la pantalla vacía, el texto al 130 % no se monta y el lector PDF no
// retiene memoria al entrar y salir. (Las páginas se leen con cadenas: este proyecto de pruebas no carga los tipos del DOM.)
import { test, expect, type Page } from 'playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { go, homeWithDemoCourse, launch } from './helpers'

const C = 'exam-2-math112'

function home(general: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, withCourse = true): string {
  const h = withCourse ? homeWithDemoCourse() : mkdtempSync(join(tmpdir(), 'aula-e2e-'))
  writeFileSync(join(h, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en', name: 'Maya', ...general }, ...extra }))
  return h
}

const js = <T>(page: Page, code: string): Promise<T> => page.evaluate(code) as Promise<T>

test('A4-P1-1 · el curso de ejemplo se marca y su examen no cuenta en el resumen del calendario', async () => {
  // primer arranque en inglés con la biblioteca vacía: Aula instala sus cursos de ejemplo
  const { app, page } = await launch({ home: home({}, {}, false) })
  const nav = page.locator('nav[aria-label="Aula"]')
  await expect(nav.getByText('Exam #2 · MATH 101')).toBeVisible({ timeout: 15_000 })
  await expect(nav.getByText('Example course').first()).toBeVisible()
  await expect(nav.getByText(/Exam in \d+ days/)).toHaveCount(0)
  await expect(page.locator('main').getByText('Example', { exact: true }).first()).toBeVisible()
  await go(page, { name: 'calendar' })
  await expect(page.getByText(/No exams in the next two weeks/)).toBeVisible()
  await go(page, { name: 'course', id: C })
  await expect(page.locator('main').getByText('Example', { exact: true }).first()).toBeVisible()
  await app.close()
})

test('A4-P1-2 · las fórmulas en inglés no llevan palabras en español', async () => {
  const { app, page } = await launch({ home: home() })
  await go(page, { name: 'tools', tool: 'formulas' })
  await expect(page.getByText('Classical probability')).toBeVisible()
  // KaTeX pone los espacios de \\text{} como espacios duros
  const text = (await js<string>(page, 'document.querySelector("main").textContent')).replace(/\u00a0/g, ' ')
  expect(text).toContain('favorable outcomes')
  for (const w of ['casos favorables', 'soluto', 'disolución', 'teórico', 'pila']) expect(text, w).not.toContain(w)
  await app.close()
})

test('A4-P1-3 · el menú «Explore» de la lección enseña sus tres modos sin desplazarse por dentro', async () => {
  for (const size of [{ width: 1440, height: 900 }, { width: 1000, height: 680 }]) {
    const { app, page } = await launch({ home: home() })
    await page.setViewportSize(size)
    await go(page, { name: 'study', id: C, mode: 'learn', skill: 'reference-angles' })
    await page.getByRole('button', { name: /^(Step by step|Explore|Just read)$/ }).first().click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveCount(3)
    const fit = await js<{ scroll: number; client: number; bottom: number; vh: number }>(page, `(() => { const m = document.querySelector('[role="menu"]'); const r = m.getBoundingClientRect(); return { scroll: m.scrollHeight, client: m.clientHeight, bottom: r.bottom, vh: innerHeight } })()`)
    expect(fit.scroll, JSON.stringify(size)).toBeLessThanOrEqual(fit.client + 1)
    expect(fit.bottom).toBeLessThanOrEqual(fit.vh)
    // Esc cierra el menú y nada más: la lección sigue abierta
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await page.waitForTimeout(500)
    await expect(page.locator('[data-screen="study"][data-active="true"]')).toHaveCount(1)
    await app.close()
  }
})

test('A4-P1-4 · una tarjeta que se pulsa es un botón y se abre con Intro', async () => {
  const { app, page } = await launch({ home: home() })
  await go(page, { name: 'tools' })
  const card = page.getByRole('button', { name: /Calculator/ }).first()
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Sine' }).first()).toBeVisible()
  // y con Espacio, desde Hoy, una tarjeta del curso (sale de Hoy)
  await go(page, { name: 'home' })
  const course = page.locator('main [role="button"][tabindex="0"]').filter({ hasText: 'Exam #2 · MATH 101' }).first()
  await course.focus()
  await page.keyboard.press('Space')
  await expect(page.locator('[data-screen="home"][data-active="true"]')).toHaveCount(0)
  await app.close()
})

test('A4-P1-5 · en inglés la bandeja se llama «Inbox» (no «Updates», que son las actualizaciones)', async () => {
  const { app, page } = await launch({ home: home() })
  const nav = page.locator('nav[aria-label="Aula"]')
  await expect(nav.getByRole('button', { name: /^Inbox/ })).toBeVisible()
  await expect(nav.getByRole('button', { name: /^Updates/ })).toHaveCount(0)
  await go(page, { name: 'inbox' })
  await expect(page.getByRole('tab', { name: /^Inbox/ })).toBeVisible()
  await app.close()
})

test('A4-P1-6 · la píldora de las pestañas es una sola, va antes (debajo) de las etiquetas y acaba en la elegida', async () => {
  const { app, page } = await launch({ home: home() })
  await go(page, { name: 'course', id: C })
  await page.getByRole('tab', { name: 'Practice', exact: true }).click()
  await page.waitForTimeout(600)
  const r = await js<{ pills: number; first: boolean; dx: number; dw: number }>(page, `(() => {
    const list = [...document.querySelectorAll('main [role="tablist"]')].find((l) => l.querySelector('[data-tab-pill]'))
    const pill = list.querySelector('[data-tab-pill]').getBoundingClientRect()
    const tab = list.querySelector('[role="tab"][aria-selected="true"]').getBoundingClientRect()
    return { pills: list.querySelectorAll('[data-tab-pill]').length, first: list.firstElementChild.hasAttribute('data-tab-pill'), dx: Math.abs(pill.left - tab.left), dw: Math.abs(pill.width - tab.width) }
  })()`)
  expect(r).toMatchObject({ pills: 1, first: true })
  expect(r.dx).toBeLessThan(1.5)
  expect(r.dw).toBeLessThan(1.5)
  await app.close()
})

test('A4-P1-7 · al terminar de crear un curso, las tarjetas del equipo no se montan unas sobre otras', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launch({ home: home(), env: { AULA_FAKE_TEAM_DELAY_MS: '20' } })
  await go(page, { name: 'create' })
  await page.getByPlaceholder(/Calculus I/).fill('Logaritmos')
  await page.getByRole('button', { name: 'Paste text' }).click()
  await page.getByPlaceholder(/Paste notes/).fill('El logaritmo en base b de x es el exponente al que hay que elevar b para obtener x. log_b(xy) = log_b x + log_b y.')
  await page.getByRole('button', { name: 'Create course' }).click()
  await expect(page.getByText('The team').first()).toBeVisible({ timeout: 30_000 })
  // en cada fotograma: ¿se solapan dos tarjetas del equipo, o el título «The team» con la primera?
  await js(page, `(() => {
    window.__overlaps = []
    const seen = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
    const tick = () => {
      const h = [...document.querySelectorAll('main h2')].find((x) => x.textContent === 'The team')
      const col = h && h.parentElement && h.parentElement.parentElement && h.parentElement.parentElement.parentElement
      const grid = col && col.querySelector(':scope > div.grid')
      if (grid) {
        const lanes = [...grid.children].map((c) => c.getBoundingClientRect())
        for (let i = 0; i < lanes.length; i++) for (let j = i + 1; j < lanes.length; j++) if (seen(lanes[i], lanes[j]) > 40) window.__overlaps.push('lanes ' + i + '/' + j)
        if (lanes[0] && h.getBoundingClientRect().bottom > lanes[0].top + 2) window.__overlaps.push('title')
      }
      if (!window.__stop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })()`)
  await expect(page.getByText('Course ready').first()).toBeVisible({ timeout: 180_000 })
  await page.waitForTimeout(1500)
  const overlaps = await js<string[]>(page, '(window.__stop = true, window.__overlaps)')
  expect([...new Set(overlaps)]).toEqual([])
  await app.close()
})

test('A4-P2-11 · Tab no sale de un diálogo, de ⌘K ni de la bienvenida', async () => {
  const { app, page } = await launch({ home: home() })
  await go(page, { name: 'settings' })
  await page.getByRole('button', { name: 'Delete all data' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    expect(await js<boolean>(page, '!!document.activeElement.closest("[role=dialog]")'), `Tab ${i + 1}`).toBe(true)
  }
  await page.keyboard.press('Shift+Tab')
  expect(await js<boolean>(page, '!!document.activeElement.closest("[role=dialog]")')).toBe(true)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+k')
  await expect(page.getByPlaceholder('Search Aula')).toBeFocused()
  await page.keyboard.press('Tab')
  expect(await js<boolean>(page, '!!document.activeElement.closest("[role=dialog]")')).toBe(true)
  await app.close()

  const first = await launch({ home: home({}, { onboarded: false }), onboarding: true })
  await expect(first.page.getByText('Hi, I’m Aula')).toBeVisible()
  for (let i = 0; i < 8; i++) {
    await first.page.keyboard.press('Tab')
    expect(await js<boolean>(first.page, '!!document.activeElement.closest("[aria-modal=true]")'), `bienvenida, Tab ${i + 1}`).toBe(true)
  }
  await first.app.close()
})

test('A4-P2-9/10/12 · la pista no se sale ni se queda pegada; el foco no cambia la forma; controles con nombre', async () => {
  const { app, page } = await launch({ home: home() })
  await page.setViewportSize({ width: 1000, height: 680 })
  await go(page, { name: 'study', id: C, mode: 'learn', skill: 'reference-angles' })
  const trigger = page.getByRole('button', { name: /^(Step by step|Explore|Just read)$/ }).first()
  await trigger.hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  const box = await js<{ left: number; right: number; width: number; vw: number }>(page, `(() => { const r = document.querySelector('[role="tooltip"]').getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, vw: innerWidth } })()`)
  expect(box.left).toBeGreaterThanOrEqual(0)
  expect(box.right).toBeLessThanOrEqual(box.vw)
  expect(box.width).toBeGreaterThan(120)
  // al pulsar, la pista se va (no se queda encima del menú)
  await trigger.click()
  await page.mouse.move(10, 400)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.keyboard.press('Escape')
  // puntos de progreso con nombre
  expect(await js<number>(page, 'document.querySelectorAll("[role=group] > button:not([aria-label])").length')).toBe(0)
  // el anillo de foco respeta el radio de la tarjeta
  await go(page, { name: 'tools' })
  const card = page.getByRole('button', { name: /Calculator/ }).first()
  await card.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  expect(await js<string>(page, 'getComputedStyle(document.activeElement).borderTopLeftRadius')).toBe('22px')
  // la barra lateral plegada: todos sus botones con nombre
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await page.waitForTimeout(400)
  expect(await js<string[]>(page, `[...document.querySelectorAll('nav[aria-label="Aula"] button')].filter((b) => !(b.getAttribute('aria-label') || b.textContent.trim())).map((b) => b.outerHTML.slice(0, 80))`)).toEqual([])
  await app.close()
})

test('A4-P2-13 · con la vista quieta, la gota nunca tapa un control (y escondida no se enfoca)', async () => {
  const { app, page } = await launch({ home: home() })
  await page.setViewportSize({ width: 1000, height: 680 })
  for (const route of [{ name: 'settings' }, { name: 'home' }, { name: 'inbox' }]) {
    await go(page, route)
    await page.waitForTimeout(1600)
    for (let step = 0; step < 12; step++) {
      const res = await js<{ visible: boolean; covered: string[]; more: boolean }>(page, `(() => {
        const orb = document.querySelector('.aula-orb'); if (!orb) return { visible: false, covered: [], more: false }
        const drop = orb.firstElementChild
        const visible = getComputedStyle(drop).visibility !== 'hidden'
        const o = { left: orb.offsetLeft, top: orb.offsetTop, right: orb.offsetLeft + orb.offsetWidth, bottom: orb.offsetTop + orb.offsetHeight }
        const covered = visible ? [...document.querySelectorAll('main button, main [role="switch"], main input, main a[href], main [role="button"], main [role="tab"]')].filter((el) => {
          const r = el.getBoundingClientRect(); const w = Math.max(0, Math.min(o.right, r.right) - Math.max(o.left, r.left)); const h = Math.max(0, Math.min(o.bottom, r.bottom) - Math.max(o.top, r.top))
          return r.width > 0 && w * h / Math.max(1, r.width * r.height) >= 0.2 && getComputedStyle(el).visibility !== 'hidden'
        }).map((el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40)) : []
        const sc = [...document.querySelectorAll('main *')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 20 && e.clientHeight > 200).sort((a, b) => b.clientHeight - a.clientHeight)[0]
        const before = sc ? sc.scrollTop : 0; if (sc) sc.scrollTop += 140
        return { visible, covered, more: !!sc && sc.scrollTop !== before }
      })()`)
      expect(res.covered, `${route.name}, paso ${step}`).toEqual([])
      if (!res.more) break
      await page.waitForTimeout(1300)
    }
  }
  await app.close()
})

test('A4-P2-15 · con movimiento reducido la pantalla nueva ya se ve entera al primer momento', async () => {
  const { app, page } = await launch({ home: home({ motion: 'reduced' }) })
  await go(page, { name: 'calendar' })
  await page.waitForTimeout(800)
  await js(page, 'window.__aula.navigate({ name: "stats" })')
  await page.waitForTimeout(80)
  const faded = await js<number>(page, `[...document.querySelectorAll('[data-screen="stats"][data-active="true"] *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 40 && r.top < innerHeight && !e.closest('[class*="glass-light"], [aria-hidden="true"], svg') && parseFloat(getComputedStyle(e).opacity) < 0.99 }).length`)
  expect(faded).toBe(0)
  await app.close()
})

test('A4-P2-17 · con texto al 130 % la cápsula de la lección no se monta y las pestañas del curso empiezan a la vista', async () => {
  const { app, page } = await launch({ home: home({ textScale: 1.3 }) })
  await page.setViewportSize({ width: 1000, height: 680 })
  await go(page, { name: 'course', id: C })
  await page.waitForTimeout(500)
  const tabs = await js<{ first: number; box: number; bar: string }>(page, `(() => { const l = document.querySelector('main [role="tablist"]'); const box = l.parentElement; return { first: l.querySelector('[role=tab]').getBoundingClientRect().left, box: box.getBoundingClientRect().left, bar: getComputedStyle(box).scrollbarWidth } })()`)
  expect(tabs.first).toBeGreaterThanOrEqual(tabs.box)
  expect(tabs.bar).toBe('none')
  await go(page, { name: 'study', id: C, mode: 'learn', skill: 'reference-angles' })
  await page.waitForTimeout(600)
  const pill = await js<{ overlap: number }>(page, `(() => {
    const spans = [...document.querySelectorAll('main span')].filter((s) => /^(Step|Concept) \\d+ of \\d+/.test(s.textContent)).sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)
    const s = spans[0]; if (!s) return { overlap: -1 }
    const r = s.getBoundingClientRect(); const cap = s.closest('.rounded-full')
    // los botones que van DESPUÉS del contador (leer en voz alta, índice, modo), no los puntos de progreso
    const btns = [...cap.querySelectorAll('button')].filter((b) => !s.parentElement.contains(b) && b.getBoundingClientRect().left > r.left)
    return { overlap: Math.max(0, ...btns.map((b) => r.right - b.getBoundingClientRect().left)) }
  })()`)
  expect(pill.overlap).toBeLessThanOrEqual(0.5)
  await app.close()
})

test('A5-P1-2 · el temporizador avisa con la ventana fuera de la vista (lo decide el proceso principal)', async () => {
  const { app, page } = await launch({ home: home(), env: { AULA_HIDDEN: '1' } })
  // sin enseñar avisos de verdad en la pantalla: se apuntan
  await app.evaluate(({ Notification }) => {
    const g = globalThis as unknown as { __shown: string[] }
    g.__shown = []
    Notification.prototype.show = function (this: { body: string }) { g.__shown.push(this.body) }
  })
  await js(page, 'window.aula.invoke("app.notify", { body: "Focus block done", whenAway: true })')
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __shown: string[] }).__shown)).toEqual(['Focus block done'])
  await app.close()
})

/** Un PDF de texto, sin dependencias: `pages` páginas con `lines` líneas cada una (para el lector). */
function textPdf(pages: number, lines: number): Buffer {
  const objs: string[] = []
  const add = (s: string) => objs.push(s) // id = índice + 1
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('') // páginas, al final
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const kids: number[] = []
  for (let p = 0; p < pages; p++) {
    let body = 'BT /F1 9 Tf 40 800 Td 11 TL\n'
    for (let l = 0; l < lines; l++) body += `(Chapter ${p + 1} line ${l + 1}: logarithms, exponents and the change of base rule ${'x'.repeat(20)}) '\n`
    body += 'ET'
    add(`<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`)
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length} 0 R >>`)
    kids.push(objs.length)
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out))
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

test('A5-P1-1 · entrar y salir del lector PDF no retiene la pantalla anterior (SegmentedTabs sin layoutId)', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launch({ home: home() })
  const dir = mkdtempSync(join(tmpdir(), 'aula-e2e-pdf-'))
  const pdf = join(dir, 'logaritmos.pdf')
  writeFileSync(pdf, textPdf(60, 70))
  // el archivo lo «elige» la persona, por el campo de archivo del chat
  await go(page, { name: 'chat' })
  await page.locator('input[type="file"]').first().setInputFiles(pdf)
  await page.waitForTimeout(800)
  await js(page, '(() => { const f = document.querySelector("input[type=file]").files[0]; window.aula.pathForFile(f) })()')
  const key = await page.evaluate(async (p) => {
    const aula = (globalThis as unknown as { aula: { invoke(m: string, a: unknown): Promise<{ ok: boolean; value?: { imported?: Array<{ key: string }> } }> } }).aula
    return (await aula.invoke('documents.import', { paths: [p] })).value?.imported?.[0]?.key
  }, pdf)
  expect(key).toBeTruthy()
  await js(page, '(() => { for (const b of document.querySelectorAll(\'button[aria-label^="Remove"]\')) b.click() })()')
  const cdp = await page.context().newCDPSession(page)
  const heapMB = async (): Promise<number> => {
    await cdp.send('HeapProfiler.collectGarbage')
    await page.waitForTimeout(300)
    await cdp.send('HeapProfiler.collectGarbage')
    await cdp.send('Performance.enable')
    const { metrics } = await cdp.send('Performance.getMetrics')
    return (metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576
  }
  const visit = async () => {
    await go(page, { name: 'documents', doc: key })
    await page.waitForTimeout(2200)
    await go(page, { name: 'home' })
  }
  for (let i = 0; i < 3; i++) await visit()
  await page.waitForTimeout(1500)
  const start = await heapMB()
  for (let i = 0; i < 20; i++) await visit()
  await page.waitForTimeout(1500)
  const end = await heapMB()
  // antes: ≈ 0,5 MB por visita con un PDF así (la pantalla entera retenida por motion); ahora, casi nada
  expect(end - start, `${start.toFixed(1)} → ${end.toFixed(1)} MB`).toBeLessThan(3)
  await app.close()
})
