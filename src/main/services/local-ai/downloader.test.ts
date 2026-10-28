// Port de `Tests/LocalAIKitTests/DownloaderTests.swift`: descargas grandes contra un servidor falso (SHA-256, reanudación,
// cancelación, disco lleno, redirecciones, huella anunciada) y la descompresión segura de los paquetes del motor.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanupTempDirs, makeTempDir } from '../agents/__fixtures__/support'
import { FakeServer, reply } from './__fixtures__/fake-server'
import { tar, tarEntry } from './__fixtures__/tar'
import { extractArchive, parseTar, safeEntryPath, symlinkStaysInside } from './archive'
import { announcedSHA256, Downloader, DownloadError, isDownloadComplete, progressFraction, type FileDownload, type TransferProgress } from './downloader'

const payload = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 31 + 7) & 0xff))
const sha = createHash('sha256').update(payload).digest('hex')

let server: FakeServer
let origin: string
let folder: string
let slow = false
let failFirst = 0

beforeEach(async () => {
  folder = makeTempDir('downloader')
  slow = false
  failFirst = 0
  server = new FakeServer((r) => {
    if (failFirst > 0) {
      failFirst -= 1
      return { status: 503 }
    }
    switch (r.path) {
      case '/file.gguf':
        return reply.file(payload, r, slow ? { chunkSize: 4096, delayMs: 20 } : {})
      case '/redirect.gguf':
        return { status: 302, headers: { location: '/file.gguf' } }
      // como Hugging Face: la redirección al CDN anuncia el SHA-256 del archivo que va a servir
      case '/announced.gguf':
        return { status: 302, headers: { location: '/file.gguf', 'x-linked-etag': `"${sha}"` } }
      case '/changed.gguf':
        return { status: 302, headers: { location: '/file.gguf', 'x-linked-etag': `"${'b'.repeat(64)}"` } }
      case '/bigger.gguf':
        return reply.file(Buffer.concat([payload, Buffer.from('extra')]), r)
      case '/offsite.gguf':
        return { status: 302, headers: { location: 'http://example.com/file.gguf' } }
      default:
        return reply.notFound()
    }
  })
  origin = await server.start()
})
afterEach(async () => {
  await server.stop()
  cleanupTempDirs()
})

const item = (path = '/file.gguf', sha256: string | undefined = sha): FileDownload => ({ url: origin + path, destination: join(folder, 'm', 'model.gguf'), bytes: payload.length, sha256 })
const downloader = (free = 100 * 1_073_741_824): Downloader => new Downloader({ attempts: 3, retryDelayMs: 0, idleTimeoutMs: 5000, diskMargin: 1000, freeSpace: () => free, insecureHosts: ['127.0.0.1'] })

describe('Downloader', () => {
  it('descarga y comprueba (y no vuelve a pedir lo que ya está)', async () => {
    const progress: TransferProgress[] = []
    await downloader().run([item()], (p) => progress.push(p))
    expect(readFileSync(item().destination).equals(payload)).toBe(true)
    expect(isDownloadComplete(item())).toBe(true)
    expect(progressFraction(progress[progress.length - 1])).toBe(1)
    const before = server.requests.length
    await downloader().run([item()])
    expect(server.requests.length).toBe(before)
  })

  it('una huella que no coincide no deja nada', async () => {
    const err = await downloader().run([item('/file.gguf', 'a'.repeat(64))]).catch((e) => e)
    expect(err).toBeInstanceOf(DownloadError)
    expect(err.kind).toBe('integrity')
    expect(existsSync(item().destination)).toBe(false)
    expect(existsSync(item().destination + '.part')).toBe(false)
  })

  it('sin SHA-256 no se descarga (salvo que se pida a propósito)', async () => {
    const err = await downloader().run([item('/file.gguf', '')]).catch((e) => e)
    expect(err.kind).toBe('missingChecksum')
    expect(err.message).toContain('model.gguf')
    await downloader().run([{ ...item('/file.gguf', undefined), unverified: true }])
    expect(isDownloadComplete({ ...item(), sha256: undefined })).toBe(true)
  })

  it('reanuda con Range', async () => {
    mkdirSync(join(folder, 'm'), { recursive: true })
    writeFileSync(item().destination + '.part', payload.subarray(0, 100_000))
    await downloader().run([item()])
    expect(readFileSync(item().destination).equals(payload)).toBe(true)
    expect(server.requestsTo('/file.gguf').pop()?.headers.range).toBe('bytes=100000-')
  })

  it('cancelar deja lo bajado para después', async () => {
    slow = true
    const controller = new AbortController()
    const d = downloader()
    const run = d.run([item()], () => undefined, controller.signal)
    await new Promise((r) => setTimeout(r, 300))
    controller.abort()
    const err = await run.catch((e) => e)
    expect(err?.name).toBe('AbortError')
    const partial = statSync(item().destination + '.part').size
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(payload.length)
    slow = false
    await d.run([item()])
    expect(isDownloadComplete(item())).toBe(true)
  })

  it('sin sitio en el disco', async () => {
    const err = await downloader(10).run([item()]).catch((e) => e)
    expect(err.kind).toBe('noSpace')
    expect(err.code).toBe('local_no_space')
  })

  it('la huella anunciada se comprueba antes de bajar nada (y no se reintenta)', async () => {
    const err = await downloader().run([item('/changed.gguf')]).catch((e) => e)
    expect(err.kind).toBe('changed')
    expect(server.requestsTo('/file.gguf')).toHaveLength(0)
    expect(server.requestsTo('/changed.gguf')).toHaveLength(1)
    expect(existsSync(item().destination)).toBe(false)
    await downloader().run([item('/announced.gguf')]) // con el SHA-256 esperado, sigue normalmente
    expect(isDownloadComplete(item())).toBe(true)
  })

  it('reintenta los errores pasajeros y sigue redirecciones del mismo servidor', async () => {
    failFirst = 2
    await downloader().run([item('/redirect.gguf')])
    expect(isDownloadComplete(item())).toBe(true)
  })

  it('más grande de lo publicado se rechaza; redirigir a http ajeno también', async () => {
    expect((await downloader().run([item('/bigger.gguf')]).catch((e) => e)).kind).toBe('integrity')
    expect(existsSync(item().destination + '.part')).toBe(false)
    const offsite = await downloader().run([item('/offsite.gguf')]).catch((e) => e)
    expect(offsite.kind).toBe('network')
  })

  it('un 404 es un error claro que no se reintenta', async () => {
    const err = await downloader().run([item('/no-existe.gguf')]).catch((e) => e)
    expect(err.kind).toBe('http')
    expect(err.message).toContain('404')
    expect(server.requestsTo('/no-existe.gguf')).toHaveLength(1)
  })

  it('si la red no deja ver las redirecciones, se dejan seguir solas', async () => {
    const modes: string[] = []
    const d = new Downloader({
      attempts: 1, retryDelayMs: 0, diskMargin: 0, freeSpace: () => 2 ** 40,
      fetch: async (url, init) => {
        modes.push(String(init?.redirect))
        return init?.redirect === 'manual' ? Response.error() : fetch(url, init)
      }
    })
    await d.run([item('/redirect.gguf')])
    expect(isDownloadComplete(item())).toBe(true)
    expect(modes).toEqual(['manual', 'follow'])
  })

  it('lee la huella de X-Linked-Etag', () => {
    expect(announcedSHA256(new Headers({ 'x-linked-etag': `W/"${'A'.repeat(64)}"` }))).toBe('a'.repeat(64))
    expect(announcedSHA256(new Headers({ 'x-linked-etag': '"abc"' }))).toBeUndefined()
    expect(announcedSHA256(new Headers())).toBeUndefined()
  })
})

// MARK: Paquetes


describe('Descompresión segura', () => {
  it('rutas internas', () => {
    expect(safeEntryPath('./build/bin/llama-server')).toBe('build/bin/llama-server')
    expect(safeEntryPath('a\\b')).toBe('a/b')
    for (const bad of ['/etc/passwd', '../x', 'a/../../x', 'C:\\Windows\\x', '', 'a\0b']) expect(safeEntryPath(bad), bad).toBeUndefined()
    expect(symlinkStaysInside('bin/libllama.so', 'libllama.so.0')).toBe(true)
    expect(symlinkStaysInside('bin/x', '../lib/y')).toBe(true)
    expect(symlinkStaysInside('bin/x', '../../fuera')).toBe(false)
    expect(symlinkStaysInside('bin/x', '/etc/passwd')).toBe(false)
  })

  it('tar.gz con carpetas, permisos y enlaces internos', async () => {
    const dir = makeTempDir()
    const archive = join(dir, 'llama.tar.gz')
    writeFileSync(archive, gzipSync(tar(
      tarEntry('llama-b1/', { type: '5', mode: 0o755 }),
      tarEntry('llama-b1/llama-server', { data: '#!/bin/sh\necho hola\n', mode: 0o755 }),
      tarEntry('llama-b1/libllama.so.0', { data: 'ELF' }),
      tarEntry('llama-b1/libllama.so', { type: '2', link: 'libllama.so.0' })
    )))
    const out = join(dir, 'out')
    expect(await extractArchive(archive, out)).toBe(3) // 2 archivos y 1 enlace
    expect(readFileSync(join(out, 'llama-b1/llama-server'), 'utf8')).toContain('echo hola')
    expect(statSync(join(out, 'llama-b1/llama-server')).mode & 0o111).not.toBe(0)
    expect(readlinkSync(join(out, 'llama-b1/libllama.so'))).toBe('libllama.so.0')
  })

  it('rechaza rutas y enlaces que salen del paquete', async () => {
    const dir = makeTempDir()
    const evil = join(dir, 'evil.tar.gz')
    writeFileSync(evil, gzipSync(tar(tarEntry('../fuera', { data: 'x' }))))
    await expect(extractArchive(evil, join(dir, 'a'))).rejects.toThrow('ruta no permitida')
    const link = join(dir, 'link.tar.gz')
    writeFileSync(link, gzipSync(tar(tarEntry('bin/x', { type: '2', link: '/etc/passwd' }))))
    await expect(extractArchive(link, join(dir, 'b'))).rejects.toThrow('enlace fuera del paquete')
    expect(existsSync(join(dir, 'fuera'))).toBe(false)
  })

  // J3-6: enlaces encadenados («p -> .», «p/q -> ..») + enlace duro escribían FUERA de la carpeta del motor
  it('PoC de J3: enlaces encadenados y enlace duro no escriben fuera del paquete', async () => {
    const dir = makeTempDir()
    const parent = join(dir, 'engine')
    const evil = join(dir, 'chain.tar.gz')
    writeFileSync(evil, gzipSync(tar(
      tarEntry('payload', { data: 'ESCRITO FUERA\n' }),
      tarEntry('p', { type: '2', link: '.' }),
      tarEntry('p/q', { type: '2', link: '..' }),
      tarEntry('q/ESCAPED.txt', { type: '1', link: 'payload' })
    )))
    await expect(extractArchive(evil, join(parent, 'b11429'))).rejects.toThrow(/enlace/)
    expect(existsSync(join(parent, 'ESCAPED.txt'))).toBe(false)
    expect(existsSync(join(dir, 'ESCAPED.txt'))).toBe(false)
  })

  it('rechaza escribir a través de un enlace del paquete y enlaces que pasan por otro enlace', async () => {
    const dir = makeTempDir()
    const cases: [string, Buffer][] = [
      // archivo dentro de una «carpeta» que es un enlace (aunque apunte dentro)
      ['through', gzipSync(tar(tarEntry('real/', { type: '5' }), tarEntry('lnk', { type: '2', link: 'real' }), tarEntry('lnk/x', { type: '1', link: 'real/../real' })))],
      // «d -> .» y luego «x -> d/../fuera»: el texto se queda dentro, la ruta real sale
      ['dotdot-after-link', gzipSync(tar(tarEntry('d', { type: '2', link: '.' }), tarEntry('x', { type: '2', link: 'd/../fuera' })))],
      ['via-link', gzipSync(tar(tarEntry('d', { type: '2', link: '.' }), tarEntry('sub/', { type: '5' }), tarEntry('sub/x', { type: '2', link: '../d/d/y' })))],
      // enlace duro cuyo origen es un enlace que sale
      ['hardlink-origin', gzipSync(tar(tarEntry('a/', { type: '5' }), tarEntry('out', { type: '2', link: 'a/../..' }), tarEntry('copy', { type: '1', link: 'out' })))],
      // la misma ruta dos veces (archivo y luego enlace con su nombre)
      ['duplicate', gzipSync(tar(tarEntry('f', { data: 'a' }), tarEntry('f', { type: '2', link: 'g' })))]
    ]
    for (const [name, data] of cases) {
      const file = join(dir, `${name}.tar.gz`)
      writeFileSync(file, data)
      await expect(extractArchive(file, join(dir, 'x', name)), name).rejects.toThrow(/enlace|repetida|fuera/)
    }
    expect(existsSync(join(dir, 'x', 'fuera'))).toBe(false)
    expect(existsSync(join(dir, 'fuera'))).toBe(false)
  })

  it('siguen valiendo los enlaces normales de las bibliotecas (también hacia carpetas hermanas)', async () => {
    const dir = makeTempDir()
    const file = join(dir, 'ok.tar.gz')
    writeFileSync(file, gzipSync(tar(
      tarEntry('lib/libggml.0.dylib', { data: 'MACHO' }),
      tarEntry('lib/libggml.dylib', { type: '2', link: 'libggml.0.dylib' }),
      tarEntry('bin/libggml.dylib', { type: '2', link: '../lib/libggml.dylib' }),
      tarEntry('bin/copia.dylib', { type: '1', link: 'lib/libggml.0.dylib' })
    )))
    const out = join(dir, 'out')
    expect(await extractArchive(file, out)).toBe(4)
    expect(readFileSync(join(out, 'bin/libggml.dylib'), 'utf8')).toBe('MACHO')
    expect(readFileSync(join(out, 'bin/copia.dylib'), 'utf8')).toBe('MACHO')
  })

  it('nombres largos de GNU y cabeceras pax', () => {
    const longName = 'carpeta/' + 'x'.repeat(150)
    const entries = parseTar(tar(tarEntry('././@LongLink', { type: 'L', data: longName + '\0' }), tarEntry('corto', { data: 'a' })))
    expect(entries.map((e) => e.path)).toEqual([longName])
    const record = (k: string, v: string): string => {
      const body = ` ${k}=${v}\n`
      let len = body.length + 2
      if (String(len).length + body.length !== len) len = String(len + 1).length + body.length
      return `${len}${body}`
    }
    const pax = parseTar(tar(tarEntry('PaxHeader', { type: 'x', data: record('path', 'ruta/ñandú.txt') }), tarEntry('otra', { data: 'b' })))
    expect(pax[0].path).toBe('ruta/ñandú.txt')
  })

  it('zip (como los paquetes de Windows)', async () => {
    const dir = makeTempDir()
    const zip = new JSZip()
    zip.file('llama-server.exe', 'MZ', { unixPermissions: 0o100755 })
    zip.file('ggml.dll', 'MZ')
    zip.folder('sub')!.file('LICENSE', 'MIT')
    const archive = join(dir, 'llama.zip')
    writeFileSync(archive, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))
    const out = join(dir, 'out')
    await extractArchive(archive, out)
    expect(readFileSync(join(out, 'llama-server.exe'), 'utf8')).toBe('MZ')
    expect(readFileSync(join(out, 'sub/LICENSE'), 'utf8')).toBe('MIT')
    const bad = new JSZip()
    bad.file('../../fuera.txt', 'x')
    const evil = join(dir, 'evil.zip')
    writeFileSync(evil, await bad.generateAsync({ type: 'nodebuffer' }))
    await expect(extractArchive(evil, join(dir, 'evil'))).rejects.toThrow('ruta no permitida')
  })

  it('un paquete roto se explica', async () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, 'roto.tar.gz'), 'no es gzip')
    await expect(extractArchive(join(dir, 'roto.tar.gz'), join(dir, 'o'))).rejects.toThrow('gzip ilegible')
    writeFileSync(join(dir, 'roto.zip'), 'no es zip')
    await expect(extractArchive(join(dir, 'roto.zip'), join(dir, 'o2'))).rejects.toThrow('zip ilegible')
  })
})
