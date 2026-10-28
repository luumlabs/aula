// Chips de filtro, contadores y teclas.
import type { ReactNode } from 'react'
import { cx } from './cx'

export function Chip({ children, color, icon, className, onClick, active }: { children: ReactNode; color?: string; icon?: ReactNode; className?: string; onClick?: () => void; active?: boolean }) {
  const style = color ? { background: `color-mix(in oklab, ${color} 13%, transparent)`, color } : undefined
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      onClick={onClick}
      style={style}
      className={cx(
        'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full t-ui font-medium whitespace-nowrap transition-colors',
        !color && (active ? 'bg-accent-wash text-accent-text' : 'bg-fill2 text-text2'),
        onClick && !color && !active && 'hover:bg-fill3 hover:text-text',
        className
      )}
    >
      {icon}
      {children}
    </Tag>
  )
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('t-caption tabular text-text3', className)}>{children}</span>
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('inline-grid place-items-center min-w-[20px] h-[20px] px-1.5 rounded-[6px] bg-fill2 t-caption font-semibold text-text3 font-sans', className)}>{children}</kbd>
}
