// Ida y vuelta de TODOS los archivos JSON del curso de demostración (resources/demo-course): leer → escribir → leer da lo mismo
// y lo escrito conserva cada clave y cada valor del original (solo puede añadir las claves no opcionales que Swift escribe).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isJSONObject, parseJSON, RawNumber, stringifyJSON } from '@engine/base/json'
import { decodePack, decodeProgress, decodeSkill, decodeSourceChunk, encodePack, encodeProgress, encodeSkill, encodeSourceChunk } from './index'

const DEMO = join(__dirname, '../../../resources/demo-course/Packs/exam-2-math112')
const rt = (v: unknown): unknown => parseJSON(stringifyJSON(v))

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : n.endsWith('.json') ? [p] : []
  })
}

/**
 * Diferencias entre el original y lo escrito: claves que faltan y valores que cambian. Las claves nuevas no cuentan
 * (son los valores por defecto que la app Swift también escribe). Las listas deben tener la misma longitud.
 */
function lost(original: unknown, written: unknown, path = '$'): string[] {
  if (original instanceof RawNumber || written instanceof RawNumber) return String(original) === String(written) ? [] : [`${path}: ${String(original)} → ${String(written)}`]
  if (Array.isArray(original)) {
    if (!Array.isArray(written)) return [`${path}: ya no es una lista`]
    const out = original.flatMap((x, i) => lost(x, written[i], `${path}[${i}]`))
    return original.length === written.length ? out : [...out, `${path}: ${original.length} → ${written.length} elementos`]
  }
  if (isJSONObject(original)) {
    if (!isJSONObject(written)) return [`${path}: ya no es un objeto`]
    return Object.keys(original).flatMap((k) => (k in written ? lost(original[k], written[k], `${path}.${k}`) : [`${path}.${k}: falta`]))
  }
  return original === written ? [] : [`${path}: ${JSON.stringify(original)?.slice(0, 60)} → ${JSON.stringify(written)?.slice(0, 60)}`]
}

interface Codec { decode: (raw: unknown) => unknown; encode: (v: never) => unknown }

function codecFor(rel: string): Codec {
  if (rel === 'pack.json') return { decode: decodePack, encode: encodePack as Codec['encode'] }
  if (rel === 'progress.json') return { decode: decodeProgress, encode: encodeProgress as Codec['encode'] }
  if (rel.startsWith('skills/')) return { decode: decodeSkill, encode: encodeSkill as Codec['encode'] }
  if (rel.endsWith('chunks.json')) {
    return {
      decode: (raw) => (Array.isArray(raw) ? raw.map((c) => decodeSourceChunk(c)) : []),
      encode: ((v: ReturnType<typeof decodeSourceChunk>[]) => v.map((c) => (c ? encodeSourceChunk(c) : null))) as Codec['encode']
    }
  }
  throw new Error(`archivo sin decodificador: ${rel}`)
}

describe('curso de demostración: ida y vuelta', () => {
  const files = walk(DEMO).map((f) => relative(DEMO, f).split('\\').join('/')).sort()

  it('trae todos los archivos del curso', () => {
    expect(files).toContain('pack.json')
    expect(files).toContain('progress.json')
    expect(files.filter((f) => f.startsWith('skills/')).length).toBe(8)
    expect(files.filter((f) => f.endsWith('chunks.json')).length).toBe(3)
  })

  for (const rel of files) {
    it(rel, () => {
      const raw = parseJSON(readFileSync(join(DEMO, rel), 'utf8'))
      const { decode, encode } = codecFor(rel)
      const model = decode(raw)
      const written = rt(encode(model as never))
      // leer lo escrito da el mismo modelo
      expect(decode(written)).toEqual(model)
      // nada se pierde ni cambia
      expect(lost(raw, written)).toEqual([])
      // escribir otra vez da los mismos bytes (estable)
      expect(stringifyJSON(encode(decode(written) as never))).toBe(stringifyJSON(written))
    })
  }

  it('el curso tiene el contenido esperado', () => {
    const pack = decodePack(parseJSON(readFileSync(join(DEMO, 'pack.json'), 'utf8')))
    expect(pack.id).toBe('exam-2-math112')
    expect(pack.skills).toHaveLength(8)
    expect(pack.icon).toBe('trigonometry')
    for (const ref of pack.skills) {
      const s = decodeSkill(parseJSON(readFileSync(join(DEMO, 'skills', `${ref.id}.json`), 'utf8')))
      expect(s.id).toBe(ref.id)
      // ningún bloque ni respuesta del curso queda como desconocido
      const unknownBlocks = [...s.lesson, ...s.exercises.flatMap((e) => [...e.prompt, ...e.solution])].filter((b) => b.type === 'unknown')
      expect(unknownBlocks, ref.id).toEqual([])
      expect(s.exercises.filter((e) => e.answer.kind === 'unknown'), ref.id).toEqual([])
      // los recuentos del plan coinciden con el contenido
      expect(ref.counts.lessonBlocks, ref.id).toBe(s.lesson.length)
      expect(ref.counts.exercises, ref.id).toBe(s.exercises.length)
    }
  })
})
