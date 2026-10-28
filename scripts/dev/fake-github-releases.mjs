// Servidor que imita las releases de GitHub (como GitHub Enterprise: electron-updater con `host` y `protocol: http`)
// para ensayar las actualizaciones sin publicar nada. Solo escucha en 127.0.0.1.
//
//   node scripts/dev/fake-github-releases.mjs <carpeta> [puerto=8765]
//
// <carpeta>/releases.json: [{ "tag": "v0.1.1", "draft": false, "prerelease": false, "title": "Aula 0.1.1", "notes": "…" }]
// (el más nuevo primero) y <carpeta>/<tag>/<archivo> con lo que subiría electron-builder (zip, blockmap, latest-mac.yml…).
// Se vuelve a leer en cada petición: cambia "draft" a false para «publicar» sin reiniciar el servidor.
// Como GitHub: los borradores no salen en el feed ni en /latest y sus archivos dan 404; /latest ignora las prerelease.
import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'

const root = process.argv[2]
const port = Number(process.argv[3] || 8765)
if (!root) {
  console.error('Uso: node scripts/dev/fake-github-releases.mjs <carpeta> [puerto]')
  process.exit(2)
}

function releases() {
  try {
    return JSON.parse(readFileSync(join(root, 'releases.json'), 'utf8'))
  } catch {
    return []
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function atom(owner, repo) {
  const entries = releases()
    .filter((r) => !r.draft)
    .map(
      (r) => `<entry><id>tag:github.com,2008:Repository/1/${esc(r.tag)}</id><updated>2026-10-26T00:00:00Z</updated>` +
        `<link rel="alternate" type="text/html" href="http://127.0.0.1:${port}/${owner}/${repo}/releases/tag/${esc(r.tag)}"/>` +
        `<title>${esc(r.title || r.tag)}</title><content type="html">${esc(r.notes || 'No content.')}</content></entry>`
    )
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US"><id>tag:github.com,2008:/${owner}/${repo}/releases</id><title>Release notes from ${repo}</title>${entries.join('')}</feed>`
}

function sendFile(req, res, file) {
  const size = statSync(file).size
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  if (range) {
    const start = range[1] === '' ? size - Number(range[2]) : Number(range[1])
    const end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), size - 1) : size - 1
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' })
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream' })
  createReadStream(file).pipe(res)
}

createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
  const p = decodeURIComponent(url.pathname)
  console.log(new Date().toISOString().slice(11, 19), req.method, p, req.headers.range || '')
  let m
  if ((m = /^\/([^/]+)\/([^/]+)\/releases\.atom$/.exec(p))) {
    res.writeHead(200, { 'Content-Type': 'application/atom+xml' })
    return res.end(atom(m[1], m[2]))
  }
  if (/^\/api\/v3\/repos\/[^/]+\/[^/]+\/releases\/latest$/.test(p)) {
    const latest = releases().find((r) => !r.draft && !r.prerelease)
    if (!latest) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      return res.end('{"message":"Not Found"}')
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ tag_name: latest.tag, name: latest.title, draft: false, prerelease: false }))
  }
  if ((m = /^\/[^/]+\/[^/]+\/releases\/download\/([^/]+)\/([^/]+)$/.exec(p))) {
    const rel = releases().find((r) => r.tag === m[1])
    const file = normalize(join(root, m[1], m[2]))
    if (rel && !rel.draft && file.startsWith(normalize(root)) && existsSync(file)) return sendFile(req, res, file)
  }
  res.writeHead(404)
  res.end('Not Found')
}).listen(port, '127.0.0.1', () => console.log(`releases de prueba en http://127.0.0.1:${port} (${root})`))
