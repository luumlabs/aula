// Estadística: pegas una lista y ves su resumen (media, mediana, moda, desviación, cuartiles) con un diagrama de caja y
// un histograma que se dibujan al entrar; regresión lineal con nube de puntos y r²; y probabilidades de la normal con
// el área sombreada que crece hasta su valor.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { BarChart3, Bell, ScatterChart } from 'lucide-react'
import { Card, SegmentedTabs, Slider, cx, useTheme } from '@renderer/design'
import { Tex } from '../shared/Tex'
import { formatNumber, niceTicks, parseNumber, percentSign } from '../shared/lib/num'
import { CardTitle, Examples, NumField, useComma, useElementSize, useStored } from '../shared/ui'
import type { ToolProps } from '../registry'
import { histogram, linearRegression, normalPdf, normalProb, normalQuantile, parseList, parsePairs, summarize, type Summary } from './lib/stats'

type Tab = 'describe' | 'regression' | 'normal'

const SAMPLES: Record<string, { es: string; en: string }> = {
  grades: { es: '6,5 7 8 5,5 9 7,5 6 8 7 4,5 9,5 7 6,5 8 7', en: '6.5 7 8 5.5 9 7.5 6 8 7 4.5 9.5 7 6.5 8 7' },
  heights: { es: '162 170 158 175 168 181 165 172 169 177 160 174 166 171 190', en: '162 170 158 175 168 181 165 172 169 177 160 174 166 171 190' },
  dice: { es: '3 5 1 6 2 4 4 6 1 3 5 2 6 6 4 3 1 2 5 4', en: '3 5 1 6 2 4 4 6 1 3 5 2 6 6 4 3 1 2 5 4' }
}

export default function StatsTool(_props: ToolProps) {
  const { t } = useTranslation('tools')
  const [tab, setTab] = useStored<Tab>('aula.tools.stats.tab', 'describe')
  return (
    <div className="flex flex-col gap-4">
      <div>
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'describe', label: t('stats.tab.describe'), icon: <BarChart3 size={14} /> },
            { id: 'regression', label: t('stats.tab.regression'), icon: <ScatterChart size={14} /> },
            { id: 'normal', label: t('stats.tab.normal'), icon: <Bell size={14} /> }
          ]}
        />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          {tab === 'describe' ? <Describe /> : tab === 'regression' ? <RegressionTab /> : <NormalTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

const areaCls = 'w-full min-h-[150px] rounded-[12px] bg-field border-[0.5px] border-line-strong/40 px-3 py-2.5 font-mono text-[13px] leading-relaxed text-text outline-none resize-y focus:border-accent-line focus:shadow-[0_0_0_3px_var(--accent-wash)]'

// MARK: Descriptiva

function Describe() {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const [text, setText] = useStored('aula.tools.stats.data', SAMPLES.grades[comma ? 'es' : 'en'])
  const [bins, setBins] = useState<number | null>(null)
  const { values, bad } = useMemo(() => parseList(text, comma), [text, comma])
  const s = useMemo(() => summarize(values), [values])
  const f = (x: number) => (Number.isFinite(x) ? formatNumber(x, { comma, sig: 5, maxDecimals: 4 }) : '—')
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card padded className="col-span-12 @4xl:col-span-4">
        <CardTitle title={t('stats.data')} detail={t('stats.dataHint')} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className={areaCls} aria-label={t('stats.data')} />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="t-footnote tabular">{t('stats.count', { count: values.length })}</span>
          {bad.length > 0 && <span className="t-footnote text-danger truncate">{t('stats.ignored', { list: bad.slice(0, 3).join(', ') })}</span>}
        </div>
        <div className="mt-3">
          <Examples items={Object.keys(SAMPLES).map((k) => t(`stats.sample.${k}`))} onPick={(label) => {
            const key = Object.keys(SAMPLES).find((k) => t(`stats.sample.${k}`) === label)
            if (key) setText(SAMPLES[key][comma ? 'es' : 'en'])
          }} />
        </div>
      </Card>
      <Card padded className="col-span-12 @4xl:col-span-8">
        {s ? (
          <div className="grid grid-cols-2 @2xl:grid-cols-4 gap-x-6 gap-y-5">
            <Big label={t('stats.mean')} value={f(s.mean)} tex="\bar x" />
            <Big label={t('stats.median')} value={f(s.median)} tex="Me" />
            <Big label={t('stats.mode')} value={s.modes.length ? s.modes.slice(0, 3).map(f).join(' · ') : t('stats.noMode')} tex="Mo" />
            <Big label={t('stats.sd')} value={f(s.sdSample)} tex="s" hint={`σ = ${f(s.sdPop)}`} />
            <Small label={t('stats.variance')} value={f(s.varSample)} hint={`σ² = ${f(s.varPop)}`} />
            <Small label={t('stats.range')} value={f(s.range)} hint={`${f(s.min)} – ${f(s.max)}`} />
            <Small label={t('stats.quartiles')} value={`${f(s.q1)} · ${f(s.q3)}`} hint={`${t('stats.iqr')} = ${f(s.iqr)}`} />
            <Small label={t('stats.sum')} value={f(s.sum)} hint={`n = ${s.n}`} />
          </div>
        ) : (
          <div className="t-callout text-text3">{t('stats.empty')}</div>
        )}
      </Card>
      {s && (
        <>
          <Card padded className="col-span-12 @4xl:col-span-6">
            <CardTitle title={t('stats.boxplot')} detail={s.outliers.length ? t('stats.outliers', { count: s.outliers.length, list: s.outliers.slice(0, 4).map(f).join(', ') }) : t('stats.noOutliers')} />
            <BoxPlot s={s} values={values} key={text} />
          </Card>
          <Card padded className="col-span-12 @4xl:col-span-6">
            <CardTitle title={t('stats.histogram')} actions={<div className="w-40"><Slider min={2} max={20} value={bins ?? Math.ceil(Math.log2(values.length) + 1)} onChange={setBins} format={(v) => t('stats.bins', { count: v })} /></div>} />
            <Histogram values={values} bins={bins ?? undefined} key={`${text}-${bins}`} />
          </Card>
        </>
      )}
    </div>
  )
}

function Big({ label, value, tex, hint }: { label: string; value: string; tex: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 t-footnote">
        <span className="text-text3 text-[13px]">
          <Tex tex={tex} />
        </span>
        {label}
      </div>
      <motion.div key={value} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="font-serif text-[30px] leading-9 tracking-[-0.02em] tabular truncate">
        {value}
      </motion.div>
      {hint && <div className="t-caption tabular">{hint}</div>}
    </div>
  )
}

function Small({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="t-footnote">{label}</div>
      <div className="t-headline tabular mt-0.5 truncate">{value}</div>
      {hint && <div className="t-caption tabular truncate">{hint}</div>}
    </div>
  )
}

/** Eje x con marcas bonitas. */
function XAxis({ lo, hi, w, y, map }: { lo: number; hi: number; w: number; y: number; map: (x: number) => number }) {
  const comma = useComma()
  return (
    <g fontSize={11} fill="var(--text3)" className="tabular">
      <line x1={0} x2={w} y1={y} y2={y} stroke="var(--line)" />
      {niceTicks(lo, hi, Math.max(3, w / 80)).map((x) => (
        <g key={x}>
          <line x1={map(x)} x2={map(x)} y1={y} y2={y + 4} stroke="var(--line)" />
          <text x={map(x)} y={y + 16} textAnchor="middle">
            {formatNumber(x, { comma, sig: 5 })}
          </text>
        </g>
      ))}
    </g>
  )
}

function BoxPlot({ s, values }: { s: Summary; values: number[] }) {
  const [ref, { w }] = useElementSize<HTMLDivElement>()
  const comma = useComma()
  const h = 170
  const pad = (s.max - s.min) * 0.08 || 1
  const lo = s.min - pad
  const hi = s.max + pad
  const map = (x: number) => ((x - lo) / (hi - lo)) * w
  const cy = 70
  const bh = 46
  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={h}>
          {/* puntos de los datos (pixel-art: cuadraditos) */}
          {values.map((x, i) => (
            <motion.rect key={i} x={map(x) - 2.5} y={cy + bh / 2 + 18 + (i % 4) * 6} width={5} height={5} rx={1} fill="var(--text3)" opacity={0.45} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 0.45, y: 0 }} transition={{ delay: 0.5 + i * 0.01 }} />
          ))}
          <motion.line x1={map(s.whiskers[0])} x2={map(s.q1)} y1={cy} y2={cy} stroke="var(--text2)" strokeWidth={1.5} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.35, duration: 0.4 }} />
          <motion.line x1={map(s.whiskers[1])} x2={map(s.q3)} y1={cy} y2={cy} stroke="var(--text2)" strokeWidth={1.5} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.35, duration: 0.4 }} />
          {[s.whiskers[0], s.whiskers[1]].map((x, i) => (
            <motion.line key={i} x1={map(x)} x2={map(x)} y1={cy - 12} y2={cy + 12} stroke="var(--text2)" strokeWidth={1.5} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} />
          ))}
          <motion.rect
            x={map(s.q1)}
            y={cy - bh / 2}
            width={Math.max(1, map(s.q3) - map(s.q1))}
            height={bh}
            rx={8}
            fill="var(--accent-wash)"
            stroke="var(--accent)"
            strokeWidth={1.5}
            style={{ originX: `${map(s.median)}px` }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ type: 'spring', stiffness: 160, damping: 20 }}
          />
          <line x1={map(s.median)} x2={map(s.median)} y1={cy - bh / 2} y2={cy + bh / 2} stroke="var(--accent)" strokeWidth={2.5} />
          <motion.circle cx={map(s.mean)} cy={cy} r={4} fill="var(--surface)" stroke="var(--accent-text)" strokeWidth={2} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.6 }} />
          {s.outliers.map((x, i) => (
            <circle key={i} cx={map(x)} cy={cy} r={4} fill="none" stroke="var(--danger)" strokeWidth={1.5} />
          ))}
          <g fontSize={11} fill="var(--text2)" className="tabular" textAnchor="middle">
            <text x={map(s.q1)} y={cy - bh / 2 - 6}>
              Q₁ {formatNumber(s.q1, { comma, sig: 4 })}
            </text>
            <text x={map(s.q3)} y={cy - bh / 2 - 6}>
              Q₃ {formatNumber(s.q3, { comma, sig: 4 })}
            </text>
          </g>
          <XAxis lo={lo} hi={hi} w={w} y={h - 22} map={map} />
        </svg>
      )}
    </div>
  )
}

function Histogram({ values, bins }: { values: number[]; bins?: number }) {
  const [ref, { w }] = useElementSize<HTMLDivElement>()
  const comma = useComma()
  const hs = useMemo(() => histogram(values, bins), [values, bins])
  const h = 190
  const top = Math.max(...hs.map((b) => b.count))
  const lo = hs[0]?.lo ?? 0
  const hi = hs[hs.length - 1]?.hi ?? 1
  const map = (x: number) => ((x - lo) / (hi - lo)) * w
  const base = h - 24
  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={h}>
          {hs.map((b, i) => {
            const bh = (b.count / top) * (base - 16)
            return (
              <g key={i}>
                <motion.rect
                  x={map(b.lo) + 1.5}
                  width={Math.max(1, map(b.hi) - map(b.lo) - 3)}
                  rx={4}
                  fill="var(--accent)"
                  fillOpacity={0.78}
                  initial={{ y: base, height: 0 }}
                  animate={{ y: base - bh, height: bh }}
                  transition={{ type: 'spring', stiffness: 140, damping: 18, delay: i * 0.04 }}
                />
                {b.count > 0 && (
                  <motion.text x={(map(b.lo) + map(b.hi)) / 2} y={base - bh - 5} textAnchor="middle" fontSize={11} fill="var(--text2)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.04 }}>
                    {b.count}
                  </motion.text>
                )}
              </g>
            )
          })}
          <g fontSize={11} fill="var(--text3)" className="tabular">
            <line x1={0} x2={w} y1={base} y2={base} stroke="var(--line)" />
            {hs.length <= 14 &&
              [...hs.map((b) => b.lo), hi].map((x, i) => (
                <text key={i} x={Math.min(w - 12, Math.max(12, map(x)))} y={base + 16} textAnchor="middle">
                  {formatNumber(x, { comma, sig: 4 })}
                </text>
              ))}
          </g>
        </svg>
      )}
    </div>
  )
}

// MARK: Regresión

function RegressionTab() {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const sample = comma ? '1 2,1\n2 3,9\n3 6,2\n4 7,8\n5 10,1\n6 12,2\n7 13,8\n8 16,3' : '1 2.1\n2 3.9\n3 6.2\n4 7.8\n5 10.1\n6 12.2\n7 13.8\n8 16.3'
  const [text, setText] = useStored('aula.tools.stats.pairs', sample)
  const [xs, setXs] = useState('10')
  const { pairs, bad } = useMemo(() => parsePairs(text, comma), [text, comma])
  const r = useMemo(() => linearRegression(pairs), [pairs])
  const f = (x: number, sig = 4) => formatNumber(x, { comma, sig })
  const x0 = parseNumber(xs)
  const sign = (b: number) => (b < 0 ? '-' : '+')
  const eq = r ? `\\hat y = ${f(r.slope).replace('−', '-').replace(',', '{,}')}\\,x ${sign(r.intercept)} ${f(Math.abs(r.intercept)).replace(',', '{,}')}` : ''
  const strength = r ? (Math.abs(r.r) > 0.9 ? 'strong' : Math.abs(r.r) > 0.6 ? 'moderate' : Math.abs(r.r) > 0.3 ? 'weak' : 'none') : 'none'
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card padded className="col-span-12 @4xl:col-span-4">
        <CardTitle title={t('stats.pairs')} detail={t('stats.pairsHint')} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className={cx(areaCls, 'min-h-[220px]')} aria-label={t('stats.pairs')} />
        <div className="mt-2 t-footnote tabular">
          {t('stats.pairsCount', { count: pairs.length })}
          {bad > 0 && <span className="text-danger"> · {t('stats.badLines', { count: bad })}</span>}
        </div>
        {r && (
          <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4">
            <div className="col-span-2 text-[18px] overflow-x-auto overflow-y-hidden">
              <Tex tex={eq} />
            </div>
            <Small label="r" value={f(r.r)} hint={t(`stats.strength.${strength}`)} />
            <Small label="r²" value={f(r.r2)} hint={t('stats.r2Hint', { pct: formatNumber(r.r2 * 100, { comma, sig: 3, maxDecimals: 1 }) + percentSign(comma) })} />
            <div className="col-span-2 flex items-end gap-3">
              <NumField label={t('stats.predict')} value={xs} onChange={setXs} className="w-28" unit="x" />
              {x0 !== null && <div className="pb-1.5 t-headline tabular">ŷ = {f(r.slope * x0 + r.intercept)}</div>}
            </div>
          </div>
        )}
      </Card>
      <Card padded className="col-span-12 @4xl:col-span-8">
        <Scatter pairs={pairs} r={r} key={text} />
      </Card>
    </div>
  )
}

function Scatter({ pairs, r }: { pairs: [number, number][]; r: ReturnType<typeof linearRegression> }) {
  const [ref, { w }] = useElementSize<HTMLDivElement>()
  const comma = useComma()
  const { dark } = useTheme()
  const h = 380
  if (!pairs.length) return <div ref={ref} className="h-[380px]" />
  const xsv = pairs.map((p) => p[0])
  const ysv = pairs.map((p) => p[1])
  const padX = (Math.max(...xsv) - Math.min(...xsv)) * 0.08 || 1
  const padY = (Math.max(...ysv) - Math.min(...ysv)) * 0.12 || 1
  const x0 = Math.min(...xsv) - padX
  const x1 = Math.max(...xsv) + padX
  const y0 = Math.min(...ysv) - padY
  const y1 = Math.max(...ysv) + padY
  const L = 44
  const B = 28
  const mx = (x: number) => L + ((x - x0) / (x1 - x0)) * (w - L - 8)
  const my = (y: number) => 8 + (1 - (y - y0) / (y1 - y0)) * (h - B - 8)
  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={h}>
          {niceTicks(y0, y1, 6).map((y) => (
            <g key={y}>
              <line x1={L} x2={w - 8} y1={my(y)} y2={my(y)} stroke="var(--line-soft)" />
              <text x={L - 6} y={my(y) + 4} textAnchor="end" fontSize={11} fill="var(--text3)" className="tabular">
                {formatNumber(y, { comma, sig: 4 })}
              </text>
            </g>
          ))}
          {niceTicks(x0, x1, Math.max(3, w / 90)).map((x) => (
            <g key={x}>
              <line x1={mx(x)} x2={mx(x)} y1={8} y2={h - B} stroke="var(--line-soft)" />
              <text x={mx(x)} y={h - B + 16} textAnchor="middle" fontSize={11} fill="var(--text3)" className="tabular">
                {formatNumber(x, { comma, sig: 4 })}
              </text>
            </g>
          ))}
          {r && (
            <>
              {pairs.map(([x, y], i) => (
                <motion.line key={`res${i}`} x1={mx(x)} x2={mx(x)} y1={my(y)} y2={my(r.slope * x + r.intercept)} stroke="var(--accent)" strokeOpacity={0.35} strokeDasharray="3 3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} />
              ))}
              <motion.line x1={mx(x0)} y1={my(r.slope * x0 + r.intercept)} x2={mx(x1)} y2={my(r.slope * x1 + r.intercept)} stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.5, duration: 0.8 }} />
            </>
          )}
          {pairs.map(([x, y], i) => (
            <motion.circle key={i} cx={mx(x)} cy={my(y)} r={5} fill={dark ? '#93b5e0' : '#3f6797'} stroke="var(--surface)" strokeWidth={1.5} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18, delay: i * 0.03 }} />
          ))}
        </svg>
      )}
    </div>
  )
}

// MARK: Normal

type Kind = 'between' | 'below' | 'above'

function NormalTab() {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const [s, setS] = useStored('aula.tools.stats.normal', { mu: '100', sigma: '15', a: '85', b: '115', kind: 'between' as Kind, p: '0,95' })
  const mu = parseNumber(s.mu) ?? 0
  const sigma = parseNumber(s.sigma) ?? 1
  const a = parseNumber(s.a) ?? mu - sigma
  const b = parseNumber(s.b) ?? mu + sigma
  const lo = s.kind === 'below' ? -Infinity : a
  const hi = s.kind === 'above' ? Infinity : s.kind === 'below' ? b : b
  const from = s.kind === 'above' ? a : lo
  const to = s.kind === 'above' ? Infinity : hi
  const p = sigma > 0 ? normalProb(from, to, mu, sigma) : NaN
  const pq = parseNumber(s.p)
  const q = pq !== null && sigma > 0 ? normalQuantile(pq, mu, sigma) : NaN
  const f = (x: number, sig = 4) => formatNumber(x, { comma, sig })
  const probTex = s.kind === 'between' ? `P(${f(a)} \\le X \\le ${f(b)})` : s.kind === 'below' ? `P(X \\le ${f(b)})` : `P(X \\ge ${f(a)})`
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card padded className="col-span-12 @4xl:col-span-4">
        <CardTitle title={t('stats.normalTitle')} detail="X ~ N(μ, σ)" />
        <div className="grid grid-cols-2 gap-3">
          <NumField label="μ" value={s.mu} onChange={(mu) => setS((x) => ({ ...x, mu }))} />
          <NumField label="σ" value={s.sigma} onChange={(sigma) => setS((x) => ({ ...x, sigma }))} invalid={!(sigma > 0)} />
        </div>
        <div className="mt-4">
          <SegmentedTabs
            size="sm"
            fill
            value={s.kind}
            onChange={(kind) => setS((x) => ({ ...x, kind }))}
            items={[
              { id: 'below', label: 'X ≤ b' },
              { id: 'between', label: 'a ≤ X ≤ b' },
              { id: 'above', label: 'X ≥ a' }
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          {s.kind !== 'below' && <NumField label="a" value={s.a} onChange={(v) => setS((x) => ({ ...x, a: v }))} hint={sigma > 0 ? `z = ${f((a - mu) / sigma, 3)}` : undefined} />}
          {s.kind !== 'above' && <NumField label="b" value={s.b} onChange={(v) => setS((x) => ({ ...x, b: v }))} hint={sigma > 0 ? `z = ${f((b - mu) / sigma, 3)}` : undefined} />}
        </div>
        <div className="mt-6 pt-5 border-t-[0.5px] border-line-soft">
          <div className="t-footnote">{t('stats.quantile')}</div>
          <div className="mt-2 flex items-end gap-3">
            <NumField value={s.p} onChange={(v) => setS((x) => ({ ...x, p: v }))} className="w-24" unit="p" ariaLabel="p" />
            <div className="pb-1.5 t-headline tabular">x = {Number.isFinite(q) ? f(q, 5) : '—'}</div>
          </div>
        </div>
      </Card>
      <Card padded="lg" className="col-span-12 @4xl:col-span-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-[17px] text-text2">
            <Tex tex={probTex} />
          </span>
          <motion.span key={p} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="font-serif text-[48px] leading-none tracking-[-0.03em] tabular">
            {Number.isFinite(p) ? formatNumber(p, { comma, sig: 4, maxDecimals: 4 }) : '—'}
          </motion.span>
          {Number.isFinite(p) && <span className="t-headline text-text3 tabular">≈ {formatNumber(p * 100, { comma, sig: 3, maxDecimals: 2 })}{percentSign(comma)}</span>}
        </div>
        {sigma > 0 && <BellCurve mu={mu} sigma={sigma} from={from} to={to} />}
      </Card>
    </div>
  )
}

function BellCurve({ mu, sigma, from, to }: { mu: number; sigma: number; from: number; to: number }) {
  const [ref, { w }] = useElementSize<HTMLDivElement>()
  const comma = useComma()
  const h = 300
  const lo = mu - 4 * sigma
  const hi = mu + 4 * sigma
  const peak = normalPdf(mu, mu, sigma)
  const mx = (x: number) => ((x - lo) / (hi - lo)) * w
  const my = (y: number) => h - 30 - (y / peak) * (h - 50)
  const N = 160
  const curve = Array.from({ length: N + 1 }, (_, i) => lo + ((hi - lo) * i) / N)
  const d = curve.map((x, i) => `${i ? 'L' : 'M'}${mx(x).toFixed(1)} ${my(normalPdf(x, mu, sigma)).toFixed(1)}`).join('')
  const a = Math.max(lo, from === -Infinity ? lo : from)
  const b = Math.min(hi, to === Infinity ? hi : to)
  const area = b > a ? Array.from({ length: 81 }, (_, i) => a + ((b - a) * i) / 80) : []
  const areaD = area.length ? `M${mx(a)} ${my(0)} ` + area.map((x) => `L${mx(x).toFixed(1)} ${my(normalPdf(x, mu, sigma)).toFixed(1)}`).join('') + ` L${mx(b)} ${my(0)} Z` : ''
  return (
    <div ref={ref} className="w-full mt-6">
      {w > 0 && (
        <svg width={w} height={h}>
          {[-3, -2, -1, 0, 1, 2, 3].map((k) => (
            <g key={k}>
              <line x1={mx(mu + k * sigma)} x2={mx(mu + k * sigma)} y1={20} y2={h - 30} stroke="var(--line-soft)" strokeDasharray={k ? '3 4' : undefined} />
              <text x={mx(mu + k * sigma)} y={h - 12} textAnchor="middle" fontSize={11} fill="var(--text3)" className="tabular">
                {formatNumber(mu + k * sigma, { comma, sig: 5 })}
              </text>
              <text x={mx(mu + k * sigma)} y={14} textAnchor="middle" fontSize={10} fill="var(--text3)">
                {k === 0 ? 'μ' : `${k > 0 ? '+' : '−'}${Math.abs(k)}σ`}
              </text>
            </g>
          ))}
          <line x1={0} x2={w} y1={my(0)} y2={my(0)} stroke="var(--line)" />
          {areaD && (
            <motion.path key={`${a}-${b}`} d={areaD} fill="var(--accent)" fillOpacity={0.22} initial={{ clipPath: 'inset(0 100% 0 0)' }} animate={{ clipPath: 'inset(0 0% 0 0)' }} transition={{ duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }} />
          )}
          <motion.path d={d} fill="none" stroke="var(--accent)" strokeWidth={2.5} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9 }} />
          {[from, to].filter((x) => Number.isFinite(x) && x >= lo && x <= hi).map((x, i) => (
            <line key={i} x1={mx(x)} x2={mx(x)} y1={my(normalPdf(x, mu, sigma))} y2={my(0)} stroke="var(--accent)" strokeWidth={1.5} />
          ))}
        </svg>
      )}
    </div>
  )
}
