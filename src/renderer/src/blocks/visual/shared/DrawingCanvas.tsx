// Lienzo de un dibujo vectorial: las formas en SVG (se trazan una tras otra al aparecer) y los textos encima en HTML, con
// fórmulas KaTeX y su tamaño de lectura (no crecen con el lienzo). Lo usan el bloque `drawing` y las figuras etiquetadas.
import { memo, useMemo } from 'react'
import { motion } from 'motion/react'
import type { DrawItem } from '@shared/schema/common'
import { RichText } from '@renderer/lib/RichText'
import { drawingShapes, type DrawShape } from '../lib/drawing'
import { vizColor } from './colors'

export interface DrawingCanvasProps {
  items: DrawItem[]
  /** Medidas del lienzo (coordenadas de los elementos). */
  W: number
  H: number
  /** Ancho en pantalla (para la escala de los textos). */
  pixelWidth: number
  /** Trazar al aparecer (false = ya dibujado: impresión, movimiento reducido, capas). */
  animate: boolean
  /** Empieza a trazar (el lienzo ya se ve). */
  play?: boolean
  /** Escala extra de los textos (zoom de una figura: crecen poco). */
  textScale?: number
  className?: string
}

const DRAW = 0.55

function stagger(n: number): number {
  return Math.min(0.09, 2.2 / Math.max(1, n))
}

export const DrawingCanvas = memo(function DrawingCanvas({ items, W, H, pixelWidth, animate, play = true, textScale = 1, className }: DrawingCanvasProps) {
  const shapes = useMemo(() => drawingShapes(items), [items])
  const k = pixelWidth > 0 ? pixelWidth / W : 1
  // los textos conservan su tamaño de lectura; en un hueco pequeño (chat) bajan un poco para no pisarse
  const textK = Math.min(1.15, Math.max(0.72, Math.sqrt(k))) * textScale
  const step = stagger(shapes.length)
  const run = animate && play
  return (
    <div className={className} style={{ position: 'absolute', inset: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden>
        {shapes.map((s, i) => (
          <ShapeView key={i} shape={s} delay={i * step} animate={animate} run={run} />
        ))}
      </svg>
      {shapes.map((s, i) =>
        s.labels.map((l, j) => (
          <motion.div
            key={`${i}-${j}`}
            className="viz-label absolute whitespace-nowrap font-medium pointer-events-none"
            style={{
              left: `${(l.x / W) * 100}%`,
              top: `${(l.y / H) * 100}%`,
              fontSize: l.size * textK,
              lineHeight: 1.2,
              color: vizColor(l.color, 'var(--text)'),
              translateX: l.anchor === 'left' ? '0%' : l.anchor === 'right' ? '-100%' : '-50%',
              translateY: '-50%'
            }}
            initial={animate ? { opacity: 0, y: 4 } : false}
            animate={run || !animate ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.4, delay: i * step + DRAW * 0.6 }}
          >
            <RichText text={l.text} inline />
          </motion.div>
        ))
      )}
    </div>
  )
})

function ShapeView({ shape, delay, animate, run }: { shape: DrawShape; delay: number; animate: boolean; run: boolean }) {
  return (
    <g>
      {shape.paths.map((p, i) => {
        const stroke = p.fillOnly ? 'none' : vizColor(p.stroke, 'var(--text)')
        const fill = p.fill ? vizColor(p.fill.color) : 'none'
        const fillOpacity = p.fill?.opacity ?? 0
        const common = {
          d: p.d,
          stroke,
          strokeWidth: p.width,
          strokeLinecap: 'round' as const,
          strokeLinejoin: 'round' as const,
          strokeDasharray: p.dashed ? '6 5' : undefined,
          fill
        }
        if (!animate) return <path key={i} {...common} fillOpacity={fillOpacity} />
        // La transparencia del relleno va SIEMPRE como atributo fijo y lo que se anima es la opacidad: si un padre salta
        // la entrada (AnimatePresence initial={false}) antes de que el lienzo se vea, el relleno queda translúcido como
        // se pidió y no opaco (sin fill-opacity, el navegador pinta el relleno al 100 %).
        // los trazos discontinuos (y los puntos) aparecen; los demás se trazan
        if (p.dashed || p.fillOnly) {
          return (
            <motion.path
              key={i}
              {...common}
              fillOpacity={fillOpacity}
              initial={{ opacity: 0 }}
              animate={run ? { opacity: 1 } : undefined}
              transition={{ duration: 0.4, delay }}
            />
          )
        }
        return (
          <g key={i}>
            {fill !== 'none' && (
              <motion.path
                d={p.d}
                stroke="none"
                fill={fill}
                fillOpacity={fillOpacity}
                initial={{ opacity: 0 }}
                animate={run ? { opacity: 1 } : undefined}
                transition={{ duration: 0.45, delay: delay + DRAW * 0.7 }}
              />
            )}
            <motion.path
              {...common}
              fill="none"
              initial={{ pathLength: 0 }}
              animate={run ? { pathLength: 1 } : undefined}
              transition={{ duration: DRAW, delay, ease: [0.4, 0, 0.2, 1] }}
            />
          </g>
        )
      })}
      {shape.heads.map((h, i) => {
        const color = vizColor(h.color, 'var(--text)')
        if (!animate) return <path key={`h${i}`} d={h.d} fill={color} />
        return <motion.path key={`h${i}`} d={h.d} fill={color} initial={{ opacity: 0 }} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 0.2, delay: delay + DRAW * 0.85 }} />
      })}
    </g>
  )
}
