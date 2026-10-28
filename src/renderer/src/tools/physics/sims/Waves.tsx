// Ondas: una onda armónica viaja por la cuerda; con «reflejada» se suma la que vuelve y aparece la onda estacionaria con
// sus nodos quietos. Un punto marcado sube y baja (no avanza): la gráfica muestra su movimiento.
import { useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Slider, Switch } from '@renderer/design'
import { formatNumber } from '../../shared/lib/num'
import { KV, useComma, useElementSize, useStored } from '../../shared/ui'
import { waveInfo, waveY } from '../lib/physics'
import { LiveGraph, PlayControls, SimShell, useLoop, usePhysicsColors, type Series } from '../parts'

const LENGTH = 8

export default function WavesSim() {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const colors = usePhysicsColors()
  const [p, setP] = useStored('aula.tools.physics.waves', { A: 0.8, lambda: 2.5, f: 0.6, reflected: false })
  const [running, setRunning] = useState(true)
  const timeRef = useRef(0)
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  const setTime = (v: number) => {
    timeRef.current = v
    redraw()
  }
  const time = timeRef.current
  const hist = useRef<[number, number][]>([])
  const [ref, { w, h }] = useElementSize<HTMLDivElement>()
  const info = waveInfo(p.lambda, p.f)
  const probe = 2

  useLoop(running, (dt) => {
    const nt = timeRef.current + dt
    hist.current.push([nt, waveY(probe, nt, p.A, p.lambda, p.f, p.reflected)])
    if (hist.current.length > 1500) hist.current.splice(0, 300)
    setTime(nt)
  })

  const mx = (x: number) => 30 + (x / LENGTH) * (w - 60)
  const amp = (h / 2 - 40) / 2.2
  const my = (y: number) => h / 2 - y * amp
  const N = 240
  const d = (fn: (x: number) => number) => Array.from({ length: N + 1 }, (_, i) => (LENGTH * i) / N).map((x, i) => `${i ? 'L' : 'M'}${mx(x).toFixed(1)} ${my(fn(x)).toFixed(1)}`).join('')
  const k = (2 * Math.PI) / p.lambda
  const nodes = p.reflected ? Array.from({ length: Math.floor(LENGTH / (p.lambda / 2)) + 1 }, (_, i) => (i * p.lambda) / 2).filter((x) => x <= LENGTH) : []
  const f = (v: number, u: string) => `${formatNumber(v, { comma, sig: 3, maxDecimals: 3 })} ${u}`
  const series: Series[] = [{ color: colors.main, label: 'y', points: hist.current }]

  return (
    <SimShell
      stage={
        <div ref={ref} className="absolute inset-0">
          {w > 0 && (
            <svg width={w} height={h}>
              <line x1={mx(0)} x2={mx(LENGTH)} y1={my(0)} y2={my(0)} stroke="var(--line)" strokeDasharray="3 5" />
              {/* λ marcada */}
              <g>
                <line x1={mx(0)} x2={mx(p.lambda)} y1={36} y2={36} stroke="var(--text3)" />
                <line x1={mx(0)} x2={mx(0)} y1={30} y2={42} stroke="var(--text3)" />
                <line x1={mx(p.lambda)} x2={mx(p.lambda)} y1={30} y2={42} stroke="var(--text3)" />
                <text x={(mx(0) + mx(p.lambda)) / 2} y={28} textAnchor="middle" fontSize={12} fill="var(--text2)">
                  λ = {f(p.lambda, 'm')}
                </text>
              </g>
              {p.reflected && (
                <>
                  <path d={d((x) => p.A * Math.sin(k * x - info.omega * time))} fill="none" stroke={colors.second} strokeOpacity={0.35} strokeDasharray="4 4" />
                  <path d={d((x) => p.A * Math.sin(k * x + info.omega * time))} fill="none" stroke={colors.third} strokeOpacity={0.35} strokeDasharray="4 4" />
                </>
              )}
              <path d={d((x) => waveY(x, time, p.A, p.lambda, p.f, p.reflected))} fill="none" stroke="var(--accent)" strokeWidth={2.6} strokeLinecap="round" />
              {nodes.map((x) => (
                <g key={x}>
                  <circle cx={mx(x)} cy={my(0)} r={4} fill="var(--surface)" stroke="var(--text2)" strokeWidth={1.5} />
                </g>
              ))}
              {/* punto que solo sube y baja */}
              <line x1={mx(probe)} x2={mx(probe)} y1={my(2.2 * p.A)} y2={my(-2.2 * p.A)} stroke="var(--line-soft)" />
              <circle cx={mx(probe)} cy={my(waveY(probe, time, p.A, p.lambda, p.f, p.reflected))} r={7} fill={colors.second} stroke="var(--surface)" strokeWidth={2} />
              {nodes.length > 0 && (
                <text x={w - 14} y={h - 16} textAnchor="end" fontSize={11} fill="var(--text3)">
                  ○ {t('physics.nodes')}
                </text>
              )}
            </svg>
          )}
        </div>
      }
      controls={<PlayControls running={running} onToggle={() => setRunning((r) => !r)} onReset={() => ((hist.current = []), setTime(0))} />}
      settings={
        <>
          <Slider label={t('physics.waveAmplitude')} min={0.1} max={1} step={0.05} value={p.A} onChange={(A) => setP((q) => ({ ...q, A }))} format={(v) => f(v, 'm')} />
          <Slider label={t('physics.wavelength')} min={0.5} max={8} step={0.1} value={p.lambda} onChange={(lambda) => setP((q) => ({ ...q, lambda }))} format={(v) => f(v, 'm')} />
          <Slider label={t('physics.frequency')} min={0.1} max={2} step={0.05} value={p.f} onChange={(fr) => setP((q) => ({ ...q, f: fr }))} format={(v) => f(v, 'Hz')} />
          <label className="flex items-center justify-between gap-3 t-ui text-text2">
            {t('physics.reflected')}
            <Switch size="sm" checked={p.reflected} onChange={(reflected) => setP((q) => ({ ...q, reflected }))} label={t('physics.reflected')} />
          </label>
        </>
      }
      readouts={
        <>
          <KV k={t('physics.waveSpeed')} v={f(info.speed, 'm/s')} hint="v = λ·f" />
          <KV k={t('physics.period')} v={f(info.period, 's')} hint="T = 1/f" />
          <KV k={t('physics.waveNumber')} v={f(info.k, 'rad/m')} hint="k = 2π/λ" />
          <KV k={t('physics.angularFreq')} v={f(info.omega, 'rad/s')} hint="ω = 2πf" />
        </>
      }
      graphTitle={t('physics.probeGraph')}
      graph={<LiveGraph series={series} window={8} yRange={[-2.2 * p.A, 2.2 * p.A]} />}
    />
  )
}
