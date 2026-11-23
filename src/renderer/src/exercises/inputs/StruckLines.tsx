// El tachado a mano de una respuesta de varias líneas: un trazo por renglón, uno detrás de otro, como quien corrige con el
// boli rojo. Va encima del campo, que no se toca: una copia invisible de lo escrito, con su misma letra, ancho y
// desplazamiento, dice dónde cae cada renglón (también los que se parten solos porque no caben).
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { cx, InkStrike } from '@renderer/design'

export interface Row {
  x: number
  y: number
  w: number
  h: number
}

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** Los renglones de un texto a partir de los rectángulos de su línea (`getClientRects`): uno por renglón (los trozos de un
 *  mismo renglón, juntos), sin los vacíos, de arriba abajo y en px enteros desde `origin`. */
export function rowsOf(rects: Iterable<Rect>, origin: { left: number; top: number }): Row[] {
  const rows: Row[] = []
  for (const r of rects) {
    if (r.width < 2 || r.height < 2) continue
    const x = r.left - origin.left
    const y = r.top - origin.top
    const same = rows.find((o) => Math.abs(o.y - y) < Math.min(o.h, r.height) / 2)
    if (!same) {
      rows.push({ x, y, w: r.width, h: r.height })
      continue
    }
    const right = Math.max(same.x + same.w, x + r.width)
    same.x = Math.min(same.x, x)
    same.w = right - same.x
  }
  return rows.sort((a, b) => a.y - b.y).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }))
}

const sameRows = (a: Row[], b: Row[]): boolean => a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.w === b[i].w && r.h === b[i].h)

/** Encima del campo `field` (en su misma caja `relative`). `className`: el relleno y la letra del campo, para que la copia
 *  se parta igual. */
export function StruckLines({ field, text, seed, className }: { field: RefObject<HTMLTextAreaElement | null>; text: string; seed: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const line = useRef<HTMLSpanElement>(null)
  const [rows, setRows] = useState<Row[]>([])

  useLayoutEffect(() => {
    const el = field.current
    const b = box.current
    const p = page.current
    const l = line.current
    if (!el || !b || !p || !l) return
    let frame = 0
    const measure = (): void => {
      frame = 0
      // lo de dentro del campo: sin sus bordes ni su barra de desplazamiento
      b.style.left = `${el.offsetLeft + el.clientLeft}px`
      b.style.top = `${el.offsetTop + el.clientTop}px`
      b.style.width = `${el.clientWidth}px`
      b.style.height = `${el.clientHeight}px`
      b.scrollTop = el.scrollTop
      const next = rowsOf(Array.from(l.getClientRects()), p.getBoundingClientRect())
      setRows((cur) => (sameRows(cur, next) ? cur : next))
    }
    const follow = (): void => {
      b.scrollTop = el.scrollTop
    }
    measure()
    // otro ancho (la ventana, el tutor al lado, el tamaño del texto): los renglones se parten de otra forma
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure)
    })
    ro?.observe(el)
    el.addEventListener('scroll', follow, { passive: true })
    return () => {
      ro?.disconnect()
      el.removeEventListener('scroll', follow)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [field, text])

  return (
    <div ref={box} aria-hidden data-struck-lines="" className="pointer-events-none absolute overflow-hidden">
      {/* lo que el navegador da a un textarea dir=auto y no a un div: cada renglón toma el sentido de su primera letra y se
          alinea a su lado (un renglón en árabe y otro en latín), y la letra se dibuja igual (se parte igual) */}
      <div ref={page} dir="auto" className={cx('relative whitespace-pre-wrap break-words text-start text-transparent [text-rendering:auto] [unicode-bidi:plaintext]', className)}>
        <span ref={line}>{text}</span>
        {/* un salto al final también es un renglón (vacío), como en el campo: así se desplazan igual */}
        {'​'}
        {rows.map((r, i) => (
          <span key={i} className="absolute flex" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
            <InkStrike seed={`${seed}:${i}`} alpha={0.9} delay={150 + Math.min(i, 5) * 260}>
              <span className="block" style={{ width: r.w, height: r.h }} />
            </InkStrike>
          </span>
        ))}
      </div>
    </div>
  )
}
