// Péndulo: integración no lineal (RK4) con rozamiento opcional, estela del recorrido y, si se quiere, el «fantasma» de
// la aproximación de ángulos pequeños para ver cuándo deja de valer.
import { useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Slider, Switch } from '@renderer/design'
import { formatNumber, percentSign } from '../../shared/lib/num'
import { KV, useComma, useElementSize, useStored } from '../../shared/ui'
import { pendulumDeriv, pendulumPeriod, rk4 } from '../lib/physics'
import { LiveGraph, PlayControls, SimShell, useLoop, usePhysicsColors, type Series } from '../parts'

const deg = (r: number) => (r * 180) / Math.PI

export default function PendulumSim() {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const colors = usePhysicsColors()
  const [p, setP] = useStored('aula.tools.physics.pendulum', { L: 1.5, theta0: 35, g: 9.8, b: 0.05, ghost: true })
  const [running, setRunning] = useState(true)
  const simRef = useRef({ t: 0, y: [(p.theta0 * Math.PI) / 180, 0] })
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  const setState = (v: { t: number; y: number[] }) => {
    simRef.current = v
    redraw()
  }
  const state = simRef.current
  const hist = useRef<{ th: [number, number][]; lin: [number, number][]; trail: [number, number][] }>({ th: [], lin: [], trail: [] })
  const [ref, { w, h }] = useElementSize<HTMLDivElement>()
  const per = pendulumPeriod(p.L, p.g, p.theta0)
  const w0 = Math.sqrt(p.g / p.L)

  useLoop(running, (dt) => {
    {
      const s = simRef.current
      const f = pendulumDeriv(p.g, p.L, p.b)
      let y = s.y
      const n = 4
      for (let i = 0; i < n; i++) y = rk4(f, y, s.t, dt / n)
      const nt = s.t + dt
      const H = hist.current
      H.th.push([nt, deg(y[0])])
      H.lin.push([nt, p.theta0 * Math.cos(w0 * nt) * Math.exp((-p.b * nt) / 2)])
      H.trail.push([y[0], nt])
      if (H.th.length > 1500) {
        H.th.splice(0, 300)
        H.lin.splice(0, 300)
      }
      if (H.trail.length > 60) H.trail.splice(0, H.trail.length - 60)
      setState({ t: nt, y })
    }
  })

  const reset = (patch: Partial<typeof p> = {}) => {
    const np = { ...p, ...patch }
    setP(np)
    setState({ t: 0, y: [(np.theta0 * Math.PI) / 180, 0] })
    hist.current = { th: [], lin: [], trail: [] }
  }

  const px = w && h ? Math.min(h - 80, w / 2 - 30) / Math.max(1.6, p.L) : 1
  const cx = w / 2
  const cy = 34
  const len = p.L * px
  const th = state.y[0]
  const bx = cx + len * Math.sin(th)
  const by = cy + len * Math.cos(th)
  const lin = ((p.theta0 * Math.cos(w0 * state.t) * Math.exp((-p.b * state.t) / 2)) * Math.PI) / 180
  const f = (x: number, u: string, sig = 3) => `${formatNumber(x, { comma, sig, maxDecimals: 3 })} ${u}`
  const series: Series[] = [{ color: colors.main, label: t('physics.thetaReal'), points: hist.current.th }]
  if (p.ghost) series.push({ color: colors.muted, label: t('physics.thetaSmall'), points: hist.current.lin })
  const vmax = Math.sqrt(2 * p.g * p.L * (1 - Math.cos((p.theta0 * Math.PI) / 180)))

  return (
    <SimShell
      stage={
        <div ref={ref} className="absolute inset-0">
          {w > 0 && (
            <svg width={w} height={h}>
              <rect x={cx - 60} y={cy - 10} width={120} height={6} rx={2} fill="var(--fill4)" />
              <line x1={cx} x2={cx} y1={cy} y2={cy + len + 30} stroke="var(--line)" strokeDasharray="3 5" />
              {/* estela */}
              {hist.current.trail.map(([a], i, arr) => (
                <circle key={i} cx={cx + len * Math.sin(a)} cy={cy + len * Math.cos(a)} r={3} fill="var(--accent)" opacity={(i / arr.length) * 0.25} />
              ))}
              {p.ghost && (
                <g opacity={0.35}>
                  <line x1={cx} y1={cy} x2={cx + len * Math.sin(lin)} y2={cy + len * Math.cos(lin)} stroke="var(--text3)" strokeWidth={1.5} strokeDasharray="4 4" />
                  <circle cx={cx + len * Math.sin(lin)} cy={cy + len * Math.cos(lin)} r={14} fill="none" stroke="var(--text3)" strokeWidth={1.5} strokeDasharray="4 3" />
                </g>
              )}
              {/* ángulo */}
              <path d={`M${cx} ${cy + 42} A42 42 0 0 ${th > 0 ? 0 : 1} ${cx + 42 * Math.sin(th)} ${cy + 42 * Math.cos(th)}`} fill="none" stroke="var(--accent)" strokeOpacity={0.7} />
              <text x={cx + (th > 0 ? -1 : 1) * 10 + 56 * Math.sin(th / 2)} y={cy + 62} textAnchor="middle" fontSize={11} fill="var(--accent-text)" className="tabular">
                {formatNumber(deg(th), { comma, sig: 3, maxDecimals: 1 })}°
              </text>
              <line x1={cx} y1={cy} x2={bx} y2={by} stroke="var(--text)" strokeWidth={2} />
              <circle cx={cx} cy={cy} r={4} fill="var(--text)" />
              <circle cx={bx} cy={by} r={14} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
              <circle cx={bx - 4} cy={by - 4} r={3.5} fill="#fff" opacity={0.35} />
              <text x={w - 14} y={22} textAnchor="end" fontSize={12} fill="var(--text3)" className="tabular">
                t = {formatNumber(state.t, { comma, sig: 4, maxDecimals: 1 })} s
              </text>
            </svg>
          )}
        </div>
      }
      controls={<PlayControls running={running} onToggle={() => setRunning((r) => !r)} onReset={() => reset()} />}
      settings={
        <>
          <Slider label={t('physics.length')} min={0.2} max={3} step={0.05} value={p.L} onChange={(L) => reset({ L })} format={(v) => f(v, 'm')} />
          <Slider label={t('physics.amplitude')} min={2} max={170} step={1} value={p.theta0} onChange={(theta0) => reset({ theta0 })} format={(v) => `${v}°`} />
          <Slider label={t('physics.gravity')} min={1} max={25} step={0.1} value={p.g} onChange={(g) => reset({ g })} format={(v) => f(v, 'm/s²')} />
          <Slider label={t('physics.damping')} min={0} max={1} step={0.01} value={p.b} onChange={(b) => setP((x) => ({ ...x, b }))} format={(v) => f(v, 's⁻¹')} />
          <label className="flex items-center justify-between gap-3 t-ui text-text2">
            {t('physics.compareSmall')}
            <Switch size="sm" checked={p.ghost} onChange={(ghost) => setP((x) => ({ ...x, ghost }))} label={t('physics.compareSmall')} />
          </label>
        </>
      }
      readouts={
        <>
          <KV k={t('physics.periodExact')} v={f(per.exact, 's', 4)} />
          <KV k={t('physics.periodSmall')} v={f(per.small, 's', 4)} hint="T = 2π√(L/g)" />
          <KV k={t('physics.vmax')} v={f(vmax, 'm/s')} />
          <KV k={t('physics.error')} v={`${formatNumber(((per.exact - per.small) / per.exact) * 100, { comma, sig: 2, maxDecimals: 1 })}${percentSign(comma)}`} hint={t('physics.errorHint')} />
        </>
      }
      graphTitle={t('physics.angleGraph')}
      graph={<LiveGraph series={series} window={10} yRange={[-p.theta0 * 1.1, p.theta0 * 1.1]} />}
    />
  )
}
