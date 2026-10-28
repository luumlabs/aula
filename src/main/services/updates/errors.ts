// Errores de las actualizaciones → un código que la interfaz explica (sin conexión, firma, permisos…).
import type { UpdateErrorCode } from '@shared/ipc/updates'
import { MacInstallError } from './mac-install'

export function classifyUpdateError(err: unknown): UpdateErrorCode {
  if (err instanceof MacInstallError) {
    if (err.code === 'corrupt') return 'corrupt'
    if (err.code === 'verify') return 'signature'
    if (err.code === 'readOnly' || err.code === 'translocated') return 'permission'
    if (err.code === 'disk' || err.code === 'system') return err.code
    return 'install'
  }
  const e = (err ?? {}) as { code?: unknown; message?: unknown; statusCode?: unknown }
  const code = typeof e.code === 'string' ? e.code : ''
  const msg = typeof e.message === 'string' ? e.message : String(err ?? '')
  if (code === 'ERR_CHECKSUM_MISMATCH' || /sha512 checksum mismatch|sha2 checksum mismatch/i.test(msg)) return 'corrupt'
  if (code === 'ERR_UPDATER_INVALID_SIGNATURE' || /not signed by the application owner|code signature|did not pass validation/i.test(msg)) return 'signature'
  if (
    code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' ||
    code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' ||
    code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' ||
    code === 'ERR_UPDATER_ZIP_FILE_NOT_FOUND' ||
    code === 'ERR_UPDATER_INVALID_RELEASE_FEED' ||
    code === 'ERR_XML_MISSED_ELEMENT' || // feed vacío: «No published versions on GitHub»
    e.statusCode === 404 ||
    /HttpError: 404|status 404|"?statusCode"?:\s*404/i.test(msg)
  ) {
    return 'unavailable'
  }
  if (/net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|CONNECTION_\w+|NETWORK_\w+|TIMED_OUT|PROXY_\w+|ADDRESS_UNREACHABLE|SSL_\w+|CERT_\w+|TUNNEL_\w+|EMPTY_RESPONSE)/.test(msg)) return 'offline'
  if (/^(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)$/.test(code)) return 'offline'
  if (code === 'ENOSPC' || /ENOSPC|no space left/i.test(msg)) return 'disk'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || /EACCES|EPERM|EROFS|permission denied|operation not permitted/i.test(msg)) return 'permission'
  // GitHub con límite de peticiones (403/429): como sin conexión, se reintenta más tarde
  if (/HttpError: (403|429)|status (403|429)/.test(msg)) return 'offline'
  return 'unknown'
}
