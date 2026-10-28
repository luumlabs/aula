// Los precios que conoce Aula: la tabla de lista (con fecha), lo aprendido del catálogo de cada proveedor y lo que ponga la
// persona (port de StudyEngine/Costs/PriceBook.swift). Lo aprendido se guarda en <datos>/Cache/prices.json.
import type { AIProviderKind } from '@shared/settings/ai'
import type { ModelCatalog } from '@shared/ai/types'
import { readJSON, writeJSONAtomic } from '../fs'
import { log } from '../log'
import { isFreePrice, isValidPrice, modelPrice, type BillingKind, type ModelPrice, type PriceQuote } from './pricing'

/** Lo mínimo que hace falta saber de un proveedor para cobrar. */
export interface BillingProvider {
  id: string
  kind: AIProviderKind
  label?: string
  baseURL?: string
  model?: string
}

export interface ListPrice {
  /** Id normalizado (ver `normalizeModel`) y alias que son el MISMO modelo. */
  ids: string[]
  price: ModelPrice
  /** Día en que se comprobó contra la página oficial (yyyy-MM-dd). */
  verified: string
  reference: string
}

const ANTHROPIC_PAGE = 'Anthropic: precios de la API (claude.com/pricing)'
const DEEPSEEK_PAGE = 'DeepSeek: página oficial de precios (tarifa punta)'

/**
 * Precios de lista. Escritura en caché: 1,25 × la entrada (5 min); lectura: la de cada modelo. DeepSeek tiene tarifa punta y
 * valle: se usa la PUNTA porque esto alimenta un TOPE (quedarse corto es dejar pasar gasto).
 */
export const LIST_PRICES: ListPrice[] = [
  // Anthropic (comprobado el 6 oct 2026)
  { ids: ['claude-fable-5-1', 'claude-mythos-5-1'], price: modelPrice(10, 50, 0.25, 12.5), verified: '2026-10-06', reference: ANTHROPIC_PAGE },
  { ids: ['claude-fable-5', 'claude-mythos-5'], price: modelPrice(10, 50, 1.0, 12.5), verified: '2026-10-06', reference: ANTHROPIC_PAGE },
  { ids: ['claude-opus-5-5'], price: modelPrice(4, 20, 0.2, 5), verified: '2026-10-06', reference: ANTHROPIC_PAGE },
  { ids: ['claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6'], price: modelPrice(5, 25, 0.5, 6.25), verified: '2026-10-06', reference: ANTHROPIC_PAGE },
  { ids: ['claude-sonnet-5-5', 'claude-sonnet-5'], price: modelPrice(2, 10, 0.2, 2.5), verified: '2026-10-06', reference: ANTHROPIC_PAGE },
  { ids: ['claude-sonnet-4-6'], price: modelPrice(3, 15, 0.3, 3.75), verified: '2026-10-06', reference: ANTHROPIC_PAGE },
  {
    ids: ['claude-haiku-5-5'],
    price: modelPrice(0.1, 0.5, 0.01, 0.125, { aboveInputTokens: 100_000, inputPerMillion: 0.5, outputPerMillion: 2.5 }),
    verified: '2026-10-06', reference: ANTHROPIC_PAGE
  },
  { ids: ['claude-haiku-4-5'], price: modelPrice(1, 5, 0.1, 1.25), verified: '2026-10-06', reference: ANTHROPIC_PAGE },
  // DeepSeek (comprobado el 17 sep 2026; «deepseek-flash» es V4.1 Flash y sus alias son el mismo modelo)
  { ids: ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-1-flash'], price: modelPrice(0.3, 1.2, 0.006), verified: '2026-09-17', reference: DEEPSEEK_PAGE },
  { ids: ['deepseek-v4-pro'], price: modelPrice(1.32, 3.96, 0.044), verified: '2026-09-17', reference: DEEPSEEK_PAGE }
]

/** Cuántos días se fía Aula de un precio aprendido antes de considerarlo viejo (se sigue usando, con «≈»). */
export const LIVE_FRESHNESS_MS = 45 * 86_400_000

export interface LearnedPrice {
  price: ModelPrice
  /** Cuándo se pidió el catálogo (ms). */
  fetchedAt: number
  free: boolean
}

interface PricesFile {
  schema: 1
  prices: Record<string, LearnedPrice>
}

/** «anthropic/claude-sonnet-5.5» → «claude-sonnet-5-5»; «claude-opus-4-6-20260115» → «claude-opus-4-6»… */
export function normalizeModel(model: string): string {
  let s = model.trim().toLowerCase()
  const slash = s.lastIndexOf('/')
  if (slash >= 0) s = s.slice(slash + 1)
  const atIdx = s.indexOf('@')
  if (atIdx >= 0) s = s.slice(0, atIdx)
  if (s.startsWith('anthropic.')) s = s.slice('anthropic.'.length)
  s = s.replace(/-v\d+(:\d+)?$/, '') // Bedrock «-v1:0»
  const colon = s.indexOf(':')
  if (colon >= 0) s = s.slice(0, colon)
  s = s.replace(/-\d{8}$/, '') // fecha de la versión
  s = s.replaceAll('.', '-')
  s = s.replaceAll('-latest', '')
  return s
}

/** La fila de lista de un modelo, por id normalizado EXACTO (nunca por prefijo: «claude-opus-5» no es «claude-opus-5-5»). */
export function listPriceFor(model: string): ListPrice | undefined {
  const n = normalizeModel(model)
  if (!n) return undefined
  return LIST_PRICES.find((r) => r.ids.includes(n))
}

export function dayToMs(iso: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined
  const t = Date.parse(iso + 'T00:00:00Z')
  return Number.isNaN(t) ? undefined : t
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

/** Un servidor en este ordenador (Ollama, LM Studio, llama.cpp): gratis. */
export function isLocalProvider(p: BillingProvider): boolean {
  if (['ollama', 'lmstudio', 'lm-studio', 'local', 'llama-cpp', 'llamacpp'].includes(p.id.toLowerCase())) return true
  if (p.kind === 'ollama' || p.kind === 'lmstudio' || p.kind === 'aula-local') return true
  if (!p.baseURL) return false
  let host = ''
  try {
    host = new URL(p.baseURL.trim()).hostname.toLowerCase()
  } catch {
    return false
  }
  return LOCAL_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local')
}

/** Cómo cobra un proveedor. */
export function billingFor(p: BillingProvider): BillingKind {
  switch (p.kind) {
    case 'claude-cli':
    case 'codex-cli':
      return 'subscription'
    case 'aula-local':
    case 'ollama':
    case 'lmstudio':
      return 'local'
    case 'opencode-cli':
      return 'unknown'
    default:
      return isLocalProvider(p) ? 'local' : 'perToken'
  }
}

const FREE = (): ModelPrice => modelPrice(0, 0, 0, 0)

export class PriceBook {
  private cache: Record<string, LearnedPrice> | null = null

  /** `file`: dónde se guardan los precios aprendidos (`null` = solo en memoria). */
  constructor(readonly file: string | null) {}

  static key(providerID: string, model: string): string {
    return providerID + '|' + model
  }

  private table(): Record<string, LearnedPrice> {
    if (this.cache) return this.cache
    const raw = this.file ? readJSON<PricesFile>(this.file) : null
    const clean: Record<string, LearnedPrice> = {}
    // un archivo editado a mano o de otra versión: solo las filas que se entienden y con precios válidos
    if (raw && typeof raw === 'object' && raw.prices && typeof raw.prices === 'object') {
      for (const [k, v] of Object.entries(raw.prices)) {
        if (v && isValidPrice(v.price) && typeof v.fetchedAt === 'number') clean[k] = { price: v.price, fetchedAt: v.fetchedAt, free: !!v.free }
      }
    }
    this.cache = clean
    return clean
  }

  /** Guarda los precios del catálogo del proveedor (solo de catálogos pedidos a la API). Devuelve cuántos aprendió. */
  learn(catalog: ModelCatalog, provider: Pick<BillingProvider, 'id'>): number {
    if (catalog.source !== 'api') return 0
    const fresh: Record<string, LearnedPrice> = {}
    for (const m of [...catalog.models, ...catalog.popular, ...catalog.free]) {
      const input = m.inputPricePerMillion
      const output = m.outputPricePerMillion
      if (m.isFree && (input === undefined || input === 0) && (output === undefined || output === 0)) {
        fresh[PriceBook.key(provider.id, m.id)] = { price: FREE(), fetchedAt: catalog.fetchedAt, free: true }
        continue
      }
      if (input === undefined || output === undefined) continue
      const p = modelPrice(input, output)
      if (!isValidPrice(p)) continue
      fresh[PriceBook.key(provider.id, m.id)] = { price: p, fetchedAt: catalog.fetchedAt, free: isFreePrice(p) }
    }
    const n = Object.keys(fresh).length
    if (!n) return 0
    const current = { ...this.table(), ...fresh }
    this.cache = current
    if (this.file) {
      try {
        writeJSONAtomic(this.file, { schema: 1, prices: current } satisfies PricesFile, false)
      } catch (err) {
        log.warn('Costes: no se pudieron guardar los precios aprendidos', err)
      }
    }
    return n
  }

  learned(providerID: string, model: string): LearnedPrice | undefined {
    return this.table()[PriceBook.key(providerID, model)]
  }

  /** Vuelve a leer el archivo la próxima vez (otro proceso lo cambió). */
  reload(): void {
    this.cache = null
  }

  /** El precio que se aplicará a `model` (o al del proveedor) y de dónde sale. */
  quote(provider: BillingProvider, rawModel?: string, userPrices: Record<string, ModelPrice> = {}, nowMs = Date.now()): PriceQuote {
    const model = (rawModel ? rawModel : provider.model ?? '').trim()
    const billing = billingFor(provider)
    if (billing === 'subscription' || billing === 'local') return { billing, price: FREE(), source: 'free', exact: true, model }
    // 1. lo que puso la persona: «proveedor:modelo» o solo «modelo» (también normalizado)
    for (const key of [provider.id + ':' + model, model, normalizeModel(model)]) {
      if (!key) continue
      const p = userPrices[key]
      if (isValidPrice(p)) return { billing, price: p, source: 'user', exact: true, model }
    }
    // 2. gratis por nombre (OpenRouter «:free») o aprendido del catálogo
    if (model.toLowerCase().endsWith(':free')) return { billing, price: FREE(), source: 'free', exact: true, model }
    const l = this.learned(provider.id, model)
    if (l) {
      const fresh = nowMs - l.fetchedAt <= LIVE_FRESHNESS_MS
      return { billing, price: l.price, source: l.free ? 'free' : 'live', asOf: l.fetchedAt, exact: fresh, model }
    }
    // 3. la tabla de lista (solo si el proveedor sirve ese modelo a precio de lista: no para OpenCode, que revende)
    if (billing === 'perToken') {
      const row = listPriceFor(model)
      if (row) return { billing, price: row.price, source: 'list', asOf: dayToMs(row.verified), exact: false, model }
    }
    return { billing, exact: false, model }
  }
}
