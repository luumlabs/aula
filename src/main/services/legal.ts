// Dónde están los documentos legales que abre Ajustes → Acerca de y qué abrir si el sistema no sabe abrirlos.
import { join } from 'node:path'
import type { LegalDoc } from '@shared/legal'

const FILES: Record<LegalDoc, string> = { aula: 'LICENSE.md', 'third-party': 'THIRD_PARTY_LICENSES.txt' }

/** Empaquetada: en Resources (extraResources). En desarrollo: LICENSE.md en la raíz; el resumen de terceros lo deja el build en out/. */
export function legalFilePath(doc: LegalDoc, ctx: { isPackaged: boolean; resourcesPath: string; appPath: string }): string {
  if (ctx.isPackaged) return join(ctx.resourcesPath, FILES[doc])
  return doc === 'aula' ? join(ctx.appPath, FILES[doc]) : join(ctx.appPath, 'out', FILES[doc])
}

/** Si no hay programa para abrir el archivo (un .md en Windows, p. ej.), el mismo texto en la web. El de terceros es de
 *  cada compilación: no tiene copia en la web. */
export function legalFallbackURL(doc: LegalDoc): string | undefined {
  return doc === 'aula' ? 'https://www.gnu.org/licenses/agpl-3.0.html' : undefined
}
