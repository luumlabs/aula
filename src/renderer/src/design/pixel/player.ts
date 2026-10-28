// Reproductor de los personajes (dibujados a mano a partir de sus fotogramas) en un <canvas>, sin React por fotograma. Un
// único bucle requestAnimationFrame para todos los personajes en pantalla, que solo copia un dibujo cuando cambia el
// fotograma (o el dibujo del «hervor»); un único IntersectionObserver para pausar los que salen de la vista, y un único
// temporizador para el reposo «de vez en cuando». Cada fotograma se pinta una vez, en un hilo aparte, y se guarda
// (./brush/frames.ts): lo que se ve, primero.
import { frameAt, type ClipName, type CompiledAnim, type Px } from './anim'
import { PRIORITY, peekFrame, requestFrame, type FrameImage } from './brush/frames'
import { ambientLevel, onAmbientChange } from '../ambient'

export type Entrance = 'none' | 'drop' | 'dissolve'

export interface PlayerOptions {
  anim: CompiledAnim
  /** Tamaño en CSS px del sprite (sin el margen). */
  size: number
  reduced: boolean
  /** Papel oscuro (los pigmentos y la silueta cambian). */
  dark: boolean
  entrance: Entrance
  /** Retraso de la entrada (s). */
  delay: number
  /** Tras la entrada (o al montar), celebra. */
  celebrate: boolean
  /** Reposo de vez en cuando. */
  idle: boolean
  /** Elemento que dispara la historia al pasar el ratón (por defecto, el más cercano que sea interactivo; null = ninguno). */
  hoverTarget?: Element | null
  /** Bucle continuo (los compañeros «trabajando»): índice de fotograma de `loopFrames` según el tiempo (s). */
  loop?: { frames: Px[][]; at: (t: number) => number } | null
}

const RAMP_IN = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3)
/** Cada cuánto cambia el dibujo del «hervor» de la línea en los bucles (ms): animación a mano «a doses». */
const BOIL_MS = 140
/** Ruido estable por píxel (el borde de lo que se va pintando al entrar). */
function hash01(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

// ——— bucle compartido ———
const active = new Set<PixelPlayer>()
let raf = 0
function tickAll(now: number): void {
  raf = 0
  // con la ventana sin ver no se pinta nada (al volver, onAmbientChange lo despierta)
  if (ambientLevel() === 'off') return
  for (const p of active) if (!p.step(now)) active.delete(p)
  // un step() puede haber llamado a play() → wake() y programado ya el siguiente: nunca dos bucles a la vez (J4-7)
  if (active.size && !raf) raf = requestAnimationFrame(tickAll)
}
function wake(p: PixelPlayer): void {
  active.add(p)
  if (!raf && ambientLevel() !== 'off') raf = requestAnimationFrame(tickAll)
}
onAmbientChange((level) => {
  if (level === 'off' && raf) {
    cancelAnimationFrame(raf)
    raf = 0
  } else if (level !== 'off' && active.size && !raf) raf = requestAnimationFrame(tickAll)
  syncIdleTimer()
})

// ——— visibilidad compartida ———
const byCanvas = new WeakMap<Element, PixelPlayer>()
let observer: IntersectionObserver | null = null
function observe(p: PixelPlayer, el: Element): void {
  if (typeof IntersectionObserver === 'undefined') {
    p.setVisible(true)
    return
  }
  observer ??= new IntersectionObserver((entries) => {
    for (const e of entries) byCanvas.get(e.target)?.setVisible(e.isIntersecting)
  })
  byCanvas.set(el, p)
  observer.observe(el)
}
function unobserve(el: Element): void {
  observer?.unobserve(el)
  byCanvas.delete(el)
}

// ——— reposo «de vez en cuando» ———
const idlers = new Set<PixelPlayer>()
let idleTimer: ReturnType<typeof setInterval> | null = null
function addIdler(p: PixelPlayer): void {
  idlers.add(p)
  syncIdleTimer()
}
function removeIdler(p: PixelPlayer): void {
  idlers.delete(p)
  syncIdleTimer()
}
/** El temporizador del reposo solo existe mientras hay personajes y alguien usa la app (en calma u oculta, ni despierta). */
function syncIdleTimer(): void {
  const want = idlers.size > 0 && ambientLevel() === 'run'
  if (want && !idleTimer) {
    idleTimer = setInterval(() => {
      const now = performance.now()
      if (typeof document !== 'undefined' && document.hidden) return
      for (const q of idlers) q.maybeIdle(now)
    }, 700)
  } else if (!want && idleTimer) {
    clearInterval(idleTimer)
    idleTimer = null
  }
}
const nextIdleDelay = () => 7000 + Math.random() * 11000

const HOVERABLE = '[data-pixel-hover], button, a[href], [role="button"], [role="option"], [role="menuitem"], [role="link"], [role="tab"], label'

/** Pinta un personaje en un canvas y le da vida. */
export class PixelPlayer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private o: PlayerOptions
  private clip: ClipName | null = null
  private clipStart = 0
  private entranceStart = -1
  private shownPx: Px[] | null = null
  private shownVar = 0
  private wantPx: Px[] | null = null
  private wantVar = 0
  private dpr = 1
  private dead = false
  private reveal: { thr: Float32Array; base: ImageData } | null = null
  private visible = false
  private hovered = false
  private replayAt = 0
  private nextIdle = 0
  private target: Element | null = null
  private onEnter = () => this.hover(true)
  private onLeave = () => this.hover(false)

  constructor(canvas: HTMLCanvasElement, o: PlayerOptions) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.o = o
    this.resize()
    const animated = !o.reduced
    if (animated && o.entrance !== 'none') {
      this.entranceStart = performance.now()
      wake(this)
    } else {
      this.paint(o.anim.base)
      if (animated && o.celebrate) this.play('celebrate')
    }
    if (animated && o.loop) wake(this)
    this.nextIdle = performance.now() + 2500 + Math.random() * 9000
    if (o.idle && animated && o.anim.clips.idle) addIdler(this)
    this.target = o.hoverTarget === null ? null : (o.hoverTarget ?? canvas.closest(HOVERABLE) ?? canvas.parentElement?.parentElement ?? null)
    this.target?.addEventListener('pointerenter', this.onEnter)
    this.target?.addEventListener('pointerleave', this.onLeave)
    observe(this, canvas)
  }

  destroy(): void {
    this.dead = true
    active.delete(this)
    removeIdler(this)
    unobserve(this.canvas)
    this.target?.removeEventListener('pointerenter', this.onEnter)
    this.target?.removeEventListener('pointerleave', this.onLeave)
  }

  /** Ajusta el lienzo a su tamaño en pantalla × densidad de píxeles. */
  resize(): void {
    const { anim, size } = this.o
    const css = (size * anim.stride) / anim.size
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const px = Math.max(1, Math.round(css * dpr))
    if (this.canvas.width !== px) {
      this.canvas.width = px
      this.canvas.height = px
    }
    this.dpr = dpr
    this.shownPx = null
    this.reveal = null
  }

  setVisible(v: boolean): void {
    const was = this.visible
    this.visible = v
    // al verse por primera vez, su dibujo pasa delante en la cola
    if (v && !was && !this.shownPx && this.entranceStart < 0) this.paint(this.wantPx ?? this.o.anim.base, this.wantVar)
    if (!v && this.clip && this.clip !== 'celebrate') this.stop()
    if (v && this.o.loop && !this.o.reduced) wake(this)
  }

  setLoop(loop: PlayerOptions['loop']): void {
    this.o.loop = loop
    if (loop && !this.o.reduced) wake(this)
    else if (!this.clip) this.paint(this.o.anim.base)
  }

  hover(on: boolean): void {
    this.hovered = on
    const hc = this.o.anim.clips.hover
    if (!hc) return
    if (this.o.reduced) {
      // con movimiento reducido: un único fotograma clave, sin animar
      this.paint(on ? hc.frames[hc.still].px : this.o.anim.base)
      return
    }
    if (on && this.clip !== 'hover' && this.entranceStart < 0) this.play('hover')
  }

  play(name: ClipName): void {
    const clip = this.o.anim.clips[name]
    if (this.o.reduced || !clip) return
    this.clip = name
    this.clipStart = performance.now()
    // los dibujos de toda la historia, pedidos por adelantado (paso t → su fotograma y su dibujo del hervor)
    for (let t = 0; t < clip.ticks; t++) {
      const i = frameAt(clip, t)
      if (i != null) requestFrame(this.o.anim, clip.frames[i].px, this.canvas.width, this.o.dark, t % 3, this.dpr, PRIORITY.ahead)
    }
    wake(this)
  }

  maybeIdle(now: number): void {
    // el reposo se puede apagar para capturas deterministas: <html data-pixel-idle="off">
    if (typeof document !== 'undefined' && document.documentElement.dataset.pixelIdle === 'off') return
    if (!this.visible || this.clip || this.entranceStart >= 0 || this.hovered || this.o.loop) return
    if (now < this.nextIdle) return
    this.nextIdle = now + nextIdleDelay()
    this.play('idle')
  }

  private stop(): void {
    this.clip = null
    this.paint(this.o.anim.base)
  }

  /** Un paso del bucle. Devuelve false cuando ya no necesita más fotogramas. */
  step(now: number): boolean {
    const { anim } = this.o
    if (this.entranceStart >= 0) {
      const t = (now - this.entranceStart) / 1000 - this.o.delay
      const dur = this.o.entrance === 'drop' ? 0.05 + anim.stride * 0.022 + 0.3 : 0.05 + 0.55 + 0.2
      this.paintEntrance(Math.max(0, t))
      if (t < dur) return true
      this.entranceStart = -1
      this.reveal = null
      this.shownPx = null
      this.paint(anim.base)
      if (this.o.celebrate) this.play('celebrate')
      else if (this.hovered) this.play('hover')
    }
    if (this.clip) {
      const clip = anim.clips[this.clip]!
      const tick = Math.floor((now - this.clipStart) / clip.ms)
      const i = frameAt(clip, tick)
      if (i != null) {
        // la línea «hierve»: un dibujo distinto en cada paso, también en los fotogramas que se mantienen
        this.paint(clip.frames[i].px, tick % 3)
        return true
      }
      const was = this.clip
      this.clip = null
      this.paint(anim.base)
      if (was === 'hover' && this.hovered) this.replayAt = now + 900
    }
    if (this.replayAt) {
      // repetir la historia con el ratón quieto encima, solo mientras alguien usa la app
      if (!this.hovered || ambientLevel() !== 'run') this.replayAt = 0
      else if (now >= this.replayAt) {
        this.replayAt = 0
        this.play('hover')
      }
      return true
    }
    if (this.o.loop && this.visible) {
      this.paint(this.o.loop.frames[this.o.loop.at(now / 1000)], Math.floor(now / BOIL_MS) % 3)
      return true
    }
    return false
  }

  /** Pone el dibujo de un fotograma (solo si cambió): ya hecho o, si no, en cuanto llegue del hilo de pintura. */
  paint(px: Px[], variant = 0): void {
    if (this.o.reduced) variant = 0
    if (px === this.shownPx && variant === this.shownVar) return
    this.wantPx = px
    this.wantVar = variant
    const { anim, dark } = this.o
    const W = this.canvas.width
    const hit = peekFrame(anim, px, W, dark, variant)
    if (hit) return this.blit(hit, px, variant)
    // mientras, el dibujo 0 de ese fotograma si ya está (mejor que uno viejo)
    const plain = variant ? peekFrame(anim, px, W, dark, 0) : undefined
    if (plain) this.blit(plain, px, 0)
    const priority = this.clip || this.o.loop ? PRIORITY.playing : this.visible ? PRIORITY.visible : PRIORITY.hidden
    requestFrame(anim, px, W, dark, variant, this.dpr, priority, (img) => {
      if (!this.dead && this.wantPx === px && this.wantVar === variant && this.entranceStart < 0) this.blit(img, px, variant)
    })
  }

  private blit(img: FrameImage, px: Px[], variant: number): void {
    const ctx = this.ctx
    if (!ctx) return
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.drawImage(img, 0, 0)
    this.shownPx = px
    this.shownVar = variant
  }

  /**
   * La entrada, dibujada: el dibujo aparece como si se pintara. «drop» lo descubre de arriba abajo (con el borde mojado y
   * desigual de un pincel que baja) y lo asienta un poco; «dissolve» lo hace florecer desde el centro.
   */
  private paintEntrance(t: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const { anim, dark } = this.o
    const W = this.canvas.width
    if (!this.reveal) {
      const img = peekFrame(anim, anim.base, W, dark, 0)
      if (!img) {
        // aún no está pintado: la entrada espera (y empieza de cero cuando llegue)
        requestFrame(anim, anim.base, W, dark, 0, this.dpr, PRIORITY.visible)
        this.entranceStart = performance.now()
        return
      }
      const scratch = document.createElement('canvas')
      scratch.width = W
      scratch.height = W
      const sx = scratch.getContext('2d')
      if (!sx) return
      sx.drawImage(img, 0, 0)
      const base = sx.getImageData(0, 0, W, W)
      const thr = new Float32Array(W * W)
      const drop = this.o.entrance === 'drop'
      const c = (W - 1) / 2
      for (let y = 0; y < W; y++)
        for (let x = 0; x < W; x++) {
          // el borde: ruido grueso (manchas) más fino (el diente del papel)
          const n = hash01(Math.floor(x / Math.max(1, W / 9)), Math.floor(y / Math.max(1, W / 9))) * 0.6 + hash01(x, y) * 0.4
          thr[y * W + x] = drop ? (y / W) * 0.82 + n * 0.18 : (Math.hypot(x - c, y - c) / (c * 1.42)) * 0.7 + n * 0.3
        }
      this.reveal = { thr, base }
    }
    const { thr, base } = this.reveal
    const dur = this.o.entrance === 'drop' ? 0.05 + anim.stride * 0.022 + 0.3 : 0.05 + 0.55 + 0.2
    const p = RAMP_IN(t / dur) * 1.25
    const out = new ImageData(W, W)
    const src = base.data
    const dst = out.data
    for (let i = 0; i < W * W; i++) {
      const a = Math.max(0, Math.min(1, (p - thr[i]) / 0.16))
      if (a <= 0) continue
      const o = i * 4
      dst[o] = src[o]
      dst[o + 1] = src[o + 1]
      dst[o + 2] = src[o + 2]
      dst[o + 3] = src[o + 3] * a
    }
    ctx.clearRect(0, 0, W, W)
    // «drop»: se asienta desde un poco más arriba
    const dy = this.o.entrance === 'drop' ? -Math.round((1 - Math.min(1, p)) * 2 * (W / anim.stride)) : 0
    ctx.putImageData(out, 0, dy)
    this.shownPx = null
  }
}
