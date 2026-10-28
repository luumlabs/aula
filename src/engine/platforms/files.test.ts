import { describe, expect, it } from 'vitest'
import { directDownloadURL, isStudyFileLink } from './files'
import {
  ensureExtension, filenameFromContentDisposition, filenameFromURL, hasBlockedExtension, isBlockedMime, isExecutableContent, looksLikeWebPage,
  sanitizeFilename, uniqueNameCandidates
} from './download-safety'
import { isLoopbackURL, normalizeBrowserURL, sitePatternMatches } from './url-policy'
import { acceptLanguages, chromeUserAgent } from './useragent'
import { READ_ONLY_RULES, platformGuide, platformInstructions, platformKindNamed } from './guides'

describe('enlaces de archivos → descarga directa', () => {
  it('Canvas', () => {
    expect(directDownloadURL('https://u.instructure.com/courses/1/files/22?verifier=abc&wrap=1')).toBe('https://u.instructure.com/courses/1/files/22/download?download_frd=1&verifier=abc')
    expect(directDownloadURL('https://u.instructure.com/files/22/preview')).toBe('https://u.instructure.com/files/22/download?download_frd=1')
    expect(directDownloadURL('https://u.instructure.com/courses/1/files')).toBeNull()
  })

  it('Moodle', () => {
    expect(directDownloadURL('https://c.edu/mod/resource/view.php?id=5')).toBe('https://c.edu/mod/resource/view.php?id=5&redirect=1')
    expect(directDownloadURL('https://c.edu/pluginfile.php/1/mod_resource/content/0/t.pdf')).toBe('https://c.edu/pluginfile.php/1/mod_resource/content/0/t.pdf?forcedownload=1')
  })

  it('Brightspace, Drive, Docs y SharePoint', () => {
    expect(directDownloadURL('https://l.edu/d2l/le/content/123/viewContent/456/View')).toBe('https://l.edu/d2l/le/content/123/topics/files/download/456/DirectFileTopicDownload')
    expect(directDownloadURL('https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=sharing')).toBe('https://drive.google.com/uc?export=download&id=1AbCdEfGhIjK&confirm=t')
    expect(directDownloadURL('https://docs.google.com/document/d/1AbCdEfGhIjK/edit')).toBe('https://docs.google.com/document/d/1AbCdEfGhIjK/export?format=pdf')
    expect(directDownloadURL('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/edit')).toBe('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/export?format=xlsx')
    expect(directDownloadURL('https://t.sharepoint.com/sites/c/Shared%20Documents/tema.pdf')).toBe('https://t.sharepoint.com/sites/c/Shared%20Documents/tema.pdf?download=1')
    expect(directDownloadURL('https://t.sharepoint.com/sites/c/_layouts/15/Doc.aspx?sourcedoc={0123456789abcdef0123456789abcdef}')).toBe('https://t.sharepoint.com/sites/c/_layouts/15/download.aspx?UniqueId=0123456789abcdef0123456789abcdef')
  })

  it('enlaces que ya son archivos', () => {
    expect(isStudyFileLink('https://c.edu/pluginfile.php/1/x.pdf')).toBe(true)
    expect(isStudyFileLink('https://bb.edu/bbcswebdav/pid-1/x.pdf')).toBe(true)
    expect(isStudyFileLink('https://s.edu/access/content/group/x/a.pdf')).toBe(true)
    expect(isStudyFileLink('https://c.edu/course/view.php?id=1')).toBe(false)
  })
})

describe('seguridad de las descargas', () => {
  it('nombres saneados', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('tema‮fdp.exe')).toBe('temafdp.exe')
    expect(sanitizeFilename('a:b<c>.pdf')).toBe('a-b_c_.pdf')
    expect(sanitizeFilename('  .oculto ')).toBe('oculto')
    expect(sanitizeFilename('CON.txt')).toBe('_CON.txt')
    expect(sanitizeFilename('')).toBe('archivo')
    expect([...sanitizeFilename('x'.repeat(300) + '.pdf')].length).toBeLessThanOrEqual(180)
  })

  it('programas fuera (por extensión, tipo o contenido)', () => {
    expect(hasBlockedExtension('setup.EXE')).toBe(true)
    expect(hasBlockedExtension('tema.pdf')).toBe(false)
    expect(isBlockedMime('application/x-msdownload; charset=binary')).toBe(true)
    expect(isExecutableContent(new Uint8Array([0x4d, 0x5a, 0, 0]), 'doc.pdf')).toBe(true)
    expect(isExecutableContent(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]), 'x.pdf')).toBe(true)
    expect(isExecutableContent(new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]), 'x.pdf')).toBe(true)
    expect(isExecutableContent(new TextEncoder().encode('#!/bin/sh'), 'script')).toBe(true)
    expect(isExecutableContent(new TextEncoder().encode('#!/bin/sh'), 'notas.txt')).toBe(false)
    expect(isExecutableContent(new TextEncoder().encode('%PDF-1.7'), 'tema.pdf')).toBe(false)
    expect(isExecutableContent(new Uint8Array([1, 2, 3, 4]), 'x.bin.pdf', new TextEncoder().encode('koly'))).toBe(true)
  })

  it('una página web en vez del archivo', () => {
    expect(looksLikeWebPage('text/html; charset=utf-8')).toBe(true)
    expect(looksLikeWebPage('application/octet-stream', new TextEncoder().encode('  <!DOCTYPE html><html>'))).toBe(true)
    expect(looksLikeWebPage('text/html', undefined, 'pagina.html')).toBe(false)
    expect(looksLikeWebPage('application/pdf', new TextEncoder().encode('%PDF'))).toBe(false)
  })

  it('nombres desde cabeceras y direcciones', () => {
    expect(filenameFromContentDisposition("attachment; filename*=UTF-8''Tema%201%20%C3%A1.pdf")).toBe('Tema 1 á.pdf')
    expect(filenameFromContentDisposition('attachment; filename="apuntes.pdf"')).toBe('apuntes.pdf')
    expect(filenameFromContentDisposition(null)).toBeNull()
    expect(filenameFromURL('https://x.edu/a/Tema%202.pdf?x=1')).toBe('Tema 2.pdf')
    expect(filenameFromURL('https://x.edu/a/view')).toBeNull()
    expect(ensureExtension('apuntes', 'application/pdf')).toBe('apuntes.pdf')
    expect(ensureExtension('apuntes.docx', 'application/pdf')).toBe('apuntes.docx')
    expect(uniqueNameCandidates('t.pdf', 3)).toEqual(['t.pdf', 't (2).pdf', 't (3).pdf'])
  })
})

describe('direcciones que abre el navegador', () => {
  it('solo http y https, sin credenciales', () => {
    expect(normalizeBrowserURL('example.com/x')).toEqual({ ok: true, url: 'https://example.com/x' })
    expect(normalizeBrowserURL('http:example.com')).toEqual({ ok: true, url: 'http://example.com/' })
    expect(normalizeBrowserURL('localhost:8080/x')).toEqual({ ok: true, url: 'https://localhost:8080/x' })
    expect(normalizeBrowserURL('file:///etc/passwd')).toMatchObject({ ok: false, error: 'forbidden_scheme' })
    expect(normalizeBrowserURL('javascript:alert(1)')).toMatchObject({ ok: false, error: 'forbidden_scheme' })
    expect(normalizeBrowserURL('https://u:p@x.com')).toMatchObject({ ok: false, error: 'credentials_in_url' })
    expect(normalizeBrowserURL('')).toMatchObject({ ok: false, error: 'invalid_url' })
  })

  it('patrones de sitio', () => {
    expect(sitePatternMatches('https://x.edu', 'https://x.edu/a')).toBe(true)
    expect(sitePatternMatches('https://x.edu', 'http://x.edu/a')).toBe(false)
    expect(sitePatternMatches('*.x.edu', 'https://a.b.x.edu/')).toBe(true)
    expect(sitePatternMatches('x.edu:8080', 'https://x.edu:8080/')).toBe(true)
    expect(sitePatternMatches('x.edu:8080', 'https://x.edu/')).toBe(false)
    expect(sitePatternMatches('*', 'https://y.com')).toBe(true)
    expect(isLoopbackURL('http://127.0.0.1:3000')).toBe(true)
    expect(isLoopbackURL('https://x.edu')).toBe(false)
  })
})

describe('agente de usuario', () => {
  it('quita Electron y Aula y deja solo la versión mayor de Chrome', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Aula/2.0.0 Chrome/146.0.7680.31 Electron/44.9.3 Safari/537.36'
    expect(chromeUserAgent(ua)).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36')
  })

  it('idiomas aceptados', () => {
    expect(acceptLanguages('es-ES')).toBe('es-ES,es;q=0.9,en;q=0.8')
    expect(acceptLanguages('en')).toBe('en')
    expect(acceptLanguages('pt_BR')).toBe('pt-BR,pt;q=0.9,en;q=0.8')
  })
})

describe('guías para la IA', () => {
  it('cada plataforma tiene su guía y todas llevan las reglas de solo lectura', () => {
    expect(platformGuide('canvas')).toContain('Modules')
    expect(platformGuide('moodle')).toContain('startattempt.php')
    expect(platformInstructions('blackboard').startsWith(READ_ONLY_RULES)).toBe(true)
    expect(platformKindNamed('D2L')).toBe('brightspace')
    expect(platformKindNamed('Google Classroom')).toBe('classroom')
    expect(platformKindNamed('blackboard ultra')).toBe('blackboard')
    expect(platformKindNamed('')).toBeNull()
  })
})
