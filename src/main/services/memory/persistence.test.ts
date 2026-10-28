// Memoria · persistencia y lo que llega a la IA (adaptado de las pruebas de Luna: test_memory_legacy_secrets.py,
// test_memory_read_consistency.py y test_store_concurrencia.py): varias instancias sobre la misma carpeta, copias que se
// limpian al olvidar, credenciales antiguas que nunca salen hacia el modelo, lo delicado fuera de los cursos, variedad en lo
// que se recupera y límites de lo pendiente.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatRequest } from '@shared/ai/types'
import { messageText } from '@shared/ai/types'
import { redactForExtraction, secretReason } from '@engine/assistant'
import { MockChatModel, reply } from '../ai/testing/mocks'
import { outputText } from '../assistant/toolkit'
import { backupPath } from '../fs'
import { courseBrief } from './index'
import type { MemoryDraft, MemoryHit, MemoryKind, MemoryRecord } from './models'
import { diversify } from './ranker'
import { isTrivialQuery, MemoryService } from './service'
import { memoryTools } from './tools'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function folder(): string {
  const d = mkdtempSync(join(tmpdir(), 'aula-mem-p-'))
  dirs.push(d)
  return join(d, 'Memory')
}
const draft = (text: string, kind: MemoryKind = 'preference', more: Partial<MemoryDraft> = {}): MemoryDraft => ({ kind, text, source: 'student', confidence: 0.9, ...more })
const CANARY = 'Mi clave API es sk-proj-' + 'z'.repeat(56)

/** Escribe `memories.json` a mano, como lo dejaría una versión anterior (sin la puerta de credenciales). */
function legacyFile(dir: string, records: Array<Partial<MemoryRecord> & { text: string }>): void {
  const m = new MemoryService({ folder: dir })
  m.disk.ensureFolder()
  const now = new Date().toISOString()
  writeFileSync(m.disk.recordsPath, JSON.stringify({ schema: 1, records: records.map((r, i) => ({ id: `m-old${i}`, kind: 'other', source: 'student', confidence: 0.9, createdAt: now, updatedAt: now, uses: 0, confirmations: 0, sensitive: false, editedByStudent: true, ...r })) }))
}

describe('varias instancias sobre la misma carpeta', () => {
  it('ninguna pisa lo que escribió la otra (recordar, corregir, olvidar)', async () => {
    const dir = folder()
    const a = new MemoryService({ folder: dir })
    const b = new MemoryService({ folder: dir })
    await a.remember(draft('Prefiere explicaciones cortas'))
    await b.remember(draft('Estudia ingeniería en la UNX', 'studies'))
    await a.remember(draft('Su examen de química es el 2026-11-20', 'exam'))
    expect(new Set(b.records().map((r) => r.text))).toEqual(new Set(['Prefiere explicaciones cortas', 'Estudia ingeniería en la UNX', 'Su examen de química es el 2026-11-20']))
    const id = b.records().find((r) => r.kind === 'studies')!.id
    await a.edit(id, 'Estudia ingeniería química en la UNX')
    b.forget([b.records().find((r) => r.kind === 'preference')!.id])
    const texts = new MemoryService({ folder: dir }).records().map((r) => r.text).sort()
    expect(texts).toEqual(['Estudia ingeniería química en la UNX', 'Su examen de química es el 2026-11-20'])
    expect(a.records().map((r) => r.text).sort()).toEqual(texts)
  })
})

describe('olvidar no deja copias', () => {
  it('ni en la versión anterior ni en las copias de archivos dañados', async () => {
    const dir = folder()
    const m = new MemoryService({ folder: dir })
    await m.remember(draft('Su color favorito es el turquesa', 'other'))
    await m.remember(draft('Estudia por las noches', 'schedule'))
    const bak = backupPath(m.disk.recordsPath)
    expect(readFileSync(bak, 'utf8')).toContain('turquesa')
    // una copia de un archivo dañado que lo contiene (y otra que no)
    writeFileSync(join(dir, 'memories.json.damaged-aaaa000000'), '{"records":[{"text":"Su color favorito es el turquesa"')
    writeFileSync(join(dir, 'memories.json.damaged-bbbb000000'), '{"records":[{"text":"Otra cosa"')
    m.forget([m.records().find((r) => r.text.includes('turquesa'))!.id])
    for (const n of readdirSync(dir)) expect(readFileSync(join(dir, n), 'utf8'), n).not.toContain('turquesa')
    expect(existsSync(join(dir, 'memories.json.damaged-bbbb000000'))).toBe(true)
    expect(new MemoryService({ folder: dir }).records().map((r) => r.text)).toEqual(['Estudia por las noches'])
  })
})

describe('lo que llega a la IA', () => {
  it('una credencial guardada antes de la puerta se ve en el panel pero nunca sale hacia el modelo', async () => {
    const dir = folder()
    legacyFile(dir, [{ text: CANARY }, { text: 'La ubicación de entrega es Barcelona', kind: 'preference' }])
    const prompts: string[] = []
    const model = new MockChatModel((req: ChatRequest) => { prompts.push(req.messages.map(messageText).join('\n')); return { events: reply({ text: '{"memories":[],"outdated":[]}' }) } })
    const m = new MemoryService({ folder: dir, model: async () => model, idleDelayMs: 3_600_000 })
    // el panel la enseña (para corregirla o borrarla a propósito)
    expect(m.records(true).map((r) => r.text)).toContain(CANARY)
    // ni el bloque del turno, ni la búsqueda, ni la herramienta, ni la extracción
    const block = await m.context('¿qué recuerdas de mí? clave API Barcelona', { kind: 'assistant' }, 2000)
    expect(block).toContain('Barcelona')
    expect(block).not.toContain('sk-proj')
    expect((await m.search('clave API', 10)).map((h) => h.record.text)).not.toContain(CANARY)
    expect(m.modelRecords().map((r) => r.text)).not.toContain(CANARY)
    const search = memoryTools(m, { source: 'assistant' }).find((t) => t.name === 'memory_search')!
    for (const query of ['', 'clave API']) expect(outputText(await search.run({ query }, {} as never))).not.toContain('sk-proj')
    m.observe({ id: 'chat:c', source: 'assistant', turns: [{ speaker: 'student', text: 'Recuerda que vivo cerca del campus y estudio por las mañanas, gracias' }] }, false)
    await m.learn('chat:c')
    expect(prompts.length).toBe(1)
    expect(prompts[0]).not.toContain('sk-proj')
    // olvidarla tampoco la devuelve al modelo
    const forget = memoryTools(m, { source: 'assistant' }).find((t) => t.name === 'memory_forget')!
    const out = outputText(await forget.run({ id: 'm-old0' }, {} as never))
    expect(out).not.toContain('sk-proj')
    expect(m.records(true).map((r) => r.text)).not.toContain(CANARY)
  })

  it('lo delicado (confirmado) ayuda al tutor, pero nunca entra en la creación de un curso', async () => {
    const m = new MemoryService({ folder: folder() })
    await m.remember(draft('Tiene TDAH y prefiere sesiones de 20 minutos', 'learning', { confirmedByStudent: true }))
    await m.remember(draft('Prefiere ejemplos de fútbol', 'learning'))
    expect(m.records().find((r) => r.text.includes('TDAH'))?.sensitive).toBe(true)
    const tutor = await m.context('¿cómo organizo la sesión de hoy?', { kind: 'tutor', courseID: 'c' }, 2000)
    expect(tutor).toContain('TDAH')
    const brief = courseBrief('author', { title: 'Curso de física', topics: 'sesiones cortas' }, 900, m)
    expect(brief).toContain('fútbol')
    expect(brief).not.toContain('TDAH')
  })

  it('«ok» o «gracias» no buscan recuerdos «relevantes», solo lo esencial', async () => {
    for (const q of ['ok', 'Gracias!', 'vale, gracias', 'sí', 'thanks', '👍']) expect(isTrivialQuery(q), q).toBe(true)
    for (const q of ['¿cuándo es mi examen?', 'explícame el seno', 'ok, ¿y la tarea de física?']) expect(isTrivialQuery(q), q).toBe(false)
    const m = new MemoryService({ folder: folder() })
    await m.remember(draft('Prefiere explicaciones cortas'))
    await m.remember(draft('Le cuesta la estequiometría en química', 'difficulty'))
    const block = await m.context('ok', { kind: 'assistant' }, 2000)
    expect(block).toContain('explicaciones cortas')
    expect(block).not.toContain('estequiometría')
  })

  it('lo recuperado es variado: dos frases que dicen lo mismo no ocupan dos sitios (MMR de Luna)', () => {
    const rec = (id: string, text: string): MemoryRecord => ({ id, kind: 'difficulty', text, source: 'student', confidence: 0.9, createdAt: '', updatedAt: '', uses: 0, confirmations: 0, sensitive: false, editedByStudent: false })
    const hit = (r: MemoryRecord, score: number): MemoryHit => ({ record: r, score, lexical: 0.5 })
    const v = (x: number[]): number[] => { const n = Math.hypot(...x); return x.map((y) => y / n) }
    const vectors = new Map([['a', v([1, 0, 0])], ['b', v([0.99, 0.05, 0])], ['c', v([0, 1, 0])], ['d', v([0.7, 0.7, 0])]])
    const hits = [hit(rec('a', 'Le cuesta derivar'), 0.9), hit(rec('b', 'Le cuesta mucho derivar'), 0.89), hit(rec('c', 'Le cuesta integrar por partes'), 0.6), hit(rec('d', 'Le cuesta derivar e integrar'), 0.7)]
    const out = diversify(hits, vectors, 3).map((h) => h.record.id)
    expect(out[0]).toBe('a')
    expect(out).not.toContain('b') // gemelo de «a»
    expect(out).toContain('c')
    // sin vectores, por entidades: lo idéntico tampoco se repite
    const lexOnly = diversify([hit(rec('x', 'Examen de Química el 2026-11-20'), 0.9), hit(rec('y', 'Examen de Química el 2026-11-20'), 0.8), hit(rec('z', 'Le cuesta Física'), 0.5)], new Map(), 3).map((h) => h.record.id)
    expect(lexOnly).toEqual(['x', 'z'])
  })
})

describe('límites de lo pendiente', () => {
  it('sin IA no se acumulan conversaciones sin fin ni turnos enormes', () => {
    let now = new Date('2026-10-01T10:00:00Z')
    const m = new MemoryService({ folder: folder(), idleDelayMs: 3_600_000, clock: () => now })
    const long = 'x'.repeat(20_000)
    for (let i = 0; i < 50; i++) {
      now = new Date(now.getTime() + 60_000)
      m.observe({ id: `chat:${i}`, source: 'assistant', turns: [{ speaker: 'student', text: `Conversación ${i}: ${long}` }] }, false)
    }
    const pending = m.disk.loadPending()
    expect(pending.length).toBe(40)
    expect(pending.some((p) => p.id === 'chat:0')).toBe(false)
    expect(Math.max(...pending.map((p) => p.turns[0].text.length))).toBeLessThanOrEqual(4000)
    // lo que se quitó cuenta como ya leído: no vuelve a entrar con los mismos turnos
    m.observe({ id: 'chat:0', source: 'assistant', turns: [{ speaker: 'student', text: 'Conversación 0' }] }, false)
    expect(m.disk.loadPending().some((p) => p.id === 'chat:0')).toBe(false)
    // un mes después, lo pendiente viejo sale al abrir
    now = new Date(now.getTime() + 31 * 86_400_000)
    const again = new MemoryService({ folder: m.folder, idleDelayMs: 3_600_000, clock: () => now })
    expect(again.hasPending()).toBe(false)
  })
})

describe('la puerta de privacidad con textos largos', () => {
  it('no tarda un tiempo cuadrático (un apunte pegado de 50 000 letras no congela la app)', () => {
    for (const long of ['x'.repeat(50_000), 'palabra '.repeat(6000), 'a.'.repeat(25_000)]) {
      const t = performance.now()
      secretReason(long)
      redactForExtraction(long)
      expect(performance.now() - t, long.slice(0, 10)).toBeLessThan(150)
    }
    // y sigue viendo un correo dentro de un texto largo
    expect(secretReason('x'.repeat(10_000) + ' escribe a ana.perez@uni.edu')).toBeDefined()
  })
})
