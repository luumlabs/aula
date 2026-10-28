// Gases ideales PV = nRT: eliges qué calcular y ves una caja con partículas que se mueven más deprisa al subir la
// temperatura, más apretadas si el volumen baja, y un manómetro que marca la presión.
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, SegmentedTabs, useTheme } from '@renderer/design'
import { ChemQuantity, type ChemUnit } from '@engine/chem/quantity'
import { Gases } from '@engine/chem/solutions'
import { formatNumber, parseNumber } from '../shared/lib/num'
import { CardTitle, ErrorLine, NumField, useComma, useStored } from '../shared/ui'
import { chemErrorText } from './lib/chem'

type Key = 'P' | 'V' | 'n' | 'T'
const UNIT: Record<Key, { unit: ChemUnit; label: string }> = { P: { unit: 'atmosphere', label: 'atm' }, V: { unit: 'liter', label: 'L' }, n: { unit: 'mole', label: 'mol' }, T: { unit: 'kelvin', label: 'K' } }

interface Saved {
  solve: Key
  P: string
  V: string
  n: string
  T: string
}

export default function Gas() {
  const { t, i18n } = useTranslation('tools')
  const es = i18n.language.startsWith('es')
  const comma = useComma()
  const [s, setS] = useStored<Saved>('aula.tools.chem.gas', { solve: 'P', P: '1', V: '22,4', n: '1', T: '273,15' })
  const res = useMemo(() => {
    const q = (k: Key) => {
      if (k === s.solve) return null
      const v = parseNumber(s[k])
      return v === null ? undefined : new ChemQuantity(v, UNIT[k].unit, s[k].trim().replace(',', '.'))
    }
    const vals = { P: q('P'), V: q('V'), n: q('n'), T: q('T') }
    if (Object.values(vals).some((v) => v === undefined)) return null
    try {
      const c = Gases.idealGas({ pressure: vals.P ?? null, volume: vals.V ?? null, amount: vals.n ?? null, temperature: vals.T ?? null, resultUnit: UNIT[s.solve].unit })
      return { ok: true as const, value: c.value }
    } catch (error) {
      return { ok: false as const, error }
    }
  }, [s])
  const val = (k: Key) => (k === s.solve ? (res?.ok ? res.value : null) : parseNumber(s[k]))
  const P = val('P') ?? 1
  const V = val('V') ?? 22.4
  const n = val('n') ?? 1
  const T = val('T') ?? 273

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card padded="lg" className="col-span-12 @4xl:col-span-5">
        <CardTitle
          title={t('chemistry.gasTitle')}
          detail={t('chemistry.gasHint')}
        />
        <SegmentedTabs size="sm" value={s.solve} onChange={(solve) => setS((p) => ({ ...p, solve }))} items={(['P', 'V', 'n', 'T'] as Key[]).map((k) => ({ id: k, label: t('chemistry.solveFor', { x: k }) }))} />
        <div className="grid grid-cols-2 gap-3 mt-4">
          {(['P', 'V', 'n', 'T'] as Key[]).map((k) =>
            k === s.solve ? (
              <div key={k}>
                <span className="block t-ui font-medium text-accent-text mb-1.5">{t(`chemistry.gas${k}`)}</span>
                <div className="h-9 rounded-[10px] bg-accent-wash px-3 flex items-center justify-between font-semibold tabular text-accent-text">
                  <span>{res?.ok ? formatNumber(res.value, { comma, sig: 4 }) : '?'}</span>
                  <span className="t-ui">{UNIT[k].label}</span>
                </div>
              </div>
            ) : (
              <NumField key={k} label={t(`chemistry.gas${k}`)} unit={UNIT[k].label} value={s[k]} onChange={(v) => setS((p) => ({ ...p, [k]: v }))} />
            )
          )}
        </div>
        {res?.ok && (
          <motion.div key={res.value} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-6 flex items-baseline gap-2">
            <span className="font-serif text-[22px] text-text3 italic">{s.solve} =</span>
            <span className="font-serif text-[46px] leading-none tracking-[-0.03em] tabular">{formatNumber(res.value, { comma, sig: 4 })}</span>
            <span className="t-headline text-text3">{UNIT[s.solve].label}</span>
          </motion.div>
        )}
        {res && !res.ok && (
          <div className="mt-4">
            <ErrorLine>{chemErrorText(res.error, es)}</ErrorLine>
          </div>
        )}
        <p className="t-footnote mt-4">R = 0{comma ? ',' : '.'}082057 L·atm/(mol·K)</p>
      </Card>
      <Card padded="lg" className="col-span-12 @4xl:col-span-7 flex flex-col">
        <div className="flex items-center justify-between gap-4">
          <div className="t-callout text-text2">{t('chemistry.gasBox')}</div>
          <Gauge p={P} />
        </div>
        <ParticleBox volume={V} moles={n} kelvin={T} />
      </Card>
    </div>
  )
}

/** Caja con partículas (canvas: sin coste de React en cada fotograma). */
function ParticleBox({ volume, moles, kelvin }: { volume: number; moles: number; kelvin: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { reducedMotion, dark } = useTheme()
  const state = useRef({ volume, moles, kelvin })
  state.current = { volume, moles, kelvin }
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const css = getComputedStyle(document.documentElement)
    const accent = css.getPropertyValue('--accent').trim() || '#b4502f'
    const line = css.getPropertyValue('--line-strong').trim() || '#847f7a'
    const N = 70
    const ps = Array.from({ length: N }, () => ({ x: Math.random(), y: Math.random(), a: Math.random() * Math.PI * 2 }))
    let wall = 1
    let raf = 0
    let last = performance.now()
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const dpr = window.devicePixelRatio || 1
      const W = canvas.clientWidth
      const H = canvas.clientHeight
      if (canvas.width !== W * dpr) {
        canvas.width = W * dpr
        canvas.height = H * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const { volume: v, moles: m, kelvin: k } = state.current
      const targetWall = Math.max(0.25, Math.min(1, Math.sqrt(Math.max(0, v) / 45)))
      wall += (targetWall - wall) * Math.min(1, dt * 6)
      const count = Math.max(4, Math.min(N, Math.round(Number.isFinite(m) ? m * 18 : 4)))
      const speed = reducedMotion ? 0 : 0.12 * Math.sqrt(Math.max(1, Number.isFinite(k) ? k : 273) / 273)
      const bw = (W - 24) * wall
      const x0 = 12
      const y0 = 10
      const bh = H - 20
      // pistón (pared derecha)
      ctx.strokeStyle = line
      ctx.globalAlpha = 0.6
      ctx.lineWidth = 1.5
      ctx.strokeRect(x0, y0, bw, bh)
      ctx.globalAlpha = 1
      ctx.fillStyle = line
      ctx.fillRect(x0 + bw - 2, y0, 4, bh)
      ctx.fillRect(x0 + bw, y0 + bh / 2 - 2, W, 4)
      ctx.fillStyle = accent
      for (let i = 0; i < count; i++) {
        const p = ps[i]
        p.x += Math.cos(p.a) * speed * dt * (H / Math.max(60, bw)) * 2
        p.y += Math.sin(p.a) * speed * dt * 2
        if (p.x < 0 || p.x > 1) {
          p.a = Math.PI - p.a
          p.x = Math.max(0, Math.min(1, p.x))
        }
        if (p.y < 0 || p.y > 1) {
          p.a = -p.a
          p.y = Math.max(0, Math.min(1, p.y))
        }
        const px = x0 + 6 + p.x * (bw - 14)
        const py = y0 + 6 + p.y * (bh - 12)
        ctx.globalAlpha = 0.85
        ctx.fillRect(Math.round(px) - 2, Math.round(py) - 2, 5, 5)
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [reducedMotion, dark])
  return <canvas ref={ref} className="mt-4 w-full flex-1 min-h-[220px]" style={{ imageRendering: 'pixelated' }} aria-hidden />
}

/** Manómetro: la aguja marca la presión (0–5 atm, escala comprimida por encima). */
function Gauge({ p }: { p: number }) {
  const comma = useComma()
  const frac = Math.max(0, Math.min(1, Math.log10(1 + Math.max(0, p)) / Math.log10(6)))
  const angle = -120 + frac * 240
  return (
    <div className="flex items-center gap-3 shrink-0">
      <svg width="64" height="64" viewBox="-32 -32 64 64" aria-hidden>
        <circle r="28" fill="var(--sunken)" stroke="var(--line)" />
        {Array.from({ length: 9 }, (_, i) => {
          const a = ((-120 + i * 30 - 90) * Math.PI) / 180
          return <line key={i} x1={Math.cos(a) * 22} y1={Math.sin(a) * 22} x2={Math.cos(a) * 26} y2={Math.sin(a) * 26} stroke="var(--line-strong)" strokeOpacity={0.6} />
        })}
        <motion.line x1={0} y1={0} x2={0} y2={-21} stroke="var(--accent)" strokeWidth={2.4} strokeLinecap="round" animate={{ rotate: angle }} transition={{ type: 'spring', stiffness: 80, damping: 12 }} />
        <circle r="3" fill="var(--accent)" />
      </svg>
      <div className="font-serif text-[22px] tabular">
        {formatNumber(p, { comma, sig: 3 })} <span className="t-ui text-text3 font-sans">atm</span>
      </div>
    </div>
  )
}
