// Contenedor que hace entrar a sus hijos uno tras otro (los hijos usan `variants={enter}`, `<Card enterAnim>` o `StaggerItem`).
import type { ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { enter } from './tokens'

export function Stagger({ children, delay = 0, gap = 0.05, ...rest }: { children: ReactNode; delay?: number; gap?: number } & HTMLMotionProps<'div'>) {
  return (
    <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } }} {...rest}>
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, ...rest }: { children: ReactNode } & HTMLMotionProps<'div'>) {
  return (
    <motion.div variants={enter} {...rest}>
      {children}
    </motion.div>
  )
}
