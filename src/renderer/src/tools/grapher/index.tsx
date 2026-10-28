// Graficadora: varias funciones (y = f(x), paramétricas y polares) que se dibujan trazo a trazo, deslizadores para los
// parámetros libres (a, b, k…) que también se pueden animar, arrastrar y hacer zoom, seguir la curva con una cruz, los
// puntos notables de la función elegida (raíces, extremos, cortes) y una tabla de valores.
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Eye, EyeOff, Home, Minus, MoreHorizontal, Pause, Play, Plus, Trash2 } from 'lucide-react'
import { Button, Card, IconButton, Menu, Slider, cx, spring, useTheme } from '@renderer/design'
import { derivative } from '@engine/math/algebra/derivative'
import { Tex } from '../shared/Tex'
import { formatNumber, localizeTex, niceTicks, parseNumber } from '../shared/lib/num'
import { seriesColor } from '../shared/palette'
import { CardTitle, NumField, useComma, useCopy, useStored } from '../shared/ui'
import type { ToolProps } from '../registry'
import { compileFn, sampleFx, sampleParam, toClosure, type Compiled, type Env, type FnKind, type Pt, type Range } from './lib/compile'
import { notablePoints, type Notable } from './lib/notable'
import { niceValue } from './lib/nice'
import { defaultViewport, panned, rangeOf, toScreen, toWorld, zoomed, type Viewport } from './lib/viewport'

// MARK: Estado

interface FnState {
  id: string
  kind: FnKind
  a: string
  b: string
  visible: boolean
  slot: number
  t0: string
  t1: string
}

interface ParamState {
  v: number
  min: number
  max: number
}

interface Saved {
  fns: FnState[]
  params: Record<string, ParamState>
  pi: boolean
  selected: string | null
}

const NAMES = ['f', 'g', 'h', 'p', 'q', 'r', 's', 'u']
const MAX_FNS = 8
let seq = 0
const newId = () => `${Date.now().toString(36)}${++seq}`

const mk = (kind: FnKind, a: string, b: string, slot: number): FnState => ({ id: newId(), kind, a, b, visible: true, slot, t0: '0', t1: kind === 'fx' ? '' : '2π' })

const INITIAL: Saved = {
  fns: [mk('fx', 'x^2 - 2x - 3', '', 0), mk('fx', 'a·sin(b·x)', '', 1)],
  params: { a: { v: 2, min: -5, max: 5 }, b: { v: 1, min: -5, max: 5 } },
  pi: false,
  selected: null
}

const isSaved = (v: unknown): v is Saved => !!v && typeof v === 'object' && Array.isArray((v as Saved).fns)

function tRange(f: FnState): [number, number] {
  const p = (s: string, d: number) => {
    const x = s.trim().replace(/π|pi/gi, 'π')
    if (!x) return d
    const m = /^(-?[\d.,]*)\s*π$/.exec(x)
    if (m) return (m[1] === '' ? 1 : m[1] === '-' ? -1 : (parseNumber(m[1]) ?? 1)) * Math.PI
    return parseNumber(x) ?? d
  }
  return [p(f.t0, 0), p(f.t1, 2 * Math.PI)]
}

// MARK: Herramienta

export default function GrapherTool(_props: ToolProps) {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const { dark } = useTheme()
  const [saved, setSaved] = useStored<Saved>('aula.tools.grapher', INITIAL, isSaved)
  const [viewport, setViewport] = useState<Viewport | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [size, setSize] = useState({ w: 800, h: 560 })

  const compiled = useMemo(() => new Map(saved.fns.map((f) => [f.id, compileFn(f.kind, f.a, f.b)])), [saved.fns])
  const selected = saved.fns.find((f) => f.id === saved.selected) ?? saved.fns[0] ?? null
  const paramNames = useMemo(() => {
    const s = new Set<string>()
    for (const f of saved.fns) if (f.visible) for (const p of compiled.get(f.id)?.params ?? []) s.add(p)
    return [...s].sort()
  }, [saved.fns, compiled])

  // parámetros nuevos empiezan en 1
  useEffect(() => {
    const missing = paramNames.filter((n) => !saved.params[n])
    if (missing.length) setSaved((s) => ({ ...s, params: { ...s.params, ...Object.fromEntries(missing.map((n) => [n, { v: 1, min: -5, max: 5 }])) } }))
  }, [paramNames, saved.params, setSaved])

  const env = useMemo<Env>(() => Object.fromEntries(Object.entries(saved.params).map(([k, p]) => [k, p.v])), [saved.params])
  const colorOf = useCallback((f: FnState) => seriesColor(f.slot, dark), [dark])
  const nameOf = useCallback((f: FnState) => NAMES[Math.max(0, saved.fns.findIndex((x) => x.id === f.id)) % NAMES.length], [saved.fns])
  const range = useDeferredValue(rangeOf(viewport ?? defaultViewport(size.w), size.w, size.h))
  const notable = useNotable(selected, saved.fns, compiled, env, range, nameOf)

  const update = (id: string, patch: Partial<FnState>) => setSaved((s) => ({ ...s, fns: s.fns.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
  const add = (kind: FnKind, a = '', b = '') => {
    if (saved.fns.length >= MAX_FNS) return
    const used = new Set(saved.fns.map((f) => f.slot))
    const slot = [0, 1, 2, 3, 4, 5, 6, 7].find((i) => !used.has(i)) ?? saved.fns.length
    const f = mk(kind, a, b, slot)
    setSaved((s) => ({ ...s, fns: [...s.fns, f], selected: f.id }))
  }
  const remove = (id: string) => setSaved((s) => ({ ...s, fns: s.fns.filter((f) => f.id !== id), selected: s.selected === id ? null : s.selected }))
  const setParam = (n: string, patch: Partial<ParamState>) => setSaved((s) => ({ ...s, params: { ...s.params, [n]: { ...(s.params[n] ?? { v: 1, min: -5, max: 5 }), ...patch } } }))

  // animar un parámetro: va y viene entre su mínimo y su máximo
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    let dir = 1
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      setSaved((s) => {
        const p = s.params[playing]
        if (!p) return s
        let v = p.v + dir * dt * (p.max - p.min) * 0.22
        if (v > p.max) {
          v = p.max
          dir = -1
        } else if (v < p.min) {
          v = p.min
          dir = 1
        }
        return { ...s, params: { ...s.params, [playing]: { ...p, v: Math.round(v * 1000) / 1000 } } }
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, setSaved])

  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4 min-w-0 order-2 @4xl:order-1">
        <Card padded={false} className="overflow-hidden">
          <div className="px-5 pt-4">
            <CardTitle
              title={t('grapher.functions')}
              actions={
                <Menu
                  trigger={(open) => (
                    <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={open} disabled={saved.fns.length >= MAX_FNS}>
                      {t('grapher.add')}
                    </Button>
                  )}
                  items={[
                    { label: t('grapher.kind.fx'), onSelect: () => add('fx') },
                    { label: t('grapher.kind.param'), onSelect: () => add('param', 'cos(3t)', 'sin(2t)') },
                    { label: t('grapher.kind.polar'), onSelect: () => add('polar', '1 + cos(θ)') }
                  ]}
                />
              }
            />
          </div>
          <div className="pb-2">
            <AnimatePresence initial={false}>
              {saved.fns.map((f) => (
                <FnRow
                  key={f.id}
                  f={f}
                  name={nameOf(f)}
                  color={colorOf(f)}
                  compiled={compiled.get(f.id)}
                  selected={selected?.id === f.id}
                  comma={comma}
                  onSelect={() => setSaved((s) => ({ ...s, selected: f.id }))}
                  onChange={(p) => update(f.id, p)}
                  onRemove={() => remove(f.id)}
                />
              ))}
            </AnimatePresence>
          </div>
          <div className="px-5 pb-4 pt-1 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex.label} onClick={() => add(ex.kind, ex.a, ex.b)} className="h-6 px-2.5 rounded-full bg-fill2 hover:bg-fill3 text-text2 hover:text-text text-[12px] font-mono">
                {ex.label}
              </button>
            ))}
          </div>
        </Card>
        {paramNames.length > 0 && (
          <Card padded>
            <CardTitle title={t('grapher.params')} detail={t('grapher.paramsHint')} />
            <div className="flex flex-col gap-4">
              {paramNames.map((n) => {
                const p = saved.params[n] ?? { v: 1, min: -5, max: 5 }
                return (
                  <div key={n} className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                      <Slider label={<Tex tex={n} />} min={p.min} max={p.max} step={(p.max - p.min) / 200} value={p.v} onChange={(v) => setParam(n, { v })} format={(v) => formatNumber(v, { comma, sig: 3, maxDecimals: 2 })} />
                    </div>
                    <IconButton label={playing === n ? t('common.pause') : t('grapher.animate')} size="sm" active={playing === n} onClick={() => setPlaying((x) => (x === n ? null : n))}>
                      {playing === n ? <Pause size={14} /> : <Play size={14} />}
                    </IconButton>
                  </div>
                )
              })}
            </div>
          </Card>
        )}
        {selected && <NotablePanel f={selected} compiled={compiled} pts={notable} color={colorOf(selected)} name={nameOf(selected)} highlight={highlight} onHighlight={setHighlight} />}
      </div>

      <div className="flex flex-col gap-4 min-w-0 order-1 @4xl:order-2">
        <Card padded={false} className="relative overflow-hidden h-[clamp(360px,64vh,680px)]">
          <Graph fns={saved.fns} compiled={compiled} env={env} colorOf={colorOf} nameOf={nameOf} selected={selected} viewport={viewport} setViewport={setViewport} pi={saved.pi} highlight={highlight} notable={notable} onSize={setSize} />
          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-[12px] bg-raised/90 border-[0.5px] border-line shadow-[var(--e2)] p-1 backdrop-blur">
            <IconButton label={t('grapher.zoomIn')} size="sm" onClick={() => setViewport((v) => (v ? zoomed(v, 1 / 1.5) : v))}>
              <Plus size={15} />
            </IconButton>
            <IconButton label={t('grapher.zoomOut')} size="sm" onClick={() => setViewport((v) => (v ? zoomed(v, 1.5) : v))}>
              <Minus size={15} />
            </IconButton>
            <IconButton label={t('grapher.reset')} size="sm" onClick={() => setViewport(null)}>
              <Home size={14} />
            </IconButton>
            <button onClick={() => setSaved((s) => ({ ...s, pi: !s.pi }))} className={cx('h-7 px-2 rounded-[8px] text-[13px] font-medium', saved.pi ? 'bg-accent-wash text-accent-text' : 'text-text2 hover:bg-fill1')} title={t('grapher.piTicks')}>
              π
            </button>
          </div>
        </Card>
        <ValueTable fns={saved.fns} compiled={compiled} env={env} colorOf={colorOf} nameOf={nameOf} />
      </div>
    </div>
  )
}

const EXAMPLES: { label: string; kind: FnKind; a: string; b: string }[] = [
  { label: 'sin(x)/x', kind: 'fx', a: 'sin(x)/x', b: '' },
  { label: 'a·x²+b·x', kind: 'fx', a: 'a·x^2 + b·x', b: '' },
  { label: '2^x', kind: 'fx', a: '2^x', b: '' },
  { label: 'ln(x)', kind: 'fx', a: 'ln(x)', b: '' },
  { label: '|x|−2', kind: 'fx', a: '|x| - 2', b: '' },
  { label: 'r = 2sin(3θ)', kind: 'polar', a: '2sin(3θ)', b: '' },
  { label: '(cos 3t, sin 2t)', kind: 'param', a: '3cos(3t)', b: '3sin(2t)' }
]

// MARK: Fila de función

const FnRow = memo(function FnRow({ f, name, color, compiled, selected, comma, onSelect, onChange, onRemove }: {
  f: FnState
  name: string
  color: string
  compiled: Compiled | undefined
  selected: boolean
  comma: boolean
  onSelect: () => void
  onChange: (p: Partial<FnState>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('tools')
  const label = f.kind === 'fx' ? `${name}(x) =` : f.kind === 'polar' ? `r(\\theta) =` : `x(t) =`
  const err = compiled?.error
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={spring.smooth}
      // con el teclado, la fila se elige al entrar en su campo (onFocusCapture); el clic es el atajo del ratón
      onFocusCapture={onSelect}
      onClick={onSelect}
      className={cx('relative isolate px-5 py-2.5 transition-colors', !selected && 'hover:bg-fill1/60')}
    >
      {/* la función elegida: un velo suave de su color que se desliza de una fila a otra (antes, una raya a la izquierda) */}
      {selected && <motion.span layoutId="grapher-mark" transition={spring.snappy} aria-hidden className="absolute inset-x-2 inset-y-1 -z-10 rounded-[12px]" style={{ background: `color-mix(in oklab, ${color} 10%, var(--fill1))` }} />}
      <div className="flex items-start gap-2.5">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onChange({ visible: !f.visible })
          }}
          title={f.visible ? t('grapher.hide') : t('grapher.show')}
          aria-label={f.visible ? t('grapher.hide') : t('grapher.show')}
          aria-pressed={f.visible}
          className="mt-[9px] grid place-items-center w-5 h-5 rounded-full shrink-0"
        >
          <span className="w-3.5 h-3.5 rounded-full transition-all" style={{ background: f.visible ? color : 'transparent', boxShadow: `inset 0 0 0 2px ${color}` }} />
        </button>
        <div className="flex-1 min-w-0">
          <FnInput label={label} value={f.a} onChange={(a) => onChange({ a })} invalid={!!err} />
          {f.kind === 'param' && <FnInput label="y(t) =" value={f.b} onChange={(b) => onChange({ b })} invalid={!!err} className="mt-1.5" />}
          {f.kind !== 'fx' && (
            <div className="mt-1.5 flex items-center gap-1.5 t-caption">
              <span>{f.kind === 'polar' ? 'θ' : 't'} ∈</span>
              <input value={f.t0} onChange={(e) => onChange({ t0: e.target.value })} className="w-14 h-6 rounded-[6px] bg-field border-[0.5px] border-line px-1.5 text-[12px] text-text tabular outline-none focus:border-accent-line" />
              <span>…</span>
              <input value={f.t1} onChange={(e) => onChange({ t1: e.target.value })} className="w-14 h-6 rounded-[6px] bg-field border-[0.5px] border-line px-1.5 text-[12px] text-text tabular outline-none focus:border-accent-line" />
            </div>
          )}
          {err ? (
            <div className="mt-1 t-footnote text-danger">{err.key === 'engine' && err.message ? err.message : t(`grapher.err.${err.key}`)}</div>
          ) : compiled?.tex && !compiled.empty ? (
            <div className="mt-1 text-[13px] text-text3 overflow-x-auto overflow-y-hidden whitespace-nowrap">
              <Tex tex={localizeTex(f.kind === 'fx' && compiled.kind === 'fx' ? `${name}(x) = ${compiled.tex}` : compiled.tex, comma)} />
            </div>
          ) : null}
        </div>
        <Menu
          trigger={(open) => (
            <IconButton label={t('grapher.more')} size="sm" onClick={(e) => (e.stopPropagation(), open())} className="mt-1">
              <MoreHorizontal size={15} />
            </IconButton>
          )}
          items={[
            { label: f.visible ? t('grapher.hide') : t('grapher.show'), icon: f.visible ? <EyeOff size={14} /> : <Eye size={14} />, onSelect: () => onChange({ visible: !f.visible }) },
            { label: t('grapher.kind.fx'), onSelect: () => onChange({ kind: 'fx', t1: '' }), separatorBefore: true, disabled: f.kind === 'fx' },
            { label: t('grapher.kind.param'), onSelect: () => onChange({ kind: 'param', b: f.b || 'sin(t)', a: f.a.includes('t') ? f.a : 'cos(t)', t0: '0', t1: '2π' }), disabled: f.kind === 'param' },
            { label: t('grapher.kind.polar'), onSelect: () => onChange({ kind: 'polar', t0: '0', t1: '2π' }), disabled: f.kind === 'polar' },
            { label: t('grapher.remove'), icon: <Trash2 size={14} />, onSelect: onRemove, danger: true, separatorBefore: true }
          ]}
        />
      </div>
    </motion.div>
  )
})

function FnInput({ label, value, onChange, invalid, className }: { label: string; value: string; onChange: (v: string) => void; invalid?: boolean; className?: string }) {
  return (
    <label className={cx('flex items-center gap-2 h-9 rounded-[10px] bg-field border-[0.5px] px-2.5 transition focus-within:border-accent-line focus-within:shadow-[0_0_0_3px_var(--accent-wash)]', invalid ? 'border-danger/50' : 'border-line-strong/40', className)}>
      <span className="text-[13px] text-text3 shrink-0">
        <Tex tex={label} />
      </span>
      <input value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} autoComplete="off" className="flex-1 min-w-0 bg-transparent outline-none text-[14px] font-mono text-text" />
    </label>
  )
}

// MARK: Curvas

interface Drawn {
  id: string
  key: string
  color: string
  d: string
  pts: Pt[][]
  width: number
  label: { x: number; y: number; text: string } | null
  vertical: number | null
}

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

function pathOf(segs: Pt[][], v: Viewport, w: number, h: number): string {
  let d = ''
  for (const seg of segs) {
    seg.forEach((p, i) => {
      const [sx, sy] = toScreen(v, w, h, p[0], p[1])
      const y = Math.max(-1e4, Math.min(1e4, sy))
      d += `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)} ${y.toFixed(1)}`
    })
  }
  return d
}

function curvesFor(fns: FnState[], compiled: Map<string, Compiled>, env: Env, v: Viewport, w: number, h: number, colorOf: (f: FnState) => string, nameOf: (f: FnState) => string, selected: FnState | null): Drawn[] {
  const r = rangeOf(v, w, h)
  const out: Drawn[] = []
  for (const f of fns) {
    const c = compiled.get(f.id)
    if (!f.visible || !c || c.error || c.empty) continue
    const width = selected?.id === f.id ? 2.8 : 2.2
    const key = `${f.id}-${f.kind}-${f.a}-${f.b}`
    if (c.kind === 'vertical') {
      const x = toClosure(c.exprs[0])(env)
      if (Number.isFinite(x)) out.push({ id: f.id, key, color: colorOf(f), d: '', pts: [], width, label: null, vertical: x })
      continue
    }
    let segs: Pt[][]
    if (c.kind === 'fx') {
      const g = toClosure(c.exprs[0])
      const e: Env = { ...env, x: 0 }
      segs = sampleFx((x) => ((e.x = x), g(e)), r, Math.max(200, Math.round(w)))
    } else {
      const [t0, t1] = tRange(f)
      const e: Env = { ...env, t: 0, θ: 0 }
      if (c.kind === 'param') {
        const fx = toClosure(c.exprs[0])
        const fy = toClosure(c.exprs[1])
        segs = sampleParam((t) => ((e.t = t), fx(e)), (t) => ((e.t = t), fy(e)), t0, t1, 1200, r)
      } else {
        const fr = toClosure(c.exprs[0])
        const rad = (t: number) => ((e.t = t), (e.θ = t), fr(e))
        segs = sampleParam((t) => rad(t) * Math.cos(t), (t) => rad(t) * Math.sin(t), t0, t1, 1200, r)
      }
    }
    // etiqueta con el nombre cerca del borde derecho (o al final de la curva)
    let label: Drawn['label'] = null
    const inView = segs.flat().filter((p) => p[0] >= r.xMin && p[0] <= r.xMax && p[1] >= r.yMin && p[1] <= r.yMax)
    if (inView.length) {
      const p = c.kind === 'fx' ? inView[Math.floor(inView.length * 0.88)] : inView[inView.length - 1]
      const [sx, sy] = toScreen(v, w, h, p[0], p[1])
      label = { x: Math.min(w - 18, sx + 6), y: Math.max(14, sy - 8), text: nameOf(f) }
    }
    out.push({ id: f.id, key, color: colorOf(f), d: pathOf(segs, v, w, h), pts: segs, width, label, vertical: null })
  }
  return out
}

// MARK: Gráfica

function Graph({ fns, compiled, env, colorOf, nameOf, selected, viewport, setViewport, pi, highlight, notable, onSize }: {
  fns: FnState[]
  compiled: Map<string, Compiled>
  env: Env
  colorOf: (f: FnState) => string
  nameOf: (f: FnState) => string
  selected: FnState | null
  viewport: Viewport | null
  setViewport: (fn: (v: Viewport | null) => Viewport | null) => void
  pi: boolean
  highlight: string | null
  notable: Notable[]
  onSize: (s: { w: number; h: number }) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { w, h } = useSize(ref)
  useEffect(() => {
    if (w && h) onSize({ w, h })
  }, [w, h, onSize])
  const comma = useComma()
  const v = viewport ?? defaultViewport(w || 800)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const [dragging, setDragging] = useState(false)

  // rueda: zoom en el punto del ratón (escucha nativa para poder impedir el desplazamiento de la página)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      setViewport((cur) => {
        const base = cur ?? defaultViewport(rect.width)
        if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) return zoomed(base, Math.exp(e.deltaY * 0.0016), toWorld(base, rect.width, rect.height, px, py))
        return panned(base, -e.deltaX, 0)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setViewport])

  const r = rangeOf(v, w || 1, h || 1)
  const curves = useMemo(() => (w && h ? curvesFor(fns, compiled, env, v, w, h, colorOf, nameOf, selected) : []), [fns, compiled, env, v, w, h, colorOf, nameOf, selected])

  // rastreo: punto de la función elegida bajo el cursor
  const trace = useMemo(() => {
    if (!cursor || dragging || !selected || !w) return null
    const c = compiled.get(selected.id)
    if (!c || c.error || c.empty || !selected.visible || c.kind === 'vertical') return null
    if (c.kind === 'fx') {
      const x = cursor[0]
      const y = toClosure(c.exprs[0])({ ...env, x })
      return Number.isFinite(y) ? ([x, y] as Pt) : null
    }
    const drawn = curves.find((d) => d.id === selected.id)
    let best: Pt | null = null
    let bd = Infinity
    for (const seg of drawn?.pts ?? []) for (const p of seg) {
      const dd = (p[0] - cursor[0]) ** 2 / v.ux ** 2 + (p[1] - cursor[1]) ** 2 / v.uy ** 2
      if (dd < bd) {
        bd = dd
        best = p
      }
    }
    return best && bd < 60 ** 2 ? best : null
  }, [cursor, dragging, selected, compiled, env, curves, v, w])

  const xTicks = useMemo(() => {
    if (!pi) return niceTicks(r.xMin, r.xMax, Math.max(4, w / 90)).map((x) => ({ x, label: formatNumber(x, { comma, sig: 6 }) }))
    const span = (r.xMax - r.xMin) / Math.PI
    const den = span < 3 ? 4 : span < 8 ? 2 : 1
    const mult = span > 24 ? Math.ceil(span / 12) : 1
    const step = (Math.PI / den) * mult
    const out: { x: number; label: string }[] = []
    for (let k = Math.ceil(r.xMin / step); k * step <= r.xMax && out.length < 60; k++) {
      const n = k * mult
      const g = gcdInt(Math.abs(n), den)
      const num = n / g
      const d = den / g
      const label = num === 0 ? '0' : `${num === 1 ? '' : num === -1 ? '−' : String(num).replace('-', '−')}π${d === 1 ? '' : '/' + d}`
      out.push({ x: k * step, label })
    }
    return out
  }, [pi, r.xMin, r.xMax, w, comma])
  const yTicks = useMemo(() => niceTicks(r.yMin, r.yMax, Math.max(4, h / 80)), [r.yMin, r.yMax, h])
  const minorX = useMemo(() => (pi ? [] : niceTicks(r.xMin, r.xMax, Math.max(4, w / 90) * 5)), [pi, r.xMin, r.xMax, w])
  const minorY = useMemo(() => niceTicks(r.yMin, r.yMax, Math.max(4, h / 80) * 5), [r.yMin, r.yMax, h])
  const [ox, oy] = toScreen(v, w, h, 0, 0)
  const axisY = Math.max(16, Math.min(h - 8, oy + 16))
  const axisX = Math.max(6, Math.min(w - 40, ox + 6))

  return (
    <div
      ref={ref}
      className={cx('absolute inset-0 select-none touch-none', dragging ? 'cursor-grabbing' : 'cursor-crosshair')}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        drag.current = { x: e.clientX, y: e.clientY }
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        setDragging(true)
      }}
      onPointerMove={(e) => {
        const rect = ref.current?.getBoundingClientRect()
        if (!rect) return
        if (drag.current) {
          const dx = e.clientX - drag.current.x
          const dy = e.clientY - drag.current.y
          drag.current = { x: e.clientX, y: e.clientY }
          setViewport((cur) => panned(cur ?? defaultViewport(rect.width), dx, dy))
        } else setCursor(toWorld(v, w, h, e.clientX - rect.left, e.clientY - rect.top))
      }}
      onPointerUp={() => {
        drag.current = null
        setDragging(false)
      }}
      onPointerLeave={() => setCursor(null)}
      onDoubleClick={(e) => {
        const rect = ref.current?.getBoundingClientRect()
        if (!rect) return
        setViewport((cur) => zoomed(cur ?? defaultViewport(rect.width), 1 / 1.8, toWorld(v, w, h, e.clientX - rect.left, e.clientY - rect.top)))
      }}
    >
      {w > 0 && (
        <svg width={w} height={h} className="block">
          {/* cuadrícula */}
          <g stroke="var(--line-soft)" strokeWidth={1}>
            {minorX.map((x) => {
              const sx = toScreen(v, w, h, x, 0)[0]
              return <line key={`mx${x}`} x1={sx} x2={sx} y1={0} y2={h} />
            })}
            {minorY.map((y) => {
              const sy = toScreen(v, w, h, 0, y)[1]
              return <line key={`my${y}`} x1={0} x2={w} y1={sy} y2={sy} />
            })}
          </g>
          <g stroke="var(--line)" strokeWidth={1}>
            {xTicks.map(({ x }) => {
              const sx = toScreen(v, w, h, x, 0)[0]
              return <line key={`x${x}`} x1={sx} x2={sx} y1={0} y2={h} />
            })}
            {yTicks.map((y) => {
              const sy = toScreen(v, w, h, 0, y)[1]
              return <line key={`y${y}`} x1={0} x2={w} y1={sy} y2={sy} />
            })}
          </g>
          {/* ejes */}
          <g stroke="var(--text3)" strokeWidth={1.25} opacity={0.75}>
            {oy >= 0 && oy <= h && <line x1={0} x2={w} y1={oy} y2={oy} />}
            {ox >= 0 && ox <= w && <line x1={ox} x2={ox} y1={0} y2={h} />}
          </g>
          <g className="tabular" fontSize={11} fill="var(--text3)">
            {xTicks.map(({ x, label }) =>
              Math.abs(x) < 1e-12 ? null : (
                <text key={`tx${x}`} x={toScreen(v, w, h, x, 0)[0]} y={axisY} textAnchor="middle">
                  {label}
                </text>
              )
            )}
            {yTicks.map((y) =>
              Math.abs(y) < 1e-12 ? null : (
                <text key={`ty${y}`} x={axisX} y={toScreen(v, w, h, 0, y)[1] - 4}>
                  {formatNumber(y, { comma, sig: 6 })}
                </text>
              )
            )}
          </g>
          {/* curvas */}
          {curves.map((c) =>
            c.vertical !== null ? (
              <motion.line key={c.key} x1={toScreen(v, w, h, c.vertical, 0)[0]} x2={toScreen(v, w, h, c.vertical, 0)[0]} y1={0} y2={h} stroke={c.color} strokeWidth={c.width} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7 }} />
            ) : (
              <motion.path key={c.key} d={c.d} fill="none" stroke={c.color} strokeWidth={c.width} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0, opacity: 0.4 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 1.1, ease: [0.3, 0.6, 0.2, 1] }} />
            )
          )}
          {curves.map((c) =>
            c.label ? (
              <motion.text key={`l${c.key}`} x={c.label.x} y={c.label.y} fill={c.color} fontSize={14} fontStyle="italic" fontFamily="var(--font-serif)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}>
                {c.label.text}
              </motion.text>
            ) : null
          )}
          {/* puntos notables */}
          {selected &&
            notable.map((p) => {
              const [sx, sy] = toScreen(v, w, h, p.x, p.y)
              if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) return null
              const on = highlight === p.id
              const color = colorOf(selected)
              return (
                <g key={p.id}>
                  <motion.circle cx={sx} cy={sy} r={on ? 6 : 4.5} fill={on ? color : 'var(--surface)'} stroke={color} strokeWidth={2} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring.bouncy} />
                  {on && <CoordLabel x={sx} y={sy} w={w} text={coordText(p.x, p.y, comma)} />}
                </g>
              )
            })}
          {/* rastreo */}
          {trace && selected && (
            <g pointerEvents="none">
              {(() => {
                const [sx, sy] = toScreen(v, w, h, trace[0], trace[1])
                const color = colorOf(selected)
                return (
                  <>
                    <line x1={sx} x2={sx} y1={0} y2={h} stroke={color} strokeOpacity={0.35} strokeDasharray="4 4" />
                    <line x1={0} x2={w} y1={sy} y2={sy} stroke={color} strokeOpacity={0.2} strokeDasharray="4 4" />
                    <circle cx={sx} cy={sy} r={5.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
                    <CoordLabel x={sx} y={sy} w={w} text={coordText(trace[0], trace[1], comma, false)} />
                  </>
                )
              })()}
            </g>
          )}
        </svg>
      )}
    </div>
  )
}

const gcdInt = (a: number, b: number): number => (b === 0 ? a || 1 : gcdInt(b, a % b))

function coordText(x: number, y: number, comma: boolean, precise = true): string {
  const sep = comma ? '; ' : ', '
  if (!precise) return `(${formatNumber(x, { comma, sig: 4, maxDecimals: 3 })}${sep}${formatNumber(y, { comma, sig: 4, maxDecimals: 3 })})`
  return `(${niceValue(x, comma).plain}${sep}${niceValue(y, comma).plain})`
}

function CoordLabel({ x, y, w, text }: { x: number; y: number; w: number; text: string }) {
  const width = text.length * 7 + 16
  const left = x + 12 + width > w ? x - 12 - width : x + 12
  return (
    <g>
      <rect x={left} y={y - 30} width={width} height={22} rx={8} fill="var(--raised)" stroke="var(--line)" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.12))' }} />
      <text x={left + width / 2} y={y - 15} textAnchor="middle" fontSize={12} fill="var(--text)" className="tabular" fontWeight={500}>
        {text}
      </text>
    </g>
  )
}

// MARK: Puntos notables

function useNotable(selected: FnState | null, fns: FnState[], compiled: Map<string, Compiled>, env: Env, range: Range, nameOf: (f: FnState) => string): Notable[] {
  return useMemo(() => {
    if (!selected || !selected.visible) return []
    const c = compiled.get(selected.id)
    if (!c || c.kind !== 'fx' || c.error || c.empty) return []
    const e: Env = { ...env, x: 0 }
    const g = toClosure(c.exprs[0])
    const f = (x: number) => ((e.x = x), g(e))
    let df: ((x: number) => number) | null = null
    try {
      const d = derivative(c.exprs[0], 'x')
      if (d) {
        const dg = toClosure(d)
        const e2: Env = { ...env, x: 0 }
        df = (x) => ((e2.x = x), dg(e2))
      }
    } catch {
      df = null
    }
    const others = fns
      .filter((o) => o.id !== selected.id && o.visible && compiled.get(o.id)?.kind === 'fx' && !compiled.get(o.id)?.error)
      .map((o) => {
        const oc = toClosure((compiled.get(o.id) as Compiled).exprs[0])
        const e3: Env = { ...env, x: 0 }
        return { name: nameOf(o), g: (x: number) => ((e3.x = x), oc(e3)) }
      })
    return notablePoints(f, df, others, range)
  }, [selected, fns, compiled, env, range.xMin, range.xMax, range.yMin, range.yMax, nameOf]) // eslint-disable-line react-hooks/exhaustive-deps
}

function NotablePanel({ f, compiled, pts, color, name, highlight, onHighlight }: {
  f: FnState
  compiled: Map<string, Compiled>
  pts: Notable[]
  color: string
  name: string
  highlight: string | null
  onHighlight: (id: string | null) => void
}) {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const copy = useCopy()
  const c = compiled.get(f.id)
  if (!c || c.kind !== 'fx' || c.error || c.empty) return null
  const icon = (k: Notable['kind']): ReactNode => {
    const s = { stroke: color, strokeWidth: 1.8, fill: 'none' }
    if (k === 'root') return <circle cx={7} cy={7} r={4} {...s} />
    if (k === 'maximum') return <path d="M2 10 L7 3 L12 10" {...s} />
    if (k === 'minimum') return <path d="M2 4 L7 11 L12 4" {...s} />
    if (k === 'intersection') return <path d="M3 3 L11 11 M11 3 L3 11" {...s} />
    return <path d="M7 2 V12 M4 7 H10" {...s} />
  }
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="px-5 pt-4">
        <CardTitle title={t('grapher.notable', { name })} detail={pts.length ? t('grapher.notableHint') : t('grapher.notableNone')} />
      </div>
      <div className="pb-2">
        {pts.map((p, i) => {
          const x = niceValue(p.x, comma)
          const y = niceValue(p.y, comma)
          return (
            <motion.button
              key={p.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onMouseEnter={() => onHighlight(p.id)}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => onHighlight(p.id)}
              onBlur={() => onHighlight(null)}
              onClick={() => copy(p.kind === 'root' ? `x = ${x.plain}` : `(${x.plain}${comma ? '; ' : ', '}${y.plain})`)}
              className={cx('w-full flex items-center gap-3 px-5 h-11 text-left border-t-[0.5px] border-line-soft first:border-t-0 transition-colors', highlight === p.id ? 'bg-fill2' : 'hover:bg-fill1')}
            >
              <svg width={14} height={14} className="shrink-0">
                {icon(p.kind)}
              </svg>
              <span className="flex-1 min-w-0 truncate t-callout text-text2">{p.kind === 'intersection' ? t('grapher.nk.intersection', { name: p.other }) : t(`grapher.nk.${p.kind}`)}</span>
              <span className="text-[14px] text-text whitespace-nowrap">
                <Tex tex={p.kind === 'root' ? `x = ${x.tex}` : `\\left(${x.tex}${comma ? ';\\,' : ',\\,'}${y.tex}\\right)`} />
              </span>
            </motion.button>
          )
        })}
      </div>
    </Card>
  )
}

// MARK: Tabla de valores

function ValueTable({ fns, compiled, env, colorOf, nameOf }: { fns: FnState[]; compiled: Map<string, Compiled>; env: Env; colorOf: (f: FnState) => string; nameOf: (f: FnState) => string }) {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const [start, setStart] = useState('-3')
  const [step, setStep] = useState('1')
  const x0 = parseNumber(start) ?? 0
  const dx = parseNumber(step) ?? 1
  const cols = fns.filter((f) => f.visible && compiled.get(f.id)?.kind === 'fx' && !compiled.get(f.id)?.error)
  const closures = cols.map((f) => toClosure((compiled.get(f.id) as Compiled).exprs[0]))
  const xs = Array.from({ length: 9 }, (_, i) => x0 + i * dx)
  if (!cols.length) return null
  return (
    <Card padded>
      <CardTitle
        title={t('grapher.table')}
        actions={
          <div className="flex items-center gap-2">
            <NumField compact value={start} onChange={(s) => setStart(s)} ariaLabel={t('grapher.tableStart')} className="w-24" unit="x₀" />
            <NumField compact value={step} onChange={(s) => setStep(s)} ariaLabel={t('grapher.tableStep')} className="w-24" unit="Δx" />
          </div>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] tabular">
          <thead>
            <tr className="text-text3">
              <th className="text-left font-medium py-1.5 pr-4">x</th>
              {cols.map((f) => (
                <th key={f.id} className="text-right font-medium py-1.5 px-3" style={{ color: colorOf(f) }}>
                  <Tex tex={`${nameOf(f)}(x)`} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {xs.map((x, i) => (
              <tr key={i} className="border-t-[0.5px] border-line-soft">
                <td className="py-1.5 pr-4 text-text2">{formatNumber(x, { comma, sig: 6 })}</td>
                {closures.map((g, j) => {
                  const y = g({ ...env, x })
                  return (
                    <td key={j} className="py-1.5 px-3 text-right text-text">
                      {Number.isFinite(y) ? formatNumber(y, { comma, sig: 6 }) : <span className="text-text3">—</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

