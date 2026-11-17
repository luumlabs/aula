// Avisos legales de Aula (AGPL v3, §0 y §5(d)): el copyright, dónde está el código, qué documentos lleva la app y dónde
// están la política de privacidad y el soporte. Los usan Ajustes → Acerca de, el aviso de la IA en los dispositivos, el
// panel «Acerca de» de macOS y el proceso principal al abrir los documentos.

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

/** Páginas públicas que enlazan Ajustes → Acerca de, las apps del iPhone/iPad y Android, y App Store Connect. */
export type PublicDoc = 'privacy' | 'support'
const PUBLIC_DOC_PATHS: Record<PublicDoc, string> = { privacy: 'docs/PRIVACY.md', support: 'docs/SUPPORT.md' }

/** La página en GitHub (rama main); en español, su mitad en español (título «## Español» → ancla #español, como en iOS y Android). */
export function publicDocURL(doc: PublicDoc, language: string): string {
  const url = `${AULA_REPO_URL}/blob/main/${PUBLIC_DOC_PATHS[doc]}`
  return language.toLowerCase().startsWith('es') ? `${url}#espa%C3%B1ol` : url
}
