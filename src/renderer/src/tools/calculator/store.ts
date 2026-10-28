// Cuaderno de la calculadora: historial, variables, `ans` y modo de ángulo. Global (la ventanita flotante y la pantalla
// grande comparten lo mismo) y guardado en localStorage.
import { create } from 'zustand'
import type { MathValue } from '@engine/math/core/types'
import { loadValue, runCalc, storeValue, type CalcIssue, type StoredValue } from './lib/engine'

export interface CalcEntry {
  id: string
  input: string
  tex: string
  value: StoredValue
  /** Comparación (verdadero/falso) o lista de cuentas; sin esto, un número. */
  kind?: 'value' | 'bool' | 'list'
  /** Texto del motor de una lista. */
  text?: string
  /** Forma cerrada del motor (3 + √2). */
  closedTex?: string
  assigned: string | null
  degrees: boolean
  at: number
}

interface Saved {
  entries: CalcEntry[]
  vars: Record<string, StoredValue>
  varOrder: string[]
  ans: StoredValue | null
  degrees: boolean
}

interface CalcState extends Saved {
  input: string
  issue: CalcIssue | null
  /** Posición en el historial al recorrerlo con ↑/↓ (null = escribiendo). */
  cursor: number | null
  draft: string
  setInput: (s: string) => void
  setDegrees: (d: boolean) => void
  submit: () => CalcEntry | null
  remove: (id: string) => void
  clearAll: () => Saved
  restore: (s: Saved) => void
  recall: (dir: -1 | 1) => void
}

const KEY = 'aula.calculator.v1'
const MAX = 200

function load(): Saved {
  const empty: Saved = { entries: [], vars: {}, varOrder: [], ans: null, degrees: false }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty
    const s = JSON.parse(raw) as Partial<Saved>
    const entries = Array.isArray(s.entries) ? s.entries.filter((e) => e && typeof e.input === 'string' && loadValue(e.value)).slice(-MAX) : []
    const vars: Record<string, StoredValue> = {}
    for (const [k, v] of Object.entries(s.vars ?? {})) if (loadValue(v)) vars[k] = v
    return { entries, vars, varOrder: (s.varOrder ?? []).filter((k) => k in vars), ans: s.ans && loadValue(s.ans) ? s.ans : null, degrees: !!s.degrees }
  } catch {
    return empty
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ entries: s.entries, vars: s.vars, varOrder: s.varOrder, ans: s.ans, degrees: s.degrees }))
  } catch {
    /* sin espacio: sigue en memoria */
  }
}

/** Variables y `ans` como valores del motor. */
export function contextOf(s: Pick<Saved, 'vars' | 'ans' | 'degrees'>): { vars: Record<string, MathValue>; ans: MathValue | null; degrees: boolean } {
  const vars: Record<string, MathValue> = {}
  for (const [k, v] of Object.entries(s.vars)) {
    const m = loadValue(v)
    if (m) vars[k] = m
  }
  return { vars, ans: loadValue(s.ans), degrees: s.degrees }
}

let seq = 0

export const useCalc = create<CalcState>((set, get) => ({
  ...load(),
  input: '',
  issue: null,
  cursor: null,
  draft: '',
  setInput: (input) => set({ input, issue: null, cursor: null }),
  setDegrees: (degrees) => {
    set({ degrees })
    save(get())
  },
  submit: () => {
    const s = get()
    if (!s.input.trim()) return null
    const r = runCalc(s.input, contextOf(s))
    if (!r.ok) {
      set({ issue: r.issue })
      return null
    }
    const value = storeValue(r.value)
    const entry: CalcEntry = { id: `${Date.now().toString(36)}-${++seq}`, input: r.input.trim(), tex: r.tex, value, assigned: r.assigned, degrees: s.degrees, at: Date.now() }
    if (r.kind !== 'value') entry.kind = r.kind
    if (r.text) entry.text = r.text
    if (r.closedTex) entry.closedTex = r.closedTex
    const vars = r.assigned ? { ...s.vars, [r.assigned]: value } : s.vars
    const varOrder = r.assigned ? [...s.varOrder.filter((v) => v !== r.assigned), r.assigned] : s.varOrder
    // `ans` solo guarda números (una comparación o una lista no lo cambian)
    const next = { entries: [...s.entries, entry].slice(-MAX), vars, varOrder, ans: r.kind === 'value' ? value : s.ans, degrees: s.degrees }
    set({ ...next, input: '', issue: null, cursor: null })
    save(next)
    return entry
  },
  remove: (id) => {
    const entries = get().entries.filter((e) => e.id !== id)
    set({ entries, cursor: null })
    save({ ...get(), entries })
  },
  clearAll: () => {
    const s = get()
    const before: Saved = { entries: s.entries, vars: s.vars, varOrder: s.varOrder, ans: s.ans, degrees: s.degrees }
    const next: Saved = { entries: [], vars: {}, varOrder: [], ans: null, degrees: s.degrees }
    set({ ...next, issue: null, cursor: null })
    save(next)
    return before
  },
  restore: (saved) => {
    set({ ...saved })
    save(saved)
  },
  recall: (dir) => {
    const s = get()
    const inputs = s.entries.map((e) => e.input)
    if (!inputs.length) return
    if (dir < 0) {
      const c = s.cursor === null ? inputs.length - 1 : Math.max(0, s.cursor - 1)
      set({ cursor: c, input: inputs[c], issue: null, draft: s.cursor === null ? s.input : s.draft })
    } else {
      if (s.cursor === null) return
      if (s.cursor + 1 < inputs.length) set({ cursor: s.cursor + 1, input: inputs[s.cursor + 1], issue: null })
      else set({ cursor: null, input: s.draft, issue: null })
    }
  }
}))
