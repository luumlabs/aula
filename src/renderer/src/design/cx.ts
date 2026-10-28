import clsx, { type ClassValue } from 'clsx'
/** Une clases condicionales. */
export function cx(...v: ClassValue[]): string {
  return clsx(v)
}
