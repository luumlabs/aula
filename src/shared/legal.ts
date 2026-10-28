// Avisos legales de Aula (AGPL v3, §0 y §5(d)): el copyright, dónde está el código y qué documentos lleva la app.
// Los usan Ajustes → Acerca de, el panel «Acerca de» de macOS y el proceso principal al abrir los documentos.

export const AULA_COPYRIGHT = 'Copyright © 2026 Luum Labs'
export const AULA_REPO_URL = 'https://github.com/luumlabs/aula'

/** Documentos legales que viajan con la app (electron-builder.yml → extraResources). */
export type LegalDoc = 'aula' | 'third-party'
export const LEGAL_DOCS: readonly LegalDoc[] = ['aula', 'third-party']

export function isLegalDoc(x: unknown): x is LegalDoc {
  return typeof x === 'string' && (LEGAL_DOCS as readonly string[]).includes(x)
}

/** El código exacto de esta versión: su etiqueta `v<versión>`; si la versión no es de una release, el repositorio. */
export function sourceCodeURL(version: string): string {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? `${AULA_REPO_URL}/tree/v${version}` : AULA_REPO_URL
}
