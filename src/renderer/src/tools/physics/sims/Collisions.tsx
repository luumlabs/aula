// Choques en 1D: dos carritos se acercan, chocan (con la elasticidad que elijas) y se separan. Barras de momento y de
// energía antes y después: el momento se conserva siempre; la energía cinética, solo si el choque es elástico.
import { useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Slider, pixelBurst } from '@renderer/design'
import { formatNumber } from '../../shared/lib/num'
import { KV, useComma, useElementSize, useStored } from '../../shared/ui'
import { collide, willCollide } from '../lib/physics'
import { LiveGraph, PlayControls, SimShell, useLoop, usePhysicsColors, type Series } from '../parts'

const TRACK = 7

export default function CollisionsSim() {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const colors = usePhysicsColors()
  const [p, setP] = useStored('aula.tools.physics.collision', { m1: 2, v1: 2.5, m2: 1, v2: -1, e: 1 })
  const [running, setRunning] = useState(false)
  const simRef = useRef({ t: 0, x1: -4, x2: 2, u1: p.v1, u2: p.v2, hit: false })
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  const setSim = (v: typeof simRef.current) => {
    simRef.current = v
    redraw()
  }
  const sim = simRef.current
  const hist = useRef<{ a: [number, number][]; b: [number, number][] }>({ a: [], b: [] })
  const [ref, { w, h }] = useElementSize<HTMLDivElement>()
  const res = useMemo(() => collide(p.m1, p.v1, p.m2, p.v2, p.e), [p])
  const size = (m: number) => 0.6 + Math.cbrt(m) * 0.45
  const hitAt = useRef<HTMLDivElement>(null)

  useLoop(running, (dt) => {
    {
      const s = simRef.current
      let { x1, x2, u1, u2, hit } = s
      x1 += u1 * dt
      x2 += u2 * dt
      const gap = x2 - size(p.m2) / 2 - (x1 + size(p.m1) / 2)
      if (!hit && gap <= 0 && willCollide(u1, u2)) {
        hit = true
        u1 = res.v1
        u2 = res.v2
        if (hitAt.current) {
          const r = hitAt.current.getBoundingClientRect()
          const sx = r.left + 30 + ((x1 + size(p.m1) / 2 + TRACK) / (2 * TRACK)) * (r.width - 60)
          pixelBurst({ x: sx, y: r.top + r.height * 0.55 }, { count: 10 })
        }
      }
      const nt = s.t + dt
      hist.current.a.push([nt, u1])
      hist.current.b.push([nt, u2])
      const out = x1 < -TRACK - 2 || x2 > TRACK + 2 || nt > 12
      if (out) setRunning(false)
      setSim({ t: nt, x1, x2, u1, u2, hit })
    }
  })

  const reset = (patch: Partial<typeof p> = {}) => {
    const np = { ...p, ...patch }
    setP(np)
    setRunning(false)
    setSim({ t: 0, x1: -4, x2: 2, u1: np.v1, u2: np.v2, hit: false })
    hist.current = { a: [], b: [] }
  }
  const toggle = () => {
    if (!running && (sim.t > 0 && (sim.x1 < -TRACK - 2 || sim.x2 > TRACK + 2 || sim.t > 12))) {
      reset()
      setTimeout(() => setRunning(true), 30)
      return
    }
    setRunning((r) => !r)
  }

  const mx = (x: number) => 30 + ((x + TRACK) / (2 * TRACK)) * (w - 60)
  const ppm = (w - 60) / (2 * TRACK)
  const floor = h * 0.62
  const f = (v: number, u: string) => `${formatNumber(v, { comma, sig: 3, maxDecimals: 2 })} ${u}`
  const cart = (x: number, m: number, u: number, color: string, label: string) => {
    const s = size(m) * ppm
    return (
      <g>
        <rect x={mx(x) - s / 2} y={floor - s - 8} width={s} height={s} rx={8} fill={color} />
        <circle cx={mx(x) - s / 4} cy={floor - 5} r={5} fill="var(--text2)" />
        <circle cx={mx(x) + s / 4} cy={floor - 5} r={5} fill="var(--text2)" />
        <text x={mx(x)} y={floor - s / 2 - 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--on-accent)">
          {label}
        </text>
        {Math.abs(u) > 0.02 && (
          <g>
            <line x1={mx(x)} x2={mx(x) + u * 22} y1={floor - s - 22} y2={floor - s - 22} stroke={color} strokeWidth={2.5} markerEnd={`url(#arr-${label})`} />
            <defs>
              <marker id={`arr-${label}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill={color} />
              </marker>
            </defs>
            <text x={mx(x) + u * 11} y={floor - s - 30} textAnchor="middle" fontSize={11} fill="var(--text2)" className="tabular">
              {formatNumber(u, { comma, sig: 2, maxDecimals: 2 })} m/s
            </text>
          </g>
        )}
      </g>
    )
  }
  const bars = (label: string, before: number, after: number, unit: string) => {
    const max = Math.max(Math.abs(before), Math.abs(after), 1e-9)
    return (
      <div className="col-span-2">
        <div className="t-footnote mb-1.5">{label}</div>
        {[
          [t('physics.before'), before],
          [t('physics.after'), after]
        ].map(([k, v]) => (
          <div key={k as string} className="flex items-center gap-2 mb-1">
            <span className="w-14 t-caption">{k}</span>
            <div className="flex-1 h-2 rounded-full bg-fill2 overflow-hidden">
              <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${(Math.abs(v as number) / max) * 100}%` }} transition={{ duration: 0.5 }} />
            </div>
            <span className="w-20 text-right t-ui tabular">{f(v as number, unit)}</span>
          </div>
        ))}
      </div>
    )
  }
  const series: Series[] = [
    { color: colors.main, label: 'v₁ (m/s)', points: hist.current.a },
    { color: colors.second, label: 'v₂ (m/s)', points: hist.current.b }
  ]

  return (
    <SimShell
      stage={
        <div
          ref={(el) => {
            ref.current = el
            hitAt.current = el
          }}
          className="absolute inset-0"
        >
          {w > 0 && (
            <svg width={w} height={h}>
              <line x1={20} x2={w - 20} y1={floor} y2={floor} stroke="var(--line-strong)" strokeOpacity={0.6} strokeWidth={2} />
              {Array.from({ length: 2 * TRACK + 1 }, (_, i) => i - TRACK).map((x) => (
                <line key={x} x1={mx(x)} x2={mx(x)} y1={floor + 4} y2={floor + (x % 5 === 0 ? 12 : 8)} stroke="var(--line)" />
              ))}
              {cart(sim.x1, p.m1, sim.u1, 'var(--accent)', `${formatNumber(p.m1, { comma, sig: 2 })} kg`)}
              {cart(sim.x2, p.m2, sim.u2, colors.second, `${formatNumber(p.m2, { comma, sig: 2 })} kg`)}
              {!willCollide(p.v1, p.v2) && (
                <text x={w / 2} y={36} textAnchor="middle" fontSize={12} fill="var(--warning)">
                  {t('physics.noCollision')}
                </text>
              )}
            </svg>
          )}
        </div>
      }
      controls={<PlayControls running={running} onToggle={toggle} onReset={() => reset()} />}
      settings={
        <>
          <Slider label="m₁" min={0.5} max={10} step={0.5} value={p.m1} onChange={(m1) => reset({ m1 })} format={(v) => f(v, 'kg')} />
          <Slider label="v₁" min={-5} max={5} step={0.1} value={p.v1} onChange={(v1) => reset({ v1 })} format={(v) => f(v, 'm/s')} />
          <Slider label="m₂" min={0.5} max={10} step={0.5} value={p.m2} onChange={(m2) => reset({ m2 })} format={(v) => f(v, 'kg')} />
          <Slider label="v₂" min={-5} max={5} step={0.1} value={p.v2} onChange={(v2) => reset({ v2 })} format={(v) => f(v, 'm/s')} />
          <Slider label={t('physics.elasticity')} min={0} max={1} step={0.05} value={p.e} onChange={(e) => reset({ e })} format={(v) => (v === 1 ? t('physics.elastic') : v === 0 ? t('physics.inelastic') : formatNumber(v, { comma, sig: 2 }))} />
        </>
      }
      readouts={
        <>
          <KV k="v₁′" v={f(res.v1, 'm/s')} />
          <KV k="v₂′" v={f(res.v2, 'm/s')} />
          {bars(t('physics.momentum'), res.pBefore, res.pAfter, 'kg·m/s')}
          {bars(t('physics.kineticEnergy'), res.keBefore, res.keAfter, 'J')}
        </>
      }
      graphTitle={t('physics.velocityGraph')}
      graph={<LiveGraph series={series} window={6} />}
    />
  )
}
