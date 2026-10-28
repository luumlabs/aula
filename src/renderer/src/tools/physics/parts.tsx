// Piezas comunes de las simulaciones: bucle de animación, gráfica en vivo que avanza con el tiempo, controles de
// reproducción y la maqueta de cada simulación (escenario, ajustes y gráfica).
import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { Button, Card, IconButton, useTheme } from '@renderer/design'
import { formatNumber, niceTicks } from '../shared/lib/num'
import { CardTitle, useComma, useElementSize } from '../shared/ui'

/** Llama a `step(dt)` en cada fotograma mientras `running` (dt en segundos, acotado para no dar saltos). */
export function useLoop(running: boolean, step: (dt: number) => void) {
  const ref = useRef(step)
  ref.current = step
  useEffect(() => {
    if (!running) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      ref.current(dt)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running])
}

export interface Series {
  color: string
  label: string
  points: [number, number][]
}

/** Gráfica en vivo: las últimas `window` unidades de tiempo, con la escala vertical fija o automática. Antes de que
 *  haya datos enseña la previsión (`preview`, en trazo discontinuo) o, si no la hay, una frase en vez de ejes vacíos. */
export function LiveGraph({ series, preview, window = 10, yRange, xLabel = 't (s)', height = 170 }: { series: Series[]; preview?: Series[]; window?: number; yRange?: [number, number]; xLabel?: string; height?: number }) {
  const { t } = useTranslation('tools')
  const [ref, { w }] = useElementSize<HTMLDivElement>()
  const comma = useComma()
  const live = series.some((s) => s.points.length > 1)
  const predicted = !live && !!preview?.some((s) => s.points.length > 1)
  const shown = predicted && preview ? preview : series
  const all = shown.flatMap((s) => s.points)
  const tMax = Math.max(window, ...all.map((p) => p[0]))
  const t0 = tMax - window
  const ys = all.filter((p) => p[0] >= t0).map((p) => p[1])
  let [y0, y1] = yRange ?? [Math.min(0, ...ys), Math.max(0, ...ys)]
  if (y1 - y0 < 1e-9) {
    y0 -= 1
    y1 += 1
  }
  const L = 40
  const mx = (t: number) => L + ((t - t0) / window) * (w - L - 6)
  const my = (y: number) => 6 + (1 - (y - y0) / (y1 - y0)) * (height - 28)
  // el contenedor medido está siempre montado (useElementSize mide una vez al montar)
  if (!live && !predicted) {
    return (
      <div ref={ref} className="grid w-full place-items-center rounded-[14px] bg-sunken px-6 text-center t-callout text-text3" style={{ height }}>
        {t('physics.graphEmpty')}
      </div>
    )
  }
  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={height}>
          {niceTicks(y0, y1, 4).map((y) => (
            <g key={y}>
              <line x1={L} x2={w - 6} y1={my(y)} y2={my(y)} stroke={Math.abs(y) < 1e-12 ? 'var(--line)' : 'var(--line-soft)'} />
              <text x={L - 6} y={my(y) + 4} textAnchor="end" fontSize={10} fill="var(--text3)" className="tabular">
                {formatNumber(y, { comma, sig: 3 })}
              </text>
            </g>
          ))}
          {niceTicks(t0, tMax, Math.max(3, w / 90)).filter((t) => mx(t) < w - 44).map((t) => (
            <text key={t} x={mx(t)} y={height - 8} textAnchor="middle" fontSize={10} fill="var(--text3)" className="tabular">
              {formatNumber(t, { comma, sig: 3 })}
            </text>
          ))}
          <text x={w - 6} y={height - 8} textAnchor="end" fontSize={10} fill="var(--text3)">
            {xLabel}
          </text>
          {shown.map((s) => {
            const pts = s.points.filter((p) => p[0] >= t0 - 0.1)
            if (pts.length < 2) return null
            const d = pts.map((p, i) => `${i ? 'L' : 'M'}${mx(p[0]).toFixed(1)} ${my(p[1]).toFixed(1)}`).join('')
            const last = pts[pts.length - 1]
            return predicted ? (
              <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth={1.75} strokeOpacity={0.55} strokeDasharray="4 5" strokeLinejoin="round" />
            ) : (
              <g key={s.label}>
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                <circle cx={mx(last[0])} cy={my(last[1])} r={3.5} fill={s.color} />
              </g>
            )
          })}
        </svg>
      )}
      {(shown.length > 1 || predicted) && (
        <div className="flex flex-wrap gap-4 t-caption mt-1">
          {shown.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span className="w-3 h-[3px] rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
          {predicted && <span className="text-text3">{t('physics.graphPreview')}</span>}
        </div>
      )}
    </div>
  )
}

/** Botones de reproducir / pausar / reiniciar. */
export function PlayControls({ running, onToggle, onReset, label }: { running: boolean; onToggle: () => void; onReset: () => void; label?: string }) {
  const { t } = useTranslation('tools')
  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="primary" icon={running ? <Pause size={13} /> : <Play size={13} />} onClick={onToggle} className="min-w-[96px]">
        {running ? t('common.pause') : (label ?? t('common.play'))}
      </Button>
      <IconButton label={t('common.reset')} size="sm" onClick={onReset}>
        <RotateCcw size={14} />
      </IconButton>
    </div>
  )
}

/** Maqueta de una simulación: escenario grande, ajustes a la derecha y gráfica debajo. */
export function SimShell({ stage, controls, settings, readouts, graph, graphTitle }: { stage: ReactNode; controls: ReactNode; settings: ReactNode; readouts: ReactNode; graph?: ReactNode; graphTitle?: ReactNode }) {
  const { t } = useTranslation('tools')
  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
      <div className="flex flex-col gap-4 min-w-0">
        <Card padded={false} className="relative overflow-hidden">
          <div className="h-[clamp(300px,46vh,440px)] relative">{stage}</div>
          <div className="absolute left-4 top-4">{controls}</div>
        </Card>
        {graph && (
          <Card padded>
            {graphTitle && <CardTitle title={graphTitle} />}
            {graph}
          </Card>
        )}
      </div>
      <div className="flex flex-col gap-4 min-w-0">
        <Card padded>
          <CardTitle title={t('physics.settings')} />
          <div className="flex flex-col gap-4">{settings}</div>
        </Card>
        <Card padded>
          <CardTitle title={t('physics.readouts')} />
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">{readouts}</div>
        </Card>
      </div>
    </div>
  )
}

/** Colores de las magnitudes en las gráficas (tonos tranquilos). */
export function usePhysicsColors() {
  const { dark } = useTheme()
  return {
    main: 'var(--accent)',
    second: dark ? '#93b5e0' : '#3f6797',
    third: dark ? '#8cc7a3' : '#386e51',
    muted: 'var(--text3)'
  }
}
