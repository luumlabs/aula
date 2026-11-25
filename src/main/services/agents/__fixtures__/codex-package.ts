// Paquetes falsos de Codex con la estructura del oficial (`codex-package-<triple>.tar.gz`, listado de rust-v0.162.1):
// `codex-package.json`, `bin/codex` y `bin/codex-code-mode-host` (con `.exe` en Windows), `codex-path/rg` y `codex-resources/`.
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { tar, tarEntry } from '../../local-ai/__fixtures__/tar'

export interface FakeCodexPackage {
  /** Sistema del paquete: en Windows, los programas llevan `.exe`. */
  platform?: NodeJS.Platform
  /** Contenido de `bin/codex`. */
  codex?: string
  /** Contenido del host de Code Mode; `false` = el paquete no lo trae. */
  host?: string | false
  /** Nombre del host dentro de `bin/` (por defecto, el que toca al sistema). */
  hostName?: string
  /** Permisos de los programas dentro del tar. */
  mode?: number
}

export const HOST_SCRIPT = '#!/bin/sh\necho "codex-code-mode-host falso"\n'

export function fakeCodexPackage(o: FakeCodexPackage = {}): Buffer {
  const exe = (name: string): string => (o.platform === 'win32' ? `${name}.exe` : name)
  const mode = o.mode ?? 0o755
  const manifest = { layoutVersion: 1, version: '0.162.1', target: 'test', variant: 'codex', entrypoint: `bin/${exe('codex')}`, resourcesDir: 'codex-resources', pathDir: 'codex-path' }
  const entries = [
    tarEntry('bin/', { type: '5', mode: 0o755 }),
    tarEntry(`bin/${exe('codex')}`, { data: o.codex ?? '#!/bin/sh\necho "codex-cli 0.162.1"\n', mode }),
    tarEntry('codex-package.json', { data: JSON.stringify(manifest, null, 2) + '\n' }),
    tarEntry('codex-path/', { type: '5', mode: 0o755 }),
    tarEntry(`codex-path/${exe('rg')}`, { data: '#!/bin/sh\n', mode }),
    tarEntry('codex-resources/', { type: '5', mode: 0o755 }),
    tarEntry('codex-resources/voice/NOTICE.md', { data: 'avisos' })
  ]
  if (o.host !== false) entries.push(tarEntry(`bin/${o.hostName ?? exe('codex-code-mode-host')}`, { data: o.host ?? HOST_SCRIPT, mode }))
  return gzipSync(tar(...entries))
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}
