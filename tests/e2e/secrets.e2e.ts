// Las claves de API se guardan con el cifrado del sistema (safeStorage: DPAPI en Windows; en Linux, libsecret o KWallet, o
// en claro con permisos 0600 si no hay llavero) y siguen ahí al volver a abrir Aula. No corre en macOS: usaría el Llavero
// de verdad de quien ejecuta las pruebas.
import { test, expect, type Page } from 'playwright/test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from './helpers'

test.skip(process.platform === 'darwin', 'usaría el Llavero de verdad de quien ejecuta las pruebas')

const KEY = 'sk-proj-prueba-e2e-' + 'k'.repeat(40) + 'fXYZ'

interface Provider { id: string; hasKey: boolean }
const invoke = async <T>(page: Page, method: string, args?: unknown): Promise<T> => {
  const r = (await page.evaluate(`window.aula.invoke(${JSON.stringify(method)}, ${JSON.stringify(args ?? null)})`)) as { ok: boolean; value: T; error?: { message: string } }
  if (!r.ok) throw new Error(`${method}: ${r.error?.message}`)
  return r.value
}

test('una clave de API se guarda cifrada y sigue al volver a abrir Aula', async () => {
  const first = await launch()
  const set = await invoke<Provider[]>(first.page, 'ai.setKey', { providerId: 'openai', key: KEY })
  expect(set.find((p) => p.id === 'openai')?.hasKey).toBe(true)
  await first.app.close()

  const file = join(first.home, 'secrets.enc')
  expect(existsSync(file)).toBe(true)
  if (process.platform === 'win32') expect(readFileSync(file).includes(KEY)).toBe(false) // DPAPI: nunca en claro
  else expect(statSync(file).mode & 0o077).toBe(0) // solo para su dueño (aunque no haya llavero)

  const second = await launch({ home: first.home })
  try {
    expect(await invoke(second.page, 'secrets.status')).toMatchObject({ locked: false })
    const again = await invoke<Provider[]>(second.page, 'ai.providers')
    expect(again.find((p) => p.id === 'openai')?.hasKey).toBe(true)
  } finally {
    await second.app.close()
  }
})
