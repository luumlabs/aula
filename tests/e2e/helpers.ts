// Arranca la app real (Electron) con una carpeta de datos nueva y la IA simulada.
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

export interface Launched {
  app: ElectronApplication
  page: Page
  home: string
}

/** Carpeta de datos nueva con el curso de ejemplo real (Trigonometría, «exam-2-math112»). */
export function homeWithDemoCourse(): string {
  const home = mkdtempSync(join(tmpdir(), 'aula-e2e-'))
  cpSync(resolve(__dirname, '../../resources/demo-course/Packs'), join(home, 'Packs'), { recursive: true })
  return home
}

export function readJSON<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export async function launch(opts: { home?: string; env?: Record<string, string>; onboarding?: boolean } = {}): Promise<Launched> {
  const home = opts.home ?? mkdtempSync(join(tmpdir(), 'aula-e2e-'))
  const app = await electron.launch({
    args: [resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, AULA_HOME: home, AULA_FAKE_AI: '1', AULA_SKIP_ONBOARDING: opts.onboarding ? '' : '1', ...opts.env }
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => !!(globalThis as unknown as { __aula?: unknown }).__aula, null, { timeout: 15_000 }).catch(() => undefined)
  return { app, page, home }
}

/** Navega con el gancho de desarrollo (solo sin empaquetar). */
export async function go(page: Page, route: Record<string, unknown>): Promise<void> {
  await page.evaluate((r) => (globalThis as unknown as { __aula: { navigate(r: unknown): void } }).__aula.navigate(r), route)
  await page.waitForTimeout(600)
}
