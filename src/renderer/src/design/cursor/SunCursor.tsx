// El cursor de Aula, el mismo de los vídeos: un sol pequeño (el del icono) en lugar de la flecha. Al moverse deja una cola de
// cometa cálida que se apaga en un instante, y al pulsar abre una onda ladrillo.
//   · El sol es una imagen de cursor del sistema, así que va sin retraso. Sobre lo que se puede pulsar lleva un aro; en los
//     campos de texto vuelve la barra de escribir, y lo que arrastra o amplía conserva su cursor.
//   · La cola y la onda se pintan en un lienzo encima de todo que no recibe clics y solo trabaja mientras hay algo que pintar.
//   · Con movimiento reducido, solo el sol (sin cola ni onda). En Ajustes → Apariencia se vuelve al cursor del sistema.
import { useEffect } from 'react'
import { addPoint, prune, ribbon, ripple, type TrailPoint } from './trail'

const SUN = {
  light: { sun: '#e2a03e', core: '226,160,62', glow: '239,181,93', rim: 'rgba(120,58,18,0.62)', accent: '#b4502f' },
  dark: { sun: '#f2c275', core: '242,194,117', glow: '242,194,117', rim: 'rgba(0,0,0,0.5)', accent: '#ea9a6c' }
} as const
type Tone = (typeof SUN)[keyof typeof SUN]

/** Lo que se puede pulsar: el sol lleva su aro. Lo deshabilitado y lo que arrastra o amplía, no. */
const PRESSABLE =
  ':is(button, a[href], summary, label, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=menuitemradio], ' +
  '[role=menuitemcheckbox], [role=option], [role=switch], [role=checkbox], [role=radio], [role=slider], input[type=checkbox], ' +
  'input[type=radio], input[type=range], input[type=button], input[type=submit], input[type=color], input[type=file], ' +
  '.cursor-pointer, .cursor-default)' +
  ':not(:disabled, [aria-disabled=true], .viz-grab, .cursor-grab, .cursor-grabbing, .cursor-crosshair, .cursor-zoom-in, .cursor-zoom-out)'
const TYPING =
  ':is(input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit], [type=color], [type=file]), textarea, ' +
  "[contenteditable=true], [contenteditable=''], [contenteditable=plaintext-only])"

/** El sol pintado a `scale` (1 o 2) en un cuadrado de 32 px de lado, con el centro como punto activo. */
function sunImage(tone: Tone, scale: number, ring: boolean): string {
  const c = document.createElement('canvas')
  c.width = c.height = 32 * scale
  const g = c.getContext('2d')
  if (!g) return ''
  g.scale(scale, scale)
  const halo = g.createRadialGradient(16, 16, 3, 16, 16, 15)
  halo.addColorStop(0, `rgba(${tone.glow},0.55)`)
  halo.addColorStop(0.45, `rgba(${tone.glow},0.18)`)
  halo.addColorStop(1, `rgba(${tone.glow},0)`)
  g.fillStyle = halo
  g.fillRect(0, 0, 32, 32)
  if (ring) {
    g.beginPath()
    g.arc(16, 16, 9.5, 0, Math.PI * 2)
    g.strokeStyle = tone.accent
    g.globalAlpha = 0.85
    g.lineWidth = 1.5
    g.stroke()
    g.globalAlpha = 1
  }
  g.beginPath()
  g.arc(16, 16, ring ? 6 : 5.5, 0, Math.PI * 2)
  g.fillStyle = tone.sun
  g.fill()
  // un borde fino para que el sol se vea también sobre papel claro o sobre un resaltado amarillo
  g.lineWidth = 1
  g.strokeStyle = tone.rim
  g.stroke()
  return c.toDataURL('image/png')
}

/** Las reglas de cursor con las imágenes ya hechas. Van en una hoja propia (no en variables CSS: un `cursor` inválido en una
 *  variable no deja caer al valor de reserva). */
function cursorCSS(tone: Tone): string {
  const decl = (ring: boolean, fallback: string): string => {
    const one = sunImage(tone, 1, ring)
    const two = sunImage(tone, 2, ring)
    return `cursor: url(${one}) 16 16, ${fallback}; cursor: -webkit-image-set(url(${one}) 1x, url(${two}) 2x) 16 16, ${fallback};`
  }
  const base = decl(false, 'default')
  return [
    `html.sun-cursor, html.sun-cursor body, html.sun-cursor button { ${base} }`,
    `html.sun-cursor ${PRESSABLE} { ${decl(true, 'pointer')} }`,
    `html.sun-cursor ${TYPING} { cursor: text; }`
  ].join('\n')
}

export function SunCursor({ enabled, dark, reducedMotion }: { enabled: boolean; dark: boolean; reducedMotion: boolean }) {
  // el sol
  useEffect(() => {
    if (!enabled) return
    const style = document.createElement('style')
    style.dataset.aulaCursor = ''
    style.textContent = cursorCSS(dark ? SUN.dark : SUN.light)
    document.head.appendChild(style)
    document.documentElement.classList.add('sun-cursor')
    return () => {
      style.remove()
      document.documentElement.classList.remove('sun-cursor')
    }
  }, [enabled, dark])

  // la cola y la onda
  useEffect(() => {
    if (!enabled || reducedMotion) return
    const tone = dark ? SUN.dark : SUN.light
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '2147483647' })
    document.body.appendChild(canvas)
    const ctx = canvas.getContext('2d')
    let points: TrailPoint[] = []
    let ripples: { x: number; y: number; t: number }[] = []
    let raf = 0
    let dpr = 1

    const size = (): void => {
      dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(window.innerWidth * dpr)
      canvas.height = Math.round(window.innerHeight * dpr)
    }
    const draw = (): void => {
      raf = 0
      if (!ctx) return
      const now = performance.now()
      points = prune(points, now)
      ripples = ripples.filter((r) => ripple(r.t, now))
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineCap = 'round'
      // la cola: una cinta con degradado de la punta vieja al sol, con su resplandor cálido
      const rib = ribbon(points, now)
      if (rib) {
        const grad = (rgb: string, k: number): CanvasGradient => {
          const g = ctx.createLinearGradient(rib.tail.x, rib.tail.y, rib.head.x, rib.head.y)
          g.addColorStop(0, `rgba(${rgb},0)`)
          g.addColorStop(1, `rgba(${rgb},${rib.alpha * k})`)
          return g
        }
        ctx.beginPath()
        rib.outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.closePath()
        ctx.shadowColor = `rgba(${tone.glow},${rib.alpha * 0.7})`
        ctx.shadowBlur = 12
        ctx.fillStyle = grad(tone.core, 1)
        ctx.fill()
        ctx.shadowBlur = 0
      }
      for (const r of ripples) {
        const w = ripple(r.t, now)
        if (!w) continue
        ctx.beginPath()
        ctx.arc(r.x, r.y, w.r, 0, Math.PI * 2)
        ctx.strokeStyle = tone.accent
        ctx.globalAlpha = w.alpha
        ctx.lineWidth = 2.2
        ctx.stroke()
        ctx.globalAlpha = 1
      }
      // solo sigue mientras quede algo que pintar
      if (points.length > 1 || ripples.length) raf = requestAnimationFrame(draw)
    }
    const wake = (): void => {
      if (!raf) raf = requestAnimationFrame(draw)
    }
    const move = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return
      const all = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
      for (const c of all.length ? all : [e]) points = addPoint(points, { x: c.clientX, y: c.clientY, t: performance.now() })
      wake()
    }
    const down = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return
      ripples.push({ x: e.clientX, y: e.clientY, t: performance.now() })
      wake()
    }
    const clear = (): void => {
      points = []
      wake()
    }
    size()
    window.addEventListener('resize', size)
    window.addEventListener('pointermove', move, { capture: true, passive: true })
    window.addEventListener('pointerdown', down, { capture: true, passive: true })
    document.documentElement.addEventListener('pointerleave', clear)
    window.addEventListener('blur', clear)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', size)
      window.removeEventListener('pointermove', move, { capture: true })
      window.removeEventListener('pointerdown', down, { capture: true })
      document.documentElement.removeEventListener('pointerleave', clear)
      window.removeEventListener('blur', clear)
      canvas.remove()
    }
  }, [enabled, reducedMotion, dark])

  return null
}
