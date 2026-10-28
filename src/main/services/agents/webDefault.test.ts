// A2-P1-2: los agentes de terminal (Claude Code, Codex, OpenCode) ya no reciben su WebFetch / búsqueda web propios por defecto:
// ni en el chat, ni en el equipo que crea cursos, ni en las automatizaciones, ni en los lectores «sin web por diseño». La web
// llega por las herramientas de Aula (`web_search`, `fetch_url`) a través del relevo MCP, con sus puertas. Es la prueba inversa
// de la del juez A2 (que veía `allowWeb = true` y `--tools WebSearch,WebFetch` en una tarea de lector).
import { describe, expect, it } from 'vitest'
import { runToolLoop } from '../ai'
import { modelAgents } from '../pipeline/agents'
import { claudeArguments } from './claude'
import { codexArguments } from './codex'
import { openCodeTaskConfig } from './opencode'
import { createCLIChatModel } from './provider'
import type { AgentEvent, AgentRunner, AgentTask, CLIAgentConfig } from './types'
import { emptyUsage } from './types'

function captured(): { tasks: AgentTask[]; runner: () => AgentRunner } {
  const tasks: AgentTask[] = []
  const config: CLIAgentConfig = { id: 'claude-cli', kind: 'claude', displayName: 'Claude Code', model: '' }
  const runner = (): AgentRunner => ({
    config,
    async *run(task: AgentTask): AsyncGenerator<AgentEvent> {
      tasks.push(task)
      yield { type: 'finished', result: { text: 'ok', steps: 0, usage: emptyUsage(), stopReason: 'end' } } as AgentEvent
    }
  })
  return { tasks, runner }
}

const claudeConfig: CLIAgentConfig = { id: 'claude-cli', kind: 'claude', displayName: 'Claude Code', model: '' }

describe('A2-P1-2 · agentes CLI sin web propia por defecto', () => {
  it('el lector «sin web por diseño» del juez: allowWeb = false y Claude sin WebSearch/WebFetch', async () => {
    const { tasks, runner } = captured()
    const model = createCLIChatModel({ id: 'claude-cli', kind: 'claude-cli', label: 'Claude', model: 'sonnet' }, { runner })
    await model.runAgent!({ system: 'reader of untrusted PDFs (no web by design)', messages: [], prompt: 'x', tools: [], maxSteps: 1, timeoutSec: 5 }, {})
    expect(tasks[0]?.allowWeb).toBe(false)
    const args = claudeArguments(tasks[0], claudeConfig, {}, undefined, undefined)
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args.join(' ')).not.toMatch(/--allowedTools [^ ]*Web(Search|Fetch)/)
    expect(args[args.indexOf('--disallowedTools') + 1]).toMatch(/WebSearch/)
    expect(args[args.indexOf('--disallowedTools') + 1]).toMatch(/WebFetch/)
  })

  it('Codex y OpenCode, igual: búsqueda desactivada y webfetch/websearch denegados', () => {
    const task: AgentTask = { system: 's', prompt: 'p', mcpServers: [], allowWeb: false }
    const codex = codexArguments(task, { id: 'codex-cli', kind: 'codex', displayName: 'Codex', model: '' }, {}, []).join(' ')
    expect(codex).toContain('web_search="disabled"')
    expect(codex).not.toContain('web_search="live"')
    const oc = openCodeTaskConfig(task)
    expect(oc).toContain('"webfetch":"deny"')
    expect(oc).toContain('"websearch":"deny"')
  })

  it('el bucle de herramientas (chat, automatizaciones) y el equipo que crea cursos no la encienden', async () => {
    const { tasks, runner } = captured()
    const model = createCLIChatModel({ id: 'claude-cli', kind: 'claude-cli', label: 'Claude', model: 'sonnet' }, { runner })
    await runToolLoop({ model, system: 'chat', prompt: 'hola', tools: [] })
    await modelAgents(model).run({ role: 'gatherer', system: 'g', prompt: 'p', tools: [], maxSteps: 1, timeoutSec: 5, signal: new AbortController().signal, onEvent: () => {} })
    expect(tasks.map((t) => t.allowWeb)).toEqual([false, false])
  })

  it('solo si una tarea lo pide expresamente', async () => {
    const { tasks, runner } = captured()
    const model = createCLIChatModel({ id: 'claude-cli', kind: 'claude-cli', label: 'Claude', model: 'sonnet' }, { runner })
    await model.runAgent!({ system: 's', messages: [], prompt: 'x', tools: [], maxSteps: 1, timeoutSec: 5, allowWeb: true }, {})
    expect(tasks[0]?.allowWeb).toBe(true)
  })
})
