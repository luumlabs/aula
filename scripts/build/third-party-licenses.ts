// Avisos de licencia de terceros dentro de la app empaquetada (MIT, BSD, Apache, OFL… piden llevar su texto).
//
// Plugin de Vite para las tres compilaciones de electron-vite (main → preload → renderer, en ese orden):
// - cada una apunta los paquetes de node_modules que acaban DENTRO de su bundle (React, three, KaTeX, las fuentes…);
// - main apunta además las dependencias de producción que electron-builder copia tal cual al app.asar (package-lock.json,
//   las que no son `dev`, menos @napi-rs: electron-builder.yml las excluye);
// - y cada una vuelve a escribir out/THIRD_PARTY_LICENSES.txt con todo lo apuntado hasta ahí (out/.licenses/*.json), así
//   que tras la del renderer el archivo está completo. electron-builder lo copia a Resources (extraResources).
// El texto sale del LICENSE*/LICENCE*/COPYING*/NOTICE* del paquete; si no tiene, de la sección «License» de su README;
// si tampoco, del texto estándar de su licencia (MIT, ISC, BSD) con el autor de su package.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

interface Pkg {
  name: string
  version: string
  license: string
  homepage?: string
  /** El autor de su package.json (para el copyright cuando el paquete no trae el texto de su licencia). */
  author?: string
  text: string
  source: 'file' | 'readme' | 'template' | 'missing'
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([._-].*)?$/i

function readJSON(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** La carpeta del paquete al que pertenece un módulo (…/node_modules/<@scope/>name), o null si no es de node_modules. */
export function packageDirOf(id: string): string | null {
  const clean = id.replace(/^\0/, '').split('?')[0].replace(/\\/g, '/')
  const at = clean.lastIndexOf('/node_modules/')
  if (at < 0) return null
  const rest = clean.slice(at + '/node_modules/'.length).split('/')
  const n = rest[0]?.startsWith('@') ? 2 : 1
  if (rest.length < n || !rest[0]) return null
  return clean.slice(0, at) + '/node_modules/' + rest.slice(0, n).join('/')
}

function authorOf(pj: Record<string, unknown>): string {
  const a = pj.author as unknown
  if (typeof a === 'string') return a.replace(/\s*\(.*?\)\s*/g, ' ').trim()
  if (a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string') {
    const o = a as { name: string; email?: string }
    return o.email ? `${o.name} <${o.email}>` : o.name
  }
  return `the ${String(pj.name)} authors`
}

const MIT = (who: string): string => `MIT License

Copyright (c) ${who}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

const ISC = (who: string): string => `ISC License

Copyright (c) ${who}

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby
granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.`

/** La sección de licencia de un README (desde su título hasta el siguiente título del mismo nivel o superior). */
export function readmeLicenseSection(md: string): string | null {
  const lines = md.split(/\r?\n/)
  const start = lines.findIndex((l) => /^#{1,6}\s*licen[cs]e\b/i.test(l.trim()))
  if (start < 0) return null
  const level = /^#+/.exec(lines[start].trim())![0].length
  const body: string[] = []
  for (const l of lines.slice(start + 1)) {
    const m = /^(#{1,6})\s/.exec(l.trim())
    if (m && m[1].length <= level) break
    body.push(l)
  }
  const text = body.join('\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
  // «MIT» a secas no es el texto de la licencia: solo vale si trae el aviso de copyright o el permiso
  return /copyright|permission is hereby granted/i.test(text) ? text : null
}

function licenseFilesIn(dir: string): string[] {
  const out: string[] = []
  const scan = (d: string, depth: number): void => {
    let names: string[] = []
    try {
      names = readdirSync(d)
    } catch {
      return
    }
    for (const n of names.sort()) {
      const p = join(d, n)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isFile() && LICENSE_FILE.test(n) && st.size < 512 * 1024) out.push(p)
      // una carpeta más abajo (p. ej. pdfjs-dist/standard_fonts/LICENSE_FOXIT), sin entrar en otros paquetes
      else if (st.isDirectory() && depth === 0 && n !== 'node_modules' && !n.startsWith('.')) scan(p, 1)
    }
  }
  scan(dir, 0)
  return out
}

export function describePackage(dir: string): Pkg | null {
  const pj = readJSON(join(dir, 'package.json'))
  if (!pj || typeof pj.name !== 'string') return null
  const lic = typeof pj.license === 'string' ? pj.license : typeof (pj.license as { type?: unknown })?.type === 'string' ? String((pj.license as { type: string }).type) : 'UNKNOWN'
  const repo = typeof pj.repository === 'string' ? pj.repository : typeof (pj.repository as { url?: unknown })?.url === 'string' ? String((pj.repository as { url: string }).url) : undefined
  const homepage = typeof pj.homepage === 'string' ? pj.homepage : repo?.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://').replace(/^git@github\.com:/, 'https://github.com/')
  const base: Omit<Pkg, 'text' | 'source'> = { name: pj.name, version: String(pj.version ?? ''), license: lic, homepage, author: pj.author ? authorOf(pj) : undefined }
  const files = licenseFilesIn(dir)
  if (files.length) {
    const text = files
      .map((f) => {
        const rel = f.slice(dir.length + 1).split(sep).join('/')
        const body = readFileSync(f, 'utf8').trim()
        return files.length > 1 ? `── ${rel} ──\n${body}` : body
      })
      .join('\n\n')
    return { ...base, text, source: 'file' }
  }
  const readme = readdirSync(dir).find((n) => /^readme(\.md|\.markdown)?$/i.test(n))
  const section = readme ? readmeLicenseSection(readFileSync(join(dir, readme), 'utf8')) : null
  if (section) return { ...base, text: section, source: 'readme' }
  const who = authorOf(pj)
  if (/^MIT$/i.test(lic)) return { ...base, text: MIT(who), source: 'template' }
  if (/^ISC$/i.test(lic)) return { ...base, text: ISC(who), source: 'template' }
  return { ...base, text: `${lic} — https://spdx.org/licenses/${encodeURIComponent(lic)}.html`, source: 'missing' }
}

/** Las dependencias de producción que electron-builder mete en el app.asar (según package-lock.json). */
export function productionPackageDirs(root: string, exclude: RegExp = /^@napi-rs\//): string[] {
  const lock = readJSON(join(root, 'package-lock.json')) as { packages?: Record<string, { dev?: boolean }> } | null
  const dirs: string[] = []
  for (const [key, info] of Object.entries(lock?.packages ?? {})) {
    if (!key.startsWith('node_modules/') || info.dev) continue
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
    if (exclude.test(name)) continue
    const dir = join(root, key)
    if (existsSync(join(dir, 'package.json'))) dirs.push(dir)
  }
  return dirs
}

/** Paquetes que una hoja de estilos importa con `@import '<paquete>'` (las fuentes de Fontsource, KaTeX, Tailwind):
 *  esos @import los resuelve el CSS, no el grafo de módulos de Vite. */
export function cssImportedPackages(css: string): string[] {
  const names = new Set<string>()
  for (const m of css.matchAll(/@import\s+(?:url\()?['"]([^'"./][^'"]*)['"]/g)) {
    const parts = m[1].split('/')
    names.add(parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
  }
  return [...names]
}

/** Lo primero del archivo: la licencia de la propia Aula (AGPL v3, §0/§5(d); A6-P1-4). */
export const AULA_NOTICE = `Aula — Copyright © 2026 Luum Labs

Aula is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public
License, version 3 only, as published by the Free Software Foundation (SPDX: AGPL-3.0-only). It comes with ABSOLUTELY
NO WARRANTY. The full license is in LICENSE.md, and the additional terms of its section 7 (the names and the icon) in
NOTICE.md, both next to this file. Source code: https://github.com/luumlabs/aula (each release is tagged v<version>).`

/** Quita las líneas de copyright (de otro titular) de un texto de licencia. */
export function withoutCopyrightLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !/^\s*(copyright\b|\(c\)|©)/i.test(l))
    .join('\n')
    .replace(/^\s*\n+/, '')
}

/** Titular conocido de paquetes que no traen su licencia (el package.json solo da un correo). */
const HOLDERS: Record<string, string> = { '@mediapipe/tasks-vision': 'Copyright The MediaPipe Authors.' }

const COMPILED_IN_MARK = '── Libraries compiled into this package ──'

/** Avisos de las bibliotecas de C que van compiladas en el WebAssembly de un paquete (no traen su texto; A6-P2-11).
 *  La lista sale del propio binario (tesseract-core*.wasm: Leptonica, libjpeg, libtiff, libwebp, giflib, libpng, zlib). */
const COMPILED_IN: Record<string, string> = {
  'tesseract.js-core': `The WebAssembly build of tesseract.js-core compiles in Tesseract (Apache-2.0, above) and these libraries.

Leptonica (BSD-2-Clause) — http://www.leptonica.org
Copyright (C) 2001 Leptonica. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
following conditions are met:
1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following
   disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following
   disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL ANY CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

libjpeg (Independent JPEG Group's license)
This software is based in part on the work of the Independent JPEG Group.
Copyright (C) 1991-2014, Thomas G. Lane, Guido Vollbeding.

libtiff (libtiff license)
Copyright (c) 1988-1997 Sam Leffler
Copyright (c) 1991-1997 Silicon Graphics, Inc.

Permission to use, copy, modify, distribute, and sell this software and its documentation for any purpose is hereby
granted without fee, provided that (i) the above copyright notices and this permission notice appear in all copies of
the software and related documentation, and (ii) the names of Sam Leffler and Silicon Graphics may not be used in any
advertising or publicity relating to the software without the specific, prior written permission of Sam Leffler and
Silicon Graphics.

THE SOFTWARE IS PROVIDED "AS-IS" AND WITHOUT WARRANTY OF ANY KIND, EXPRESS, IMPLIED OR OTHERWISE, INCLUDING WITHOUT
LIMITATION, ANY WARRANTY OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.

IN NO EVENT SHALL SAM LEFFLER OR SILICON GRAPHICS BE LIABLE FOR ANY SPECIAL, INCIDENTAL, INDIRECT OR CONSEQUENTIAL
DAMAGES OF ANY KIND, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER OR NOT ADVISED OF THE
POSSIBILITY OF DAMAGE, AND ON ANY THEORY OF LIABILITY, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.

libwebp (BSD-3-Clause)
Copyright (c) 2010, Google Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
following conditions are met:
* Redistributions of source code must retain the above copyright notice, this list of conditions and the following
  disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following
  disclaimer in the documentation and/or other materials provided with the distribution.
* Neither the name of Google nor the names of its contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

giflib (MIT-style license)
Copyright (c) 1997 Eric S. Raymond

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

libpng (PNG Reference Library License) and zlib (zlib License): credited with thanks; their licenses ask to keep their
notices in source distributions (https://www.libpng.org/pub/png/src/libpng-LICENSE.txt, https://zlib.net/zlib_license.html).`
}

export function renderLicenses(pkgs: Pkg[]): string {
  const uniq = new Map<string, Pkg>()
  for (const p of pkgs) uniq.set(`${p.name}@${p.version}`, p)
  const list = [...uniq.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  // sin texto propio (p. ej. un Apache-2.0 sin su LICENSE): el texto de la misma licencia que trae otro paquete, sin
  // las líneas de copyright de ese otro (no son de este paquete; A6-P2-11)
  for (const p of list.filter((x) => x.source === 'missing')) {
    // el más largo: el texto completo de la licencia, no un aviso corto que solo remite a ella
    const twin = list
      .filter((x) => x.source === 'file' && x.license === p.license && !x.text.includes('── '))
      .sort((a, b) => b.text.length - a.text.length)[0]
    if (!twin) continue
    const holder = HOLDERS[p.name] ?? (p.author ? `Copyright: ${p.author} (from its package.json).` : '')
    p.text = `${p.license}. The package doesn't include the license text; this is the standard text of the same license.\n${holder ? `${holder}\n` : ''}\n${withoutCopyrightLines(twin.text)}`
  }
  // bibliotecas compiladas DENTRO de un paquete (WebAssembly) cuyas licencias piden llevar su aviso con el binario
  for (const p of list) {
    const extra = COMPILED_IN[p.name]
    if (extra && !p.text.includes(COMPILED_IN_MARK)) p.text = `${p.text}\n\n${COMPILED_IN_MARK}\n\n${extra}`
  }
  const head = `${AULA_NOTICE}

${'='.repeat(100)}

Aula — third-party software licenses

Aula includes the open-source packages below. Each keeps its own license, reproduced here. This file is generated when
Aula is built, from the packages that are actually inside this copy of the app. Fonts, data and logos, and the
components Aula downloads only when you ask, are listed in THIRD_PARTY_NOTICES.md (next to this file). Electron,
Chromium and Node.js carry their own notices: LICENSE.electron.txt and LICENSES.chromium.html.

${list.length} packages:
${list.map((p) => `  ${p.name} ${p.version} (${p.license})`).join('\n')}
`
  const body = list.map((p) => `${'='.repeat(100)}\n${p.name} ${p.version} · ${p.license}${p.homepage ? ` · ${p.homepage}` : ''}\n${'='.repeat(100)}\n\n${p.text}\n`)
  return [head, ...body].join('\n\n')
}

/** Plugin de Vite: `thirdPartyLicenses('main', { production: true })`, `('preload')`, `('renderer')`. */
export function thirdPartyLicenses(
  part: 'main' | 'preload' | 'renderer',
  opts: { production?: boolean; root?: string; css?: string[] } = {}
): Plugin {
  const root = resolve(opts.root ?? process.cwd())
  const partsDir = join(root, 'out', '.licenses')
  return {
    name: 'aula:third-party-licenses',
    apply: 'build',
    buildStart() {
      // main va primero: empieza de cero para no arrastrar paquetes de compilaciones viejas
      if (part === 'main') rmSync(partsDir, { recursive: true, force: true })
    },
    generateBundle() {
      const dirs = new Set<string>()
      for (const id of this.getModuleIds()) {
        if (this.getModuleInfo(id)?.isExternal) continue
        const d = packageDirOf(id)
        if (d && resolve(d) !== root) dirs.add(resolve(d))
      }
      if (opts.production) for (const d of productionPackageDirs(root)) dirs.add(resolve(d))
      for (const css of opts.css ?? []) {
        for (const name of cssImportedPackages(readFileSync(join(root, css), 'utf8'))) {
          const d = join(root, 'node_modules', name)
          if (existsSync(join(d, 'package.json'))) dirs.add(resolve(d))
        }
      }
      const pkgs = [...dirs].map(describePackage).filter((p): p is Pkg => !!p)
      const missing = pkgs.filter((p) => p.source === 'missing').map((p) => `${p.name}@${p.version} (${p.license})`)
      if (missing.length) this.warn(`sin texto de licencia (solo el identificador): ${missing.join(', ')}`)
      mkdirSync(partsDir, { recursive: true })
      writeFileSync(join(partsDir, `${part}.json`), JSON.stringify(pkgs))
      const all: Pkg[] = []
      for (const f of readdirSync(partsDir).filter((n) => n.endsWith('.json'))) all.push(...(JSON.parse(readFileSync(join(partsDir, f), 'utf8')) as Pkg[]))
      writeFileSync(join(root, 'out', 'THIRD_PARTY_LICENSES.txt'), renderLicenses(all))
    }
  }
}
