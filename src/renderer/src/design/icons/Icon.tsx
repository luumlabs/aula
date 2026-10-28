// Icono propio de Aula (rejilla de 24, trazo redondeado). El grosor depende del tamaño, como en la app original:
// 2,2 a 12 · 1,9 a 16 · 1,6 a 20 · 1,45 a 24 · 1,25 a 32.
import { memo, type CSSProperties } from 'react'
import { ICON_PATHS, type IconName } from './paths'

function strokeFor(size: number): number {
  const pts: [number, number][] = [[12, 2.2], [16, 1.9], [20, 1.6], [24, 1.45], [32, 1.25]]
  if (size <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    const [s1, w1] = pts[i - 1]
    const [s2, w2] = pts[i]
    if (size <= s2) return w1 + ((size - s1) / (s2 - s1)) * (w2 - w1)
  }
  return pts[pts.length - 1][1]
}

export const Icon = memo(function Icon({ name, size = 16, className, style, title }: { name: IconName; size?: number; className?: string; style?: CSSProperties; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeFor(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</title>` : '') + ICON_PATHS[name] }}
    />
  )
})

export type { IconName }
