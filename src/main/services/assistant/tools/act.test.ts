// open_screen → Ajustes: el chat puede llevar a cualquier sección de Ajustes (también «Apariencia», donde está el cursor), con
// los nombres que escriba el modelo; una sección que no existe se le devuelve como error para que se corrija.
import { describe, expect, it } from 'vitest'
import { SETTINGS_SECTION_NAMES } from '@shared/settings/sections'
import type { AgentTool, ToolOutput } from '../../ai/model'
import type { AssistantTarget, ToolEnv } from '../host'
import { openScreenTool, settingsPane, SETTINGS_PANES } from './act'

const ctx = { signal: new AbortController().signal, callId: '1' }

/** Llama a la herramienta y devuelve su salida como `ToolOutput`. */
async function call(tool: AgentTool, args: Record<string, string>): Promise<ToolOutput> {
  const out = await tool.run(args, ctx)
  return typeof out === 'string' ? { text: out } : out
}

function opener(): { env: ToolEnv; opened: AssistantTarget[] } {
  const opened: AssistantTarget[] = []
  const env = { library: { openPack: () => undefined, listPacks: () => [] }, navigate: (t: AssistantTarget) => { opened.push(t) } } as unknown as ToolEnv
  return { env, opened }
}

describe('settingsPane', () => {
  it('acepta todas las secciones de Ajustes, y solo esas', () => {
    expect([...SETTINGS_PANES].sort()).toEqual(Object.keys(SETTINGS_SECTION_NAMES).sort())
    for (const s of SETTINGS_PANES) expect(settingsPane(s)).toBe(s)
    expect(settingsPane('notifications-center')).toBeUndefined()
    expect(settingsPane('')).toBeUndefined()
    expect(settingsPane('constructor')).toBeUndefined()
  })

  it('entiende mayúsculas, acentos y nombres parecidos (el cursor y el tema → apariencia)', () => {
    expect(settingsPane(' Appearance ')).toBe('appearance')
    expect(settingsPane('cursor')).toBe('appearance')
    expect(settingsPane('Dark mode')).toBe('appearance')
    expect(settingsPane('always-on')).toBe('persistent')
    expect(settingsPane('Plataformas')).toBe('platforms')
    expect(settingsPane('Memoria')).toBe('memory')
  })
})

describe('open_screen · settings_pane', () => {
  it('abre Ajustes en la sección pedida (también apariencia y plataformas)', async () => {
    const { env, opened } = opener()
    const tool = openScreenTool(env)
    for (const pane of ['appearance', 'platforms', 'cursor']) {
      const out = await call(tool, { screen: 'settings', settings_pane: pane })
      expect(out.isError).toBeFalsy()
    }
    expect(opened.map((t) => t.settingsPane)).toEqual(['appearance', 'platforms', 'appearance'])
    expect(opened.every((t) => t.screen === 'settings')).toBe(true)
  })

  it('el esquema enumera las secciones y dice dónde está el cursor', () => {
    const tool = openScreenTool(opener().env)
    const pane = (tool.inputSchema as { properties: Record<string, { enum?: string[]; description?: string }> }).properties.settings_pane
    expect(pane.enum).toEqual(SETTINGS_PANES)
    expect(pane.description).toMatch(/appearance \([^)]*cursor/)
  })

  it('una sección desconocida es un error (no navega); en otra pantalla se ignora', async () => {
    const { env, opened } = opener()
    const tool = openScreenTool(env)
    const bad = await call(tool, { screen: 'settings', settings_pane: 'wallpaper' })
    expect(bad.isError).toBe(true)
    expect(bad.text).toContain('appearance')
    expect(opened).toEqual([])
    const home = await call(tool, { screen: 'home', settings_pane: 'wallpaper' })
    expect(home.isError).toBeFalsy()
    expect(opened).toEqual([{ screen: 'home' }])
  })
})
