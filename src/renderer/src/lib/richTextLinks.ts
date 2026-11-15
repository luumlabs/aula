// Política de enlaces compartida por el texto vivo y su representación estática.
export const PAGE_ANCHOR = /^#aula-page-\d{1,4}$/
export function safeHref(url: string): string {
  const value = url.trim()
  return /^(https?:|mailto:)/i.test(value) || PAGE_ANCHOR.test(value) ? value : ''
}
export function underlinedRichLink(href: string | undefined): boolean {
  return !!href && !PAGE_ANCHOR.test(href)
}
