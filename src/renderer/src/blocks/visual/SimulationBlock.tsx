// Simulación (`simulation`): deslizadores que cambian los parámetros de un modelo, magnitudes que se recalculan en vivo, una
// gráfica con objetos que se mueven (reloj con reproducir, pausa, velocidad, bucle y arrastre), un registro de una magnitud que
// se dibuja mientras corre, las fórmulas del modelo y preguntas para probar. Port de StudyUI/Blocks/Simulation/SimulationView.swift
// con el motor de StudyEngine/Content/SimulationEngine.swift (lib/simulation.ts). El reloj arranca en su límite inferior.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Button, Icon, IconButton, cx, useTheme } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import type { SimParam } from '@shared/schema/visual'
import { RichText } from '@renderer/lib/RichText'
import { Tex } from '@renderer/tools/shared/Tex'
import type { BlockProps } from '../types'
import { SimulationClock, SimulationEngine, decimalsFor, formatSimValue, saneParams, simKey, snapToStep, type Env } from './lib/simulation'
import { chooseTrace, isTimePlot, simulationRange, traceValue, type TraceSpec } from './lib/simPlot'
import { SimPlot } from './shared/SimPlot'
import { PresetScene, hasScene } from './shared/PresetScenes'
import { mathify, vizColor } from './shared/colors'
import { BlockHeader, Caption, canvasWell, useInView, useInk, useSize } from './shared/ui'

const SPEEDS = [0.5, 1, 2] as const

export default function SimulationBlock({ block, ctx }: BlockProps<BlockOf<'simulation'>>) {
  const { t, i18n } = useTranslation('visual')
  const ink = useInk(ctx.hue)
  const { reducedMotion } = useTheme()
  const sep = (ctx.language || i18n.language).startsWith('en') ? '.' : ','
  const interactive = ctx.mode !== 'print'
  const b = useMemo(() => ({ ...block, params: saneParams(block.params) }), [block])
  const engine = useMemo(() => new SimulationEngine(b), [b])
  const defaults = useMemo(() => engine.initialParams, [engine])
  const [values, setValues] = useState<Env>(defaults)
  const bounds = useMemo(() => engine.timeBounds(values), [engine, values])
  const tm = b.time
  const speed = tm && tm.speed > 0 && Number.isFinite(tm.speed) ? tm.speed : 1
  const loops = tm?.loop ?? true

  // reloj: con «Reducir movimiento» no arranca solo; fuera de la pantalla no dibuja a 60 fps
  const [box, size] = useSize<HTMLDivElement>()
  const visible = useInView(box, false, '80px')
  const [playing, setPlaying] = useState(() => !!tm?.autoplay && !reducedMotion && interactive)
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState(loops)
  const [time, setTime] = useState(() => SimulationClock.initial(bounds?.[0] ?? 0))
  const clock = useRef({ start: performance.now(), t0: time })
  // la gráfica contra el tiempo se va trazando cuando el reloj ya ha corrido (antes, entera)
  const [started, setStarted] = useState(playing)

  const lo = bounds?.[0] ?? 0, hi = bounds?.[1] ?? 1
  const now = Math.min(Math.max(time, lo), hi)

  useEffect(() => {
    if (!playing || !visible || !tm || !bounds) return
    clock.current = { start: performance.now(), t0: now >= hi - 1e-9 && !loop ? lo : now }
    let raf = 0
    const tick = (ms: number): void => {
      const elapsed = (ms - clock.current.start) / 1000
      const tt = SimulationClock.time(clock.current.t0, elapsed, speed * rate, lo, hi, loop)
      setTime(tt)
      // sin bucle, al llegar al final se para de verdad
      if (!loop && tt >= hi - 1e-9) { setPlaying(false); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, visible, lo, hi, speed, rate, loop]) // eslint-disable-line react-hooks/exhaustive-deps

  const togglePlay = (): void => {
    if (!playing && now >= hi - 1e-9) setTime(lo)
    setStarted(true)
    setPlaying((p) => !p)
    ctx.onInteract?.(block.id, 'simulation-play')
  }
  const scrub = (v: number): void => {
    setPlaying(false)
    setStarted(true)
    setTime(v)
  }
  const reset = (): void => {
    setValues(defaults)
    const nb = engine.timeBounds(defaults)
    setTime(SimulationClock.initial(nb?.[0] ?? 0))
    setPlaying(false)
    setStarted(false)
  }
  const setParam = useCallback((p: SimParam, v: number) => {
    setValues((cur) => ({ ...cur, [p.name]: snapToStep(v, p) }))
    ctx.onInteract?.(block.id, 'simulation-param')
  }, [block.id, ctx])

  // rango de la gráfica: fijo mientras corre el reloj (los ejes no «saltan»); se recalcula con los deslizadores
  const range = useMemo(() => simulationRange(engine, values), [engine, values])
  const env = engine.environment(values, tm ? now : undefined)
  const objects = engine.resolve(values, tm ? now : undefined)
  const timePlot = useMemo(() => isTimePlot(engine), [engine])
  const trace = useMemo(() => (interactive ? chooseTrace(engine, values) : undefined), [engine, values, interactive])
  const changed = b.params.some((p) => Math.abs((values[p.name] ?? p.value) - p.value) > 1e-12)

  const width = Math.max(200, size.width)
  const ratio = b.plot.aspectRatio !== undefined && b.plot.aspectRatio > 0.2 && b.plot.aspectRatio < 2 ? b.plot.aspectRatio : 0.62
  const plotH = Math.round(Math.min(ctx.mode === 'chat' ? 300 : 440, Math.max(200, width * ratio)))
  const shown = b.derived.filter((d) => d.show)
  const wide = width >= 640

  return (
    <section className="flex flex-col gap-3.5" style={ink} aria-label={b.title ?? t('sim.eyebrow')}>
      <BlockHeader
        icon="sliders"
        eyebrow={t('sim.eyebrow')}
        title={b.title}
        actions={
          interactive && b.params.length > 0 ? (
            <Button size="sm" variant="ghost" icon={<Icon name="undo" size={13} />} onClick={reset} disabled={!changed} title={t('resetHint')}>
              {t('reset')}
            </Button>
          ) : undefined
        }
      />
      {b.intro && (
        <div className="t-callout text-text2 -mt-1">
          <RichText text={b.intro} />
        </div>
      )}
      <div ref={box} className={cx(canvasWell, 'bg-surface')}>
        {size.width > 0 && b.preset && hasScene(b.preset, env) && (
          <div className="px-3 pt-3 border-b-[0.5px] border-line-soft">
            <PresetScene preset={b.preset} env={env} width={width - 24} />
          </div>
        )}
        {size.width > 0 && (
          <div className="px-1 pt-2 pb-1">
            <SimPlot engine={engine} spec={b.plot} env={env} objects={objects} range={range} width={width - 8} height={plotH} sweepX={timePlot && started ? now : undefined} decimalSep={sep} />
          </div>
        )}
        <Legend spec={b.plot} />
      </div>
      {tm && bounds && (
        <Clock
          interactive={interactive}
          playing={playing}
          now={now}
          lo={lo}
          hi={hi}
          label={tm.label ?? tm.name}
          name={tm.name}
          unit={tm.unit}
          rate={rate}
          loop={loop}
          sep={sep}
          onToggle={togglePlay}
          onScrub={scrub}
          onRate={setRate}
          onLoop={() => setLoop((v) => !v)}
        />
      )}
      {trace && tm && bounds && (
        <TraceChart engine={engine} spec={trace} values={values} lo={lo} hi={hi} now={now} label={traceLabel(trace, b, t)} unit={tm.unit} sep={sep} />
      )}
      <div className={cx('grid gap-4', wide && shown.length > 0 && b.params.length > 0 ? 'grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]' : 'grid-cols-1')}>
        {b.params.length > 0 && (
          <div className="flex flex-col gap-3">
            {b.params.map((p) => (
              <ParamSlider key={p.name} p={p} value={values[p.name] ?? p.value} interactive={interactive} sep={sep} onChange={(v) => setParam(p, v)} />
            ))}
          </div>
        )}
        {shown.length > 0 && (
          <div className="grid gap-2 content-start [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
            {shown.map((d) => {
              const v = env[simKey(d.name)]
              return (
                <div key={d.name} className="rounded-[14px] bg-fill1 px-3 py-2.5 flex flex-col gap-0.5 min-w-0">
                  <span className="t-caption text-text2 leading-[14px]">
                    <RichText text={d.label ?? d.name} inline />
                  </span>
                  <span className="flex items-baseline gap-1">
                    <span className="font-serif text-[22px] leading-7 tabular text-text">{v === undefined ? '—' : formatSimValue(v, d.decimals, sep)}</span>
                    {d.unit && <span className="t-footnote text-text3">{unitText(d.unit).trim()}</span>}
                  </span>
                  {d.tex && <Tex tex={d.tex} className="text-[13px] text-text2 max-w-full overflow-x-auto overflow-y-hidden" />}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {b.formulas.length > 0 && (
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {b.formulas.slice(0, 8).map((f, i) => (
            <div key={i} className="rounded-[14px] bg-sunken px-3.5 py-3">
              {f.name && <div className="t-ui text-text2">{f.name}</div>}
              <div className="mt-1.5 text-[16px] overflow-x-auto overflow-y-hidden">
                <Tex tex={f.tex} display />
              </div>
              {f.when && (
                <div className="t-ui text-text3 mt-1">
                  <RichText text={f.when} inline />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {b.prompts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="t-footnote font-medium text-text3 flex items-center gap-1.5">
            <Icon name="lightbulb" size={13} />
            {t('sim.tryThis')}
          </div>
          <ol className="m-0 p-0 list-none flex flex-col gap-1.5">
            {b.prompts.map((q, i) => (
              <li key={i} className="flex gap-2.5 items-baseline">
                <span className="font-serif text-[16px] tabular text-text3 w-5 text-right shrink-0">{i + 1}.</span>
                <span className="t-callout text-text">
                  <RichText text={q} inline />
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <Caption text={b.caption} />
    </section>
  )
}

/** La unidad tras la cifra: «45°» pegado; el resto con un espacio («25 m/s»). */
const unitText = (u: string): string => (u === '°' || u === '′' || u === '″' ? u : ` ${u}`)

function traceLabel(spec: TraceSpec, b: BlockOf<'simulation'>, t: (k: string) => string): string {
  if (spec.derived) {
    const d = b.derived.find((x) => x.name === spec.derived)
    return d?.label ?? spec.derived
  }
  if (spec.point?.axis === 'x') return b.plot.xLabel ?? t('sim.traceX')
  return b.plot.yLabel ?? t('sim.traceY')
}

function Legend({ spec }: { spec: BlockOf<'simulation'>['plot'] }) {
  const items = spec.curves.filter((c) => c.label)
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 -mt-1">
      {items.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1.5 t-caption text-text2">
          <span className="inline-block w-4 h-0" style={{ borderTop: `2.4px ${c.dashed ? 'dashed' : 'solid'} ${vizColor(c.color)}` }} aria-hidden />
          <RichText text={mathify(c.label ?? '')} inline />
        </span>
      ))}
    </div>
  )
}

function Clock({ interactive, playing, now, lo, hi, label, name, unit, rate, loop, sep, onToggle, onScrub, onRate, onLoop }: {
  interactive: boolean; playing: boolean; now: number; lo: number; hi: number; label: string; name: string; unit?: string; rate: number; loop: boolean; sep: string
  onToggle: () => void; onScrub: (v: number) => void; onRate: (r: number) => void; onLoop: () => void
}) {
  const { t } = useTranslation('visual')
  const pct = hi > lo ? ((now - lo) / (hi - lo)) * 100 : 0
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {interactive && (
        <motion.button
          type="button"
          onClick={onToggle}
          whileTap={{ scale: 0.92 }}
          aria-label={playing ? t('pause') : t('play')}
          title={playing ? t('pause') : t('play')}
          className="grid place-items-center w-9 h-9 rounded-full bg-accent text-on-accent shadow-[var(--accent-halo)] shrink-0"
        >
          <Icon name={playing ? 'pause' : 'play'} size={15} />
        </motion.button>
      )}
      <div className="flex-1 min-w-[160px] flex flex-col gap-1">
        {interactive ? (
          <input
            type="range"
            min={lo}
            max={hi}
            step={(hi - lo) / 1000}
            value={now}
            onChange={(e) => onScrub(Number(e.target.value))}
            aria-label={label}
            className="aula-range w-full"
            style={{ background: `linear-gradient(90deg, var(--accent) ${pct}%, var(--fill3) ${pct}%)` }}
          />
        ) : (
          <div className="h-1 rounded-full bg-fill3 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
        )}
      </div>
      <span className="t-number-inline text-text2 min-w-[92px] text-right">
        <span className="font-serif italic">{name}</span> = {formatSimValue(now, 2, sep)}
        {unit && <span className="text-text3"> {unit}</span>}
      </span>
      {interactive && (
        <div className="flex items-center gap-0.5 rounded-full bg-fill2 p-[3px]">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onRate(s)}
              aria-pressed={rate === s}
              title={t('sim.speed', { x: formatSimValue(s, undefined, sep) })}
              className={cx('h-6 px-2 rounded-full t-caption font-semibold tabular transition-colors', rate === s ? 'bg-raised text-text shadow-[var(--e1)]' : 'text-text3 hover:text-text')}
            >
              {formatSimValue(s, undefined, sep)}×
            </button>
          ))}
        </div>
      )}
      {interactive && (
        <IconButton size="sm" label={loop ? t('sim.loopOn') : t('sim.loopOff')} active={loop} onClick={onLoop}>
          <Icon name="repeat" size={14} />
        </IconButton>
      )}
    </div>
  )
}

function ParamSlider({ p, value, interactive, sep, onChange }: { p: SimParam; value: number; interactive: boolean; sep: string; onChange: (v: number) => void }) {
  const pct = p.max > p.min ? ((value - p.min) / (p.max - p.min)) * 100 : 0
  const dec = Math.max(decimalsFor(p.step), decimalsFor(p.min))
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="t-ui font-medium text-text2 min-w-0">
          <RichText text={p.label ?? p.name} inline />
        </span>
        <span className="t-number-inline text-text whitespace-nowrap">
          {formatSimValue(value, dec, sep)}
          {p.unit && <span className="text-text3 font-normal">{unitText(p.unit)}</span>}
        </span>
      </span>
      {interactive ? (
        <input
          type="range"
          min={p.min}
          max={p.max}
          step={(p.max - p.min) / p.step <= 400 ? p.step : 'any'}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="aula-range w-full"
          style={{ background: `linear-gradient(90deg, var(--accent) ${pct}%, var(--fill3) ${pct}%)` }}
        />
      ) : (
        <div className="h-1 rounded-full bg-fill3 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
      )}
    </label>
  )
}

/** Registro de una magnitud mientras corre el reloj: se dibuja hasta el instante actual. */
function TraceChart({ engine, spec, values, lo, hi, now, label, unit, sep }: { engine: SimulationEngine; spec: TraceSpec; values: Env; lo: number; hi: number; now: number; label: string; unit?: string; sep: string }) {
  const { t } = useTranslation('visual')
  const [box, size] = useSize<HTMLDivElement>()
  const samples = useMemo(() => {
    const out: Array<[number, number]> = []
    for (let i = 0; i <= 240; i++) {
      const tt = lo + ((hi - lo) * i) / 240
      const v = traceValue(engine, spec, values, tt)
      if (v !== undefined && Number.isFinite(v)) out.push([tt, v])
    }
    return out
  }, [engine, spec, values, lo, hi])
  if (samples.length < 2) return null
  const ys = samples.map((s) => s[1])
  let y0 = Math.min(...ys), y1 = Math.max(...ys)
  if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1 }
  const pad = (y1 - y0) * 0.12
  y0 -= pad; y1 += pad
  const W = Math.max(100, size.width), H = 92
  const sx = (v: number): number => 8 + ((v - lo) / (hi - lo)) * (W - 16)
  const sy = (v: number): number => 8 + (1 - (v - y0) / (y1 - y0)) * (H - 16)
  const upTo = samples.filter((s) => s[0] <= now)
  const cur = traceValue(engine, spec, values, now)
  const path = (pts: Array<[number, number]>): string => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join('')
  const zero = y0 < 0 && y1 > 0 ? sy(0) : undefined
  return (
    <div className="rounded-[16px] bg-fill1 px-3 pt-2 pb-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-caption text-text2 flex items-center gap-1.5">
          <Icon name="activity" size={12} />
          {t('sim.trace')} · <RichText text={mathify(label)} inline />
        </span>
        {cur !== undefined && <span className="font-serif text-[15px] tabular text-text">{formatSimValue(cur, 2, sep)}</span>}
      </div>
      <div ref={box} className="w-full">
        {size.width > 0 && (
          <svg width={W} height={H} aria-hidden>
            {zero !== undefined && <line x1={8} x2={W - 8} y1={zero} y2={zero} stroke="var(--line)" />}
            <path d={path(samples)} fill="none" stroke="var(--text3)" strokeOpacity={0.25} strokeWidth={1.5} strokeDasharray="3 4" />
            {upTo.length >= 1 && cur !== undefined && <path d={path([...upTo, [now, cur]])} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {cur !== undefined && <circle cx={sx(now)} cy={sy(cur)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} />}
          </svg>
        )}
      </div>
      <div className="flex justify-between t-caption tabular text-text3 -mt-0.5">
        <span>{formatSimValue(lo, undefined, sep)}{unit ? ` ${unit}` : ''}</span>
        <span>{formatSimValue(hi, 2, sep)}{unit ? ` ${unit}` : ''}</span>
      </div>
    </div>
  )
}
