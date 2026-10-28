// Prueba con IA REAL (la que Aula elija sola: Claude Code, Codex, una clave…): crea un curso rápido desde un texto,
// espera a que termine y hace una pregunta al chat. Consume uso de la IA elegida. Solo desarrollo.
//   xvfb-run -a node scripts/dev/real-ai-check.mjs [carpeta-de-datos]
import { _electron as electron } from 'playwright'
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const home = process.argv[2] || mkdtempSync(join(tmpdir(), 'aula-real-'))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, AULA_HOME: home, AULA_SKIP_ONBOARDING: '1', AULA_FAKE_AI: '' } })
const page = await app.firstWindow()
await page.waitForTimeout(3000)
const call = (m, a) => page.evaluate(async ([m, a]) => { const r = await window.aula.invoke(m, a); if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`); return r.value }, [m, a])

const status = await call('ai.status', {})
log('IA:', JSON.stringify(status.resolved ?? status))
const notes = `La derivada de una función mide su ritmo de cambio instantáneo. Definición: f'(x) = lim_{h→0} (f(x+h) − f(x))/h.
Reglas: (c)' = 0; (x^n)' = n·x^(n−1); (f+g)' = f' + g'; producto (fg)' = f'g + fg'; cociente (f/g)' = (f'g − fg')/g²; cadena (f∘g)' = f'(g(x))·g'(x).
Ejemplos: (3x² + 2x)' = 6x + 2; (sin x)' = cos x; (e^{2x})' = 2e^{2x}. La derivada en un punto es la pendiente de la recta tangente.`
const draft = await call('create.addText', { text: notes, title: 'Apuntes: derivadas' })
log('borrador', draft.draftId, draft.materials.map((m) => `${m.title} (${m.status})`).join(', '))
const { runId, packId } = await call('create.start', {
  draftId: draft.draftId,
  request: { title: 'Derivadas básicas', subject: 'Matemáticas', level: 'highschool', language: 'es', depth: 'quick', lessonMode: 'stepByStep', allowWeb: false, verify: true, materialIds: draft.materials.map((m) => m.id), officialIds: [] }
})
log('ejecución', runId, 'curso', packId)
const started = Date.now()
let last = ''
for (;;) {
  await page.waitForTimeout(15000)
  const run = await call('generation.run', { id: runId })
  const line = `${run.state} · ${run.stage} · ${Math.round(run.progress * 100)}% · temas ${run.skills.map((s) => s.status).join(',')}`
  if (line !== last) log(line)
  last = line
  if (run.question) { log('PREGUNTA:', run.question.text); await call('generation.answer', { id: runId, questionId: run.question.id, answer: run.question.options?.[0]?.label ?? 'Sí' }) }
  if (['done', 'failed', 'cancelled', 'limit', 'paused'].includes(run.state)) { log('FIN', run.state, run.error ?? '', JSON.stringify(run.report ?? {})); break }
  if (Date.now() - started > 45 * 60 * 1000) { log('TIEMPO AGOTADO'); break }
}
const dir = join(home, 'Packs', packId)
const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'))
log('curso:', pack.title, '·', pack.skills.length, 'temas')
for (const s of pack.skills) {
  const f = join(dir, 'skills', `${s.id}.json`)
  if (!existsSync(f)) { log('  falta', s.id); continue }
  const k = JSON.parse(readFileSync(f, 'utf8'))
  log(`  ${s.title}: ${k.lesson?.length ?? 0} bloques, ${k.exercises?.length ?? 0} ejercicios, ${k.cards?.length ?? 0} tarjetas`)
}
// el chat
const th = await call('chat.newThread', undefined)
await call('chat.send', { threadId: th.id, text: '¿Cuál es la derivada de x³·sin x? Explícamelo en dos pasos.' })
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(5000)
  const t = await call('chat.thread', { id: th.id })
  const a = t.messages.filter((m) => m.role === 'assistant').at(-1)
  const busy = (await page.evaluate(() => document.querySelector('[data-streaming="true"]') != null))
  if (a && a.text.length > 40 && !busy && i > 2) { log('CHAT:', a.text.slice(0, 600).replace(/\n/g, ' ⏎ ')); break }
}
await app.close()
log('datos en', home)
