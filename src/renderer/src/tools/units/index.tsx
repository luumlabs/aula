// Conversor de unidades: eliges la magnitud, escribes un valor y lo ves en la otra unidad al instante. El botón de
// intercambiar da la vuelta a las dos tarjetas; abajo, el mismo valor en todas las unidades de la magnitud.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftRight, ArrowUpDown, Clock, Database, Droplet, Gauge, Move, Ruler, RotateCw, Scale, Square, Thermometer, Weight, Zap, Plug } from 'lucide-react'
import { Card, Select, cx, spring, useTheme } from '@renderer/design'
import { formatNumber, parseNumber } from '../shared/lib/num'
import { useComma, useCopy, useStored } from '../shared/ui'
import type { ToolProps } from '../registry'
import { CATEGORIES, categoryById, convert, ratio, unitIn, type UnitDef } from './lib/catalog'

const ICONS: Record<string, typeof Ruler> = {
  length: Ruler, mass: Weight, temperature: Thermometer, time: Clock, volume: Droplet, area: Square, speed: Gauge,
  energy: Zap, pressure: Gauge, power: Plug, force: Move, angle: RotateCw, data: Database
}

interface Saved {
  cat: string
  from: Record<string, string>
  to: Record<string, string>
  value: string
}

export default function UnitsTool({ compact }: ToolProps) {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const copy = useCopy()
  const { reducedMotion } = useTheme()
  const [saved, setSaved] = useStored<Saved>('aula.tools.units', { cat: 'length', from: {}, to: {}, value: '1' })
  const [turns, setTurns] = useState(0)
  const cat = categoryById(saved.cat)
  const from = unitIn(cat, saved.from[cat.id] ?? cat.from)
  const to = unitIn(cat, saved.to[cat.id] ?? cat.to)
  const v = parseNumber(saved.value)
  const result = v === null ? null : convert(v, from, to)
  const fmt = (x: number) => formatNumber(x, { comma, sig: 10, maxDecimals: 12 })
  const unitName = (u: UnitDef) => t(`units.u.${u.id}`)

  const setCat = (id: string) => setSaved((s) => ({ ...s, cat: id }))
  const setFrom = (id: string) => setSaved((s) => ({ ...s, from: { ...s.from, [cat.id]: id } }))
  const setTo = (id: string) => setSaved((s) => ({ ...s, to: { ...s.to, [cat.id]: id } }))
  const swap = () => {
    setTurns((n) => n + 1)
    setSaved((s) => ({ ...s, from: { ...s.from, [cat.id]: to.id }, to: { ...s.to, [cat.id]: from.id }, value: result !== null ? formatNumber(result, { comma, sig: 10, maxDecimals: 12, group: false }) : s.value }))
  }
  const options = cat.units.map((u) => ({ value: u.id, label: `${unitName(u)}`, hint: u.symbol }))
  const r = ratio(from, to)

  const fromPane = (
    <motion.div key={`from-${turns}`} initial={turns ? { rotateX: -80, opacity: 0 } : false} animate={{ rotateX: 0, opacity: 1 }} transition={spring.smooth} className="min-w-0 flex-1 [transform-origin:50%_50%]">
      <Select value={from.id} options={options} onChange={setFrom} label={t('units.from')} />
      <div className="mt-3 flex items-baseline gap-2 rounded-[16px] bg-sunken border-[0.5px] border-line px-4 py-3 focus-within:border-accent-line focus-within:shadow-[0_0_0_3px_var(--accent-wash)] transition">
        <input
          value={saved.value}
          inputMode="decimal"
          aria-label={t('units.value')}
          onChange={(e) => setSaved((s) => ({ ...s, value: e.target.value }))}
          className={cx('min-w-0 flex-1 bg-transparent outline-none font-serif tabular tracking-[-0.02em] text-text', compact ? 'text-[26px] leading-[34px]' : 'text-[38px] leading-[46px]')}
        />
        <span className="t-headline text-text3 shrink-0">{from.symbol}</span>
      </div>
    </motion.div>
  )
  const toPane = (
    <motion.div key={`to-${turns}`} initial={turns ? { rotateX: 80, opacity: 0 } : false} animate={{ rotateX: 0, opacity: 1 }} transition={{ ...spring.smooth, delay: 0.05 }} className="min-w-0 flex-1 [transform-origin:50%_50%]">
      <Select value={to.id} options={options} onChange={setTo} label={t('units.to')} />
      <button
        onClick={() => result !== null && copy(fmt(result))}
        title={t('common.copy')}
        className="mt-3 w-full flex items-baseline gap-2 rounded-[16px] bg-accent-wash px-4 py-3 text-left min-w-0"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={`${result}-${to.id}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className={cx('min-w-0 flex-1 truncate font-serif tabular tracking-[-0.02em] text-accent-text', compact ? 'text-[26px] leading-[34px]' : 'text-[38px] leading-[46px]')}
          >
            {/* la cifra grande, redondeada para que quepa (6 cifras significativas); la completa está en la lista de abajo */}
            {result === null ? '—' : formatNumber(result, { comma, sig: 6, maxDecimals: 8 })}
          </motion.span>
        </AnimatePresence>
        <span className="t-headline text-accent-text/80 shrink-0">{to.symbol}</span>
      </button>
    </motion.div>
  )
  const swapButton = (
    <motion.button
      onClick={swap}
      aria-label={t('units.swap')}
      title={t('units.swap')}
      animate={{ rotate: reducedMotion ? 0 : turns * 180 }}
      transition={spring.bouncy}
      whileTap={{ scale: 0.9 }}
      className={cx('grid place-items-center shrink-0 w-11 h-11 rounded-full bg-raised border-[0.5px] border-line shadow-[var(--e2)] text-text2 hover:text-accent-text', compact ? 'self-center' : 'self-center @2xl:mt-7')}
    >
      {compact ? (
        <ArrowUpDown size={18} />
      ) : (
        <>
          <ArrowUpDown size={18} className="@2xl:hidden" />
          <ArrowLeftRight size={18} className="hidden @2xl:block" />
        </>
      )}
    </motion.button>
  )

  if (compact) {
    return (
      <div className="p-4 flex flex-col gap-3 [perspective:900px]">
        <Select value={cat.id} options={CATEGORIES.map((c) => ({ value: c.id, label: t(`units.cat.${c.id}`) }))} onChange={setCat} />
        {fromPane}
        {swapButton}
        {toPane}
      </div>
    )
  }

  return (
    <div className="grid gap-4 grid-cols-12">
      <Card padded className="col-span-12">
        <CategoryStrip value={cat.id} onChange={setCat} />
      </Card>
      <Card padded="lg" className="col-span-12 @5xl:col-span-7">
        <div className="flex flex-col @2xl:flex-row gap-4 [perspective:900px]">
          {fromPane}
          {swapButton}
          {toPane}
        </div>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 t-callout text-text2">
          {r !== null ? (
            <>
              <span>
                1 {from.symbol} = <span className="tabular text-text">{fmt(r)}</span> {to.symbol}
              </span>
              <span>
                1 {to.symbol} = <span className="tabular text-text">{fmt(1 / r)}</span> {from.symbol}
              </span>
            </>
          ) : (
            <TemperatureFormula from={from} to={to} />
          )}
        </div>
        {cat.id === 'temperature' && v !== null && <Thermo celsius={convert(v, from, unitIn(cat, 'C'))} />}
      </Card>
      <Card padded={false} className="col-span-12 @5xl:col-span-5 overflow-hidden">
        <div className="px-5 pt-4 pb-2 font-serif text-[19px]">{t('units.all', { value: saved.value || '—', unit: from.symbol })}</div>
        <div className="max-h-[440px] overflow-y-auto pb-2">
          {cat.units.map((u, i) => {
            const x = v === null ? null : convert(v, from, u)
            const on = u.id === to.id
            return (
              <motion.button
                key={`${cat.id}-${u.id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 14) * 0.025, duration: 0.3 }}
                onClick={() => setTo(u.id)}
                className={cx('w-full flex items-center gap-3 px-5 h-11 text-left transition-colors border-t-[0.5px] border-line-soft first:border-t-0', on ? 'bg-accent-wash' : 'hover:bg-fill1', u.id === from.id && 'opacity-60')}
              >
                <span className="flex-1 min-w-0 truncate t-callout text-text2">{unitName(u)}</span>
                <span className={cx('tabular t-number-inline truncate max-w-[60%]', on ? 'text-accent-text' : 'text-text')}>{x === null ? '—' : fmt(x)}</span>
                <span className="w-10 t-ui text-text3 shrink-0">{u.symbol}</span>
              </motion.button>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

function CategoryStrip({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation('tools')
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist">
      {CATEGORIES.map((c) => {
        const Icon = ICONS[c.id] ?? Scale
        const on = c.id === value
        return (
          <button key={c.id} role="tab" aria-selected={on} onClick={() => onChange(c.id)} className={cx('relative h-9 px-3.5 rounded-full inline-flex items-center gap-2 t-ui font-medium transition-colors', on ? 'text-accent-text' : 'text-text2 hover:text-text hover:bg-fill1')}>
            {on && <motion.span layoutId="units-cat" transition={spring.snappy} className="absolute inset-0 rounded-full bg-accent-wash" />}
            <Icon size={15} className="relative" />
            <span className="relative">{t(`units.cat.${c.id}`)}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Fórmula de conversión de temperaturas (no proporcionales). */
function TemperatureFormula({ from, to }: { from: UnitDef; to: UnitDef }) {
  const key = `${from.id}${to.id}`
  const f: Record<string, string> = { CF: '°F = °C × 9/5 + 32', FC: '°C = (°F − 32) × 5/9', CK: 'K = °C + 273,15', KC: '°C = K − 273,15', FK: 'K = (°F + 459,67) × 5/9', KF: '°F = K × 9/5 − 459,67' }
  const comma = useComma()
  const text = f[key]
  if (!text) return null
  return <span className="font-mono text-[13px]">{comma ? text : text.replace(/(\d),(\d)/g, '$1.$2')}</span>
}

/** Termómetro pixel-art que sube y baja con la temperatura (de −40 °C a 120 °C). */
function Thermo({ celsius }: { celsius: number }) {
  const { t } = useTranslation('tools')
  const pct = Math.max(0, Math.min(1, (celsius + 40) / 160))
  const cells = 20
  const lit = Math.round(pct * cells)
  const marks = useMemo(() => [-40, 0, 37, 100], [])
  const label = celsius <= 0 ? t('units.freezing') : celsius >= 100 ? t('units.boiling') : celsius >= 36 && celsius <= 38 ? t('units.body') : null
  return (
    <div className="mt-6 flex items-center gap-4">
      <div className="relative flex-1">
        <div className="flex gap-[3px]">
          {Array.from({ length: cells }, (_, i) => (
            <motion.span
              key={i}
              className="h-3 flex-1 rounded-[2px]"
              animate={{ background: i < lit ? 'var(--accent)' : 'var(--fill2)', opacity: i < lit ? 0.45 + (0.55 * (i + 1)) / cells : 1 }}
              transition={{ duration: 0.25, delay: i * 0.012 }}
            />
          ))}
        </div>
        <div className="relative h-4 mt-1">
          {marks.map((m) => (
            <span key={m} className={cx('absolute t-caption whitespace-nowrap', m === -40 ? '' : '-translate-x-1/2')} style={{ left: `${((m + 40) / 160) * 100}%` }}>
              {m} °C
            </span>
          ))}
        </div>
      </div>
      {label && <span className="t-ui text-text2 shrink-0">{label}</span>}
    </div>
  )
}
