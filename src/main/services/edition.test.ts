// La frontera de la edición de la App Store se decide en un solo sitio. Estas pruebas vigilan que siga siendo así:
// ninguna comprobación suelta de `process.mas` y ningún proceso lanzado fuera de los módulos que la respetan.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { edition, isAppStore } from './edition'

const SRC = join(__dirname, '..', '..')
const originalMas = Object.getOwnPropertyDescriptor(process, 'mas')
afterEach(() => {
  if (originalMas) Object.defineProperty(process, 'mas', originalMas)
  else Reflect.deleteProperty(process, 'mas')
})

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== '__fixtures__' && name !== 'node_modules') sources(path, out)
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|sim\.test)\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path)
  }
  return out
}
const rel = (path: string): string => relative(SRC, path).split(sep).join('/')

describe('edición de Aula', () => {
  it('la edición normal lo puede todo; la de la App Store, solo lo que permite el sandbox', () => {
    expect(isAppStore()).toBe(false)
    expect(edition).toMatchObject({ selfUpdates: true, externalTools: true, aiConsent: false })
    Object.defineProperty(process, 'mas', { value: true, configurable: true })
    expect(isAppStore()).toBe(true)
    expect(edition).toMatchObject({ selfUpdates: false, externalTools: false, aiConsent: true })
  })

  it('nadie más mira process.mas: se pregunta por la capacidad', () => {
    const offenders = sources(SRC).filter((file) => /process\.mas\b|\.mas\s*===/.test(readFileSync(file, 'utf8'))).map(rel)
    // el preload no puede importar del proceso principal: expone el dato a la interfaz (`api.appStore`)
    expect(offenders.sort()).toEqual(['main/services/edition.ts', 'preload/index.ts'])
  })

  it('solo lanzan procesos los módulos que ya respetan la edición', () => {
    const launchers = sources(SRC).filter((file) => /from 'node:child_process'|utilityProcess\.fork\(/.test(readFileSync(file, 'utf8'))).map(rel)
    // Añadir aquí un archivo nuevo obliga a decidir qué hace en la edición de la App Store (edition.externalTools).
    expect(launchers.sort()).toEqual([
      'main/electron/ingest-host.ts', // proceso auxiliar del propio Electron (utilityProcess), permitido en el sandbox
      'main/electron/updates.ts', // el actualizador propio: no arranca sin edition.selfUpdates
      'main/services/agents/child-process.ts', // agentes de terminal: ChildProcessHandle.spawn se niega
      'main/services/local-ai/engine.ts', // motor local: install() y start() se niegan
      'main/services/updates/mac-install.ts' // solo lo usa el actualizador propio
    ])
  })
})
