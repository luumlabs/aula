// Dibujo vectorial (`drawing`): líneas, flechas, formas, arcos, ángulos, cotas, ejes, objetos hechos y textos con fórmulas que
// se trazan uno tras otro al entrar en la vista (port de StudyUI/Blocks/DrawingView.swift). Puede moverse (deslizadores y un
// reloj que desplazan, giran o llevan elementos por un recorrido) y construirse paso a paso (cada paso muestra su etapa,
// lleva los deslizadores a sus valores y rodea en ladrillo lo que importa). En papel y con «Reducir movimiento», quieto:
// la imagen en reposo (el reloj y los deslizadores siguen funcionando a mano, sin arrancar solos).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Icon, useTheme } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import type { SimParam } from '@shared/schema/visual'
import { RichText } from '@renderer/lib/RichText'
import type { BlockProps } from '../types'
import {
  GLIDE_MS, canvasSize, drawingEngine, drawingEnv, drawingMoves, drawingShapes, glideValues, highlightIndices, resolveFrame, saneDrawParams, stepState
} from './lib/drawing'
import { snapToStep } from './lib/simulation'
import { DrawingCanvas } from './shared/DrawingCanvas'
import { Clock, ParamSlider } from './shared/SimControls'
import { useSimClock } from './shared/useSimClock'
import { Caption, useInView, useInk, useSize } from './shared/ui'
import { DrawingSteps, PrintedDrawingSteps } from './DrawingSteps'

/** Cada cuánto avanza un paso al pulsar «Ver». */
const STEP_MS = 3200

export default function DrawingBlock({ block, ctx }: BlockProps<BlockOf<'drawing'>>) {
  const { t, i18n } = useTranslation('visual')
  const ink = useInk(ctx.hue)
  const { reducedMotion } = useTheme()
  const { W, H } = canvasSize(block.width, block.height)
  const [box, size] = useSize<HTMLDivElement>()
  const seen = useInView(box, true, '-40px')
  const onScreen = useInView(box, false, '80px')
  const printing = ctx.mode === 'print'
  const animate = !printing && !reducedMotion
  const maxW = Math.min(W * 1.6, ctx.mode === 'chat' ? 560 : 760)
  const label = [block.title, block.caption].filter(Boolean).join('. ') || t('drawing')
  const sep = (ctx.language || i18n.language).startsWith('en') ? '.' : ','

  // movimiento: deslizadores y reloj (en papel, la imagen en reposo)
  const params = useMemo(() => saneDrawParams(block.params ?? []), [block.params])
  const engine = useMemo(() => drawingEngine({ params, time: block.time }), [params, block.time])
  const moves = !printing && drawingMoves(block)
  const steps = useMemo(() => (printing ? [] : (block.steps ?? [])), [printing, block.steps])
  const rest = useMemo(() => stepState([], params, null).values, [params])
  const [values, setValues] = useState<Record<string, number>>(rest)
  const bounds = useMemo(() => (block.time ? engine.timeBounds(values) : undefined), [engine, values, block.time])
  const lo = bounds?.[0] ?? 0, hi = bounds?.[1] ?? 1
  const clock = useSimClock({ lo, hi, speed: block.time?.speed ?? 1, loops: block.time?.loop ?? true, autoplay: !!block.time?.autoplay && moves && !reducedMotion, onScreen })

  // pasos: null = el dibujo entero, en reposo
  const [step, setStep] = useState<number | null>(null)
  const [playingSteps, setPlayingSteps] = useState(false)
  const state = useMemo(() => stepState(steps, params, step), [steps, params, step])
  // solo se rodea lo que ya se ve en el paso
  const focus = useMemo(() => (step === null ? undefined : highlightIndices(block.items, state.highlight, state.show)), [step, block.items, state.highlight, state.show])

  // al cambiar de paso, los deslizadores se deslizan hasta sus valores (550 ms; al instante con «Reducir movimiento»)
  const current = useRef(values)
  current.current = values
  const glide = useRef(0)
  const glideTo = useCallback((to: Record<string, number>) => {
    cancelAnimationFrame(glide.current)
    const from = current.current
    if (reducedMotion || Object.keys(to).every((k) => from[k] === to[k])) { setValues(to); return }
    const start = performance.now()
    const frame = (ms: number): void => {
      const k = Math.min(1, (ms - start) / GLIDE_MS)
      setValues(glideValues(from, to, k))
      if (k < 1) glide.current = requestAnimationFrame(frame)
    }
    glide.current = requestAnimationFrame(frame)
  }, [reducedMotion])
  useEffect(() => () => cancelAnimationFrame(glide.current), [])

  const { pause: pauseClock } = clock
  const stepRef = useRef(step)
  stepRef.current = step
  const go = useCallback((k: number | null, auto = false) => {
    if (!auto) setPlayingSteps(false)
    const next = k === null ? null : Math.max(0, Math.min(steps.length - 1, k))
    setStep(next)
    // un reloj en marcha se para al cambiar de paso: el paso manda
    pauseClock()
    glideTo(stepState(steps, params, next).values)
    if (!auto) ctx.onInteract?.(block.id, 'drawing-step')
  }, [steps, params, pauseClock, glideTo, ctx, block.id])

  // «Ver»: un paso cada 3,2 s hasta el último
  useEffect(() => {
    if (!playingSteps) return
    const id = setInterval(() => {
      const next = Math.min((stepRef.current ?? -1) + 1, steps.length - 1)
      if (next >= steps.length - 1) setPlayingSteps(false)
      go(next, true)
    }, STEP_MS)
    return () => clearInterval(id)
  }, [playingSteps, steps.length, go])
  const toggleSteps = (): void => {
    if (playingSteps) return setPlayingSteps(false)
    if (step === null || step >= steps.length - 1) go(0, true)
    setPlayingSteps(true)
    ctx.onInteract?.(block.id, 'drawing-play')
  }

  const setParam = (p: SimParam, v: number): void => {
    cancelAnimationFrame(glide.current)
    setValues((cur) => ({ ...cur, [p.name]: snapToStep(v, p) }))
    ctx.onInteract?.(block.id, 'drawing-param')
  }
  const reset = (): void => {
    cancelAnimationFrame(glide.current)
    setPlayingSteps(false)
    setStep(null)
    setValues(rest)
    clock.reset()
  }
  const changed = step !== null || clock.now > lo + 1e-9 || params.some((p) => Math.abs((values[p.name] ?? p.value) - p.value) > 1e-9)

  // un transform por elemento en cada fotograma (la geometría se calcula una vez)
  const restShapes = useMemo(() => (moves ? drawingShapes(block.items) : []), [moves, block.items])
  const frame = useMemo(
    () => (moves ? resolveFrame(block.items, restShapes, engine, drawingEnv(engine, values, block.time ? clock.now : undefined)) : undefined),
    [moves, block.items, restShapes, engine, values, block.time, clock.now]
  )

  const tm = block.time
  const hasControls = moves && (params.length > 0 || !!tm)
  return (
    <div className="flex flex-col gap-3" style={ink}>
      {/* la imagen (role img) es lo dibujado dentro del lienzo, no la figura: así el botón «Marcar» y la zona de marcar, que
          van en el lienzo, quedan fuera de ella y los lectores de pantalla los anuncian */}
      <figure className="flex flex-col gap-2 m-0">
        {block.title && (
          <figcaption className="font-serif text-[19px] leading-[26px] font-medium text-text">
            <RichText text={block.title} inline />
          </figcaption>
        )}
        <div className="w-full flex justify-center">
          <div ref={box} className="relative w-full" style={{ maxWidth: maxW, aspectRatio: `${W} / ${H}` }}>
            {size.width > 0 && (
              <DrawingCanvas
                items={block.items}
                W={W}
                H={H}
                pixelWidth={size.width}
                animate={animate}
                play={seen}
                frame={frame}
                show={step === null ? undefined : state.show}
                focus={focus}
                hand={block.style === 'hand'}
                seed={block.id}
                askParts={printing ? false : ctx.inPrompt ? 'visible' : true}
                label={label}
              />
            )}
          </div>
        </div>
        <Caption text={block.caption} />
      </figure>
      {hasControls && (
        <div className="flex flex-col gap-3 rounded-[16px] bg-fill1 px-4 py-3" role="group" aria-label={t('draw.controls')}>
          {tm && bounds && (
            <Clock
              interactive
              playing={clock.playing}
              now={clock.now}
              lo={lo}
              hi={hi}
              label={tm.label ?? tm.name}
              name={tm.name}
              unit={tm.unit}
              rate={clock.rate}
              loop={clock.loop}
              sep={sep}
              onToggle={() => { clock.toggle(); ctx.onInteract?.(block.id, 'drawing-play') }}
              onScrub={clock.scrub}
              onRate={clock.setRate}
              onLoop={clock.toggleLoop}
            />
          )}
          {params.length > 0 && (
            <div className="grid gap-x-6 gap-y-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
              {params.map((p) => (
                <ParamSlider key={p.name} p={p} value={values[p.name] ?? p.value} interactive sep={sep} onChange={(v) => setParam(p, v)} />
              ))}
            </div>
          )}
          <div className="flex justify-end -mb-1">
            <Button size="sm" variant="ghost" icon={<Icon name="undo" size={13} />} onClick={reset} disabled={!changed} title={t('resetHint')}>
              {t('reset')}
            </Button>
          </div>
        </div>
      )}
      {steps.length > 0 && (
        <DrawingSteps steps={steps} step={step} playing={playingSteps} onGo={(k) => go(k)} onToggle={toggleSteps} onAll={() => go(null)} reduced={reducedMotion} />
      )}
      {printing && (block.steps?.length ?? 0) > 0 && <PrintedDrawingSteps steps={block.steps ?? []} />}
    </div>
  )
}
