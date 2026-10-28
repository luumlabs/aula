import { describe, expect, it } from 'vitest'
import { classifyUpdateError } from './errors'
import { MacInstallError } from './mac-install'

const err = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {})

describe('classifyUpdateError', () => {
  it('sin conexión', () => {
    expect(classifyUpdateError(err('net::ERR_INTERNET_DISCONNECTED'))).toBe('offline')
    expect(classifyUpdateError(err('net::ERR_NAME_NOT_RESOLVED'))).toBe('offline')
    expect(classifyUpdateError(err('net::ERR_CONNECTION_REFUSED'))).toBe('offline')
    expect(classifyUpdateError(err('net::ERR_PROXY_CONNECTION_FAILED'))).toBe('offline')
    expect(classifyUpdateError(err('getaddrinfo', 'ENOTFOUND'))).toBe('offline')
    expect(classifyUpdateError(err('HttpError: 403 Forbidden rate limit'))).toBe('offline')
  })
  it('sin versión publicada (repositorio privado, borrador, falta el latest-mac.yml)', () => {
    expect(classifyUpdateError(err('Unable to find latest version on GitHub', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND'))).toBe('unavailable')
    expect(classifyUpdateError(err('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'))).toBe('unavailable')
    expect(classifyUpdateError(err('Cannot find latest-mac.yml', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'))).toBe('unavailable')
    expect(classifyUpdateError(err('No published versions on GitHub', 'ERR_XML_MISSED_ELEMENT'))).toBe('unavailable')
    expect(classifyUpdateError(Object.assign(new Error('404 Not Found'), { statusCode: 404 }))).toBe('unavailable')
  })
  it('descarga dañada y firmas', () => {
    expect(classifyUpdateError(err('sha512 checksum mismatch, expected x, got y', 'ERR_CHECKSUM_MISMATCH'))).toBe('corrupt')
    expect(classifyUpdateError(err('New version 2.0.1 is not signed by the application owner', 'ERR_UPDATER_INVALID_SIGNATURE'))).toBe('signature')
    expect(classifyUpdateError(err('Code signature at URL file:///x did not pass validation: code failed to satisfy specified code requirement(s)'))).toBe('signature')
    expect(classifyUpdateError(new MacInstallError('verify', 'Firma no válida'))).toBe('signature')
    expect(classifyUpdateError(new MacInstallError('corrupt', 'SHA-512 distinto'))).toBe('corrupt')
    expect(classifyUpdateError(new MacInstallError('install', 'x'))).toBe('install')
  })
  it('permisos, disco y el resto', () => {
    expect(classifyUpdateError(err('EACCES: permission denied, rename', 'EACCES'))).toBe('permission')
    expect(classifyUpdateError(err('ENOSPC: no space left on device', 'ENOSPC'))).toBe('disk')
    expect(classifyUpdateError(err('algo raro'))).toBe('unknown')
    expect(classifyUpdateError(undefined)).toBe('unknown')
  })
})
