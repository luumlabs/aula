// Configuración de servidores MCP para cada CLI, sin tocar nunca la configuración del usuario
// (port de `AgentKit/CLI/MCPConfigWriter.swift`).
import { sanitizeName } from '../../mcp/protocol'
import { compactJSON } from './json'
import type { MCPServerSpec } from './types'

// MARK: Claude Code

/** `{"mcpServers":{nombre:{command,args,env}}}` para `claude --mcp-config` (claves ordenadas, determinista). */
export function claudeMCPConfig(servers: MCPServerSpec[]): string {
  const entries: Record<string, unknown> = {}
  for (const server of servers) entries[server.name] = { command: server.command, args: server.args ?? [], env: server.env ?? {} }
  return compactJSON({ mcpServers: entries })
}

// MARK: Codex

/**
 * Pares `-c clave=valor` (valores TOML escapados) que declaran los servidores en `mcp_servers.<nombre>`. Se usan `-c` y no un
 * `CODEX_HOME` temporal porque la sesión de ChatGPT vive en `CODEX_HOME`. Nombres normalizados a `[A-Za-z0-9_-]`; cada servidor
 * aprueba sus herramientas (en modo no interactivo nadie podría aprobarlas) y lleva plazos amplios.
 */
export function codexMCPOverrides(servers: MCPServerSpec[], startupTimeout = 60, toolTimeout = 300): string[] {
  const args: string[] = []
  const used = new Set<string>()
  for (const server of servers) {
    let name = sanitizeName(server.name)
    let suffix = 2
    while (used.has(name)) name = `${sanitizeName(server.name)}_${suffix++}`
    used.add(name)
    const add = (key: string, value: string): void => {
      args.push('-c', `mcp_servers.${name}.${key}=${value}`)
    }
    add('command', toml(server.command))
    add('args', '[' + (server.args ?? []).map(toml).join(', ') + ']')
    const env = Object.entries(server.env ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    if (env.length > 0) add('env', '{ ' + env.map(([k, v]) => `${tomlKey(k)} = ${toml(v)}`).join(', ') + ' }')
    add('default_tools_approval_mode', toml('approve'))
    add('startup_timeout_sec', String(startupTimeout))
    add('tool_timeout_sec', String(toolTimeout))
  }
  return args
}

/** Cadena TOML básica con escapes (`\\`, `\"`, `\n`, `\t`, `\r`, `\b`, `\f`, `\uXXXX` para el resto de controles). */
export function toml(value: string): string {
  let out = '"'
  for (const ch of value) {
    const code = ch.codePointAt(0)!
    if (ch === '\\') out += '\\\\'
    else if (ch === '"') out += '\\"'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\r') out += '\\r'
    else if (code === 0x08) out += '\\b'
    else if (code === 0x0c) out += '\\f'
    else if (code < 0x20 || code === 0x7f) out += '\\u' + code.toString(16).toUpperCase().padStart(4, '0')
    else out += ch
  }
  return out + '"'
}

/** Clave TOML: sin comillas si es «bare» (`A-Za-z0-9_-`), con comillas si no. */
export function tomlKey(key: string): string {
  return key && /^[A-Za-z0-9_-]+$/.test(key) ? key : toml(key)
}

// MARK: OpenCode

export interface OpenCodeAgentDefinition {
  name: string
  prompt: string
  steps?: number
  temperature?: number
  model?: string
}

/** Permisos que se deniegan por nombre (el orden importa: «gana la última regla que coincide»). */
export const OPENCODE_DENIED_PERMISSIONS = [
  'bash', 'edit', 'read', 'glob', 'grep', 'list', 'task', 'skill', 'lsp', 'question', 'todowrite', 'todoread', 'codesearch',
  'external_directory', 'doom_loop', 'plan_enter', 'plan_exit'
]

/**
 * Plazo de OpenCode por servidor MCP (desde 1.19 vale también para cada llamada). Las herramientas de Aula pueden esperar a
 * que el estudiante conteste una tarjeta de permiso: 10 minutos.
 */
export const OPENCODE_MCP_TIMEOUT_MS = 600_000

export function openCodeToolPattern(server: MCPServerSpec): string {
  return sanitizeName(server.name) + '_*'
}

export function openCodePermissionJSON(servers: MCPServerSpec[], allowWeb: boolean): string {
  const entries: [string, string][] = [['*', 'deny']]
  for (const name of OPENCODE_DENIED_PERMISSIONS) entries.push([name, 'deny'])
  for (const server of servers) entries.push([openCodeToolPattern(server), 'allow'])
  entries.push(['webfetch', allowWeb ? 'allow' : 'deny'])
  entries.push(['websearch', allowWeb ? 'allow' : 'deny'])
  // el orden de las claves importa, así que se escribe a mano
  return '{' + entries.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',') + '}'
}

/** Configuración efímera completa (JSON) para `OPENCODE_CONFIG_CONTENT`: servidores MCP, permisos y (opcional) el agente. */
export function openCodeConfigJSON(servers: MCPServerSpec[], allowWeb: boolean, agent?: OpenCodeAgentDefinition): string {
  const mcp: Record<string, unknown> = {}
  for (const server of servers) {
    mcp[sanitizeName(server.name)] = {
      type: 'local',
      command: [server.command, ...(server.args ?? [])],
      environment: server.env ?? {},
      enabled: true,
      timeout: OPENCODE_MCP_TIMEOUT_MS
    }
  }
  const root: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    autoupdate: false,
    share: 'disabled',
    snapshot: false,
    mcp
  }
  if (agent) {
    const definition: Record<string, unknown> = { mode: 'primary', description: 'Agente de estudio de Aula', prompt: agent.prompt }
    if (agent.steps !== undefined) definition.steps = agent.steps
    if (agent.temperature !== undefined) definition.temperature = agent.temperature
    if (agent.model) definition.model = agent.model
    root.agent = { [agent.name]: definition }
    root.default_agent = agent.name
  }
  // `permission` se inserta a mano para conservar el orden de las reglas
  const text = compactJSON(root)
  return defuseOpenCode(text.slice(0, -1) + ',"permission":' + openCodePermissionJSON(servers, allowWeb) + '}')
}

/**
 * OpenCode sustituye `{env:VAR}` y `{file:ruta}` en TODO el texto de la configuración. Si un texto externo (apuntes en el
 * prompt) trajera ese patrón, su contenido se expandiría y viajaría al modelo: se neutraliza con un espacio de ancho cero.
 */
export function defuseOpenCode(text: string): string {
  return text.replaceAll('{env:', '{​env:').replaceAll('{file:', '{​file:')
}
