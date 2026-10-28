// settings.json: valores por defecto, mezcla con lo guardado y ajustes retirados que se olvidan.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setDataRoot } from '../paths'
import { getSettings, resetSettingsCache, updateSettings } from './index'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aula-settings-'))
  setDataRoot(root)
  resetSettingsCache()
})
afterEach(() => {
  resetSettingsCache()
  rmSync(root, { recursive: true, force: true })
})

describe('ajustes', () => {
  it('sin archivo: todo encendido salvo «Aula siempre activa», sin tope de gasto', () => {
    const s = getSettings()
    expect(s.persistent.enabled).toBe(false)
    expect(s.data).toEqual({ memory: true, webSearch: true, autoUpdate: true })
    expect(s.ai.dailyBudgetUSD).toBe(0)
  })
  it('olvida los interruptores retirados y conserva lo demás', () => {
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ version: 2, general: { sounds: false, name: 'Ana' }, data: { semanticSearch: true, memory: false } }))
    const s = getSettings()
    expect(s.general.name).toBe('Ana')
    expect(s.data.memory).toBe(false)
    expect('semanticSearch' in s.data).toBe(false)
    expect('sounds' in s.general).toBe(false)
    updateSettings({ ai: { dailyBudgetUSD: 3 } })
    const saved = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')) as { ai: { dailyBudgetUSD: number }; data: Record<string, unknown> }
    expect(saved.ai.dailyBudgetUSD).toBe(3)
    expect(saved.data.semanticSearch).toBeUndefined()
  })

  it('un settings.json dañado no se cambia en silencio por los valores por defecto: usa la versión anterior', () => {
    updateSettings({ general: { name: 'Ana' } })
    updateSettings({ ai: { dailyBudgetUSD: 2 } })
    expect(existsSync(join(root, '.settings.json.bak'))).toBe(true)
    writeFileSync(join(root, 'settings.json'), '{"version": 2, "general": {"na') // a medias
    resetSettingsCache()
    expect(getSettings().general.name).toBe('Ana')
    expect(readdirSync(root).filter((n) => n.startsWith('settings.json.damaged-'))).toHaveLength(1)
    // dañados los dos: valores por defecto (sin romper el arranque) y el dañado sigue copiado al lado
    writeFileSync(join(root, '.settings.json.bak'), 'basura')
    resetSettingsCache()
    expect(getSettings().general.name).not.toBe('Ana')
  })
  it('los ajustes de una versión más nueva se leen y se guardan sin perder lo que esta no conoce ni bajar de versión', () => {
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ version: 3, general: { name: 'Luis' }, futuro: { algo: true } }))
    expect(getSettings().general.name).toBe('Luis')
    updateSettings({ ai: { dailyBudgetUSD: 1 } })
    const saved = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect(saved.version).toBe(3)
    expect(saved.futuro).toEqual({ algo: true })
  })
})
