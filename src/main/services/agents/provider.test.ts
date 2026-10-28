// El adaptador que convierte un agente CLI en un `ChatModel` de la app: herramientas de Aula por MCP (relevo local + ayudante),
// conversación aplanada en un solo mensaje, eventos, errores y registro en la capa de IA.
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/ai/types'
import { AIError } from '../ai/errors'
import type { AgentTool } from '../ai/model'
import { AgentError } from './errors'
import {
  aulaMCPHelperLaunch,
  aulaMCPServerSpec,
  cliAgentConfig,
  cliKindForProvider,
  configureAulaMCPHelper,
  conversationPrompt,
  createCLIChatModel,
  registerCLIProviders,
  unpackedPath
} from './provider'
import { createRelayToolsProvider, RELAY_TOKEN_ENV, RELAY_URL_ENV } from './relay'
import type { AgentEvent, AgentRunner, AgentTask, CLIAgentConfig } from './types'
import { emptyUsage } from './types'
import { setPackaged } from '../runtime'

const user = (text: string): ChatMessage => ({ role: 'user', content: [{ type: 'text', text }] })
const assistant = (text: string): ChatMessage => ({ role: 'assistant', content: [{ type: 'text', text }] })

/** Un agente falso: guarda la tarea, ejecuta `body` y emite lo que devuelva. */
function fakeRunner(body: (task: AgentTask, signal?: AbortSignal) => Promise<AgentEvent[]> | AgentEvent[]): { runner: (o: unknown) => AgentRunner; tasks: AgentTask[]; overrides: unknown[] } {
  const tasks: AgentTask[] = []
  const overrides: unknown[] = []
  const config: CLIAgentConfig = { id: 'claude-cli', kind: 'claude', displayName: 'Claude Code', model: '' }
  return {
    tasks,
    overrides,
    runner: (o) => {
      overrides.push(o)
      return {
        config,
        async *run(task: AgentTask, signal?: AbortSignal) {
          tasks.push(task)
          for (const e of await body(task, signal)) yield e
        }
      }
    }
  }
}

const finished = (text: string): AgentEvent => ({ type: 'finished', result: { text, steps: 1, usage: emptyUsage(), stopReason: 'stop' } })

afterEach(() => configureAulaMCPHelper(undefined))

describe('conversationPrompt', () => {
  it('sin historia, el último mensaje del usuario tal cual (con sus imágenes)', () => {
    const msg: ChatMessage = { role: 'user', content: [{ type: 'text', text: 'Hola' }, { type: 'image', image: { mediaType: 'image/png', base64: 'QUJD' } }] }
    expect(conversationPrompt([{ role: 'system', content: [{ type: 'text', text: 'S' }] }, msg])).toEqual({ prompt: 'Hola', images: [{ mediaType: 'image/png', base64: 'QUJD' }] })
  })

  it('la conversación anterior va delante entre etiquetas (resultados de herramientas recortados)', () => {
    const tool: ChatMessage = { role: 'tool', name: 'buscar', toolCallID: 'c1', content: [{ type: 'text', text: 'x'.repeat(3000) }] }
    const call: ChatMessage = { role: 'assistant', content: [], toolCalls: [{ id: 'c1', name: 'buscar', arguments: {} }] }
    const { prompt } = conversationPrompt([user('¿Qué es una derivada?'), call, tool, assistant('Es una razón de cambio.'), user('Pon un ejemplo')])
    expect(prompt.startsWith('<conversation_so_far>\n<user>\n¿Qué es una derivada?\n</user>')).toBe(true)
    expect(prompt).toContain('<assistant>\n[tool buscar]\n</assistant>')
    expect(prompt).toContain('<tool_result name="buscar">\n' + 'x'.repeat(2000) + '…\n</tool_result>')
    expect(prompt).toContain('<assistant>\nEs una razón de cambio.\n</assistant>')
    expect(prompt.endsWith('</conversation_so_far>\n\nPon un ejemplo')).toBe(true)
  })

  it('un prompt explícito sustituye al último mensaje', () => {
    expect(conversationPrompt([user('a')], 'b').prompt).toBe('b')
  })
})

describe('createCLIChatModel', () => {
  const config = { id: 'claude-cli', kind: 'claude-cli' as const, label: 'Claude', model: 'sonnet', reasoning: 'high' as const }

  it('runAgent: las herramientas de Aula llegan por MCP (relevo local con clave) y se ejecutan en la app', async () => {
    configureAulaMCPHelper({ command: '/ruta/Aula', args: ['/ruta/aula-mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1' } })
    const ran: unknown[] = []
    const tool: AgentTool = { name: 'crear_leccion', description: 'Crea', inputSchema: { type: 'object', properties: {} }, run: (args, ctx) => {
      ran.push({ args, callId: ctx.callId })
      return 'creada'
    } }
    const fake = fakeRunner(async (task) => {
      // lo que haría el ayudante `aula-mcp` lanzado por la CLI
      const aula = task.mcpServers?.find((s) => s.name === 'aula')
      const relay = createRelayToolsProvider(aula!.env![RELAY_URL_ENV], aula!.env![RELAY_TOKEN_ENV])
      const out = await relay.call('crear_leccion', { titulo: 'X' }, { signal: new AbortController().signal })
      return [{ type: 'started', provider: 'Claude Code', model: 'sonnet' }, { type: 'text', text: out.text }, finished(out.text)]
    })
    const model = createCLIChatModel(config, { runner: fake.runner, extraMCPServers: [{ name: 'canvas', command: 'npx' }] })
    expect(model.providerId).toBe('claude-cli')
    expect(model.capabilities.tools).toBe(true)
    const events: AgentEvent[] = []
    const result = await model.runAgent!(
      { system: 'SYS', messages: [user('hola')], prompt: '', tools: [tool], maxSteps: 12, timeoutSec: 60, reasoningEffort: 'low' },
      { onEvent: (e) => events.push(e as AgentEvent) }
    )
    expect(result.text).toBe('creada')
    expect(ran).toEqual([{ args: { titulo: 'X' }, callId: expect.any(String) }])
    expect(events.map((e) => e.type)).toEqual(['started', 'text', 'finished'])
    const task = fake.tasks[0]
    expect(task.system).toBe('SYS')
    expect(task.prompt).toBe('hola')
    expect(task.maxSteps).toBe(12)
    expect(task.timeoutMs).toBe(60_000)
    expect(task.model).toBe('sonnet')
    expect(task.mcpServers?.map((s) => s.name)).toEqual(['aula', 'canvas'])
    const aula = task.mcpServers![0]
    expect(aula.command).toBe('/ruta/Aula')
    expect(aula.args).toEqual(['/ruta/aula-mcp.js'])
    expect(aula.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(aula.env?.[RELAY_URL_ENV]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(fake.overrides[0]).toEqual({ effort: 'low' })
    // al terminar, el relevo deja de atender
    const after = await createRelayToolsProvider(aula.env![RELAY_URL_ENV], aula.env![RELAY_TOKEN_ENV]).call('crear_leccion', {}, { signal: new AbortController().signal })
    expect(after.isError).toBe(true)
  })

  it('runAgent sin herramientas no arranca relevo', async () => {
    const fake = fakeRunner(() => [finished('ok')])
    await createCLIChatModel(config, { runner: fake.runner }).runAgent!({ system: '', messages: [user('a')], prompt: '', tools: [], maxSteps: 1, timeoutSec: 5 }, {})
    expect(fake.tasks[0].mcpServers).toEqual([])
  })

  it('complete: el texto llega por partes y como mensaje del asistente, sin web ni herramientas', async () => {
    const fake = fakeRunner(() => [{ type: 'text', text: 'Hola ' }, { type: 'text', text: 'mundo' }, { type: 'usage', usage: { ...emptyUsage(), completionTokens: 2 } }, finished('Hola mundo')])
    const deltas: unknown[] = []
    const response = await createCLIChatModel(config, { runner: fake.runner }).complete(
      { messages: [{ role: 'system', content: [{ type: 'text', text: 'Responde breve' }] }, user('Saluda')], maxTokens: 100 },
      { onDelta: (e) => deltas.push(e) }
    )
    expect(response.message).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Hola mundo' }] })
    expect(response.finish).toBe('stop')
    expect(deltas).toEqual([{ type: 'text', text: 'Hola ' }, { type: 'text', text: 'mundo' }, { type: 'usage', usage: expect.any(Object) }, { type: 'finished', finish: 'stop' }])
    const task = fake.tasks[0]
    expect(task.system).toBe('Responde breve')
    expect(task.allowWeb).toBe(false)
    expect(task.mcpServers).toBeUndefined()
    expect(task.maxOutputTokens).toBe(100)
  })

  it('los errores de la CLI llegan como AIError del mismo tipo', async () => {
    const fake = fakeRunner(() => {
      throw new AgentError('rateLimited', 'Has alcanzado el límite', 3600)
    })
    const err = await createCLIChatModel(config, { runner: fake.runner }).complete({ messages: [user('a')] }).catch((e) => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.kind).toBe('rateLimited')
    expect(err.retryAfter).toBe(3600)
  })

  it('cancelar es un AIError «cancelled»', async () => {
    const controller = new AbortController()
    const fake = fakeRunner(() => {
      controller.abort()
      return []
    })
    const err = await createCLIChatModel(config, { runner: fake.runner }).complete({ messages: [user('a')] }, { signal: controller.signal }).catch((e) => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.kind).toBe('cancelled')
  })

  it('un proveedor que no es CLI se rechaza', () => {
    expect(() => createCLIChatModel({ id: 'x', kind: 'anthropic', label: 'X' })).toThrow(AIError)
  })
})

describe('Configuración y registro', () => {
  it('ajustes → configuración del agente', () => {
    expect(cliAgentConfig({ id: 'codex-cli', kind: 'codex-cli', label: '', model: 'gpt-6', reasoning: 'auto', executable: '/x/codex' })).toEqual({
      id: 'codex-cli', kind: 'codex', displayName: 'Codex', model: 'gpt-6', executablePath: '/x/codex', reasoningEffort: undefined
    })
    expect(cliKindForProvider('opencode-cli')).toBe('opencode')
    expect(cliKindForProvider('ollama')).toBeUndefined()
  })

  it('registra las tres CLIs con su comprobación de disponibilidad', () => {
    const registered: { kind: string; probe: boolean }[] = []
    registerCLIProviders((kind, _factory, options) => registered.push({ kind, probe: typeof options?.probe === 'function' }))
    expect(registered).toEqual([{ kind: 'claude-cli', probe: true }, { kind: 'codex-cli', probe: true }, { kind: 'opencode-cli', probe: true }])
  })

  it('cómo se lanza el ayudante: el ejecutable de Aula en modo Node con out/main/aula-mcp.js', () => {
    const previous = process.env.AULA_MCP_SCRIPT
    process.env.AULA_MCP_SCRIPT = '/app/out/main/aula-mcp.js'
    try {
      // en la app instalada la variable no cuenta: siempre el script de Aula
      setPackaged(true)
      expect(aulaMCPHelperLaunch().args[0]).toMatch(/aula-mcp\.js$/)
      expect(aulaMCPHelperLaunch().args[0]).not.toBe('/app/out/main/aula-mcp.js')
      setPackaged(false)
      const launch = aulaMCPHelperLaunch()
      expect(launch.command).toBe(process.execPath)
      expect(launch.args).toEqual(['/app/out/main/aula-mcp.js'])
      const spec = aulaMCPServerSpec({ url: 'http://127.0.0.1:1', token: 't' }, { AULA_MCP_NAME: 'aula' })
      expect(spec.env).toMatchObject({ [RELAY_URL_ENV]: 'http://127.0.0.1:1', [RELAY_TOKEN_ENV]: 't', AULA_MCP_NAME: 'aula' })
    } finally {
      setPackaged(true)
      if (previous === undefined) delete process.env.AULA_MCP_SCRIPT
      else process.env.AULA_MCP_SCRIPT = previous
    }
    expect(unpackedPath('/no/existe/app.asar/out/main/aula-mcp.js')).toBe('/no/existe/app.asar/out/main/aula-mcp.js') // sin .unpacked, igual
  })
})
