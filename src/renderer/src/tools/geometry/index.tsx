// Geometría: resuelve triángulos (LLL, LAL, ALA, AAL y el caso ambiguo LLA) y los dibuja a escala trazo a trazo con sus
// ángulos; áreas y perímetros de figuras con su fórmula; y el círculo con su sector, arco, cuerda y segmento.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Circle, Shapes, Triangle as TriangleIcon } from 'lucide-react'
import { Card, SegmentedTabs, Slider, cx } from '@renderer/design'
import { Tex } from '../shared/Tex'
import { formatNumber, parseNumber } from '../shared/lib/num'
import { CardTitle, ErrorLine, KV, NumField, useComma, useElementSize, useStored } from '../shared/ui'
import type { ToolProps } from '../registry'
import { SHAPE_FIELDS, TRI_FIELDS, circleMeasures, shapeMeasures, solveTriangle, triangleVertices, type ShapeId, type TriMode, type Triangle, type TriangleInfo } from './lib/geometry'

type Tab = 'triangle' | 'shapes' | 'circle'

export default function GeometryTool(_props: ToolProps) {
  const { t } = useTranslation('tools')
  const [tab, setTab] = useStored<Tab>('aula.tools.geometry.tab', 'triangle')
  return (
    <div className="flex flex-col gap-4">
      <div>
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'triangle', label: t('geometry.tab.triangle'), icon: <TriangleIcon size={14} /> },
            { id: 'shapes', label: t('geometry.tab.shapes'), icon: <Shapes size={14} /> },
            { id: 'circle', label: t('geometry.tab.circle'), icon: <Circle size={14} /> }
          ]}
        />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          {tab === 'triangle' ? <TriangleTab /> : tab === 'shapes' ? <ShapesTab /> : <CircleTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// MARK: Triángulo

const LAW: Record<TriMode, string> = {
  SSS: '\\cos A = \\frac{b^2 + c^2 - a^2}{2bc}',
  SAS: 'a^2 = b^2 + c^2 - 2bc\\cos A',
  ASA: '\\frac{a}{\\sin A} = \\frac{b}{\\sin B} = \\frac{c}{\\sin C}',
  AAS: '\\frac{a}{\\sin A} = \\frac{b}{\\sin B} = \\frac{c}{\\sin C}',
  SSA: '\\sin B = \\frac{b\\,\\sin A}{a}'
}

const DEFAULTS: Record<TriMode, Record<string, string>> = {
  SSS: { a: '5', b: '6', c: '7' },
  SAS: { b: '5', A: '50', c: '7' },
  ASA: { B: '40', a: '8', C: '65' },
  AAS: { A: '35', B: '75', a: '6' },
  SSA: { a: '6', b: '8', A: '35' }
}

function TriangleTab() {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const [s, setS] = useStored('aula.tools.geometry.tri', { mode: 'SSS' as TriMode, values: DEFAULTS as Record<TriMode, Record<string, string>> })
  const [pick, setPick] = useState(0)
  const vals = s.values[s.mode] ?? DEFAULTS[s.mode]
  const given = Object.fromEntries(TRI_FIELDS[s.mode].map((k) => [k, parseNumber(vals[k] ?? '') ?? undefined])) as Partial<Triangle>
  const res = useMemo(() => solveTriangle(s.mode, given), [s.mode, JSON.stringify(given)]) // eslint-disable-line react-hooks/exhaustive-deps
  const sols = res.ok ? res.solutions : []
  const sol = sols[Math.min(pick, sols.length - 1)]
  const f = (x: number) => formatNumber(x, { comma, sig: 5, maxDecimals: 3 })
  const isAngle = (k: string) => k === k.toUpperCase()
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card padded className="col-span-12 @4xl:col-span-4">
        <CardTitle title={t('geometry.solveTriangle')} detail={t(`geometry.mode.${s.mode}`)} />
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(TRI_FIELDS) as TriMode[]).map((m) => (
            <button key={m} onClick={() => (setS((p) => ({ ...p, mode: m })), setPick(0))} className={cx('h-8 px-3 rounded-[10px] t-ui font-semibold tracking-wide transition-colors', s.mode === m ? 'bg-accent-wash text-accent-text' : 'bg-fill2 text-text2 hover:bg-fill3')}>
              {t(`geometry.abbr.${m}`)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          {TRI_FIELDS[s.mode].map((k) => (
            <NumField
              key={k}
              label={<span className="font-serif italic text-[15px] text-text">{k}</span>}
              unit={isAngle(k) ? '°' : undefined}
              value={vals[k] ?? ''}
              onChange={(v) => setS((p) => ({ ...p, values: { ...p.values, [p.mode]: { ...(p.values[p.mode] ?? {}), [k]: v } } }))}
            />
          ))}
        </div>
        <p className="t-footnote mt-3">{t('geometry.convention')}</p>
        <div className="mt-4 rounded-[12px] bg-sunken px-4 py-3 text-[15px] overflow-x-auto overflow-y-hidden">
          <div className="t-eyebrow mb-1">{t('geometry.law')}</div>
          <Tex tex={LAW[s.mode]} display />
        </div>
        {!res.ok && res.error !== 'missing' && (
          <div className="mt-3">
            <ErrorLine>{t(`geometry.err.${res.error}`)}</ErrorLine>
          </div>
        )}
      </Card>
      <Card padded className="col-span-12 @4xl:col-span-8">
        {sols.length > 1 && (
          <div className="flex items-center gap-3 mb-2">
            <SegmentedTabs size="sm" value={String(pick)} onChange={(v) => setPick(Number(v))} items={sols.map((_, i) => ({ id: String(i), label: t('geometry.solutionN', { n: i + 1 }) }))} />
            <span className="t-footnote">{t('geometry.ambiguous')}</span>
          </div>
        )}
        {sol ? <TriangleDrawing t={sol} ghost={sols.length > 1 ? sols[1 - Math.min(pick, 1)] : undefined} key={`${s.mode}-${pick}-${f(sol.a)}-${f(sol.b)}-${f(sol.c)}`} /> : <div className="h-[320px] grid place-items-center t-callout text-text3">{t('geometry.fillData')}</div>}
        {sol && (
          <div className="grid grid-cols-3 @3xl:grid-cols-6 gap-x-5 gap-y-4 mt-4">
            {(['a', 'b', 'c'] as const).map((k) => (
              <KV key={k} k={<span className="font-serif italic text-[14px]">{k}</span>} v={f(sol[k])} />
            ))}
            {(['A', 'B', 'C'] as const).map((k) => (
              <KV key={k} k={<span className="font-serif italic text-[14px]">{k}</span>} v={`${f(sol[k])}°`} />
            ))}
            <KV k={t('geometry.area')} v={f(sol.area)} />
            <KV k={t('geometry.perimeter')} v={f(sol.perimeter)} />
            <KV k={t('geometry.circumradius')} v={f(sol.R)} />
            <KV k={t('geometry.inradius')} v={f(sol.r)} />
            <div className="col-span-3 @3xl:col-span-2">
              <KV k={t('geometry.heights')} v={`${f(sol.ha)} · ${f(sol.hb)} · ${f(sol.hc)}`} />
            </div>
            <div className="col-span-3 @3xl:col-span-6">
              <KV k={t('geometry.type')} v={`${t(`geometry.sides.${sol.bySides}`)}, ${t(`geometry.angles.${sol.byAngles}`)}`} />
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

function TriangleDrawing({ t: tri, ghost }: { t: TriangleInfo; ghost?: TriangleInfo }) {
  const [ref, { w }] = useElementSize<HTMLDivElement>()
  const comma = useComma()
  const h = 320
  const v = triangleVertices(tri)
  const gv = ghost ? triangleVertices(ghost) : null
  const pts = [v.A, v.B, v.C, ...(gv ? [gv.C] : [])]
  const minX = Math.min(...pts.map((p) => p[0]))
  const maxX = Math.max(...pts.map((p) => p[0]))
  const minY = Math.min(...pts.map((p) => p[1]))
  const maxY = Math.max(...pts.map((p) => p[1]))
  const pad = 56
  const k = Math.min((w - 2 * pad) / Math.max(1e-9, maxX - minX), (h - 2 * pad) / Math.max(1e-9, maxY - minY))
  const ox = (w - (maxX - minX) * k) / 2 - minX * k
  const oy = (h + (maxY - minY) * k) / 2 + minY * k
  const P = (p: [number, number]): [number, number] => [ox + p[0] * k, oy - p[1] * k]
  const [A, B, C] = [P(v.A), P(v.B), P(v.C)]
  const cx = (A[0] + B[0] + C[0]) / 3
  const cy = (A[1] + B[1] + C[1]) / 3
  const out = (p: [number, number], d = 18): [number, number] => {
    const dx = p[0] - cx
    const dy = p[1] - cy
    const l = Math.hypot(dx, dy) || 1
    return [p[0] + (dx / l) * d, p[1] + (dy / l) * d]
  }
  const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  const f = (x: number) => formatNumber(x, { comma, sig: 4, maxDecimals: 2 })
  const arc = (at: [number, number], p: [number, number], q: [number, number], angle: number, i: number) => {
    const r = 24
    const a1 = Math.atan2(p[1] - at[1], p[0] - at[0])
    const a2 = Math.atan2(q[1] - at[1], q[0] - at[0])
    let d = a2 - a1
    while (d <= -Math.PI) d += 2 * Math.PI
    while (d > Math.PI) d -= 2 * Math.PI
    if (Math.abs(angle - 90) < 0.01) {
      const u: [number, number] = [Math.cos(a1) * 14, Math.sin(a1) * 14]
      const vv: [number, number] = [Math.cos(a2) * 14, Math.sin(a2) * 14]
      return <motion.path key={i} d={`M${at[0] + u[0]} ${at[1] + u[1]} L${at[0] + u[0] + vv[0]} ${at[1] + u[1] + vv[1]} L${at[0] + vv[0]} ${at[1] + vv[1]}`} fill="none" stroke="var(--accent)" strokeWidth={1.5} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 1 + i * 0.15 }} />
    }
    const e: [number, number] = [at[0] + Math.cos(a1 + d) * r, at[1] + Math.sin(a1 + d) * r]
    const s0: [number, number] = [at[0] + Math.cos(a1) * r, at[1] + Math.sin(a1) * r]
    return <motion.path key={i} d={`M${s0[0]} ${s0[1]} A${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${e[0]} ${e[1]}`} fill="none" stroke="var(--accent)" strokeWidth={1.5} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 1 + i * 0.15, duration: 0.4 }} />
  }
  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={h}>
          {gv && <path d={`M${A[0]} ${A[1]} L${B[0]} ${B[1]} L${P(gv.C)[0]} ${P(gv.C)[1]} Z`} fill="none" stroke="var(--text3)" strokeDasharray="4 5" opacity={0.6} />}
          <motion.path d={`M${A[0]} ${A[1]} L${B[0]} ${B[1]} L${C[0]} ${C[1]} Z`} fill="var(--accent-wash)" stroke="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9, duration: 0.5 }} />
          <motion.path d={`M${A[0]} ${A[1]} L${B[0]} ${B[1]} L${C[0]} ${C[1]} Z`} fill="none" stroke="var(--text)" strokeWidth={2.2} strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: [0.3, 0.6, 0.2, 1] }} />
          {arc(A, B, C, tri.A, 0)}
          {arc(B, C, A, tri.B, 1)}
          {arc(C, A, B, tri.C, 2)}
          {(
            [
              ['A', A, tri.A],
              ['B', B, tri.B],
              ['C', C, tri.C]
            ] as const
          ).map(([name, p, ang], i) => {
            const [x, y] = out(p as [number, number], 18)
            // el valor del ángulo, dentro, junto a su arco (hacia el centro del triángulo)
            const [vx, vy] = out(p as [number, number], -46)
            return (
              <motion.g key={name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.25 }}>
                <text x={x} y={y + 5} textAnchor="middle" fontFamily="var(--font-serif)" fontStyle="italic" fontSize={18} fill="var(--text)">
                  {name}
                </text>
                <text x={vx} y={vy + 5} textAnchor="middle" fontSize={11} fill="var(--accent-text)" className="tabular">
                  {f(ang)}°
                </text>
              </motion.g>
            )
          })}
          {(
            [
              ['a', B, C, tri.a],
              ['b', A, C, tri.b],
              ['c', A, B, tri.c]
            ] as const
          ).map(([name, p, q, len], i) => {
            const m = mid(p as [number, number], q as [number, number])
            const [x, y] = out(m, 16)
            return (
              <motion.text key={name} x={x} y={y + 4} textAnchor="middle" fontSize={12} fill="var(--text2)" className="tabular" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 + i * 0.2 }}>
                <tspan fontFamily="var(--font-serif)" fontStyle="italic" fontSize={15} fill="var(--text)">
                  {name}
                </tspan>{' '}
                = {f(len)}
              </motion.text>
            )
          })}
        </svg>
      )}
    </div>
  )
}

// MARK: Figuras

const SHAPES: ShapeId[] = ['rectangle', 'square', 'parallelogram', 'trapezoid', 'rhombus', 'polygon', 'ellipse']
const SHAPE_DEFAULTS: Record<ShapeId, Record<string, string>> = {
  rectangle: { b: '8', h: '5' },
  square: { l: '6' },
  parallelogram: { b: '8', h: '4', s: '5' },
  trapezoid: { B: '10', b: '6', h: '4' },
  rhombus: { D: '8', d: '5' },
  polygon: { n: '6', l: '4' },
  ellipse: { a: '6', b: '3.5' }
}

function shapePath(id: ShapeId, v: Record<string, number>, size: number): string {
  // figura normalizada al cuadro [0, size]
  const fit = (pts: [number, number][]) => {
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const sc = size / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-9)
    const mx = (Math.max(...xs) + Math.min(...xs)) / 2
    const my = (Math.max(...ys) + Math.min(...ys)) / 2
    return pts.map(([x, y]) => [size / 2 + (x - mx) * sc, size / 2 - (y - my) * sc] as [number, number])
  }
  const poly = (pts: [number, number][]) => 'M' + fit(pts).map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L') + ' Z'
  switch (id) {
    case 'rectangle':
      return poly([[0, 0], [v.b, 0], [v.b, v.h], [0, v.h]])
    case 'square':
      return poly([[0, 0], [v.l, 0], [v.l, v.l], [0, v.l]])
    case 'parallelogram': {
      const off = Math.sqrt(Math.max(0, v.s * v.s - v.h * v.h))
      return poly([[0, 0], [v.b, 0], [v.b + off, v.h], [off, v.h]])
    }
    case 'trapezoid': {
      const off = (v.B - v.b) / 2
      return poly([[0, 0], [v.B, 0], [off + v.b, v.h], [off, v.h]])
    }
    case 'rhombus':
      return poly([[0, v.d / 2], [v.D / 2, 0], [v.D, v.d / 2], [v.D / 2, v.d]])
    case 'polygon': {
      const n = Math.max(3, Math.min(100, Math.round(v.n)))
      return poly(Array.from({ length: n }, (_, i) => [Math.cos(Math.PI / 2 + (2 * Math.PI * i) / n), Math.sin(Math.PI / 2 + (2 * Math.PI * i) / n)] as [number, number]))
    }
    case 'ellipse': {
      const pts = Array.from({ length: 96 }, (_, i) => [v.a * Math.cos((2 * Math.PI * i) / 96), v.b * Math.sin((2 * Math.PI * i) / 96)] as [number, number])
      return poly(pts)
    }
  }
}

function ShapesTab() {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const [s, setS] = useStored('aula.tools.geometry.shapes', { shape: 'trapezoid' as ShapeId, values: SHAPE_DEFAULTS })
  const vals = s.values[s.shape] ?? SHAPE_DEFAULTS[s.shape]
  const nums = Object.fromEntries(SHAPE_FIELDS[s.shape].map((k) => [k, parseNumber(vals[k] ?? '') ?? undefined]))
  const res = shapeMeasures(s.shape, nums)
  const f = (x: number) => formatNumber(x, { comma, sig: 6, maxDecimals: 4 })
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card padded className="col-span-12 @4xl:col-span-5">
        <div className="grid grid-cols-4 @2xl:grid-cols-7 @4xl:grid-cols-4 gap-2">
          {SHAPES.map((id) => (
            <button key={id} onClick={() => setS((p) => ({ ...p, shape: id }))} className={cx('flex flex-col items-center gap-1 rounded-[12px] p-2 transition-colors', s.shape === id ? 'bg-accent-wash text-accent-text' : 'hover:bg-fill1 text-text2')}>
              <svg width={34} height={34} viewBox="-3 -3 46 46">
                <path d={shapePath(id, Object.fromEntries(Object.entries(SHAPE_DEFAULTS[id]).map(([k, v]) => [k, Number(v)])), 40)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
              </svg>
              <span className="t-caption text-current text-center leading-tight">{t(`geometry.shape.${id}`)}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-5">
          {SHAPE_FIELDS[s.shape].map((k) => (
            <NumField key={k} label={t(`geometry.fields.${s.shape}.${k}`)} value={vals[k] ?? ''} onChange={(v) => setS((p) => ({ ...p, values: { ...p.values, [p.shape]: { ...(p.values[p.shape] ?? {}), [k]: v } } }))} />
          ))}
        </div>
        {!res && <div className="mt-3"><ErrorLine>{t('geometry.err.shape')}</ErrorLine></div>}
      </Card>
      <Card padded className="col-span-12 @4xl:col-span-7">
        <div className="flex flex-col @3xl:flex-row items-center gap-6">
          <svg width={220} height={220} viewBox="-10 -10 220 220" className="shrink-0">
            {res && (
              <>
                <motion.path key={`${s.shape}-${JSON.stringify(vals)}`} d={shapePath(s.shape, nums as Record<string, number>, 200)} fill="var(--accent-wash)" stroke="var(--accent)" strokeWidth={2.2} strokeLinejoin="round" initial={{ pathLength: 0, fillOpacity: 0 }} animate={{ pathLength: 1, fillOpacity: 1 }} transition={{ pathLength: { duration: 0.9 }, fillOpacity: { delay: 0.7, duration: 0.4 } }} />
              </>
            )}
          </svg>
          {res && (
            <div className="flex-1 min-w-0 grid gap-5">
              <div>
                <div className="text-[15px] text-text2 overflow-x-auto overflow-y-hidden">
                  <Tex tex={res.areaTex} />
                </div>
                <div className="font-serif text-[40px] leading-tight tabular">{f(res.area)}</div>
                <div className="t-footnote">{t('geometry.area')}</div>
              </div>
              <div>
                <div className="text-[15px] text-text2 overflow-x-auto overflow-y-hidden">
                  <Tex tex={res.perimeterTex} />
                </div>
                <div className="font-serif text-[30px] leading-tight tabular">{f(res.perimeter)}</div>
                <div className="t-footnote">{t('geometry.perimeter')}</div>
              </div>
              {res.extra && (
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {res.extra.diagonal !== undefined && <KV k={t('geometry.diagonal')} v={f(res.extra.diagonal)} />}
                  {res.extra.side !== undefined && <KV k={t('geometry.side')} v={f(res.extra.side)} />}
                  {res.extra.apothem !== undefined && <KV k={t('geometry.apothem')} v={f(res.extra.apothem)} />}
                  {res.extra.interiorAngle !== undefined && <KV k={t('geometry.interiorAngle')} v={`${f(res.extra.interiorAngle)}°`} />}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

// MARK: Círculo

function CircleTab() {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const [s, setS] = useStored('aula.tools.geometry.circle', { r: '5', theta: 120 })
  const r = parseNumber(s.r) ?? 0
  const c = circleMeasures(r, s.theta)
  const f = (x: number) => formatNumber(x, { comma, sig: 6, maxDecimals: 4 })
  const R = 110
  const th = (s.theta * Math.PI) / 180
  const end: [number, number] = [R * Math.cos(-th), R * Math.sin(-th)]
  const large = s.theta > 180 ? 1 : 0
  const sector = s.theta >= 360 ? `M ${R} 0 A ${R} ${R} 0 1 0 ${-R} 0 A ${R} ${R} 0 1 0 ${R} 0 Z` : `M 0 0 L ${R} 0 A ${R} ${R} 0 ${large} 0 ${end[0]} ${end[1]} Z`
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card padded className="col-span-12 @4xl:col-span-4">
        <CardTitle title={t('geometry.circleTitle')} />
        <NumField label={t('geometry.radius')} value={s.r} onChange={(v) => setS((p) => ({ ...p, r: v }))} unit="r" />
        <div className="mt-4">
          <Slider label={t('geometry.sectorAngle')} min={0} max={360} step={1} value={s.theta} onChange={(theta) => setS((p) => ({ ...p, theta }))} format={(v) => `${v}°`} />
        </div>
        <div className="mt-5 rounded-[12px] bg-sunken px-4 py-3 text-[14px] grid gap-1.5">
          <Tex tex="L = r\,\theta \qquad A_{\text{sector}} = \tfrac12 r^2\theta" />
          <Tex tex="c = 2r\sin\tfrac{\theta}{2} \qquad A_{\text{seg}} = \tfrac12 r^2(\theta - \sin\theta)" />
        </div>
      </Card>
      <Card padded className="col-span-12 @4xl:col-span-8">
        <div className="flex flex-col @3xl:flex-row items-center gap-6">
          <svg width={260} height={260} viewBox="-130 -130 260 260" className="shrink-0">
            <circle r={R} fill="none" stroke="var(--line-strong)" strokeOpacity={0.6} strokeWidth={1.5} />
            <motion.path d={sector} fill="var(--accent-wash)" animate={{ d: sector }} transition={{ duration: 0.2 }} />
            {s.theta > 0 && s.theta < 360 && <line x1={R} y1={0} x2={end[0]} y2={end[1]} stroke="var(--text3)" strokeDasharray="4 4" />}
            <motion.path
              d={s.theta >= 360 ? `M ${R} 0 A ${R} ${R} 0 1 0 ${-R} 0 A ${R} ${R} 0 1 0 ${R} 0` : `M ${R} 0 A ${R} ${R} 0 ${large} 0 ${end[0]} ${end[1]}`}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={3.5}
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.8 }}
            />
            <line x1={0} y1={0} x2={R} y2={0} stroke="var(--text)" strokeWidth={1.5} />
            <line x1={0} y1={0} x2={end[0]} y2={end[1]} stroke="var(--text)" strokeWidth={1.5} />
            <circle r={3} fill="var(--text)" />
            <text x={R / 2} y={16} textAnchor="middle" fontFamily="var(--font-serif)" fontStyle="italic" fontSize={15} fill="var(--text)">
              r
            </text>
            <text x={30 * Math.cos(-th / 2)} y={30 * Math.sin(-th / 2) + 4} textAnchor="middle" fontSize={12} fill="var(--accent-text)">
              θ
            </text>
          </svg>
          {c && (
            <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-6 gap-y-4">
              <KV k={t('geometry.diameter')} v={f(c.diameter)} />
              <KV k={t('geometry.circumference')} v={f(c.circumference)} />
              <KV k={t('geometry.circleArea')} v={f(c.area)} />
              <KV k={t('geometry.arc')} v={f(c.arc)} />
              <KV k={t('geometry.sectorArea')} v={f(c.sector)} />
              <KV k={t('geometry.chord')} v={f(c.chord)} />
              <KV k={t('geometry.segmentArea')} v={f(c.segment)} />
              <KV k={t('geometry.radians')} v={`${f((s.theta * Math.PI) / 180)} rad`} />
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
