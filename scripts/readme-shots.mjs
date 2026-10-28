// Capturas del README: la app real con el curso de ejemplo y seis semanas de estudio simuladas por el motor.
//   npx electron-vite build && xvfb-run -a node scripts/readme-shots.mjs [docs/media/screenshots] [nombre…]
// Cada captura se hace en inglés y en español, en claro; las marcadas con `dark` también en oscuro.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const [dir, ...only] = process.argv.slice(2)
const out = resolve(dir || 'docs/media/screenshots')
mkdirSync(out, { recursive: true })
const ID = 'exam-2-math112'
const course = (tab) => JSON.stringify({ name: 'course', id: ID, tab })
const study = (mode, extra = {}) => JSON.stringify({ name: 'study', id: ID, mode, ...extra })
// pulsa el primer botón cuyo texto coincide, en cuanto aparece (lo intenta durante unos segundos)
const click = (re) =>
  `(() => { let n = 0; const id = setInterval(() => { const b = [...document.querySelectorAll('button')].find((x) => ${re}.test(x.textContent || '')); if (b || ++n > 30) { clearInterval(id); b?.click() } }, 250) })()`

// el chat con la IA simulada: pide un cuestionario, lo empieza y responde la primera pregunta
const quizChat = (text) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 60 && !document.querySelector('textarea'); i++) await sleep(250)
  await sleep(400)
  const box = document.querySelector('textarea')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(250)
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 80 && !document.querySelector('[data-studyset="quiz"]'); i++) await sleep(250)
  await sleep(600)
  const q = document.querySelector('[data-studyset="quiz"]')
  ;[...q.querySelectorAll('button')].find((b) => /Start|Empezar/.test(b.textContent))?.click()
  await sleep(900)
  ;[...q.querySelectorAll('[role="radio"]')].find((r) => r.textContent.includes('±2'))?.click()
  await sleep(300)
  ;[...q.querySelectorAll('button')].find((b) => /^(Check|Comprobar)/.test(b.textContent.trim()))?.click()
})()`

const SHOTS = [
  { name: 'home', route: 'home', dark: true },
  { name: 'course', route: course('overview'), dark: true },
  { name: 'learn', route: study('learn', { skill: 'reference-angles' }) },
  { name: 'cards', route: study('cards') },
  { name: 'exam', route: study('exam'), eval: click('/Start the mock exam|Empezar el simulacro/'), wait: 6000 },
  { name: 'create', route: JSON.stringify({ name: 'create' }) },
  { name: 'stats', route: 'stats', dark: true },
  { name: 'calendar', route: 'calendar' },
  { name: 'tools', route: 'tools' },
  { name: 'chemistry', route: JSON.stringify({ name: 'tools', tool: 'chemistry' }) },
  { name: 'reference', route: course('reference') },
  { name: 'inbox', route: 'inbox' },
  { name: 'settings', route: 'settings', wait: 6000 },
  { name: 'chat', route: 'chat', env: { AULA_FAKE_AI: '1' }, eval: { en: quizChat('Give me a quick quiz'), es: quizChat('Hazme un cuestionario rápido') }, wait: 9000 }
]

for (const lang of ['en', 'es'])
  for (const s of SHOTS) {
    if (only.length && !only.includes(s.name)) continue
    for (const theme of s.dark ? ['light', 'dark'] : ['light']) {
      const file = `${out}/${s.name}-${theme}-${lang}.png`
      const args = ['scripts/shot.mjs', '--demo', '--lang', lang, '--route', s.route, '--theme', theme, '--size', '1440x900', '--wait', String(s.wait ?? 4200), '--out', file]
      const evalCode = typeof s.eval === 'object' ? s.eval[lang] : s.eval
      if (evalCode) args.push('--eval', evalCode)
      execFileSync('node', args, { stdio: 'inherit', env: { ...process.env, ...(s.env ?? {}) } })
    }
  }
