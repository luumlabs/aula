// Masa-muelle: el muelle se estira y encoge (zigzag que cambia de longitud), con barras de energía cinética, potencial
// y total que muestran cómo se intercambian (y cómo se pierde con el rozamiento).
import { useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Slider } from '@renderer/design'
import { formatNumber } from '../../shared/lib/num'
import { KV, useComma, useElementSize, useStored } from '../../shared/ui'
import { rk4, springDeriv, springInfo } from '../lib/physics'
import { LiveGraph, PlayControls, SimShell, useLoop, usePhysicsColors, type Series } from '../parts'

export default function SpringSim() {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const colors = usePhysicsColors()
  const [p, setP] = useStored('aula.tools.physics.spring', { k: 20, m: 1, c: 0.3, x0: 0.5 })
  const [running, setRunning] = useState(true)
  const simRef = useRef({ t: 0, y: [p.x0, 0] })
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  const setSt = (v: { t: number; y: number[] }) => {
    simRef.current = v
    redraw()
  }
  const st = simRef.current
  const hist = useRef<{ x: [number, number][]; v: [number, number][] }>({ x: [], v: [] })
  const [ref, { w, h }] = useElementSize<HTMLDivElement>()
  const info = springInfo(p.k, p.m, p.c)

  useLoop(running, (dt) => {
    {
      const s = simRef.current
      const f = springDeriv(p.k, p.m, p.c)
      let y = s.y
      for (let i = 0; i < 4; i++) y = rk4(f, y, s.t, dt / 4)
      const nt = s.t + dt
      hist.current.x.push([nt, y[0]])
      hist.current.v.push([nt, y[1]])
      if (hist.current.x.length > 1500) {
        hist.current.x.splice(0, 300)
        hist.current.v.splice(0, 300)
      }
      setSt({ t: nt, y })
    }
  })
  const reset = (patch: Partial<typeof p> = {}) => {
    const np = { ...p, ...patch }
    setP(np)
    setSt({ t: 0, y: [np.x0, 0] })
    hist.current = { x: [], v: [] }
  }

  const [x, v] = st.y
  const ke = 0.5 * p.m * v * v
  const pe = 0.5 * p.k * x * x
  const e0 = 0.5 * p.k * p.x0 * p.x0 || 1
  const scale = w ? (w * 0.22) / 1 : 100
  const wallX = 40
  const eqX = w * 0.45
  const bx = eqX + x * scale
  const bw = 44 + Math.cbrt(p.m) * 16
  const floor = h * 0.62
  const coils = 12
  const springPath = (() => {
    const x1 = wallX
    const x2 = bx - bw / 2
    const yy = floor - 26
    let d = `M${x1} ${yy} L${x1 + 10} ${yy}`
    const span = x2 - x1 - 20
    for (let i = 0; i < coils; i++) d += ` L${x1 + 10 + (span * (i + 0.5)) / coils} ${yy + (i % 2 ? 12 : -12)}`
    return d + ` L${x2 - 10} ${yy} L${x2} ${yy}`
  })()
  const f = (val: number, u: string, sig = 3) => `${formatNumber(val, { comma, sig, maxDecimals: 3 })} ${u}`
  const series: Series[] = [
    { color: colors.main, label: 'x (m)', points: hist.current.x },
    { color: colors.second, label: 'v (m/s)', points: hist.current.v }
  ]
  const bar = (label: string, val: number, color: string) => (
    <div className="flex flex-col items-center gap-1 w-10">
      <div className="relative h-24 w-5 rounded-[5px] bg-fill2 overflow-hidden">
        <motion.div className="absolute bottom-0 inset-x-0 rounded-[5px]" style={{ background: color }} animate={{ height: `${Math.min(1, val / e0) * 100}%` }} transition={{ duration: 0.05 }} />
      </div>
      <span className="t-caption">{label}</span>
    </div>
  )

  return (
    <SimShell
      stage={
        <div ref={ref} className="absolute inset-0">
          {w > 0 && (
            <svg width={w} height={h}>
              <rect x={wallX - 14} y={floor - 90} width={14} height={90} fill="var(--fill4)" />
              <line x1={wallX - 14} x2={w} y1={floor} y2={floor} stroke="var(--line-strong)" strokeOpacity={0.6} />
              <line x1={eqX} x2={eqX} y1={floor - 100} y2={floor + 14} stroke="var(--text3)" strokeDasharray="3 5" />
              <text x={eqX} y={floor + 28} textAnchor="middle" fontSize={11} fill="var(--text3)">
                x = 0
              </text>
              <path d={springPath} fill="none" stroke="var(--text2)" strokeWidth={2} strokeLinejoin="round" />
              <rect x={bx - bw / 2} y={floor - 26 - bw / 2} width={bw} height={bw} rx={8} fill="var(--accent)" />
              <text x={bx} y={floor - 22} textAnchor="middle" fontSize={12} fill="var(--on-accent)" fontWeight={600}>
                {formatNumber(p.m, { comma, sig: 2 })} kg
              </text>
              {/* desplazamiento */}
              <line x1={eqX} x2={bx} y1={floor + 46} y2={floor + 46} stroke="var(--accent-text)" strokeWidth={2} />
              <text x={(eqX + bx) / 2} y={floor + 62} textAnchor="middle" fontSize={11} fill="var(--accent-text)" className="tabular">
                x = {formatNumber(x, { comma, sig: 2, maxDecimals: 2 })} m
              </text>
            </svg>
          )}
          <div className="absolute top-4 right-5 flex items-end gap-2 rounded-[14px] bg-raised/80 border-[0.5px] border-line px-3 pt-3 pb-2 backdrop-blur">
            {bar(t('physics.kinetic'), ke, colors.second)}
            {bar(t('physics.potential'), pe, colors.main)}
            {bar(t('physics.total'), ke + pe, colors.third)}
          </div>
        </div>
      }
      controls={<PlayControls running={running} onToggle={() => setRunning((r) => !r)} onReset={() => reset()} />}
      settings={
        <>
          <Slider label={t('physics.k')} min={1} max={100} step={1} value={p.k} onChange={(k) => reset({ k })} format={(val) => f(val, 'N/m')} />
          <Slider label={t('physics.mass')} min={0.1} max={10} step={0.1} value={p.m} onChange={(m) => reset({ m })} format={(val) => f(val, 'kg')} />
          <Slider label={t('physics.x0')} min={-1} max={1} step={0.05} value={p.x0} onChange={(x0) => reset({ x0 })} format={(val) => f(val, 'm')} />
          <Slider label={t('physics.friction')} min={0} max={20} step={0.1} value={p.c} onChange={(c) => setP((q) => ({ ...q, c }))} format={(val) => f(val, 'kg/s')} />
        </>
      }
      readouts={
        <>
          <KV k={t('physics.period')} v={f(info.period, 's', 4)} hint="T = 2π√(m/k)" />
          <KV k="ω₀" v={f(info.omega0, 'rad/s')} />
          <KV k={t('physics.zeta')} v={formatNumber(info.zeta, { comma, sig: 3 })} hint={t(`physics.regime.${info.regime}`)} />
          <KV k={t('physics.energy')} v={f(ke + pe, 'J')} />
        </>
      }
      graphTitle={t('physics.positionGraph')}
      graph={<LiveGraph series={series} window={10} />}
    />
  )
}
