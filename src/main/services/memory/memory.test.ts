// Memoria del estudiante (port de Tests/StudyEngineTests/MemoryTests.swift): puerta de privacidad, deduplicación y correcciones,
// caducidad, búsqueda híbrida (con un modelo de vectores falso multilingüe), inyección, extracción con una IA falsa, lo deducido
// de la práctica, herramientas, disco y deshacer desde el historial.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fold, STOPWORDS, normalizedKey } from '@engine/assistant'
import type { ChatRequest } from '@shared/ai/types'
import { messageText } from '@shared/ai/types'
import { MockChatModel, reply } from '../ai/testing/mocks'
import type { Embedder, EmbeddingRole } from '../search/hybrid'
import { Library } from '../store/library'
import { installSampleCourses } from '../store/samples'
import { ChangeContext } from '../store/history/context'
import { ChangeHistory } from '../store/history/changeHistory'
import { MemoryService } from './service'
import { parseExtraction } from './extractor'
import { memoryTools } from './tools'
import { parseKind, type MemoryConversation, type MemoryDraft, type MemoryKind, type MemorySource } from './models'
import { courseBrief } from './index'
import { outputText } from '../assistant/toolkit'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'aula-mem-'))
  dirs.push(d)
  return d
}

/** Vectores falsos: cada «concepto» es una dimensión y sus palabras en varios idiomas caen en ella (como haría EmbeddingGemma). */
class FakeEmbedder implements Embedder {
  static concepts: string[][] = [
    ['examen', 'exam', 'exams', 'examenes', 'prueba', 'test', 'quiz', 'parcial'], ['ingles', 'english', 'inglés'], ['quimica', 'química', 'chemistry', 'chemical'],
    ['explicaciones', 'explicacion', 'explanations', 'explanation', 'explain', 'explica'], ['cortas', 'corta', 'short', 'brief', 'breve', 'breves'],
    ['trigonometria', 'trigonometría', 'trigonometry', 'trig', 'seno', 'coseno', 'sine'], ['noche', 'night', 'evening', 'tarde'], ['universidad', 'university', 'college', 'unx'],
    ['graficas', 'gráficas', 'graphs', 'dibujos', 'visual', 'visuals', 'diagramas'], ['lunes', 'monday']
  ]
  modelID = 'fake-1'
  dimensions = FakeEmbedder.concepts.length + 32
  calls = 0
  async embed(texts: string[], _role: EmbeddingRole): Promise<Float32Array[]> {
    this.calls++
    return texts.map((t) => {
      const words = new Set(fold(t).split(' '))
      const v = new Array<number>(this.dimensions).fill(0.02)
      const known = new Set<string>()
      FakeEmbedder.concepts.forEach((c, i) => {
        if (c.some((w) => words.has(fold(w)))) { v[i] += 1; for (const w of c) known.add(fold(w)) }
      })
      for (const w of words) {
        if (w.length > 3 && !known.has(w) && !STOPWORDS.has(w)) {
          let h = 7
          for (const ch of w) h = (h * 31 + ch.codePointAt(0)!) >>> 0
          v[FakeEmbedder.concepts.length + (h % 32)] += 0.35
        }
      }
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
      return Float32Array.from(v.map((x) => x / n))
    })
  }
}

function make(opts: { embedder?: Embedder; library?: Library; now?: Date; model?: MockChatModel; history?: ChangeHistory; folder?: string } = {}): MemoryService {
  const fixed = opts.now
  return new MemoryService({
    folder: opts.folder ?? join(tempDir(), 'Memory'), library: opts.library, embedder: opts.embedder, idleDelayMs: 3_600_000,
    clock: fixed ? () => fixed : undefined, model: opts.model ? async () => opts.model : undefined, history: opts.history
  })
}

const draft = (text: string, kind: MemoryKind = 'preference', more: Partial<MemoryDraft> & { source?: MemorySource } = {}): MemoryDraft => ({ kind, text, source: 'tutor', confidence: 0.9, ...more })

describe('privacidad', () => {
  it('nunca guarda secretos', async () => {
    const m = make()
    const secrets = [
      'Su clave de OpenAI es sk-proj-abcdefghijklmnopqrstuvwx1234', 'La contraseña de Canvas es gato123', 'my password is Hunter2!',
      'Token: ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789', 'Tarjeta 4111 1111 1111 1111', 'Su DNI es 12345678Z', 'SSN 123-45-6789',
      'Escríbele a ana.perez@uni.edu para dudas', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      'Entra con https://alumno:Secreta99@campus.example.edu'
    ]
    for (const s of secrets) expect((await m.remember(draft(s, 'other'))).status, s).toBe('rejectedSecret')
    expect(m.records(true)).toEqual([])
    const raw = existsSync(m.disk.recordsPath) ? readFileSync(m.disk.recordsPath, 'utf8') : ''
    expect(raw.includes('gato123') || raw.includes('sk-proj') || raw.includes('4111')).toBe(false)
    for (const ok of ['La clave para ella es practicar con ejemplos resueltos', 'Su curso es MATH112 en el campus norte', 'Examen el 2026-11-10 a las 10:00']) {
      const r = await m.remember(draft(ok, 'other'))
      expect(['created', 'merged', 'updated', 'reinforced'], `${ok}: ${r.status}`).toContain(r.status)
    }
  })

  it('lo delicado necesita confirmación', async () => {
    const m = make()
    expect((await m.remember(draft('Tiene TDAH y le cuesta concentrarse más de 20 minutos', 'learning'))).status).toBe('rejectedSensitive')
    expect((await m.remember(draft('Tiene mucha ansiedad antes de los exámenes', 'learning'))).status).toBe('rejectedSensitive')
    expect((await m.remember(draft('Le cuesta la depresión del punto de congelación en Química', 'difficulty'))).status).toBe('created')
    const r4 = await m.remember(draft('Tiene TDAH y le cuesta concentrarse más de 20 minutos', 'learning', { confirmedByStudent: true }))
    expect(r4.status).toBe('created')
    expect(r4.record?.sensitive).toBe(true)
    expect((await m.remember(draft('Es católica y no estudia los domingos', 'schedule', { source: 'student' }))).status).toBe('created')
  })
})

describe('deduplicación y correcciones', () => {
  it('fusiona lo repetido y una corrección sustituye', async () => {
    const m = make()
    expect((await m.remember(draft('Prefiere explicaciones cortas'))).status).toBe('created')
    const b = await m.remember(draft('prefiere explicaciones cortas.'))
    expect(b.status).toBe('reinforced')
    expect(b.record?.confirmations).toBe(1)
    expect((await m.remember(draft('Prefiere que las explicaciones sean cortas'))).status).toBe('merged')
    expect(m.records().length).toBe(1)

    const e1 = await m.remember(draft('Tiene el examen de química el 14 de octubre', 'exam'))
    const e2 = await m.remember(draft('Tiene el examen de química el 16 de octubre', 'exam'))
    expect(e2.status).toBe('created')
    expect(e2.replaced.map((r) => r.id)).toEqual([e1.record!.id])
    expect(m.records().filter((r) => r.kind === 'exam').map((r) => r.text)).toEqual(['Tiene el examen de química el 16 de octubre'])
    expect(m.records(true).find((r) => r.id === e1.record!.id)?.supersededBy).toBeDefined()

    await m.remember(draft('Le cuesta la trigonometría', 'difficulty'))
    const n = await m.remember(draft('Ya no le cuesta la trigonometría', 'difficulty'))
    expect(n.replaced.length).toBe(1)
    expect(m.records().filter((r) => r.kind === 'difficulty').map((r) => r.text)).toEqual(['Ya no le cuesta la trigonometría'])
    await m.remember(draft('Le cuesta la química orgánica', 'difficulty'))
    expect(m.records().filter((r) => r.kind === 'difficulty').length).toBe(2)

    const back = await m.remember(draft('Tiene el examen de química el 14 de octubre', 'exam'))
    expect(back.status).toBe('reinforced')
    expect(m.records().filter((r) => r.kind === 'exam').map((r) => r.text)).toEqual(['Tiene el examen de química el 14 de octubre'])
  })

  it('la misma clave actualiza en su sitio', async () => {
    const m = make()
    const a = await m.remember(draft('Quiere sacar un 8 en el parcial de física', 'goal', { key: 'goal:fisica-parcial' }))
    const b = await m.remember(draft('Ahora quiere sacar al menos un 9 en el parcial de física', 'goal', { key: 'goal:fisica-parcial' }))
    expect(b.status).toBe('updated')
    expect(b.record?.id).toBe(a.record?.id)
    expect(m.records().map((r) => r.text)).toEqual(['Ahora quiere sacar al menos un 9 en el parcial de física'])
  })

  it('con vectores, el mismo hecho en otro idioma se fusiona', async () => {
    const m = make({ embedder: new FakeEmbedder() })
    await m.remember(draft('Prefiere explicaciones cortas'))
    const r = await m.remember(draft('Prefers short explanations'))
    expect(r.status).toBe('merged')
    expect(m.records().length).toBe(1)
  })

  it('vectores casi idénticos no juntan hechos distintos', async () => {
    const same: Embedder = { modelID: 'same', dimensions: 2, embed: async (t) => t.map(() => Float32Array.from([0.6, 0.8])) }
    const m = make({ embedder: same })
    await m.remember(draft('Le cuesta la química', 'difficulty'))
    const b = await m.remember(draft('Le cuesta la física', 'difficulty'))
    expect(b.status).toBe('created')
    expect(b.replaced).toEqual([])
    const c = await m.remember(draft('Aprende mejor con gráficas', 'learning'))
    const d = await m.remember(draft('Aprende mejor con ejemplos resueltos', 'learning'))
    expect([c.status, d.status]).toEqual(['created', 'created'])
    await m.remember(draft('Prefiere explicaciones cortas'))
    const e = await m.remember(draft('Prefers short explanations'))
    expect(e.status).toBe('merged')
    expect(e.record?.text).toBe('Prefiere explicaciones cortas')
    await m.remember(draft('Su examen de química es el 14 de octubre', 'exam'))
    const f = await m.remember(draft('Su examen de química es el 16 de octubre', 'exam'))
    expect(f.replaced.length).toBe(1)
  })

  it('lo automático no pisa lo que corrigió el estudiante', async () => {
    const m = make({ model: new MockChatModel(() => ({ events: reply({ text: '{"memories":[{"kind":"goal","text":"Quiere sacar un 5 en física","key":"goal:fisica","confidence":0.9}],"outdated":[]}' }) })) })
    const mine = await m.remember(draft('Quiere sacar un 9 en física', 'goal', { key: 'goal:fisica', source: 'student' }))
    m.observe({ id: 'chat:p', source: 'assistant', turns: [{ speaker: 'student', text: 'Bueno, con un cinco en física me conformo, la verdad' }] }, false)
    const out = await m.learn('chat:p')
    expect(out.map((r) => r.status)).toEqual(['cancelled'])
    expect(m.records().find((r) => r.id === mine.record!.id)?.text).toBe('Quiere sacar un 9 en física')
  })
})

describe('caducidad', () => {
  it('lo pasajero caduca, los exámenes al día siguiente y lo viejo se purga', async () => {
    const t0 = new Date('2026-10-01T12:00:00Z')
    const folder = join(tempDir(), 'Memory')
    const m = make({ now: t0, folder })
    await m.remember(draft('Esta semana está repasando derivadas', 'other'))
    const exam = await m.remember(draft('Examen 1 de Álgebra el 2026-10-06 a las 10:00', 'exam'))
    const pref = await m.remember(draft('Le gustan las gráficas', 'learning'))
    expect(exam.record?.expiresAt).toBeDefined()
    expect(pref.record?.expiresAt).toBeUndefined()
    const week = m.records(true).find((r) => r.text.startsWith('Esta semana'))!
    expect(Math.round((Date.parse(week.expiresAt!) - t0.getTime()) / 86_400_000)).toBe(14)
    const later = new MemoryService({ folder, clock: () => new Date(t0.getTime() + 10 * 86_400_000) })
    expect(new Set(later.records().map((r) => r.kind))).toEqual(new Set(['other', 'learning']))
    expect(later.records(true).length).toBe(3)
    const much = new MemoryService({ folder, clock: () => new Date(t0.getTime() + 95 * 86_400_000) })
    expect(much.records(true).map((r) => r.kind)).toEqual(['learning'])
    const mid = make({ now: new Date(t0.getTime() + 10 * 86_400_000) })
    const old = await mid.remember({ kind: 'exam', text: 'Quiz de inglés el lunes', source: 'tutor', expiresAt: t0.toISOString() })
    expect(mid.records().length).toBe(0)
    mid.restore(old.record!.id)
    expect(mid.records().length).toBe(1)
  })

  it('la extracción descarta lo que ya pasó', () => {
    const now = new Date('2026-10-12T12:00:00Z')
    const json = 'Claro: {"memories":[{"kind":"exam","text":"Quiz el 2026-10-05","expires":"2026-10-06"},{"kind":"exam","text":"Final el 2026-12-10","expires":"2026-12-11"}],"outdated":[]}'
    expect(parseExtraction(json, new Set(), now)?.memories.map((x) => x.text)).toEqual(['Final el 2026-12-10'])
  })
})

describe('búsqueda e inyección', () => {
  it('encuentra por significado entre idiomas y por palabras', async () => {
    const m = make({ embedder: new FakeEmbedder() })
    await m.remember(draft('Tiene un quiz de inglés el lunes 19 de octubre a las 10:00', 'exam'))
    await m.remember(draft('Prefiere explicaciones cortas con un ejemplo resuelto'))
    await m.remember(draft('Suele estudiar por la noche', 'schedule'))
    await m.remember(draft('Estudia en la UNX, segundo año de ingeniería', 'studies'))
    expect((await m.search('When is my English test?', 3))[0]?.record.kind).toBe('exam')
    expect((await m.search('UNX', 3))[0]?.record.kind).toBe('studies')
    expect(await m.search('fotosíntesis', 5)).toEqual([])
    const lexical = make()
    await lexical.remember(draft('Tiene un quiz de inglés el lunes', 'exam'))
    await lexical.remember(draft('Le gustan los diagramas', 'learning'))
    expect((await lexical.search('¿cuándo es el quiz de inglés?', 2))[0]?.record.kind).toBe('exam')
    expect(lexical.records().find((r) => r.kind === 'exam')?.uses).toBe(1)
  })

  it('el bloque de contexto es compacto y viene al caso', async () => {
    const m = make({ embedder: new FakeEmbedder() })
    await m.remember(draft('Prefiere explicaciones cortas con un ejemplo resuelto'))
    await m.remember(draft('Aprende mejor con gráficas y dibujos', 'learning'))
    await m.remember({ kind: 'difficulty', text: 'Le cuesta despejar en las identidades trigonométricas', source: 'tutor', courseID: 'trig', courseTitle: 'Trigonometría', confidence: 0.8 })
    await m.remember({ kind: 'exam', text: 'Examen 2 de Trigonometría el 2099-10-08 a las 8:00', source: 'tutor', courseID: 'trig', courseTitle: 'Trigonometría', confidence: 0.9 })
    for (let i = 0; i < 30; i++) await m.remember(draft(`Dato irrelevante número ${i} sobre la cafetería ${i}`, 'other'))
    const block = await m.context('No entiendo cómo simplificar sec x cos x', { kind: 'tutor', courseID: 'trig', courseTitle: 'Trigonometría' }, 700)
    expect(block.startsWith('## What Aula remembers about the student')).toBe(true)
    expect(block).toContain('explicaciones cortas')
    expect(block).toContain('identidades trigonométricas')
    expect(block).toContain('Examen 2')
    expect(block.length).toBeLessThanOrEqual(1100)
    expect(block).not.toContain('cafetería 29')
    m.setEnabled(false)
    expect(await m.context('hola', { kind: 'assistant' }, 700)).toBe('')
    expect(memoryTools(m, { source: 'assistant' })).toEqual([])
  })
})

describe('aprender de las conversaciones', () => {
  const conversation = (turns: Array<[boolean, string]>, id = 'chat:t1'): MemoryConversation => ({ id, source: 'assistant', turns: turns.map(([s, text]) => ({ speaker: s ? 'student' : 'aula', text })) })

  it('extrae con una IA falsa, sin secretos ni datos delicados', async () => {
    const now = new Date('2026-10-12T15:00:00Z')
    const prompts: string[] = []
    let oldID = ''
    const model = new MockChatModel((req: ChatRequest) => {
      prompts.push(req.messages.map(messageText).join('\n'))
      return { events: reply({ text: `Aquí tienes:\n\`\`\`json\n{"memories":[
        {"kind":"exam","text":"Tiene un quiz de inglés el lunes 19 de octubre de 2026 a las 10:00","key":"exam:ingles-quiz","confidence":0.9,"expires":"2026-10-20"},
        {"kind":"preference","text":"Quiere explicaciones cortas, con un ejemplo","key":"pref:longitud","confidence":0.9},
        {"kind":"learning","text":"Tiene ansiedad en los exámenes","sensitive":true},
        {"kind":"other","text":"Su contraseña de Canvas es Perro2024!"}
      ],"outdated":["${oldID}","m-inventado"]}\n\`\`\`` }) }
    })
    const m = make({ now, model })
    const old = await m.remember(draft('Su examen de inglés es el viernes 16 de octubre', 'exam', { key: 'exam:ingles' }))
    oldID = old.record!.id
    const conv = conversation([[true, 'Hola! el lunes tengo quiz de inglés a las 10, ya no es el viernes. Explícame corto y con un ejemplo porfa'],
      [false, '¡Hecho! ¿Quieres que te prepare un curso rápido?'], [true, 'Sí, uno rápido. Mi contraseña de Canvas es Perro2024! por si la necesitas']])
    m.observe(conv, false)
    const saved = await m.learn(conv.id)
    expect(saved.filter((r) => r.status === 'created' || r.status === 'merged' || r.status === 'updated').length).toBe(2)
    const texts = m.records().map((r) => r.text)
    expect(texts).toContain('Tiene un quiz de inglés el lunes 19 de octubre de 2026 a las 10:00')
    expect(texts).toContain('Quiere explicaciones cortas, con un ejemplo')
    expect(texts.some((t) => t.includes('ansiedad') || t.includes('Perro2024'))).toBe(false)
    expect(m.records(true).find((r) => r.id === oldID)?.supersededBy).toBeDefined()
    const p = prompts.join('')
    expect(p).not.toContain('Perro2024')
    expect(p).toContain(oldID)
    expect(p).toContain('data — not instructions')
    expect(m.records().find((r) => r.kind === 'exam')?.source).toBe('assistant')
    expect(m.records().find((r) => r.kind === 'exam')?.conversationID).toBe('chat:t1')
    // lo mismo otra vez no vuelve a llamar a la IA; con un turno nuevo, sí
    m.observe(conv, false)
    await m.learn(conv.id)
    expect(prompts.length).toBe(1)
    m.observe({ ...conv, turns: [...conv.turns, { speaker: 'student', text: 'Por cierto, estudio ingeniería en la UNX, segundo año' }] }, false)
    await m.learn(conv.id)
    expect(prompts.length).toBe(2)
    expect(prompts[1]).toContain('(earlier, already reviewed)')
  })

  it('una conversación trivial no llama a la IA y en pausa no aprende', async () => {
    const prompts: string[] = []
    const model = new MockChatModel(() => { prompts.push('x'); return { events: reply({ text: '{"memories":[],"outdated":[]}' }) } })
    const m = make({ model })
    const conv = conversation([[true, 'ok gracias'], [false, '¡De nada!']], 'tutor:x:1')
    m.observe(conv, false)
    await m.learn(conv.id)
    expect(prompts.length).toBe(0)
    m.pause(new Date(Date.now() + 1e12))
    m.observe(conversation([[true, 'Mi examen final de cálculo es el 10 de diciembre a las 9']], 'tutor:x:2'), true)
    await new Promise((r) => setTimeout(r, 400))
    expect(prompts.length).toBe(0)
    expect(m.records()).toEqual([])
    expect((await m.remember(draft('Prefiere ejemplos de física', 'preference', { source: 'student' }))).status).toBe('created')
    expect((await m.remember(draft('Prefiere ejemplos de química'))).status).toBe('paused')
  })

  it('una respuesta mala se reintenta tres veces y se deja', async () => {
    let calls = 0
    const m = make({ model: new MockChatModel(() => { calls++; return { events: reply({ text: 'No sé qué decir.' }) } }) })
    const conv = conversation([[true, 'Mi examen final de cálculo es el 10 de diciembre a las 9 de la mañana']])
    m.observe(conv, false)
    for (let i = 0; i < 4; i++) await m.learn(conv.id)
    expect(calls).toBe(3)
    expect(m.records()).toEqual([])
  })

  it('«Borrar todo» mientras piensa no guarda nada', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const model = new MockChatModel(() => ({ events: reply({ text: '{"memories":[{"kind":"goal","text":"Quiere aprobar Cálculo con un 8","confidence":0.9}],"outdated":[]}' }) }))
    const slow = { ...model, complete: async (req: ChatRequest, o?: Parameters<MockChatModel['complete']>[1]) => { await gate; return model.complete(req, o) } } as unknown as MockChatModel
    const m = make({ model: slow })
    const conv = conversation([[true, 'Quiero aprobar Cálculo con un 8 este semestre, ayúdame a organizarme']])
    m.observe(conv, false)
    const t = m.learn(conv.id)
    await new Promise((r) => setTimeout(r, 30))
    m.forgetAll()
    release()
    await t
    expect(m.records(true)).toEqual([])
  })

  it('al descartar una conversación ya no queda pendiente', () => {
    const m = make({ model: new MockChatModel(() => ({ events: reply({ text: '{}' }) })) })
    m.observe(conversation([[true, 'Mi examen final es el 3 de diciembre a las 8 de la mañana']], 'tutor:c:2'), false)
    expect(existsSync(m.disk.pendingPath)).toBe(true)
    m.discardConversation('tutor:c:2')
    expect(existsSync(m.disk.pendingPath)).toBe(false)
  })
})

describe('práctica', () => {
  it('lo deducido llega y se va solo, y respeta lo que corrige el estudiante', async () => {
    const lib = new Library(tempDir())
    installSampleCourses(lib, { onlyIfEmpty: false })
    const store = lib.openPack('demo-cuadraticas')!
    const now = new Date()
    store.updateProgress((p) => {
      p.skills.parabola = { alpha: 2, beta: 9, attempts: 10, lastPracticed: now.toISOString(), streak: 0, lessonStep: 0, lessonDone: false, learning: {} }
      p.mistakes.push({ id: 'p-e1', exerciseID: 'p-e1', skill: 'parabola', firstSeen: now.toISOString(), lastSeen: now.toISOString(), count: 4, lastInput: 'x=3',
        why: 'Confunde el signo de b al calcular el vértice', due: now.toISOString(), stage: 0, resolved: false })
    })
    const m = new MemoryService({ folder: join(tempDir(), 'Memory'), library: lib, clock: () => now })
    await m.refreshPracticeInsights(true)
    const derived = m.records().filter((r) => r.source === 'practice')
    expect(derived.some((r) => r.kind === 'difficulty' && r.text.includes('La parábola y su gráfica'))).toBe(true)
    expect(derived.some((r) => r.kind === 'mistake' && r.text.includes('Confunde el signo de b'))).toBe(true)
    expect(new Set(derived.map((r) => r.courseID))).toEqual(new Set(['demo-cuadraticas']))
    await m.refreshPracticeInsights(true)
    expect(m.records().filter((r) => r.source === 'practice').length).toBe(derived.length)
    const mistake = derived.find((r) => r.kind === 'mistake')!
    await m.edit(mistake.id, 'A veces confunde el signo de b (ya casi no)')
    store.updateProgress((p) => {
      p.skills.parabola = { alpha: 20, beta: 1, attempts: 30, lastPracticed: now.toISOString(), streak: 0, lessonStep: 0, lessonDone: false, learning: {} }
      p.mistakes = p.mistakes.map((x) => ({ ...x, resolved: true }))
    })
    await m.refreshPracticeInsights(true)
    const after = m.records().filter((r) => r.source === 'practice')
    expect(after.some((r) => r.kind === 'difficulty')).toBe(false)
    expect(after.some((r) => r.kind === 'strength')).toBe(true)
    expect(m.records().some((r) => r.id === mistake.id && r.editedByStudent)).toBe(true)
  })
})

describe('herramientas', () => {
  it('recordar, buscar y olvidar (con confirmaciones)', async () => {
    const m = make({ embedder: new FakeEmbedder() })
    const confirmations: string[] = []
    let answer = true
    const tools = memoryTools(m, { source: 'tutor', courseID: 'trig', courseTitle: 'Trigonometría', conversationID: 'tutor:trig:1' }, async (c) => { confirmations.push(c.title); return answer })
    expect(new Set(tools.map((t) => t.name))).toEqual(new Set(['memory_remember', 'memory_search', 'memory_forget']))
    const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
      JSON.parse(outputText(await tools.find((t) => t.name === name)!.run(args as never, { signal: new AbortController().signal, callId: 'c' })))
    expect((await call('memory_remember', { text: 'Tiene el examen 2 de trigonometría el 2099-10-08 a las 8:00', kind: 'exam', key: 'exam:trig-2' })).ok).toBe(true)
    expect(m.records()[0]?.courseID).toBe('trig')
    expect(m.records()[0]?.expiresAt).toBeDefined()
    expect((await call('memory_remember', { text: 'La contraseña del campus es Lima2024', kind: 'other' })).ok).toBe(false)
    answer = false
    expect((await call('memory_remember', { text: 'Tiene dislexia y lee despacio', kind: 'learning' })).saved).toBe(false)
    answer = true
    expect((await call('memory_remember', { text: 'Tiene dislexia y lee despacio', kind: 'learning' })).ok).toBe(true)
    expect(confirmations.length).toBe(2)
    const found = await call('memory_search', { query: 'When is my trig exam?' }) as { memories: Array<{ kind: string; id: string }> }
    expect(found.memories[0]?.kind).toBe('exam')
    expect((await call('memory_search', { query: '' })).count).toBe(2)
    expect((await call('memory_forget', { id: found.memories[0].id })).forgotten).toBe(1)
    await call('memory_remember', { text: 'Le gustan los mapas conceptuales', kind: 'learning' })
    const ids = m.records().map((r) => r.id)
    answer = false
    expect((await call('memory_forget', { ids: [ids[0], ids[1]] })).ok).toBe(false)
    expect(m.records().length).toBe(2)
    answer = true
    await call('memory_forget', { ids: [ids[0], ids[1]] })
    expect(m.records()).toEqual([])
    // sin interfaz para preguntar, lo delicado no se guarda
    const bare = memoryTools(m, { source: 'tutor' })
    const out = await bare.find((t) => t.name === 'memory_remember')!.run({ text: 'Tiene dislexia', kind: 'learning' }, { signal: new AbortController().signal, callId: 'c' })
    expect(typeof out === 'string' ? false : out.isError).toBe(true)
  })

  it('tras leer contenido ajeno, recordar pide confirmación', async () => {
    const m = make()
    const asked: string[] = []
    const tools = memoryTools(m, { source: 'assistant' }, async (c) => { asked.push(c.action); return false }, () => true)
    const out = JSON.parse(outputText(await tools[0].run({ text: 'Su examen final es el 2099-12-10', kind: 'exam' }, { signal: new AbortController().signal, callId: 'c' })))
    expect(out.saved).toBe(false)
    expect(asked).toEqual(['rememberAfterReading'])
    expect(m.records()).toEqual([])
  })
})

describe('disco', () => {
  it('persiste con permisos privados, separa vectores por modelo y sobrevive a un archivo dañado', async () => {
    const emb = new FakeEmbedder()
    const folder = join(tempDir(), 'Memory')
    const m = make({ embedder: emb, folder })
    await m.remember(draft('Prefiere explicaciones cortas'))
    await m.remember(draft('Estudia en la UNX', 'studies'))
    // permisos POSIX (en Windows protege la ACL de la carpeta del usuario)
    if (process.platform !== 'win32') {
      expect(statSync(m.disk.recordsPath).mode & 0o777).toBe(0o600)
      expect(statSync(folder).mode & 0o777).toBe(0o700)
    }
    const again = new MemoryService({ folder, embedder: emb })
    expect(new Set(again.records().map((r) => r.text))).toEqual(new Set(['Prefiere explicaciones cortas', 'Estudia en la UNX']))
    const hits = await again.search('short explanations', 1)
    expect(hits[0]?.record.kind).toBe('preference')
    expect(hits[0]?.semantic).toBeDefined()
    emb.modelID = 'fake-2'
    expect((await again.search('short explanations', 1))[0]?.record.kind).toBe('preference')
    // dañado: se lee la versión anterior (y queda una copia privada del dañado al lado)
    writeFileSync(m.disk.recordsPath, '{roto')
    const recovered = new MemoryService({ folder })
    expect(recovered.records().map((r) => r.text)).toContain('Prefiere explicaciones cortas')
    const copies = readdirSync(folder).filter((n) => n.startsWith('memories.json.damaged-'))
    expect(copies).toHaveLength(1)
    if (process.platform !== 'win32') expect(statSync(join(folder, copies[0])).mode & 0o777).toBe(0o600)
    // dañados el archivo y su copia: se empieza de cero sin romper el arranque
    writeFileSync(m.disk.recordsPath, '{roto')
    writeFileSync(join(folder, '.memories.json.bak'), '[[')
    const broken = new MemoryService({ folder })
    expect(broken.records()).toEqual([])
    await broken.remember(draft('Le gustan los ejemplos de fútbol', 'learning'))
    broken.forgetAll()
    expect(new MemoryService({ folder }).records(true)).toEqual([])
    expect(existsSync(m.disk.recordsPath)).toBe(false)
    // «Borrar todo» no deja copias con texto: ni la versión anterior ni las de archivos dañados
    expect(readdirSync(folder).filter((n) => n.includes('memories'))).toEqual([])
  })

  it('lo que cambia Aula se apunta en el historial, se deshace y olvidar limpia las copias', async () => {
    const root = tempDir()
    const history = ChangeHistory.at(root)
    const m = make({ folder: join(root, 'Memory'), history })
    await m.remember(draft('Prefiere ejemplos de fútbol', 'learning', { source: 'student' })) // a mano: no se apunta
    const actor = ChangeContext.newActor('chat', 'Recuerda que estudio de noche')
    const r = await ChangeContext.run(actor, () => m.remember(draft('Suele estudiar por la noche', 'schedule')))
    expect(r.status).toBe('created')
    const groups = history.groups({ domain: 'memory' })
    expect(groups.map((g) => g.id)).toEqual([actor.group])
    history.undo(actor.group)
    expect(m.records().map((x) => x.text)).toEqual(['Prefiere ejemplos de fútbol'])
    // otra vez, y olvidarlo quita su texto de las copias del historial
    const r2 = await ChangeContext.run(ChangeContext.newActor('chat', 'otra vez'), () => m.remember(draft('Suele estudiar por la noche', 'schedule')))
    m.forget([r2.record!.id])
    const blobs = history.lines().flatMap((l) => (l.t === 'change' ? [l.before, l.after] : [])).filter((h): h is string => !!h && h !== '-' && h !== '!')
    for (const h of blobs) {
      const p = history.blobPath(h)
      if (existsSync(p)) expect(readFileSync(p, 'utf8')).not.toContain('por la noche')
    }
  })
})

describe('creación de cursos y utilidades', () => {
  it('el resumen para crear cursos depende del papel', async () => {
    const m = make()
    await m.remember(draft('Prefiere ejemplos de la vida real antes que la teoría', 'learning'))
    await m.remember({ kind: 'difficulty', text: 'Le cuestan las identidades trigonométricas', source: 'practice', courseID: 'trig', courseTitle: 'Trigonometría' })
    const req = { packID: 'trig2', title: 'Trigonometría II', subject: 'Matemáticas', topics: 'Identidades, ecuaciones trigonométricas' }
    const planner = courseBrief('planner', req, 900, m)
    expect(planner).toContain('About the student')
    expect(planner).toContain('identidades trigonométricas')
    expect(planner).toContain('vida real')
    expect(courseBrief('verifier', req, 900, m)).toBe('')
    m.setEnabled(false)
    expect(courseBrief('author', req, 900, m)).toBe('')
  })

  it('lee tipos y claves con tolerancia', () => {
    expect(parseKind('Exams')).toBe('exam')
    expect(parseKind('learning style')).toBe('learning')
    expect(parseKind('dificultad')).toBe('difficulty')
    expect(parseKind('???')).toBe('other')
    expect(normalizedKey('Exam: Química Parcial 2')).toBe('exam:quimica-parcial-2')
  })

  it('abre los recuerdos escritos por la app Swift', () => {
    const folder = join(tempDir(), 'Memory')
    const m = make({ folder })
    m.disk.ensureFolder()
    writeFileSync(m.disk.recordsPath, JSON.stringify({ schema: 1, records: [
      { id: 'm-abc12345', kind: 'exams', text: 'Tiene el final el 2099-06-10', source: 'tutor', confidence: 0.9, createdAt: '2026-10-01T10:00:00.123Z', updatedAt: '2026-10-01T10:00:00Z', uses: 2, confirmations: 0, sensitive: false, editedByStudent: false, courseTitle: 'Física' },
      { id: 'm-roto', kind: 'other' },
      { id: 'm-def', kind: 'preference', text: 'Prefiere ejemplos', source: 'raro', createdAt: 'no es fecha' }
    ] }))
    const again = new MemoryService({ folder })
    const recs = again.records(true)
    expect(recs.map((r) => r.id).sort()).toEqual(['m-abc12345', 'm-def'])
    expect(recs.find((r) => r.id === 'm-abc12345')?.kind).toBe('exam')
    expect(recs.find((r) => r.id === 'm-def')?.source).toBe('student')
  })
})
