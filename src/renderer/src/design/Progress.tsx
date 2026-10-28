// Cifras que cuentan hasta su valor (en serif tabular), anillos y barras que se llenan al aparecer.
import i18n from '@renderer/i18n'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { animate, motion, useInView, useMotionValue, useTransform } from 'motion/react'
import { cx } from './cx'
import { useTheme } from './theme'

export function AnimatedNumber({ value, decimals = 0, duration = 0.9, suffix = '', prefix = '', className }: { value: number; decimals?: number; duration?: number; suffix?: string; prefix?: string; className?: string }) {
  const { reducedMotion } = useTheme()
  const mv = useMotionValue(reducedMotion ? value : 0)
  const text = useTransform(mv, (v) => `${prefix}${v.toLocaleString(i18n.language, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`)
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  useEffect(() => {
    if (!inView) return
    if (reducedMotion) {
      mv.set(value)
      return
    }
    const c = animate(mv, value, { duration, ease: [0.2, 0.7, 0.2, 1] })
    return () => c.stop()
  }, [value, inView, reducedMotion, duration, mv])
  return (
    <motion.span ref={ref} className={cx('tabular', className)}>
      {text}
    </motion.span>
  )
}

export function ProgressRing({ value, size = 28, stroke, color = 'var(--accent)', track = 'var(--fill2)', children, className, ghost, delay = 0.1 }: { value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode; className?: string; ghost?: number; delay?: number }) {
  useId()
  const sw = stroke ?? Math.max(3, Math.round(size / 9))
  const r = (size - sw) / 2
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  const g = ghost != null ? Math.max(0, Math.min(1, ghost)) : null
  return (
    <div className={cx('relative inline-grid place-items-center shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={sw} />
        {g != null && (
          <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeOpacity={0.22} strokeWidth={sw} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: g }} transition={{ duration: 1.1, delay, ease: [0.2, 0.7, 0.2, 1] }} />
        )}
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: v }} transition={{ duration: 1.1, delay, ease: [0.2, 0.7, 0.2, 1] }} />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center">{children}</div>}
    </div>
  )
}

export function ProgressBar({ value, height = 4, color = 'var(--accent)', className, marker, label }: { value: number; height?: number; color?: string; className?: string; marker?: number; label?: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return (
    <div className={cx('relative w-full rounded-full bg-fill2 overflow-hidden', className)} style={{ height }} role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${v * 100}%` }} transition={{ duration: 1, ease: [0.2, 0.7, 0.2, 1] }} />
      {marker != null && <div className="absolute inset-y-[-2px] w-[2px] rounded-full bg-text" style={{ left: `calc(${Math.max(0, Math.min(1, marker)) * 100}% - 1px)` }} />}
    </div>
  )
}
