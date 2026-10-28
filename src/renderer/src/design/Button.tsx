// Botones: una sola acción principal por vista, en ladrillo; lo demás neutro o fantasma. Pulsar = escala 0,97.
import { forwardRef, type ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { cx } from './cx'
import { spring } from './tokens'
import { Spinner } from './Pixel'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'plain'
type Size = 'sm' | 'md' | 'lg' | 'xl'

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  iconRight?: ReactNode
  loading?: boolean
  full?: boolean
  children?: ReactNode
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[13px] gap-1.5 rounded-[8px]',
  md: 'h-8 px-3 text-[13px] gap-1.5 rounded-[10px]',
  lg: 'h-10 px-4 text-[14px] gap-2 rounded-[10px]',
  xl: 'h-12 px-5 text-[15px] gap-2 rounded-[12px]'
}

const looks: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-pressed shadow-[var(--accent-halo)] font-semibold',
  secondary: 'bg-fill2 text-text hover:bg-fill3 active:bg-fill4 font-medium',
  ghost: 'text-text2 hover:text-text hover:bg-fill1 active:bg-fill2 font-medium',
  plain: 'text-accent-text hover:bg-accent-wash font-medium',
  danger: 'bg-danger-fill text-white hover:brightness-110 font-semibold'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, full, className, children, disabled, ...rest },
  ref
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      whileTap={{ scale: 0.97 }}
      transition={spring.snappy}
      className={cx(
        'relative inline-flex select-none items-center justify-center whitespace-nowrap outline-none transition-colors duration-150 disabled:opacity-45 disabled:pointer-events-none no-drag',
        sizes[size],
        looks[variant],
        full && 'w-full',
        className
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon}
      {children != null && <span>{children}</span>}
      {iconRight}
    </motion.button>
  )
})

export interface IconButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  label: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
  active?: boolean
  variant?: 'ghost' | 'filled' | 'raised'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, size = 'md', active, variant = 'ghost', className, ...rest },
  ref
) {
  const dim = size === 'sm' ? 'h-7 w-7 rounded-[8px]' : size === 'lg' ? 'h-10 w-10 rounded-[10px]' : 'h-8 w-8 rounded-[10px]'
  const look =
    variant === 'raised'
      ? 'bg-raised text-text2 hover:text-text border-[0.5px] border-line shadow-[var(--e2)]'
      : variant === 'filled'
        ? 'bg-fill2 text-text2 hover:text-text hover:bg-fill3'
        : cx('text-text2 hover:text-text hover:bg-fill1', active && 'bg-fill2 text-text')
  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.92 }}
      transition={spring.snappy}
      className={cx('inline-flex items-center justify-center no-drag outline-none transition-colors disabled:opacity-35', dim, look, className)}
      {...rest}
    >
      {children}
    </motion.button>
  )
})
