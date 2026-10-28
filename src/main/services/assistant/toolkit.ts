// Piezas comunes de las herramientas del chat, del tutor y de la memoria (como `ToolOut`, `ToolArgs` y `Schema` de AICore):
// salidas en JSON para la IA, lectura tolerante de argumentos y esquemas JSON compactos.
import type { JSONObject, JSONSchema, JSONValue } from '@shared/ai/json'
import type { AgentTool, ToolContext, ToolOutput } from '../ai/model'

/** Resultado en JSON (claves en inglés: lo lee el modelo). */
export function outJSON(value: JSONObject): ToolOutput {
  return { text: JSON.stringify(value) }
}

/** Error para la IA: `{ok:false, error, hint?}` (no rompe el bucle: el modelo lo lee y se corrige). */
export function outError(message: string, hint?: string): ToolOutput {
  const o: JSONObject = { ok: false, error: message }
  if (hint) o.hint = hint
  return { text: JSON.stringify(o), isError: true }
}

/** Lectura tolerante de los argumentos que escribió la IA (nombres alternativos, números como texto…). */
export class ToolArgs {
  readonly v: JSONObject
  constructor(raw: unknown) {
    this.v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as JSONObject) : {}
  }

  private pick(key: string, alt: string[]): JSONValue | undefined {
    for (const k of [key, ...alt]) {
      const x = this.v[k]
      if (x !== undefined && x !== null) return x
    }
    return undefined
  }

  string(key: string, alt: string[] = []): string | undefined {
    const x = this.pick(key, alt)
    if (typeof x === 'string') return x.trim() === '' ? undefined : x
    if (typeof x === 'number' || typeof x === 'boolean') return String(x)
    return undefined
  }

  int(key: string, alt: string[] = []): number | undefined {
    const x = this.pick(key, alt)
    const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN
    return Number.isFinite(n) ? Math.trunc(n) : undefined
  }

  number(key: string, alt: string[] = []): number | undefined {
    const x = this.pick(key, alt)
    const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN
    return Number.isFinite(n) ? n : undefined
  }

  bool(key: string, alt: string[] = []): boolean | undefined {
    const x = this.pick(key, alt)
    if (typeof x === 'boolean') return x
    if (typeof x === 'string') {
      const s = x.trim().toLowerCase()
      if (['true', 'yes', 'si', 'sí', '1'].includes(s)) return true
      if (['false', 'no', '0'].includes(s)) return false
    }
    if (typeof x === 'number') return x !== 0
    return undefined
  }

  array(key: string, alt: string[] = []): JSONValue[] | undefined {
    const x = this.pick(key, alt)
    if (Array.isArray(x)) return x
    // algunos modelos mandan la lista como texto JSON
    if (typeof x === 'string' && x.trim().startsWith('[')) {
      try {
        const p = JSON.parse(x) as unknown
        if (Array.isArray(p)) return p as JSONValue[]
      } catch { /* no es una lista */ }
    }
    return undefined
  }

  strings(key: string, alt: string[] = []): string[] | undefined {
    const a = this.array(key, alt)
    if (a) return a.flatMap((x) => (typeof x === 'string' ? [x] : typeof x === 'number' ? [String(x)] : []))
    const one = this.string(key, alt)
    return one !== undefined ? [one] : undefined
  }

  object(key: string): JSONObject | undefined {
    const x = this.v[key]
    return x && typeof x === 'object' && !Array.isArray(x) ? (x as JSONObject) : undefined
  }

  /** Los argumentos sin estas claves (para reenviarlos a otra herramienta). */
  without(...keys: string[]): JSONObject {
    const out: JSONObject = { ...this.v }
    for (const k of keys) delete out[k]
    return out
  }
}

// MARK: Esquemas

type Field = [string, JSONSchema]

export const Schema = {
  string(description?: string, values?: readonly string[]): JSONSchema {
    const s: JSONSchema = { type: 'string' }
    if (description) s.description = description
    if (values) s.enum = [...values]
    return s
  },
  integer(description?: string, min?: number, max?: number): JSONSchema {
    const s: JSONSchema = { type: 'integer' }
    if (description) s.description = description
    if (min !== undefined) s.minimum = min
    if (max !== undefined) s.maximum = max
    return s
  },
  number(description?: string): JSONSchema {
    return description ? { type: 'number', description } : { type: 'number' }
  },
  boolean(description?: string): JSONSchema {
    return description ? { type: 'boolean', description } : { type: 'boolean' }
  },
  array(items: JSONSchema, description?: string): JSONSchema {
    const s: JSONSchema = { type: 'array', items }
    if (description) s.description = description
    return s
  },
  /** Objeto libre (cualquier clave). */
  free(description?: string): JSONSchema {
    const s: JSONSchema = { type: 'object', additionalProperties: true }
    if (description) s.description = description
    return s
  },
  object(fields: Field[], required: string[] = [], additional = false): JSONSchema {
    const s: JSONSchema = { type: 'object', properties: Object.fromEntries(fields) as Record<string, JSONSchema>, additionalProperties: additional }
    if (required.length) s.required = required
    return s
  }
}

/** Una herramienta a partir de su especificación y su manejador (los argumentos llegan ya leídos). */
export function tool(name: string, description: string, inputSchema: JSONSchema, run: (a: ToolArgs, ctx: ToolContext) => Promise<ToolOutput> | ToolOutput): AgentTool {
  return { name, description, inputSchema, run: (args, ctx) => run(new ToolArgs(args), ctx) }
}

/** Texto de una salida de herramienta (para leerla en las pruebas o reenviarla). */
export function outputText(o: string | ToolOutput): string {
  return typeof o === 'string' ? o : o.text
}

/** Sin nombres repetidos (gana la primera). */
export function uniqueTools(tools: AgentTool[]): AgentTool[] {
  const seen = new Set<string>()
  return tools.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)))
}
