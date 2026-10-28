// Imita github.com (no GitHub Enterprise) lo más fiel posible, por HTTPS, para ensayar la app REAL publicada (que mira
// https://github.com/luumlabs/aula) con --host-resolver-rules="MAP github.com 127.0.0.1:<p>, MAP release-assets.githubusercontent.com 127.0.0.1:<p>".
//   node scripts/dev/fake-github-com.mjs <carpeta> <puerto> <cert.pem> <key.pem>   (ver docs/PUBLISHING.md → Rehearsing)
// <carpeta>/releases.json: [{tag, draft?, prerelease?, title?, notes?}] (más nuevo primero); <carpeta>/mode: "private" → 404 en todo,
// "ratelimit" → 429 en github.com. Como github.com (comprobado con curl el 27-10-2026):
//   /releases.atom (200 atom), /releases/latest → 302 /releases/tag/<t> (JSON si Accept: application/json),
//   /releases/download/<t>/<f> → 302 a release-assets.githubusercontent.com (URL firmada), un rango → 206, varios → 501.
import { createServer } from 'node:https'
import { createReadStream, existsSync, readFileSync, statSync, appendFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { randomUUID } from 'node:crypto'

const [root, portArg, certFile, keyFile] = process.argv.slice(2)
const port = Number(portArg)
const OWNER = 'luumlabs', REPO = 'aula'
const logFile = join(root, 'requests.log')
const releases = () => { try { return JSON.parse(readFileSync(join(root, 'releases.json'), 'utf8')) } catch { return [] } }
const mode = () => { try { return readFileSync(join(root, 'mode'), 'utf8').trim() } catch { return '' } }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const assets = new Map() // id → file

function atom() {
  const e = releases().filter((r) => !r.draft).map((r) =>
    `<entry><id>tag:github.com,2008:Repository/1/${esc(r.tag)}</id><updated>2026-10-27T00:00:00Z</updated>` +
    `<link rel="alternate" type="text/html" href="https://github.com/${OWNER}/${REPO}/releases/tag/${esc(r.tag)}"/>` +
    `<title>${esc(r.title || r.tag)}</title><content type="html">${esc(r.notes || 'No content.')}</content><author><name>${OWNER}</name></author></entry>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="en-US">\n<id>tag:github.com,2008:https://github.com/${OWNER}/${REPO}/releases</id><title>Release notes from ${REPO}</title><updated>2026-10-27T00:00:00Z</updated>\n${e}\n</feed>`
}

function sendFile(req, res, file) {
  const size = statSync(file).size
  const r = req.headers.range || ''
  if (r.includes(',')) { res.writeHead(501, { 'Content-Type': 'application/octet-stream' }); return res.end() }
  const m = /^bytes=(\d*)-(\d*)$/.exec(r)
  const head = { 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream', 'Last-Modified': 'Mon, 27 Oct 2026 12:00:00 GMT', ETag: '"0x8DE15AB"' }
  if (m) {
    const start = m[1] === '' ? size - Number(m[2]) : Number(m[1])
    const end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    if (req.method === 'HEAD') return res.end()
    return createReadStream(file, { start, end }).pipe(res)
  }
  res.writeHead(200, { ...head, 'Content-Length': size })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

createServer({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, (req, res) => {
  const host = String(req.headers.host || '').replace(/:\d+$/, '')
  const url = new URL(req.url || '/', `https://${host}`)
  const p = decodeURIComponent(url.pathname)
  appendFileSync(logFile, `${new Date().toISOString().slice(11, 23)} ${req.method} ${host}${p}${url.search ? '?…' : ''} ${req.headers.range || ''} accept=${req.headers.accept || ''} ua=${(req.headers['user-agent'] || '').slice(0, 40)}\n`)
  const md = mode()
  if (host === 'release-assets.githubusercontent.com') {
    const id = p.split('/').pop()
    const file = assets.get(id)
    if (file && existsSync(file)) return sendFile(req, res, file)
    res.writeHead(403, { 'Content-Type': 'application/xml' }); return res.end('<Error><Code>AuthenticationFailed</Code></Error>')
  }
  if (host !== 'github.com' || md === 'private') { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('Not Found') }
  if (md === 'ratelimit') { res.writeHead(429, { 'Content-Type': 'text/html', 'Retry-After': '60' }); return res.end('Too Many Requests') }
  const base = `/${OWNER}/${REPO}/releases`
  let m
  if (p === `${base}.atom`) { res.writeHead(200, { 'Content-Type': 'application/atom+xml; charset=utf-8' }); return res.end(atom()) }
  if (p === `${base}/latest`) {
    const latest = releases().find((r) => !r.draft && !r.prerelease)
    if (!latest) { res.writeHead(302, { Location: `https://github.com${base}` }); return res.end() }
    res.writeHead(302, { Location: `https://github.com${base}/tag/${latest.tag}`, 'Content-Type': 'text/html; charset=utf-8' }); return res.end()
  }
  if ((m = new RegExp(`^${base}/tag/([^/]+)$`).exec(p))) {
    const rel = releases().find((r) => r.tag === m[1] && !r.draft)
    if (!rel) { res.writeHead(404); return res.end('Not Found') }
    if (/application\/json/.test(req.headers.accept || '')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ id: 396839748, tag_name: rel.tag, update_url: `${base}/tag/${rel.tag}`, update_authenticity_token: 'x', delete_url: `${base}/tag/${rel.tag}`, delete_authenticity_token: 'y', edit_url: `${base}/edit/${rel.tag}` }))
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<html>release</html>')
  }
  if (p === base) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<html>releases</html>') }
  if ((m = new RegExp(`^${base}/download/([^/]+)/([^/]+)$`).exec(p))) {
    const rel = releases().find((r) => r.tag === m[1])
    const file = normalize(join(root, m[1], m[2]))
    if (rel && !rel.draft && file.startsWith(normalize(root)) && existsSync(file)) {
      const id = randomUUID()
      assets.set(id, file)
      res.writeHead(302, { Location: `https://release-assets.githubusercontent.com/github-production-release-asset/1081/${id}?sp=r&sv=2018-11-09&sr=b&spr=https&se=2026-10-27T18%3A00%3A00Z&rscd=attachment%3B+filename%3D${encodeURIComponent(m[2])}&rsct=application%2Foctet-stream&sig=abc`, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': 0 })
      return res.end()
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('Not Found')
}).listen(port, '127.0.0.1', () => console.log(`fake github.com on https://127.0.0.1:${port} (${root})`))
