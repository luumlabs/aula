// Las rutas «Ajustes → …» de los textos y del código llevan a secciones que existen, con el nombre real de cada idioma.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SETTINGS_SECTION_NAMES, SETTINGS_TITLE, settingsPath, type SettingsSection } from './sections'

const SRC = join(__dirname, '..', '..')
const LOCALES = join(SRC, 'renderer', 'src', 'i18n', 'locales')

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) files(p, out)
    else if (/\.(ts|tsx|json)$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p)
  }
  return out
}

describe('nombres de las secciones de Ajustes', () => {
  it('son los mismos que los títulos de settings.json', () => {
    for (const lang of ['es', 'en'] as const) {
      const json = JSON.parse(readFileSync(join(LOCALES, lang, 'settings.json'), 'utf8')) as Record<string, { title?: string } | string>
      expect(json.title).toBe(SETTINGS_TITLE[lang])
      for (const [section, names] of Object.entries(SETTINGS_SECTION_NAMES)) {
        expect((json[section] as { title?: string }).title, `${lang} ${section}`).toBe(names[lang])
      }
    }
  })

  it('settingsPath da la ruta en el idioma pedido', () => {
    expect(settingsPath('ai', 'es')).toBe('Ajustes → Tu IA')
    expect(settingsPath('memory', 'en')).toBe('Settings → What Aula remembers')
  })

  it('toda ruta «Ajustes → …» / «Settings → …» escrita en el código o en los textos existe', () => {
    const known: Record<'es' | 'en', string[]> = { es: [], en: [] }
    for (const s of Object.keys(SETTINGS_SECTION_NAMES) as SettingsSection[]) {
      known.es.push(SETTINGS_SECTION_NAMES[s].es)
      known.en.push(SETTINGS_SECTION_NAMES[s].en)
    }
    const problems: string[] = []
    for (const file of files(SRC)) {
      // los comentarios no se ven: solo cuentan las líneas de código y los textos
      const text = readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
      for (const [lang, word] of [['es', 'Ajustes'], ['en', 'Settings']] as const) {
        for (const m of text.matchAll(new RegExp(`${word} → ([^\\n]{0,40})`, 'g'))) {
          const rest = m[1].replace(/^[«“"]/, '')
          // rutas de otras apps (los ajustes de Google Calendar), no de Aula
          if (rest.startsWith('${') || rest.startsWith('Integrate calendar')) continue
          if (!known[lang].some((name) => rest.startsWith(name))) problems.push(`${file.slice(SRC.length + 1)}: ${word} → ${m[1]}`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})
