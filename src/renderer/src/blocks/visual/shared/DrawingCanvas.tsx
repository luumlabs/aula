// Lienzo de un dibujo vectorial: las formas en SVG (se trazan una tras otra al aparecer) y los textos encima en HTML, con
// fórmulas KaTeX y su tamaño de lectura (no crecen con el lienzo). Lo usan el bloque `drawing` y las figuras etiquetadas.
// Además: rellenos rayados con papel debajo, la línea a mano (objetos siempre; el dibujo entero si se pide), elementos que
// se mueven (un transform por elemento en cada fotograma, la geometría no se recalcula), pasos (etapas que aparecen, lo
// destacado rodeado en ladrillo y el resto atenuado) y las partes con nombre marcadas para «marcar y preguntar».
import { memo, useEffect, useId, useMemo, useRef, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { DrawItem } from '@shared/schema/common'
import { RichText } from '@renderer/lib/RichText'
import { useTheme } from '@renderer/design'
import { Ink } from '@renderer/design/paint'
import { seedOf } from '@renderer/design/paint/random'
import { applyFrame, boundsOf, drawingLayout, labelBox, paintOrder, type Box, type DrawPath, type DrawShape, type ItemFrame, type Pt, type ShapeContext } from '../lib/drawing'
import { handAmplitude, handPath } from '../lib/hand'
import { loopDrawKey, loopInk } from '../lib/loopInk'
import { PAPER, vizColor } from './colors'
import { canvasMeasure, useFontsReady } from './measure'

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
  /** Transform de cada elemento en este fotograma (dibujos que se mueven); sin él, la imagen en reposo. */
  frame?: ReadonlyArray<ItemFrame | undefined>
  /** Etapa máxima visible (dibujos paso a paso); sin ella, todo. */
  show?: number
  /** Elementos destacados en este paso: se rodean en ladrillo y el resto se atenúa. */
  focus?: ReadonlySet<number>
  /** Todo el dibujo a mano alzada (los objetos hechos van siempre a mano; las marcas de geometría, nunca). */
  hand?: boolean
  /** Semilla de la línea a mano (el id del bloque): el mismo temblor en cada arranque. */
  seed?: string
  /**
   * Marca las partes con nombre para «marcar y preguntar» (data-ask-part / data-ask-label). `'visible'`: solo con lo que se
   * ve escrito (su etiqueta o su texto), no con su `name` (en el enunciado de un ejercicio, el nombre puede ser la respuesta).
   */
  askParts?: boolean | 'visible'
  /**
   * Nombre accesible: lo dibujado es una imagen (role img) con este nombre, y el lienzo, el recuadro de «marcar y preguntar»
   * (data-ask-canvas). Su botón y su zona de marcar van en el lienzo junto a la imagen, no dentro: lo de dentro de una
   * imagen no llega a los lectores de pantalla.
   */
  label?: string
}

const DRAW = 0.55
/** Atenuado de lo que no se destaca en un paso (en oscuro, algo menos: si no, desaparece). */
const DIM_LIGHT = 0.3
const DIM_DARK = 0.42

function stagger(n: number): number {
  return Math.min(0.09, 2.2 / Math.max(1, n))
}

/** Transform SVG de un fotograma (gira alrededor del pivote y después se desplaza). */
const transformOf = (fr: ItemFrame | undefined): string | undefined =>
  fr ? `translate(${fr.dx.toFixed(2)} ${fr.dy.toFixed(2)})${fr.deg ? ` rotate(${(-fr.deg).toFixed(2)} ${fr.px.toFixed(2)} ${fr.py.toFixed(2)})` : ''}` : undefined

/** Cómo ve el estudiante un elemento (su nombre, su etiqueta o su texto); sin nada, no es una parte con nombre. */
export function askLabel(it: DrawItem, onlyVisible = false): string | undefined {
  const s = (onlyVisible ? undefined : it.name) ?? it.label ?? (it.kind === 'text' ? it.text : undefined)
  return s && s.trim() ? s.trim().slice(0, 200) : undefined
}

/** Caja que ocupa un elemento con sus etiquetas (unidades del lienzo), ya movido: lo que rodea el paso. */
function shapeBox(s: DrawShape, fr: ItemFrame | undefined, ctx: ShapeContext): Box | undefined {
  const pts: Pt[] = [...s.paths.flatMap((p) => p.pts ?? []), ...s.outline]
  if (!pts.length && s.around) pts.push([s.around.x, s.around.y], [s.around.x + s.around.w, s.around.y + s.around.h])
  const moved = fr ? pts.map((p) => applyFrame(p, fr)) : pts
  // las etiquetas van dentro del rodeado (la línea nunca pasa por encima de un texto pequeño)
  for (const l of s.labels) {
    const b = labelBox(l, ctx)
    const [dx, dy] = fr ? ((q) => [q[0] - l.x, q[1] - l.y])(applyFrame([l.x, l.y], fr)) : [0, 0]
    moved.push([b.x + dx, b.y + dy], [b.x + b.w + dx, b.y + b.h + dy])
  }
  return boundsOf(moved)
}

/**
 * El papel que hay detrás del lienzo (el primer fondo con color de sus antepasados), para que el «papel» de los objetos y
 * los rayados se funda con él. Sobre el papel con grano de las pantallas se oscurece un poco, como el grano en promedio
 * (los colores del grano son los de `.paper-grain` en paint.css).
 */
function paperBehind(el: HTMLElement, dark: boolean): string | undefined {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const bg = getComputedStyle(p).backgroundColor
    if (!bg || bg === 'transparent' || /rgba\(.*,\s*0\)$/.test(bg)) continue
    if (!p.classList.contains('paper-grain')) return bg
    return dark ? `color-mix(in oklab, ${bg} 97%, rgb(255 240 219))` : `color-mix(in oklab, ${bg} 95%, rgb(84 64 43))`
  }
  return undefined
}

export const DrawingCanvas = memo(function DrawingCanvas({
  items, W, H, pixelWidth, animate, play = true, textScale = 1, className, frame, show, focus, hand = false, seed = 'drawing', askParts = false, label
}: DrawingCanvasProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const fonts = useFontsReady()
  const { dark } = useTheme()
  const k = pixelWidth > 0 ? pixelWidth / W : 1
  // los textos conservan su tamaño de lectura; en un hueco pequeño (chat) bajan un poco para no pisarse
  const textK = Math.min(1.15, Math.max(0.72, Math.sqrt(k))) * textScale
  // unidades del lienzo que ocupa un px de texto (para colocar las etiquetas automáticas); redondeado: no se recoloca a cada px
  const unitsPerPx = Math.round((textK / k) * 50) / 50
  const measureCtx = useMemo((): ShapeContext => ({ measure: (text, size) => canvasMeasure(text, size, false), unitsPerPx }), [unitsPerPx])
  const shapes = useMemo(
    () => drawingLayout(items, W, H, measureCtx),
    // las letras recién cargadas cambian las medidas
    [items, W, H, measureCtx, fonts] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const order = useMemo(() => paintOrder(items), [items])
  const amp = handAmplitude(W, H)
  // las formas a mano se calculan una vez (el movimiento solo cambia el transform)
  const handD = useMemo(
    () => shapes.map((s, i) => s.paths.map((p, j) => (p.pts && !p.crisp && !p.fillOnly && (p.hand || hand) ? handPath(p.pts, !!p.closed, seedOf(`${seed}:${i}:${j}`), amp) : undefined))),
    [shapes, hand, seed, amp]
  )
  const hatches = useMemo(() => {
    const colors = new Set<string>()
    for (const s of shapes) for (const p of s.paths) if (p.fill?.hatch) colors.add(p.fill.color ?? '')
    return new Map([...colors].map((c, h) => [c, `${uid}-h${h}`]))
  }, [shapes, uid])
  const step = stagger(shapes.length)
  const run = animate && play
  // primera aparición: todo se traza en orden; lo que aparece después (un paso nuevo) se traza enseguida
  const revealed = useRef(false)
  useEffect(() => {
    if (!run || revealed.current) return
    const id = setTimeout(() => (revealed.current = true), (shapes.length * step + DRAW) * 1000)
    return () => clearTimeout(id)
  }, [run, shapes.length, step])
  const visible = (i: number): boolean => show === undefined || (items[i]?.stage ?? 0) <= show
  // se atenúa el resto solo si se rodea algo que se ve (rodear lo que aún no está no debe apagar todo el dibujo)
  const lit = !!focus && [...focus].some(visible)
  const dimmed = (i: number): boolean => lit && !focus?.has(i)
  const freshRank = new Map<number, number>()
  if (show !== undefined) order.filter((i) => (items[i]?.stage ?? 0) === show).forEach((i, r) => freshRank.set(i, r))
  const delayOf = (i: number, rank: number): number => (revealed.current ? (freshRank.get(i) ?? 0) * 0.12 : rank * step)
  const dim = dark ? DIM_DARK : DIM_LIGHT
  const dimStyle = (i: number): CSSProperties => ({ opacity: dimmed(i) ? dim : 1, transition: 'opacity 300ms ease' })
  const ink = (i: number): { 'data-ask-part'?: string; 'data-ask-label'?: string } => {
    if (!askParts) return {}
    const label = askLabel(items[i], askParts === 'visible')
    return label ? { 'data-ask-part': items[i].id ?? `item-${i}`, 'data-ask-label': label } : {}
  }
  const pad = 7
  // el papel de los objetos y los rayados, el mismo que el del fondo (se mira al montar y al cambiar de tema)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // un fotograma después: el tema ya ha puesto (o quitado) su clase en la raíz
    const id = requestAnimationFrame(() => {
      const el = box.current
      const paper = el ? paperBehind(el, dark) : undefined
      if (el && paper) el.style.setProperty('--draw-paper', paper)
    })
    return () => cancelAnimationFrame(id)
  }, [dark])
  return (
    <div ref={box} className={className} style={{ position: 'absolute', inset: 0 }} {...(label ? { 'data-ask-canvas': '' } : {})}>
      <div role={label ? 'img' : undefined} aria-label={label} style={{ position: 'absolute', inset: 0 }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden>
          {hatches.size > 0 && (
            <defs>
              {[...hatches].map(([c, id]) => (
                <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
                  <path d="M0 0V6" stroke={vizColor(c || undefined, 'var(--text2)')} strokeWidth={1.1} />
                </pattern>
              ))}
            </defs>
          )}
          <AnimatePresence>
            {order.map((i, rank) => {
              const s = shapes[i]
              if (!s || !visible(i) || (!s.paths.length && !s.heads.length && !s.labels.some((l) => l.leader))) return null
              const fr = frame?.[i]
              return (
                <motion.g key={i} exit={animate ? { opacity: 0, transition: { duration: 0.25 } } : undefined}>
                  {/* la atenuación va en un <g> normal: motion solo lee el estilo de un SVG al montarlo */}
                  <g transform={transformOf(fr)} style={dimStyle(i)} {...(s.paths.length ? ink(i) : {})}>
                    <ShapeView shape={s} hand={handD[i]} delay={delayOf(i, rank)} animate={animate} run={run} hatches={hatches} dark={dark} />
                    {s.labels.map((l, j) => (l.leader ? <Leader key={j} l={l.leader} animate={animate} run={run} delay={delayOf(i, rank) + DRAW * 0.6} /> : null))}
                  </g>
                </motion.g>
              )
            })}
          </AnimatePresence>
        </svg>
        <AnimatePresence>
          {order.flatMap((i, rank) => {
            const s = shapes[i]
            if (!s || !visible(i)) return []
            const fr = frame?.[i]
            return s.labels.map((l, j) => {
              const [lx, ly] = fr ? applyFrame([l.x, l.y], fr) : [l.x, l.y]
              return (
                <motion.div
                  key={`${i}-${j}`}
                  className="viz-label absolute whitespace-nowrap font-medium pointer-events-none"
                  style={{
                    left: `${(lx / W) * 100}%`,
                    top: `${(ly / H) * 100}%`,
                    fontSize: l.size * textK,
                    lineHeight: 1.2,
                    color: vizColor(l.color, 'var(--text)'),
                    translateX: l.anchor === 'left' ? '0%' : l.anchor === 'right' ? '-100%' : '-50%',
                    translateY: '-50%'
                  }}
                  initial={animate ? { opacity: 0, y: 4 } : false}
                  animate={run || !animate ? { opacity: dimmed(i) ? dim : 1, y: 0 } : undefined}
                  exit={animate ? { opacity: 0, transition: { duration: 0.2 } } : undefined}
                  transition={{ duration: 0.4, delay: delayOf(i, rank) + DRAW * 0.6 }}
                  {...(!s.paths.length && j === 0 ? ink(i) : {})}
                >
                  <RichText text={l.text} inline />
                </motion.div>
              )
            })
          })}
        </AnimatePresence>
        {focus && focus.size > 0 && [...focus].map((i) => {
          const s = shapes[i]
          const b = s && visible(i) ? shapeBox(s, frame?.[i], measureCtx) : undefined
          if (!b) return null
          // por fuera de la caja (nunca encima del texto pequeño), con su margen; algo redondeado aunque el elemento sea fino
          let w = (b.w + pad * 2) * k, h = (b.h + pad * 2) * k
          const bx = b.x - pad - (Math.max(w, h * 0.5) - w) / 2 / k, by = b.y - pad - (Math.max(h, w * 0.5) - h) / 2 / k
          w = Math.max(w, h * 0.5)
          h = Math.max(h, w * 0.5)
          return (
            <Ink
              key={`loop-${i}-${seed}`}
              drawing={loopInk(w + 8, h + 8, `${seed}:loop:${i}`)}
              color="var(--pigment-brick)"
              draw={animate}
              // trazado una vez por paso: si lo rodeado gira o cambia de tamaño, el rodeado nuevo sale al instante
              drawKey={loopDrawKey(uid, i, focus)}
              delay={120}
              className="ink-fixed"
              style={{ left: `${(bx / W) * 100}%`, top: `${(by / H) * 100}%`, width: w + 8, height: h + 8, marginLeft: -4, marginTop: -4 }}
            />
          )
        })}
      </div>
    </div>
  )
})

function Leader({ l, animate, run, delay }: { l: [number, number, number, number]; animate: boolean; run: boolean; delay: number }) {
  const common = { x1: l[0], y1: l[1], x2: l[2], y2: l[3], stroke: 'var(--text3)', strokeWidth: 0.9, strokeLinecap: 'round' as const }
  if (!animate) return <line {...common} strokeOpacity={0.7} />
  return <motion.line {...common} strokeOpacity={0.7} initial={{ opacity: 0 }} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 0.3, delay }} />
}

const ShapeView = memo(function ShapeView({ shape, hand, delay, animate, run, hatches, dark }: { shape: DrawShape; hand?: Array<string | undefined>; delay: number; animate: boolean; run: boolean; hatches: ReadonlyMap<string, string>; dark: boolean }) {
  return (
    <g>
      {shape.paths.map((p, i) => <PathView key={i} p={p} d={hand?.[i] || p.d} delay={delay} animate={animate} run={run} hatches={hatches} dark={dark} />)}
      {shape.heads.map((h, i) => {
        const color = vizColor(h.color, 'var(--text)')
        if (!animate) return <path key={`h${i}`} d={h.d} fill={color} />
        return <motion.path key={`h${i}`} d={h.d} fill={color} initial={{ opacity: 0 }} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 0.2, delay: delay + DRAW * 0.85 }} />
      })}
    </g>
  )
})

function PathView({ p, d, delay, animate, run, hatches, dark }: { p: DrawPath; d: string; delay: number; animate: boolean; run: boolean; hatches: ReadonlyMap<string, string>; dark: boolean }) {
  const stroke = p.fillOnly || p.width <= 0 ? 'none' : vizColor(p.stroke, 'var(--text)')
  const fill = p.fill ? (p.fill.hatch ? `url(#${hatches.get(p.fill.color ?? '') ?? ''})` : vizColor(p.fill.color)) : 'none'
  // en oscuro, las aguadas de los objetos sobre papel oscuro se cargan algo más (si no, quedan turbias)
  const base = p.fill?.opacity ?? 0
  const fillOpacity = dark && p.hand && p.paper && !p.fill?.hatch && base < 0.6 ? Math.min(0.85, base * 1.6) : base
  // un relleno a mano va algo desplazado de su línea, como un color fuera de registro
  const offset = p.hand && !p.fill?.hatch ? 'translate(0.7 0.9)' : undefined
  // papel debajo (rayados y objetos): lo que queda detrás no se transparenta
  const paper = !!p.paper && fill !== 'none' && !p.fillOnly
  const common = {
    d,
    stroke,
    strokeWidth: p.width,
    strokeOpacity: p.alpha,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeDasharray: p.dashed ? '6 5' : undefined,
    fill
  }
  if (!animate) {
    return (
      <>
        {paper && <path d={d} fill={PAPER} stroke="none" transform={offset} />}
        <path {...common} fillOpacity={fillOpacity} />
      </>
    )
  }
  const fadeIn = (at: number, duration: number) => ({ initial: { opacity: 0 }, animate: run ? { opacity: 1 } : undefined, transition: { duration, delay: at } })
  // La transparencia del relleno va SIEMPRE como atributo fijo y lo que se anima es la opacidad: si un padre salta
  // la entrada (AnimatePresence initial={false}) antes de que el lienzo se vea, el relleno queda translúcido como
  // se pidió y no opaco (sin fill-opacity, el navegador pinta el relleno al 100 %).
  // los trazos discontinuos, los puntos y la rejilla aparecen; los demás se trazan
  if (p.dashed || p.fillOnly || p.fade) {
    return (
      <>
        {paper && <motion.path d={d} fill={PAPER} stroke="none" {...fadeIn(delay, 0.4)} />}
        <motion.path {...common} fillOpacity={fillOpacity} {...fadeIn(delay, 0.4)} />
      </>
    )
  }
  return (
    <g>
      {paper && <motion.path d={d} fill={PAPER} stroke="none" transform={offset} {...fadeIn(delay + DRAW * 0.7, 0.45)} />}
      {fill !== 'none' && <motion.path d={d} stroke="none" fill={fill} fillOpacity={fillOpacity} transform={offset} {...fadeIn(delay + DRAW * 0.7, 0.45)} />}
      {stroke !== 'none' && (
        <motion.path
          {...common}
          fill="none"
          initial={{ pathLength: 0 }}
          animate={run ? { pathLength: 1 } : undefined}
          transition={{ duration: DRAW, delay, ease: [0.4, 0, 0.2, 1] }}
        />
      )}
    </g>
  )
}
