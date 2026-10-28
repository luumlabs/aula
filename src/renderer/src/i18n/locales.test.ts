// Comprobaciones de los textos de la interfaz (es/en): mismas claves, mismas interpolaciones, plurales con `count`
// y tipografía del inglés (sin comillas españolas «»).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, 'locales')
const LANGS = ['es', 'en'] as const
const PLURAL = /_(zero|one|two|few|many|other)$/

type Flat = Record<string, string>

function flatten(value: unknown, prefix = '', out: Flat = {}): Flat {
  if (typeof value === 'string') out[prefix] = value
  else if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  }
  return out
}

function load(lang: string): Record<string, Flat> {
  const out: Record<string, Flat> = {}
  for (const file of readdirSync(join(ROOT, lang)).filter((f) => f.endsWith('.json'))) {
    out[file.replace(/\.json$/, '')] = flatten(JSON.parse(readFileSync(join(ROOT, lang, file), 'utf8')))
  }
  return out
}

const all = { es: load('es'), en: load('en') }
const vars = (s: string) => [...s.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]).sort()
const base = (k: string) => k.replace(PLURAL, '')
/** Es una forma de plural si existe su `_other` (así «calendar_too_many» no cuenta como plural). */
const isPlural = (k: string, keys: Flat) => PLURAL.test(k) && `${base(k)}_other` in keys
const baseIn = (keys: Flat) => (k: string) => (isPlural(k, keys) ? base(k) : k)

describe('textos de la interfaz', () => {
  it('es y en tienen los mismos espacios de nombres', () => {
    expect(Object.keys(all.en).sort()).toEqual(Object.keys(all.es).sort())
  })

  it('es y en tienen las mismas claves (los plurales pueden tener formas distintas)', () => {
    const problems: string[] = []
    for (const ns of Object.keys(all.es)) {
      const es = new Set(Object.keys(all.es[ns]).map(baseIn(all.es[ns])))
      const en = new Set(Object.keys(all.en[ns] ?? {}).map(baseIn(all.en[ns] ?? {})))
      for (const k of es) if (!en.has(k)) problems.push(`falta en en: ${ns}:${k}`)
      for (const k of en) if (!es.has(k)) problems.push(`falta en es: ${ns}:${k}`)
    }
    expect(problems).toEqual([])
  })

  it('las interpolaciones {{…}} coinciden entre es y en', () => {
    const problems: string[] = []
    for (const ns of Object.keys(all.es)) {
      for (const [k, es] of Object.entries(all.es[ns])) {
        const en = all.en[ns]?.[k] ?? all.en[ns]?.[`${base(k)}_other`]
        if (en === undefined) continue
        const a = [...new Set(vars(es))].filter((v) => v !== 'count')
        const b = [...new Set(vars(en))].filter((v) => v !== 'count')
        if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${ns}:${k} es=${a} en=${b}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('todo texto con {{count}} tiene formas de plural _one y _other', () => {
    const problems: string[] = []
    for (const lang of LANGS) {
      for (const [ns, keys] of Object.entries(all[lang])) {
        for (const [k, v] of Object.entries(keys)) {
          if (!isPlural(k, keys) && /\{\{\s*count\b/.test(v)) problems.push(`${lang} ${ns}:${k} usa {{count}} sin plural`)
          if (isPlural(k, keys)) {
            const b = base(k)
            if (!(`${b}_one` in keys) || !(`${b}_other` in keys)) problems.push(`${lang} ${ns}:${b} sin _one/_other`)
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('los plurales en singular no dicen «1 modelos» (el _one no lleva palabras en plural tras {{count}})', () => {
    const problems: string[] = []
    for (const [ns, keys] of Object.entries(all.es)) {
      for (const [k, v] of Object.entries(keys)) {
        if (k.endsWith('_one') && /\{\{count\}\}\s+\p{L}+s(?!\p{L})/u.test(v) && !/\{\{count\}\}\s+(más|mes|vez|lunes|martes|miércoles|jueves|viernes|análisis|tesis|crisis|virus|tokens?)(?!\p{L})/u.test(v)) {
          problems.push(`es ${ns}:${k} = ${v}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('los textos en inglés no llevan comillas españolas «» ni rayas pegadas a la española', () => {
    const problems: string[] = []
    for (const [ns, keys] of Object.entries(all.en)) {
      for (const [k, v] of Object.entries(keys)) {
        if (/[«»]/.test(v)) problems.push(`en ${ns}:${k} = ${v}`)
        if (/\s—\S[^—]*\S—\s/.test(v)) problems.push(`en ${ns}:${k} (raya) = ${v}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('los textos en español no llevan comillas inglesas “” ni rectas', () => {
    const problems: string[] = []
    for (const [ns, keys] of Object.entries(all.es)) {
      for (const [k, v] of Object.entries(keys)) if (/[“”"]/.test(v)) problems.push(`es ${ns}:${k} = ${v}`)
    }
    expect(problems).toEqual([])
  })
})
