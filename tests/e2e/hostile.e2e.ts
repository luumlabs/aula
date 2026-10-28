// A2-P1-3 en la app de verdad: un curso «compartido» trae un PDF hostil (un flujo «q Q» enorme comprimido a casi nada y repetido
// en cada página, sin `pages.json`). Abrirlo en Documentos lo leía en el proceso principal: la app se quedaba sin responder
// mientras tanto (el juez A2 midió 23,6 s con 3 páginas). Ahora lo lee el lector aparte y el proceso principal sigue contestando.
import { test, expect } from 'playwright/test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { qqBombPDF } from '../../src/main/services/ingest/testing/hostilePdf'
import { _electron as electron } from 'playwright'

function homeWithHostileCourse(): string {
  const home = mkdtempSync(join(tmpdir(), 'aula-e2e-hostile-'))
  const demo = resolve(__dirname, '../../resources/demo-course/Packs/exam-2-math112')
  const dir = join(home, 'Packs', 'shared-course')
  cpSync(demo, dir, { recursive: true })
  const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as Record<string, unknown>
  pack.id = 'shared-course'
  pack.title = 'Curso compartido'
  pack.sources = [{ id: 'notes', title: 'Lecture notes', kind: 'pdf', filename: 'notes.pdf', addedAt: '2026-10-01T00:00:00.000Z', pages: 3, characters: 1000, status: 'ready', trust: 'official', warnings: [] }]
  writeFileSync(join(dir, 'pack.json'), JSON.stringify(pack))
  mkdirSync(join(dir, 'sources', 'notes'), { recursive: true })
  writeFileSync(join(dir, 'sources', 'notes', 'notes.pdf'), qqBombPDF(3, 40))
  return home
}

test('un curso importado con un PDF hostil no congela el proceso principal (ni al arrancar ni al abrirlo)', async () => {
  test.setTimeout(180_000)
  const home = homeWithHostileCourse()
  const app = await electron.launch({
    args: [resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, AULA_HOME: home, AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: '1', AULA_HIDDEN: '1' }
  })
  try {
    // un latido en el proceso principal desde el primer momento: el mayor hueco entre latidos es lo que estuvo bloqueado
    await app.evaluate(() => {
      const g = globalThis as unknown as { __gap: number }
      g.__gap = 0
      let last = Date.now()
      setInterval(() => { const now = Date.now(); g.__gap = Math.max(g.__gap, now - last); last = now }, 50).unref()
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('nav[aria-label="Aula"]')).toBeAttached()
    const started = Date.now()
    const envelope = await page.evaluate(() => (globalThis as unknown as { aula: { invoke(m: string, a?: unknown): Promise<unknown> } }).aula
      .invoke('documents.open', { ref: { kind: 'source', packId: 'shared-course', sourceId: 'notes' } }))
    const ok = (envelope as { ok?: boolean } | undefined)?.ok === true
    // la lectura de fondo (índice de documentos) puede seguir un poco: se deja terminar
    await page.waitForTimeout(3000)
    const gap = await app.evaluate(() => (globalThis as unknown as { __gap: number }).__gap)
    console.log(`[A2-P1-3] documents.open ${ok ? 'ok' : JSON.stringify(envelope).slice(0, 200)} in ${((Date.now() - started) / 1000).toFixed(1)} s; worst main-process stall ${gap} ms`)
    expect(ok).toBe(true)
    // antes: unos 10 s seguidos sin responder con 3 páginas de 40 MB (el juez midió 23,6 s con 100 MB); ahora, nada que se note
    expect(gap).toBeLessThan(1500)
  } finally {
    await app.close()
  }
})
