import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, join, parse, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import JSZip from 'jszip'
import { applyPendingWipe, exportAllData, includedInExport, scheduleDataWipe, unsafeWipeRoot, WIPE_MARK_MAX_AGE_MS, type WipeResult } from './data'

let root: string
let out: string

function put(rel: string, text = 'x'): void {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
}

beforeEach(() => {
  root = join(mkdtempSync(join(tmpdir(), 'aula-data-')), 'Aula')
  out = mkdtempSync(join(tmpdir(), 'aula-export-'))
  put('settings.json', '{"version":2}')
  put('secrets.enc', 'CLAVES')
  put('Packs/trig/pack.json', '{}')
  put('Packs/trig/skills/a.json', '{}')
  put('Packs/trig/.aula-lock')
  put('Memory/memories.json', '[]')
  put('calendar.json', '{}')
  put('Browser Data/Cookies', 'galletas')
  put('Models/qwen.gguf', 'pesos')
  put('Logs/main.log', 'log')
  put('Packs/trig/notes.tmp')
})
afterEach(() => {
  rmSync(join(root, '..'), { recursive: true, force: true })
  rmSync(out, { recursive: true, force: true })
})

describe('exportar todo', () => {
  it('copia los cursos, la memoria, el calendario y los ajustes; nunca claves, cookies, modelos ni registros', async () => {
    const dest = join(out, 'Aula.zip')
    await exportAllData(root, dest)
    const zip = await JSZip.loadAsync(readFileSync(dest))
    const files = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name).sort()
    const top = basename(root)
    expect(files).toEqual([`${top}/Memory/memories.json`, `${top}/Packs/trig/pack.json`, `${top}/Packs/trig/skills/a.json`, `${top}/calendar.json`, `${top}/settings.json`])
    expect(await zip.file(`${top}/settings.json`)!.async('string')).toBe('{"version":2}')
    expect(includedInExport('Packs/trig/key.pem')).toBe(false)
    expect(includedInExport('Assistant/threads/a.json')).toBe(true)
  })

  it('lista cerrada: la cuenta de ChatGPT de Codex, los volcados, los modelos y lo que guarda Chromium no salen', async () => {
    put('tools/codex/home/auth.json', '{"tokens":{"access_token":"sk-secreto","refresh_token":"rt"},"OPENAI_API_KEY":"sk-x"}')
    put('tools/codex/home/sessions/2026/10/rollout.jsonl', '{"secreto":true}')
    put('tools/codex/home/config.toml', 'model = "o3"')
    put('Crashpad/completed/a.dmp', 'volcado')
    put('LocalAI/models/m.gguf', 'pesos')
    put('Local State', '{"os_crypt":{"encrypted_key":"x"}}')
    put('Local Storage/leveldb/000003.log', 'x')
    put('Cookies', 'galletas')
    put('Cache/prices.json', '{}')
    put('window.json', '{}')
    put('Eliminados/viejo/pack.json', '{}')
    put('Packs/trig/runs/r1.json', '{}')
    put('Packs/trig/sources/apuntes.pdf', 'pdf')
    put('Packs/trig/auth.json', '{}')
    put('Assistant/threads/a.json', '{}')
    put('Automations/automations.json', '[]')
    put('Documents/library.json', '{}')
    put('History/log.json', '{}')
    put('Calendars/sub1.ics', 'BEGIN:VCALENDAR')
    put('calendar-subscriptions.json', '{}')
    put('achievements.json', '{}')
    put('costs.json', '{}')
    put('Secrets.json', '{}')
    const dest = join(out, 'Aula.zip')
    await exportAllData(root, dest)
    const zip = await JSZip.loadAsync(readFileSync(dest))
    const top = basename(root) + '/'
    const files = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name.slice(top.length)).sort()
    expect(files).toEqual([
      'Assistant/threads/a.json', 'Automations/automations.json', 'Calendars/sub1.ics', 'Documents/library.json', 'History/log.json',
      'Memory/memories.json', 'Packs/trig/pack.json', 'Packs/trig/runs/r1.json', 'Packs/trig/skills/a.json', 'Packs/trig/sources/apuntes.pdf',
      'achievements.json', 'calendar-subscriptions.json', 'calendar.json', 'costs.json', 'settings.json'
    ])
    const folders = Object.values(zip.files).filter((f) => f.dir).map((f) => f.name)
    expect(folders.some((f) => f.includes('tools') || f.includes('Crashpad') || f.includes('LocalAI') || f.includes('Local Storage'))).toBe(false)
  })

  it('nombres sueltos', () => {
    for (const p of ['tools/codex/home/auth.json', 'tools/codex/home/sessions/2026/x.jsonl', 'tools/codex/home/config.toml', 'Crashpad/completed/a.dmp',
      'LocalAI/m.gguf', 'Models/m.gguf', 'secrets.enc', 'Secrets.json', 'Browser Data/Cookies', 'Logs/main.log', 'Drafts/d/draft.json', 'Packs/../tools/x',
      'Packs/x/.aula-lock', 'Packs/x/a.tmp', 'Memory/cert.p12', 'settings.json/x', 'Packs/x/secrets.json']) {
      expect(includedInExport(p), p).toBe(false)
    }
    for (const p of ['Packs/x/runs/r1/log.txt', 'Packs/x/pack.json', 'settings.json', 'costs.json', 'calendar.json', 'Calendars/s.ics', 'Packs']) {
      expect(includedInExport(p), p).toBe(true)
    }
  })

  it('escribe por trozos un ZIP válido con muchos archivos (y archivos vacíos) sin dejar temporales', async () => {
    for (let i = 0; i < 300; i++) put(`Packs/muchos/skills/s${i}.json`, JSON.stringify({ i, texto: 'á'.repeat(i) }))
    put('Packs/muchos/vacio.json', '')
    const dest = join(out, 'Aula.zip')
    await exportAllData(root, dest)
    expect(readdirSync(out)).toEqual(['Aula.zip'])
    const zip = await JSZip.loadAsync(readFileSync(dest))
    const top = basename(root)
    expect(await zip.file(`${top}/Packs/muchos/skills/s299.json`)!.async('string')).toBe(JSON.stringify({ i: 299, texto: 'á'.repeat(299) }))
    expect(await zip.file(`${top}/Packs/muchos/vacio.json`)!.async('string')).toBe('')
  })
})

describe('borrar todo', () => {
  const mark = join('.aula-wipe-pending')
  const result = (): { r: WipeResult | null; onResult: (x: WipeResult) => void } => {
    const box: { r: WipeResult | null; onResult: (x: WipeResult) => void } = { r: null, onResult: (x) => { box.r = x } }
    return box
  }

  it('solo al arrancar con la marca: borra lo de Aula y deja la carpeta (y lo que no es de Aula)', () => {
    put('tools/codex/home/auth.json')
    put('Crashpad/completed/a.dmp')
    put('.settings.json.1a2b3c4d.tmp')
    put('.calendar.aula-lock')
    // copias de la versión anterior y de archivos dañados (con datos del estudiante): también se borran
    put('.settings.json.bak')
    put('settings.json.damaged-1a2b3c4d5e')
    put('calendar.json.damaged-20261026120000')
    // J3-14: lo de las actualizaciones y los secretos apartados al «Empezar de cero» también
    put('Updates/install.json')
    put('Updates/watchdog.sh')
    put('secrets.unreadable-2026-10-27T09-30-00.enc')
    put('.secrets.enc.bak')
    put('mis-cosas.txt', 'no es de Aula')
    expect(applyPendingWipe(root)).toBe(false)
    expect(existsSync(join(root, 'Packs'))).toBe(true)
    scheduleDataWipe(root)
    expect(JSON.parse(readFileSync(join(root, mark), 'utf8'))).toMatchObject({ app: 'Aula', root: resolve(root), requestedAt: expect.any(String) })
    expect(existsSync(join(root, 'Packs'))).toBe(true)
    const box = result()
    expect(applyPendingWipe(root, { onResult: box.onResult })).toBe(true)
    expect(readdirSync(root)).toEqual(['mis-cosas.txt'])
    expect(box.r).toEqual({ wiped: true, left: ['mis-cosas.txt'] })
    expect(applyPendingWipe(root)).toBe(false)
  })

  it('no sigue los enlaces simbólicos (ni los de dentro ni los del primer nivel)', () => {
    const outside = join(root, '..', 'fuera')
    mkdirSync(outside)
    writeFileSync(join(outside, 'keep.txt'), 'x')
    symlinkSync(outside, join(root, 'Packs', 'enlace'))
    symlinkSync(outside, join(root, 'Documents'))
    scheduleDataWipe(root)
    expect(applyPendingWipe(root)).toBe(true)
    expect(readdirSync(outside)).toEqual(['keep.txt'])
    expect(existsSync(join(root, 'Documents'))).toBe(false)
  })

  it('si algo no se puede borrar, la marca se quita igual (no se borra después lo que se guarde)', () => {
    scheduleDataWipe(root)
    const box = result()
    const remove = (p: string) => {
      if (p.endsWith('Packs')) throw new Error('EBUSY')
      rmSync(p, { recursive: true, force: true })
    }
    expect(applyPendingWipe(root, { onResult: box.onResult, remove })).toBe(true)
    expect(box.r?.left).toEqual(['Packs'])
    expect(existsSync(join(root, mark))).toBe(false)
    put('Packs/nuevo/pack.json', '{}')
    expect(applyPendingWipe(root)).toBe(false)
    expect(existsSync(join(root, 'Packs', 'nuevo', 'pack.json'))).toBe(true)
  })

  it('nunca vacía la carpeta personal, la raíz ni una carpeta que no parece de Aula', () => {
    expect(unsafeWipeRoot(homedir())).toMatch(/personal/)
    expect(unsafeWipeRoot(join(homedir(), '..'))).toMatch(/personal|raíz|sistema/)
    expect(unsafeWipeRoot(parse(root).root)).toMatch(/raíz/)
    if (process.platform !== 'win32') expect(unsafeWipeRoot('/etc')).toMatch(/sistema/)
    expect(unsafeWipeRoot(root)).toBeNull()
    // sin settings.json ni Packs/: no se toca nada (y la marca se quita)
    const other = mkdtempSync(join(tmpdir(), 'aula-no-'))
    writeFileSync(join(other, 'tesis.docx'), 'mía')
    mkdirSync(join(other, 'Memory'))
    scheduleDataWipe(other)
    const box = result()
    expect(applyPendingWipe(other, { onResult: box.onResult })).toBe(false)
    expect(box.r?.refused).toMatch(/no parece/)
    expect(readdirSync(other).sort()).toEqual(['Memory', 'tesis.docx'])
    rmSync(other, { recursive: true, force: true })
  })

  it('la carpeta personal con una marca dentro no se vacía', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'aula-home-'))
    writeFileSync(join(fakeHome, 'settings.json'), '{}')
    mkdirSync(join(fakeHome, 'Packs'))
    writeFileSync(join(fakeHome, 'notas.txt'), 'x')
    const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
    process.env.HOME = fakeHome
    process.env.USERPROFILE = fakeHome
    try {
      scheduleDataWipe(fakeHome)
      expect(applyPendingWipe(fakeHome)).toBe(false)
      expect(readdirSync(fakeHome).sort()).toEqual(['Packs', 'notas.txt', 'settings.json'])
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })

  it('una marca antigua, de otra carpeta o ilegible no se aplica (y se quita)', () => {
    scheduleDataWipe(root, new Date(Date.now() - WIPE_MARK_MAX_AGE_MS - 60_000))
    expect(applyPendingWipe(root)).toBe(false)
    expect(existsSync(join(root, 'Packs'))).toBe(true)
    expect(existsSync(join(root, mark))).toBe(false)
    // una copia de la carpeta (con la marca) abierta en otro sitio
    writeFileSync(join(root, mark), JSON.stringify({ app: 'Aula', requestedAt: new Date().toISOString(), root: join(root, '..', 'otra') }))
    expect(applyPendingWipe(root)).toBe(false)
    expect(existsSync(join(root, 'Packs'))).toBe(true)
    writeFileSync(join(root, mark), 'basura')
    expect(applyPendingWipe(root)).toBe(false)
    expect(existsSync(join(root, mark))).toBe(false)
    // la marca de antes (solo la fecha) sigue valiendo
    writeFileSync(join(root, mark), new Date().toISOString())
    expect(applyPendingWipe(root)).toBe(true)
    expect(existsSync(join(root, 'Packs'))).toBe(false)
  })
})
