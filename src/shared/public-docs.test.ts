// Lo que se publica con Aula (README, avisos legales, plantillas, datos de prueba) dice lo que hace la app y no lleva
// datos de nadie. Ids de la auditoría A6.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { publicDocURL } from '@shared/legal'

const ROOT = join(__dirname, '../..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

/** Archivos de texto bajo esas carpetas (sin node_modules, out ni release). */
function textFiles(dirs: string[]): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      // work/: las cachés del vídeo (no van al repositorio)
      if (n === 'node_modules' || n === 'out' || n === 'release' || n === 'work' || n.startsWith('.')) continue
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx|mjs|js|json|md|ics|html|txt|yml)$/.test(n)) out.push(p)
    }
  }
  for (const d of dirs) walk(join(ROOT, d))
  return out
}

describe('datos de prueba sin datos reales (A6-P1-1)', () => {
  it('los Canvas de pruebas y ejemplos son de mentira: solo subdominios de ejemplo de instructure.com', () => {
    // un Canvas es <centro>.instructure.com: el de verdad de alguien dice dónde estudia
    const allowed = new Set(['uni', 'school', 'u', 'x', 'other', 'example', 'canvas', 'tuuniversidad', 'youruniversity'])
    const found: string[] = []
    for (const f of textFiles(['src', 'tests', 'resources', 'docs', 'scripts'])) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\b([a-z0-9-]+)\.instructure\.com\b/gi)) {
        if (!allowed.has(m[1].toLowerCase())) found.push(`${relative(ROOT, f)}: ${m[0]}`)
      }
    }
    expect(found).toEqual([])
  })
})

describe('licencia y avisos (A6-P1-4, A6-P1-5)', () => {
  it('NOTICE.md lleva el copyright, la falta de garantía y los términos del §7(e) y §7(c), y viaja con la app', () => {
    const notice = read('NOTICE.md')
    expect(notice).toContain('Copyright © 2026 Luum Labs')
    expect(notice).toMatch(/WITHOUT ANY WARRANTY/)
    expect(notice).toMatch(/version 3 only/)
    expect(notice).toMatch(/section 7\(e\)/)
    expect(notice).toMatch(/section 7\(c\)/)
    expect(notice).toMatch(/Unmodified copies may keep the name/)
    expect(read('electron-builder.yml')).toMatch(/- \{ from: NOTICE\.md, to: NOTICE\.md \}/)
    // LICENSE.md se queda con el texto puro (GitHub lo detecta como agpl-3.0)
    expect(read('LICENSE.md')).toMatch(/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/)
    expect(read('LICENSE.md')).not.toMatch(/Luum Labs/)
  })

  it('README, CONTRIBUTING y THIRD_PARTY_NOTICES remiten a NOTICE.md y ya no dicen que el icono «no va incluido»', () => {
    for (const f of ['README.md', 'README.es.md', 'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md']) expect(read(f), f).toContain('NOTICE.md')
    expect(read('README.md')).not.toMatch(/aren't included/)
    expect(read('README.es.md')).not.toMatch(/no van incluidos/)
    expect(read('CONTRIBUTING.md')).not.toMatch(/aren't covered by the license as trademarks/)
  })

  it('la AGPL pide OFRECER el código a quien recibe la versión, no publicarlo para todos (A6-P2-13)', () => {
    expect(read('README.md')).toMatch(/you must offer them\s+its complete source code/)
    expect(read('README.es.md')).toMatch(/tienes que ofrecerles su código completo/)
    expect(read('README.md')).toMatch(/AGPL-3\.0-only/)
  })

  it('CONTRIBUTING: licencias permisivas, cesión a quien mantenga Aula y el código de conducta (A6-P2-12, A6-P2-17)', () => {
    const c = read('CONTRIBUTING.md')
    expect(c).not.toMatch(/GPL-3\.0…\)/)
    expect(c).toMatch(/copyleft dependencies \(GPL, LGPL, AGPL\) only after discussing it/)
    expect(c).toMatch(/any successor or assignee that maintains Aula/)
    expect(c).toContain('CODE_OF_CONDUCT.md')
    const coc = read('CODE_OF_CONDUCT.md')
    expect(coc).toMatch(/Contributor Covenant/)
    expect(coc).not.toMatch(/@(gmail|proton|icloud)\./)
  })

  it('THIRD_PARTY_NOTICES: los logos no son de la licencia de Aula y el MIT de los de OpenAI va con ellos (A6-P2-11)', () => {
    const n = read('THIRD_PARTY_NOTICES.md')
    expect(n).toMatch(/These logo drawings are not covered by Aula's license/)
    expect(n).toMatch(/## OpenAI Cookbook \(MIT\)/)
    expect(n).toMatch(/aren't copyrightable/)
    expect(n).toMatch(/libappindicator/)
  })
})

describe('README coherente con la release (A6-P2-7, A6-P2-19)', () => {
  // el corto está ahora en docs/FEATURES*.md (el README se quedó con la demo de 90 s)
  it('el corto no descarga el máster de 256 MB: enlaza al corte web y dice cuánto pesa', () => {
    for (const f of ['docs/FEATURES.md', 'docs/FEATURES.es.md']) {
      const md = read(f)
      expect(md, f).not.toMatch(/releases\/download\/v[\d.]+\/Aula-film\.mp4/)
      expect(md, f).toMatch(/releases\/download\/v[\d.]+\/Aula-film-web\.mp4/)
      // dice cuánto pesa (el corte web, ≤ 27 MB)
      expect(md, f).toMatch(/\b(1\d|2[0-7]) MB\b/)
    }
  })

  it('la versión de Node del README y de CONTRIBUTING es la que piden las herramientas (package.json → engines)', () => {
    const engines = (JSON.parse(read('package.json')) as { engines: { node: string } }).engines.node
    expect(engines).toBe('^20.19.0 || >=22.12.0')
    expect(read('README.md')).toMatch(/Node\.js 22\.12 or later/)
    expect(read('README.es.md')).toMatch(/Node\.js 22\.12 o posterior/)
    expect(read('CONTRIBUTING.md')).toMatch(/Node\.js 22\.12 or later \(20\.19 or later also works\)/)
  })
})

describe('plantillas de GitHub (A6-P2-16)', () => {
  it('el registro se encuentra también en Windows y Linux, que no tienen menú «Help»', () => {
    const t = read('.github/ISSUE_TEMPLATE/bug_report.yml')
    expect(t).toMatch(/On macOS: menu \*\*Help → Show Logs\*\*/)
    expect(t).toMatch(/Settings → Privacy and data → Open data folder\* → `Logs\/main\.log`/)
  })
})

describe('la .deb de Linux y el código de cada versión (A6-P1-3, A6-P2-14)', () => {
  const version = (JSON.parse(read('package.json')) as { version: string }).version
  const deb = `Aula-${version}-linux-amd64.deb`

  it('README, instalación, notas y plantilla cuentan lo mismo de la .deb, y lo que de verdad hace', () => {
    expect(read(`docs/release-notes/${version}.md`)).toContain(deb)
    // el README y docs/INSTALL*.md nombran los archivos con <version>/<versión>, así una versión nueva no los deja viejos
    const named = { en: deb.replace(version, '<version>'), es: deb.replace(version, '<versión>') }
    for (const f of ['README.md', 'docs/INSTALL.md']) expect(read(f), f).toContain(named.en)
    for (const f of ['README.es.md', 'docs/INSTALL.es.md']) expect(read(f), f).toContain(named.es)
    for (const f of ['README.md', 'README.es.md', 'docs/INSTALL.md', 'docs/INSTALL.es.md']) {
      expect(read(f), f).not.toMatch(/Aula-(Setup-)?\d+\.\d+\.\d+/)
    }
    expect(read('.github/ISSUE_TEMPLATE/bug_report.yml')).toContain('Linux (.deb)')
    // la .deb no se actualiza sola: Aula avisa y Ajustes → Acerca de lleva a descargarla de las releases
    expect(read('docs/INSTALL.md')).not.toMatch(/offers the new one to download/)
    expect(read('docs/INSTALL.md')).toMatch(/download its `\.deb` from the \[releases\]/)
    expect(read('docs/INSTALL.es.md')).toMatch(/descarga su `\.deb` de las \[versiones publicadas\]/)
    // en Ubuntu ≥ 23.10 la AppImage arranca sin el aislamiento de Chromium (AppRun de electron-builder), no «se cierra»
    expect(read('docs/INSTALL.md')).not.toMatch(/closes right away/)
    expect(read('docs/INSTALL.md')).toMatch(/starts with that sandbox turned off/)
    expect(read('docs/INSTALL.es.md')).toMatch(/arranca con ese aislamiento apagado/)
  })

  it('PUBLISHING no manda a --only para añadir la .deb a una versión ya etiquetada', () => {
    const p = read('docs/PUBLISHING.md')
    expect(p).not.toMatch(/so you can add the `\.deb` later/)
    expect(p).toMatch(/### Adding a `\.deb` to a published release/)
    const section = p.split('### Adding a `.deb` to a published release')[1]?.split('\n## ')[0] ?? ''
    // La receta usa el código etiquetado y crea solo la .deb, sin publicar lo que genere el builder.
    expect(section).toMatch(/git worktree add \S+ v\d+\.\d+\.\d+/)
    expect(section).toMatch(/npx electron-builder --linux deb[^\n]*--publish never/)
    // Un archivo explícito: ni globs, ni AppImages, ni feeds que sustituyan la actualización publicada.
    const uploads = section.split('\n').filter((line) => line.startsWith('gh release upload ')).map((line) => line.split('#')[0].trim())
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatch(/^gh release upload v\d+\.\d+\.\d+ [^\s*?{}]+\.deb -R [^\s]+$/)
    expect(section).toMatch(/Never upload the\s+`latest-linux\.yml`/)
    expect(section).toMatch(/Don't use\s+`scripts\/release-local\.sh --only linux`/)
  })

  it('las notas de la versión dicen dónde está su código fuente, en las dos lenguas', () => {
    const md = read(`docs/release-notes/${version}.md`)
    expect(md).toMatch(new RegExp(`\\*\\*Source code:\\*\\* the \\*Source code\\* archives of this release \\(tag \`v${version.replace(/\./g, '\\.')}\`\\)`))
    expect(md).toMatch(/\*\*Código fuente:\*\* los archivos \*Source code\* de esta versión/)
  })
})

describe('política de privacidad y soporte (App Store 5.1.1(i))', () => {
  it('las dos páginas tienen su mitad en español, a la que lleva el ancla #español', () => {
    for (const f of ['docs/PRIVACY.md', 'docs/SUPPORT.md']) expect(read(f), f).toMatch(/^## Español$/m)
  })

  it('la misma dirección en la app, las apps nativas y la ficha del App Store', () => {
    const listing = read('docs/app-store/listing.md')
    expect(listing).toContain(`| Privacy policy URL | ${publicDocURL('privacy', 'en')} |`)
    expect(listing).toContain(`| Support URL | ${publicDocURL('support', 'en')} |`)
    expect(read('native/android/res/values/strings.xml')).toContain(`>${publicDocURL('privacy', 'en')}<`)
    expect(read('native/android/res/values-es/strings.xml')).toContain(`>${publicDocURL('privacy', 'es')}<`)
    const ios = read('native/ios/Aula/LicensesView.swift')
    expect(ios).toContain(`"${publicDocURL('privacy', 'en')}"`)
    expect(ios).toContain('#espa%C3%B1ol')
  })
})
