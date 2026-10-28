// Crear un curso con la IA simulada (AULA_FAKE_AI=1): la pantalla de crear, el monitor del equipo y el curso terminado; y
// después «Pedir cambios a Aula» sobre ese curso.
import { test, expect } from 'playwright/test'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { go, launch, readJSON } from './helpers'

test('crear un curso con texto pegado y pedirle cambios', async () => {
  test.setTimeout(240_000)
  const { app, page, home } = await launch({ env: { AULA_FAKE_TEAM_DELAY_MS: '20' } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await go(page, { name: 'create' })
  await page.getByPlaceholder(/Calculus I/).fill('Funciones exponenciales')
  await page.getByRole('button', { name: 'Paste text' }).click()
  await page.getByPlaceholder(/Paste notes/).fill('Una función exponencial es f(x) = a·b^x con b > 0 y b ≠ 1. Si b > 1 crece; si 0 < b < 1 decrece. La gráfica corta el eje y en (0, a).')
  // sin pulsar «Add»: lo pegado se añade solo al crear (antes se perdía y el curso salía sin materiales)
  await expect(page.getByRole('button', { name: /Add this text/ })).toBeVisible()
  await page.getByRole('button', { name: 'Create course' }).click()

  // el monitor del equipo y, al final, el curso en disco
  await expect(page.getByText(/Creating your course|Course ready/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Course ready').first()).toBeVisible({ timeout: 180_000 })
  const packs = readdirSync(join(home, 'Packs')).filter((d) => existsSync(join(home, 'Packs', d, 'pack.json')))
  const id = packs.find((p) => readJSON<{ title: string }>(join(home, 'Packs', p, 'pack.json')).title.includes('exponencial'))
  expect(id).toBeTruthy()
  const pack = readJSON<{ skills: unknown[]; sources: unknown[] }>(join(home, 'Packs', id!, 'pack.json'))
  expect(pack.skills.length).toBeGreaterThan(0)
  expect(pack.sources).toHaveLength(1)

  // «Pedir cambios a Aula» abre el monitor en modo «aplicando cambios»
  await go(page, { name: 'course', id })
  await page.getByRole('button', { name: /Ask Aula for changes/ }).click()
  await page.getByRole('textbox', { name: /Ask Aula for changes/ }).fill('Añade un ejemplo resuelto paso a paso.')
  await page.getByRole('button', { name: 'Ask for changes', exact: true }).click()
  await expect(page.getByText(/Applying your changes|Changes applied/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Changes applied').first()).toBeVisible({ timeout: 180_000 })
  expect(errors).toEqual([])
  await app.close()
})

test('un archivo elegido con el selector se añade; una ruta inventada por la interfaz, no', async () => {
  const { app, page } = await launch()
  const dir = mkdtempSync(join(tmpdir(), 'aula-e2e-files-'))
  const file = join(dir, 'derivadas-apuntes.txt')
  writeFileSync(file, 'La derivada de x^2 es 2x. La derivada de una constante es 0. Regla de la cadena: (f∘g)′ = f′(g)·g′.')
  writeFileSync(join(dir, 'otro.txt'), 'existe, pero nadie lo eligió')
  await go(page, { name: 'create' })
  await page.locator('input[type="file"]').first().setInputFiles(file)
  await expect(page.getByText(/derivadas/i).first()).toBeVisible({ timeout: 30_000 })
  // la misma petición con una ruta que nadie soltó ni eligió: se rechaza
  const refused = await page.evaluate(async (p) => {
    const aula = (globalThis as unknown as { aula: { invoke(m: string, a: unknown): Promise<{ ok: boolean; error?: { code?: string } }> } }).aula
    return aula.invoke('create.addFiles', { paths: [p] })
  }, join(dir, 'otro.txt'))
  expect(refused.ok).toBe(false)
  expect(refused.error?.code).toBe('file_not_allowed')
  await app.close()
})
