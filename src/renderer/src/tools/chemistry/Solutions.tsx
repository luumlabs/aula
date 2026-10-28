// Disoluciones: molaridad (o la masa que hay que pesar) y dilución C₁V₁ = C₂V₂, con vasos que se llenan y se tiñen
// según el volumen y la concentración.
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, SegmentedTabs } from '@renderer/design'
import { ChemQuantity, type ChemUnit } from '@engine/chem/quantity'
import { Solutions as Sol } from '@engine/chem/solutions'
import { parseFormula } from '@engine/chem/parser'
import { formatNumber, parseNumber } from '../shared/lib/num'
import { CardTitle, ErrorLine, NumField, TextInput, useComma, useStored } from '../shared/ui'
import { chemErrorText } from './lib/chem'

interface MolSaved {
  mode: 'molarity' | 'mass'
  formula: string
  mass: string
  volume: string
  molarity: string
}

type DilKey = 'c1' | 'v1' | 'c2' | 'v2'
interface DilSaved {
  solve: DilKey
  c1: string
  v1: string
  c2: string
  v2: string
}

const q = (text: string, unit: ChemUnit): ChemQuantity | null => {
  const v = parseNumber(text)
  return v === null ? null : new ChemQuantity(v, unit, text.trim().replace(',', '.'))
}

export default function SolutionsTab() {
  return (
    <div className="grid grid-cols-12 gap-4">
      <Molarity />
      <Dilution />
    </div>
  )
}

function Molarity() {
  const { t, i18n } = useTranslation('tools')
  const es = i18n.language.startsWith('es')
  const comma = useComma()
  const [s, setS] = useStored<MolSaved>('aula.tools.chem.molarity', { mode: 'molarity', formula: 'NaCl', mass: '5,85', volume: '250', molarity: '0,1' })
  const res = useMemo(() => {
    try {
      const f = parseFormula(s.formula)
      const vol = q(s.volume, 'milliliter')
      if (!vol) return null
      if (s.mode === 'molarity') {
        const m = q(s.mass, 'gram')
        if (!m) return null
        const c = Sol.molarity(m, f, vol)
        return { ok: true as const, value: c.value, unit: 'mol/L', moles: c.value * vol.baseValue, conc: c.value }
      }
      const M = q(s.molarity, 'molar')
      if (!M) return null
      const c = Sol.soluteMass(M, vol, f)
      return { ok: true as const, value: c.value, unit: 'g', moles: M.baseValue * vol.baseValue, conc: M.baseValue }
    } catch (error) {
      return { ok: false as const, error }
    }
  }, [s])
  const vol = parseNumber(s.volume) ?? 0
  return (
    <Card padded="lg" className="col-span-12 @4xl:col-span-6">
      <CardTitle
        title={t('chemistry.molarityTitle')}
        actions={
          <SegmentedTabs
            size="sm"
            value={s.mode}
            onChange={(mode) => setS((p) => ({ ...p, mode }))}
            items={[
              { id: 'molarity', label: t('chemistry.molarity') },
              { id: 'mass', label: t('chemistry.massNeeded') }
            ]}
          />
        }
      />
      <div className="flex gap-5">
        <div className="flex-1 min-w-0 grid gap-3">
          <TextInput value={s.formula} onChange={(formula) => setS((p) => ({ ...p, formula }))} mono label={t('chemistry.solute')} />
          {s.mode === 'molarity' ? (
            <NumField label={t('chemistry.soluteMass')} unit="g" value={s.mass} onChange={(mass) => setS((p) => ({ ...p, mass }))} />
          ) : (
            <NumField label={t('chemistry.concentration')} unit="M" value={s.molarity} onChange={(molarity) => setS((p) => ({ ...p, molarity }))} />
          )}
          <NumField label={t('chemistry.solutionVolume')} unit="mL" value={s.volume} onChange={(volume) => setS((p) => ({ ...p, volume }))} />
        </div>
        <Beaker level={Math.min(1, vol / 1000)} tint={res?.ok ? Math.min(1, Math.log10(1 + res.conc * 10) / 1.5) : 0} label={`${formatNumber(vol, { comma, sig: 4 })} mL`} />
      </div>
      {res?.ok && (
        <motion.div key={`${res.value}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-[44px] leading-none tracking-[-0.03em] tabular">{formatNumber(res.value, { comma, sig: 4 })}</span>
            <span className="t-headline text-text3">{res.unit}</span>
          </div>
          <span className="t-callout text-text2 tabular">n = {formatNumber(res.moles, { comma, sig: 4 })} mol</span>
        </motion.div>
      )}
      {res && !res.ok && (
        <div className="mt-4">
          <ErrorLine>{chemErrorText(res.error, es)}</ErrorLine>
        </div>
      )}
    </Card>
  )
}

function Dilution() {
  const { t, i18n } = useTranslation('tools')
  const es = i18n.language.startsWith('es')
  const comma = useComma()
  const [s, setS] = useStored<DilSaved>('aula.tools.chem.dilution', { solve: 'v1', c1: '2', v1: '', c2: '0,5', v2: '250' })
  const res = useMemo(() => {
    const get = (k: DilKey) => (k === s.solve ? null : q(s[k], k.startsWith('c') ? 'molar' : 'milliliter'))
    const vals = { c1: get('c1'), v1: get('v1'), c2: get('c2'), v2: get('v2') }
    if (Object.entries(vals).some(([k, v]) => k !== s.solve && v === null)) return null
    try {
      return { ok: true as const, value: Sol.dilution(vals.c1, vals.v1, vals.c2, vals.v2).value }
    } catch (error) {
      return { ok: false as const, error }
    }
  }, [s])
  const num = (k: DilKey) => (k === s.solve ? (res?.ok ? res.value : null) : parseNumber(s[k]))
  const c1 = num('c1') ?? 0
  const v1 = num('v1') ?? 0
  const c2 = num('c2') ?? 0
  const v2 = num('v2') ?? 0
  const maxV = Math.max(v1, v2, 1)
  const maxC = Math.max(c1, c2, 1e-9)
  const field = (k: DilKey, label: string, unit: string) =>
    k === s.solve ? (
      <div>
        <span className="block t-ui font-medium text-accent-text mb-1.5">{label}</span>
        <div className="h-9 rounded-[10px] bg-accent-wash px-3 flex items-center justify-between font-semibold tabular text-accent-text">
          <span>{res?.ok ? formatNumber(res.value, { comma, sig: 4 }) : '?'}</span>
          <span className="t-ui text-accent-text/80">{unit}</span>
        </div>
      </div>
    ) : (
      <NumField label={label} unit={unit} value={s[k]} onChange={(v) => setS((p) => ({ ...p, [k]: v }))} />
    )
  return (
    <Card padded="lg" className="col-span-12 @4xl:col-span-6">
      <CardTitle
        title={t('chemistry.dilutionTitle')}
        detail="C₁·V₁ = C₂·V₂"
        actions={
          <SegmentedTabs
            size="sm"
            value={s.solve}
            onChange={(solve) => setS((p) => ({ ...p, solve }))}
            items={[
              { id: 'c1', label: 'C₁' },
              { id: 'v1', label: 'V₁' },
              { id: 'c2', label: 'C₂' },
              { id: 'v2', label: 'V₂' }
            ]}
          />
        }
      />
      <div className="grid grid-cols-2 gap-3">
        {field('c1', t('chemistry.c1'), 'M')}
        {field('v1', t('chemistry.v1'), 'mL')}
        {field('c2', t('chemistry.c2'), 'M')}
        {field('v2', t('chemistry.v2'), 'mL')}
      </div>
      <div className="mt-5 flex items-end justify-center gap-8">
        <Beaker level={v1 / maxV} tint={c1 / maxC} label={t('chemistry.stock')} small />
        <svg width="46" height="20" viewBox="0 0 46 20" className="mb-12 text-text3" aria-hidden>
          <path d="M2 10 H40 M33 4 L41 10 L33 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <Beaker level={v2 / maxV} tint={c2 / maxC} label={t('chemistry.diluted')} small />
      </div>
      {res && !res.ok && (
        <div className="mt-4">
          <ErrorLine>{chemErrorText(res.error, es)}</ErrorLine>
        </div>
      )}
    </Card>
  )
}

/** Vaso de precipitados: el líquido sube con el volumen y se tiñe con la concentración (un solo tono). */
export function Beaker({ level, tint, label, small }: { level: number; tint: number; label?: string; small?: boolean }) {
  const w = small ? 92 : 120
  const h = small ? 112 : 150
  const inner = { x: 10, y: 14, w: w - 20, h: h - 22 }
  const lv = Math.max(0.04, Math.min(1, Number.isFinite(level) ? level : 0))
  const liquidH = inner.h * lv
  const pct = Math.round(10 + Math.max(0, Math.min(1, tint)) * 55)
  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <defs>
          <clipPath id={`beaker-${w}`}>
            <path d={`M${inner.x} ${inner.y} V${h - 14} Q${inner.x} ${h - 6} ${inner.x + 8} ${h - 6} H${w - inner.x - 8} Q${w - inner.x} ${h - 6} ${w - inner.x} ${h - 14} V${inner.y} Z`} />
          </clipPath>
        </defs>
        <g clipPath={`url(#beaker-${w})`}>
          <motion.rect x={0} width={w} initial={{ y: h, height: 0 }} animate={{ y: h - 6 - liquidH, height: liquidH + 6 }} transition={{ type: 'spring', stiffness: 120, damping: 18 }} fill={`color-mix(in oklab, var(--accent) ${pct}%, transparent)`} />
          <motion.rect x={0} width={w} height={2} initial={{ y: h }} animate={{ y: h - 6 - liquidH }} transition={{ type: 'spring', stiffness: 120, damping: 18 }} fill={`color-mix(in oklab, var(--accent) ${pct + 20}%, transparent)`} />
        </g>
        <path d={`M4 ${inner.y - 6} H${inner.x} V${h - 14} Q${inner.x} ${h - 6} ${inner.x + 8} ${h - 6} H${w - inner.x - 8} Q${w - inner.x} ${h - 6} ${w - inner.x} ${h - 14} V${inner.y - 6}`} fill="none" stroke="var(--line-strong)" strokeOpacity={0.7} strokeWidth={1.6} strokeLinejoin="round" />
        {[0.25, 0.5, 0.75].map((m) => (
          <line key={m} x1={w - inner.x - 12} x2={w - inner.x - 2} y1={h - 6 - inner.h * m} y2={h - 6 - inner.h * m} stroke="var(--line-strong)" strokeOpacity={0.5} />
        ))}
      </svg>
      {label && <span className="t-caption tabular">{label}</span>}
    </div>
  )
}
