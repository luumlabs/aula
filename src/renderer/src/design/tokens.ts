// Movimiento de «Papel y luz» (los muelles de la app original, pasados de SwiftUI a motion).
// spring(response r, dampingFraction ζ) → stiffness (2π/r)², damping 4πζ/r con masa 1.
import type { Transition, Variants } from 'motion/react'

export const spring = {
  /** botones, selectores, menús (0,30 · 0,86) */
  snappy: { type: 'spring', stiffness: 439, damping: 36, mass: 1 } as Transition,
  /** barra lateral, paneles, hojas, cambio de sección (0,42 · 1,0) */
  smooth: { type: 'spring', stiffness: 224, damping: 30, mass: 1 } as Transition,
  /** solo interruptor, diálogo y aviso breve (0,44 · 0,76) */
  bouncy: { type: 'spring', stiffness: 204, damping: 22, mass: 1 } as Transition
}

export const duration = { fast: 0.15, base: 0.24, slow: 0.36 }

/** Entrada de filas y bloques: aparecen subiendo 6 px. */
export const enter: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: duration.slow, ease: [0.2, 0.7, 0.2, 1] } }
}
