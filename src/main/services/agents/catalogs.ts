// Modelos de las suscripciones por CLI, según la propia CLI o sus alias documentados (port de `CLIModelCatalogs.swift`):
//  - Claude Code: alias de `--model` (vacío = el predeterminado de la cuenta);
//  - Codex: `codex debug models` (y, sin red, `--bundled`), por prioridad y sin los ocultos;
//  - OpenCode: `opencode models --verbose` (una línea «proveedor/modelo» por modelo, con su JSON de metadatos).
import { tmpdir } from 'node:os'
import type { CLIAgentKind } from '@shared/agents'
import { captureCommand } from './child-process'
import { codexModels } from './codex-account'
import { get, int, isObject, str, tryParse } from './json'
import { childEnvironment, findExecutable, prepareLocator } from './locator'
import { stripANSI } from './probe'

export interface CLIModelInfo {
  id: string
  displayName?: string
  contextLength?: number
  supportsTools?: boolean
  supportsVision?: boolean
  isFree?: boolean
  /** Niveles de razonamiento publicados ([] = no se puede elegir; undefined = no se sabe). */
  reasoningEfforts?: string[]
  defaultEffort?: string
}

/** Alias de Claude Code y el modelo al que apuntan hoy (solo para enseñar; a la CLI va el alias). */
export const CLAUDE_ALIASES: CLIModelInfo[] = [
  { id: 'opus', displayName: 'Opus · Claude Opus 5.5', contextLength: 1_000_000, supportsTools: true, supportsVision: true },
  { id: 'sonnet', displayName: 'Sonnet · Claude Sonnet 5.5', contextLength: 1_000_000, supportsTools: true, supportsVision: true },
  { id: 'haiku', displayName: 'Haiku · Claude Haiku 5.5', contextLength: 1_000_000, supportsTools: true, supportsVision: true },
  { id: 'fable', displayName: 'Fable · Claude Fable 5.1', contextLength: 1_000_000, supportsTools: true, supportsVision: true }
]

export async function cliModelCatalog(kind: CLIAgentKind, executablePath?: string, codexHome?: string): Promise<CLIModelInfo[]> {
  if (kind === 'claude') return CLAUDE_ALIASES.map((m) => ({ ...m }))
  await prepareLocator()
  if (kind === 'codex') {
    const exe = findExecutable('codex', executablePath)
    if (!exe) return []
    return (await codexModels(exe, codexHome)).map((m) => ({
      id: m.id,
      displayName: m.displayName,
      contextLength: m.contextLength,
      supportsTools: m.supportsTools,
      supportsVision: m.supportsVision,
      reasoningEfforts: m.reasoningEfforts,
      defaultEffort: m.defaultEffort
    }))
  }
  const exe = findExecutable('opencode', executablePath)
  if (!exe) return []
  const out = await captureCommand(exe, ['models', '--verbose'], { env: childEnvironment({ OPENCODE_DISABLE_AUTOUPDATE: '1' }), cwd: tmpdir(), timeoutMs: 20_000 })
  return parseOpenCodeModels(out?.stdout.toString('utf8') ?? '')
}

const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

/** Líneas «proveedor/modelo» de `opencode models` (sin colores ni cabeceras), con el JSON de `--verbose` si lo hay. */
export function parseOpenCodeModels(text: string): CLIModelInfo[] {
  const seen = new Set<string>()
  const models: CLIModelInfo[] = []
  let metadata = ''
  for (const raw of stripANSI(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._:/-]+$/.test(line)) {
      metadata = ''
      if (!seen.has(line)) {
        seen.add(line)
        models.push({ id: line, isFree: line.endsWith('-free') || line.endsWith(':free'), reasoningEfforts: [] })
      }
      continue
    }
    if (models.length === 0 || (!metadata && !line.startsWith('{'))) continue
    metadata += line + '\n'
    const json = tryParse(metadata)
    if (!isObject(json)) continue
    const model = models[models.length - 1]
    const variants = get(json, 'variants')
    if (isObject(variants)) {
      model.reasoningEfforts = Object.keys(variants).sort((a, b) => {
        const ai = EFFORT_ORDER.indexOf(a) < 0 ? EFFORT_ORDER.length : EFFORT_ORDER.indexOf(a)
        const bi = EFFORT_ORDER.indexOf(b) < 0 ? EFFORT_ORDER.length : EFFORT_ORDER.indexOf(b)
        return ai === bi ? (a < b ? -1 : a > b ? 1 : 0) : ai - bi
      })
    }
    const name = str(json.name)
    if (name) model.displayName = name
    const context = int(get(json, 'limit', 'context'))
    if (context !== undefined) model.contextLength = context
    metadata = ''
  }
  return models
}
