// Tiro parabólico: un cañoncito pixel-art dispara; la bola deja su estela, se marca la altura máxima y el alcance, y
// los tiros anteriores quedan como fantasmas para comparar ángulos.
import { useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Slider } from '@renderer/design'
import { Tex } from '../../shared/Tex'
import { formatNumber } from '../../shared/lib/num'
import { KV, useComma, useElementSize, useStored } from '../../shared/ui'
import { projectile } from '../lib/physics'
import { LiveGraph, PlayControls, SimShell, useLoop, usePhysicsColors, type Series } from '../parts'

export default function ProjectileSim() {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const colors = usePhysicsColors()
  const [p, setP] = useStored('aula.tools.physics.projectile', { v0: 18, angle: 50, g: 9.8, h0: 0 })
  const [running, setRunning] = useState(false)
  const timeRef = useRef(0)
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  const setTime = (v: number) => {
    timeRef.current = v
    redraw()
  }
  const time = timeRef.current
  const [ghosts, setGhosts] = useState<{ v0: number; angle: number; g: number; h0: number }[]>([])
  const hist = useRef<{ y: [number, number][]; v: [number, number][] }>({ y: [], v: [] })
  const traj = useMemo(() => projectile(p.v0, p.angle, p.g, p.h0), [p])
  const [ref, { w, h }] = useElementSize<HTMLDivElement>()

  useLoop(running, (dt) => {
    const nt = Math.min(traj.flightTime, timeRef.current + dt)
    const s = traj.at(nt)
    hist.current.y.push([nt, s.y])
    hist.current.v.push([nt, Math.hypot(s.vx, s.vy)])
    if (nt >= traj.flightTime) setRunning(false)
    setTime(nt)
  })

  const launch = () => {
    if (running) return setRunning(false)
    if (time >= traj.flightTime || time === 0) {
      if (time > 0) setGhosts((g) => [...g.slice(-2), p])
      setTime(0)
      hist.current = { y: [], v: [] }
    }
    setRunning(true)
  }
  const reset = () => {
    setRunning(false)
    setTime(0)
    setGhosts([])
    hist.current = { y: [], v: [] }
  }
  const set = (patch: Partial<typeof p>) => {
    setP((x) => ({ ...x, ...patch }))
    if (!running) {
      setTime(0)
      hist.current = { y: [], v: [] }
    }
  }

  // escala: que quepan el tiro actual y los fantasmas, con la misma escala en x e y
  const all = [p, ...ghosts].map((g) => projectile(g.v0, g.angle, g.g, g.h0))
  const xMax = Math.max(10, ...all.map((a) => a.range)) * 1.1
  const yMax = Math.max(5, ...all.map((a) => a.maxHeight)) * 1.2
  const pad = 36
  const k = w && h ? Math.min((w - 2 * pad) / xMax, (h - 2 * pad - 20) / yMax) : 1
  const X = (x: number) => pad + x * k
  const Y = (y: number) => h - pad - y * k
  const path = (pr: ReturnType<typeof projectile>, tEnd: number) => {
    const n = 80
    let d = ''
    for (let i = 0; i <= n; i++) {
      const s = pr.at((tEnd * i) / n)
      d += `${i ? 'L' : 'M'}${X(s.x).toFixed(1)} ${Y(s.y).toFixed(1)}`
    }
    return d
  }
  const now = traj.at(time)
  const f = (x: number, u: string) => `${formatNumber(x, { comma, sig: 3, maxDecimals: 2 })} ${u}`
  const series: Series[] = [
    { color: colors.main, label: t('physics.height'), points: hist.current.y },
    { color: colors.second, label: t('physics.speed'), points: hist.current.v }
  ]
  // previsión del tiro antes de lanzarlo, para que la gráfica no salga vacía
  const preview = useMemo<Series[]>(() => {
    const ts = Array.from({ length: 61 }, (_, i) => (traj.flightTime * i) / 60)
    return [
      { color: colors.main, label: t('physics.height'), points: ts.map((x) => [x, traj.at(x).y]) },
      { color: colors.second, label: t('physics.speed'), points: ts.map((x) => [x, Math.hypot(traj.at(x).vx, traj.at(x).vy)]) }
    ]
  }, [traj, colors.main, colors.second, t])
  const done = time >= traj.flightTime - 1e-9 && time > 0

  return (
    <SimShell
      stage={
        <div ref={ref} className="absolute inset-0">
          {w > 0 && (
            <svg width={w} height={h}>
              {/* suelo */}
              <line x1={0} x2={w} y1={Y(0)} y2={Y(0)} stroke="var(--line-strong)" strokeOpacity={0.6} />
              {Array.from({ length: Math.ceil(w / 14) }, (_, i) => (
                <rect key={i} x={i * 14 + 3} y={Y(0) + 3 + (i % 3)} width={4} height={3} fill="var(--fill4)" />
              ))}
              {ghosts.map((g, i) => {
                const pr = projectile(g.v0, g.angle, g.g, g.h0)
                return <path key={i} d={path(pr, pr.flightTime)} fill="none" stroke="var(--text3)" strokeOpacity={0.35 + i * 0.1} strokeDasharray="3 5" />
              })}
              <path d={path(traj, traj.flightTime)} fill="none" stroke="var(--accent)" strokeOpacity={0.25} strokeDasharray="5 6" />
              {time > 0 && <path d={path(traj, time)} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" />}
              {/* altura máxima y alcance */}
              {time >= traj.peakTime && traj.peakTime > 0 && (
                <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <line x1={X(traj.at(traj.peakTime).x)} x2={X(traj.at(traj.peakTime).x)} y1={Y(traj.maxHeight)} y2={Y(0)} stroke="var(--text3)" strokeDasharray="2 4" />
                  <text x={X(traj.at(traj.peakTime).x)} y={Y(traj.maxHeight) - 10} textAnchor="middle" fontSize={11} fill="var(--text2)">
                    hₘₐₓ = {f(traj.maxHeight, 'm')}
                  </text>
                </motion.g>
              )}
              {done && (
                <motion.g initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  <line x1={X(0)} x2={X(traj.range)} y1={Y(0) + 16} y2={Y(0) + 16} stroke="var(--accent-text)" />
                  <text x={X(traj.range / 2)} y={Y(0) + 30} textAnchor="middle" fontSize={11} fill="var(--accent-text)">
                    {t('physics.range')} {f(traj.range, 'm')}
                  </text>
                </motion.g>
              )}
              {/* cañoncito pixel-art */}
              <g transform={`translate(${X(0)} ${Y(p.h0)})`}>
                {p.h0 > 0 && <rect x={-10} y={0} width={20} height={p.h0 * k} fill="var(--fill3)" />}
                <g transform={`rotate(${-p.angle})`}>
                  <rect x={-2} y={-5} width={22} height={10} rx={1} fill="var(--text2)" />
                  <rect x={18} y={-6} width={4} height={12} fill="var(--text)" />
                </g>
                <rect x={-9} y={-2} width={18} height={8} fill="var(--text)" />
                <rect x={-7} y={5} width={5} height={5} fill="var(--text3)" />
                <rect x={2} y={5} width={5} height={5} fill="var(--text3)" />
              </g>
              {/* bola y su velocidad */}
              {(time > 0 || running) && (
                <g>
                  <line x1={X(now.x)} y1={Y(now.y)} x2={X(now.x) + now.vx * 2.2} y2={Y(now.y) - now.vy * 2.2} stroke={colors.second} strokeWidth={2} markerEnd="url(#arrow)" />
                  <circle cx={X(now.x)} cy={Y(now.y)} r={7} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
                </g>
              )}
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" fill={colors.second} />
                </marker>
              </defs>
              <text x={w - 14} y={22} textAnchor="end" fontSize={12} fill="var(--text3)" className="tabular">
                t = {formatNumber(time, { comma, sig: 3, maxDecimals: 2 })} s
              </text>
            </svg>
          )}
        </div>
      }
      controls={<PlayControls running={running} onToggle={launch} onReset={reset} label={t('physics.launch')} />}
      settings={
        <>
          <Slider label={t('physics.v0')} min={1} max={40} step={0.5} value={p.v0} onChange={(v0) => set({ v0 })} format={(v) => f(v, 'm/s')} />
          <Slider label={t('physics.angle')} min={0} max={90} step={1} value={p.angle} onChange={(angle) => set({ angle })} format={(v) => `${v}°`} />
          <Slider label={t('physics.h0')} min={0} max={40} step={1} value={p.h0} onChange={(h0) => set({ h0 })} format={(v) => f(v, 'm')} />
          <Slider label={t('physics.gravity')} min={1} max={25} step={0.1} value={p.g} onChange={(g) => set({ g })} format={(v) => f(v, 'm/s²')} />
        </>
      }
      readouts={
        <>
          <KV k={t('physics.range')} v={f(traj.range, 'm')} />
          <KV k={t('physics.maxHeight')} v={f(traj.maxHeight, 'm')} />
          <KV k={t('physics.flightTime')} v={f(traj.flightTime, 's')} />
          <KV k={t('physics.components')} v={`${formatNumber(traj.vx, { comma, sig: 3 })} · ${formatNumber(traj.vy0, { comma, sig: 3 })}`} hint={<><Tex tex="v_{0x} \cdot v_{0y}" className="text-[1.15em]" /> {t('physics.componentsUnit')}</>} />
        </>
      }
      graphTitle={t('physics.liveGraph')}
      graph={<LiveGraph series={series} preview={preview} window={Math.max(2, Math.ceil(traj.flightTime))} />}
    />
  )
}
