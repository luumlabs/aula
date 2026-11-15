// Lista exacta del grafo de la entrada aislada; el protocolo nunca sirve todos los assets de la app.
import { posix } from 'node:path'
import type { Plugin } from 'vite'

export function figureRenderAssets(): Plugin {
  return {
    name: 'aula:figure-render-assets', apply: 'build', enforce: 'post',
    generateBundle(_options, bundle) {
      const entry = 'figure-render.html', seen = new Set<string>()
      const visit = (name: string): void => {
        if (seen.has(name)) return
        const file = bundle[name]
        if (!file) throw new Error(`Recurso de figura ausente: ${name}`)
        seen.add(name)
        if (file.type === 'chunk') {
          for (const dependency of [...file.imports, ...file.dynamicImports]) visit(dependency)
          const meta = (file as typeof file & { viteMetadata?: { importedCss: Set<string>; importedAssets: Set<string> } }).viteMetadata
          for (const dependency of [...meta?.importedCss ?? [], ...meta?.importedAssets ?? []]) visit(dependency)
        } else if (/\.(html|css)$/.test(name)) {
          const text = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source)
          const references = name.endsWith('.html') ? [...text.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m => m[1]) : [...text.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g)].map(m => m[1])
          for (const reference of references) {
            if (reference.startsWith('data:')) continue
            if (/^[a-z]+:/i.test(reference) || reference.startsWith('//')) throw new Error('La figura no admite recursos externos')
            visit(reference.startsWith('/') ? reference.slice(1) : posix.normalize(posix.join(posix.dirname(name), reference)))
          }
        }
      }
      visit(entry)
      this.emitFile({ type: 'asset', fileName: 'figure-render-assets.json', source: JSON.stringify({ version: 1, files: [...seen].sort() }) })
    }
  }
}
