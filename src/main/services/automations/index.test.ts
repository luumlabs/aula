// El centro de la carpeta de datos con los servicios de verdad (calendario, cursos, estudio) y la IA simulada de la app
// (`createFakeModel`, la de AULA_FAKE_AI=1) en una carpeta temporal; y el espejo settings.persistent ⇄ proactive.json.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultSettings } from '@shared/settings'
import { defaultProactiveSettings, defaultSchedule } from '@shared/automations'
import type { ChatEvent } from '@shared/ai/types'
import { setDataRoot } from '../paths'
import { createFakeModel, setFakeAIScript, setModelOverride } from '../ai'
import { automationCenter, proactivePatchFromSettings, setAutomationCenter, setInboxChatSink, settingsPatchFromProactive } from './index'

let home: string
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'aula-auto-home-'))
  setDataRoot(home)
  setModelOverride(createFakeModel)
})
afterAll(() => {
  setModelOverride(null)
  setFakeAIScript(null)
  setAutomationCenter(null)
  setInboxChatSink(null)
  rmSync(home, { recursive: true, force: true })
})

describe('con los servicios de verdad y la IA simulada', () => {
  it('«Ejecutar ahora» revisa, guarda el historial, deja la novedad y la manda al chat', async () => {
    // la IA simulada: primero informa con report_check, luego termina
    setFakeAIScript((req): string | ChatEvent[] => {
      const done = req.messages.some((m) => m.role === 'tool')
      if (done) return 'ok'
      return [
        { type: 'tool_call', index: 0, id: 'c1', name: 'report_check', argumentsFragment: JSON.stringify({ summary: 'Tienes **2 tareas** esta semana.', items: [{ key: 'k1', title: 'Tarea 1', kind: 'assignment' }] }) },
        { type: 'finished', finish: 'toolCalls' }
      ]
    })
    const posted: string[] = []
    setInboxChatSink({ postSystemMessage: (thread, m) => { posted.push(thread + ':' + m.text) } })
    const c = automationCenter()
    const item = await c.save({ title: 'Mi semana', instruction: 'Dime qué tengo esta semana', schedule: { ...defaultSchedule('daily'), times: ['18:00'] }, capabilities: ['calendar', 'courses'], notify: 'always', untilFound: false })
    expect(c.runNow(item.automation.id)).toBe(true)
    await c.waitIdle(20_000)
    const runs = c.runs(item.automation.id)
    expect(runs[0]).toMatchObject({ outcome: 'nothingNew', summary: 'Tienes **2 tareas** esta semana.', trigger: 'manual' })
    expect(runs[0].tokens).toBeGreaterThan(0)
    const entry = c.inboxEntries()[0]
    expect(entry).toMatchObject({ kind: 'automation', preview: 'Tienes 2 tareas esta semana.', threadID: 'aula-novedades' })
    expect(posted).toEqual(['aula-novedades:Tienes **2 tareas** esta semana.'])
    c.ensureRoutines() // lo que hace `start()` al arrancar
    const snap = await c.snapshot()
    expect(snap.chatLinked).toBe(true)
    expect(snap.items.some((i) => i.automation.id === routineID('deadlineReminders'))).toBe(true) // ligeras, sin configurar nada
    expect(snap.proactive.enabled).toBe(false)
  })
})

const routineID = (r: string) => `routine-${r}`

describe('settings.persistent ⇄ proactive.json', () => {
  it('los ajustes mandan en lo que comparten y se escribe de vuelta lo que cambia el modo', () => {
    const s = defaultSettings().persistent
    const p = defaultProactiveSettings()
    expect(proactivePatchFromSettings(s, p)).toEqual({ quiet: { enabled: true, from: '22:00', to: '08:00' } })
    expect(proactivePatchFromSettings({ ...s, enabled: true, style: 'quiet', quietHours: null }, p)).toEqual({ enabled: true, style: 'discreet', quiet: { ...p.quiet, enabled: false } })
    // «Personalizada» no se pisa con el estilo de los ajustes
    expect(proactivePatchFromSettings({ ...s, style: 'attentive', quietHours: { from: '22:30', to: '07:30' } }, { ...p, style: 'custom' })).toEqual({})
    expect(settingsPatchFromProactive({ ...p, enabled: true, style: 'attentive' }, { ...s, quietHours: { from: '22:30', to: '07:30' } })).toEqual({ enabled: true, style: 'attentive' })
    expect(settingsPatchFromProactive(p, { ...s, quietHours: { from: '22:30', to: '07:30' } })).toBeNull()
  })
})
