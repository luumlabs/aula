// Masa molar: escribes una fórmula y ves su masa (la cifra cuenta hasta su valor), la suma desglosada y un donut con la
// composición en masa que se dibuja trozo a trozo.
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, cx, useTheme } from '@renderer/design'
import { PeriodicTable, localizedElementName } from '@engine/chem/elements'
import { nameOf } from '@engine/chem/nomenclature'
import { Tex } from '../shared/Tex'
import { formatFixed, formatNumber, parseNumber, percentSign } from '../shared/lib/num'
import { seriesColor } from '../shared/palette'
import { CardTitle, CountUp, ErrorLine, Examples, NumField, TextInput, useComma, useStored } from '../shared/ui'
import { arcPath, chemErrorText, donutArcs, molarView, type MolarView } from './lib/chem'

const EXAMPLES = ['H2O', 'NaCl', 'C6H12O6', 'Ca(OH)2', 'CuSO4·5H2O', '(NH4)3PO4', 'C8H10N4O2']

export default function MolarMass() {
  const { t, i18n } = useTranslation('tools')
  const es = i18n.language.startsWith('es')
  const comma = useComma()
  const [text, setText] = useStored('aula.tools.chem.molar', 'C6H12O6')
  const res = useMemo(() => molarView(text), [text])
  const last = useRef<MolarView | null>(null)
  if (res?.ok) last.current = res
  const v = res?.ok ? res : last.current
  const stale = !res?.ok
  const name = useMemo(() => {
    if (!es || !res?.ok) return null
    try {
      return nameOf(res.formula)?.name ?? null
    } catch {
      return null
    }
  }, [es, res])
  const sum = v
    ? v.parts.map((p) => `${p.count === 1 ? '' : `${p.count}\\times`}${(comma ? p.massText.replace('.', '{,}') : p.massText)}`).join(' + ') + ` = ${formatFixed(v.value, v.decimals, comma).replace(',', '{,}')}`
    : ''

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card padded="lg" className="col-span-12 @4xl:col-span-7 flex flex-col">
        <TextInput value={text} onChange={setText} mono label={t('chemistry.formula')} placeholder="C6H12O6" ariaLabel={t('chemistry.formula')} invalid={!!res && !res.ok} />
        <div className="mt-2.5">
          <Examples items={EXAMPLES} onPick={setText} />
        </div>
        {res && !res.ok && (
          <div className="mt-3">
            <ErrorLine>{chemErrorText(res.error, es)}</ErrorLine>
          </div>
        )}
        {v && (
          <motion.div className={cx('mt-6 transition-opacity', stale && 'opacity-40')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: stale ? 0.4 : 1, y: 0 }}>
            <div className="text-[34px] leading-tight overflow-x-auto overflow-y-hidden">
              <Tex tex={v.ce} />
            </div>
            {name && <div className="t-callout text-text2 mt-1 first-letter:uppercase">{name}</div>}
            <div className="mt-5 flex items-baseline gap-2">
              <CountUp value={v.value} decimals={v.decimals} className="font-serif text-[56px] leading-none tracking-[-0.03em]" />
              <span className="t-headline text-text3">g/mol</span>
            </div>
            <div className="mt-4 text-[15px] text-text2 overflow-x-auto overflow-y-hidden">
              <Tex tex={sum} />
            </div>
            {v.approximate && <div className="t-footnote mt-2 text-warning">{t('chemistry.approxMass')}</div>}
            <MassMoles molar={v.value} />
          </motion.div>
        )}
      </Card>
      <Card padded className="col-span-12 @4xl:col-span-5">
        <CardTitle title={t('chemistry.composition')} detail={t('chemistry.compositionHint')} />
        {v ? <Donut v={v} key={v.ce} /> : <div className="t-callout text-text3">{t('chemistry.typeFormula')}</div>}
      </Card>
    </div>
  )
}

/** Conversor rápido gramos ↔ moles con la masa molar de la fórmula. */
function MassMoles({ molar }: { molar: number }) {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const [grams, setGrams] = useStored('aula.tools.chem.grams', '10')
  const g = parseNumber(grams)
  return (
    <div className="mt-6 pt-5 border-t-[0.5px] border-line-soft flex flex-wrap items-end gap-3">
      <NumField label={t('chemistry.mass')} unit="g" value={grams} onChange={setGrams} className="w-36" />
      <span className="pb-2 text-text3">=</span>
      <div className="pb-1.5">
        <span className="font-serif text-[26px] tabular">{g === null ? '—' : formatNumber(g / molar, { comma, sig: 4 })}</span>
        <span className="t-ui text-text3 ml-1.5">mol</span>
      </div>
      <span className="pb-2 t-footnote">{t('chemistry.massMolesHint')}</span>
    </div>
  )
}

function Donut({ v }: { v: MolarView }) {
  const { dark } = useTheme()
  const { i18n } = useTranslation('tools')
  const comma = useComma()
  const [hover, setHover] = useState<number | null>(null)
  const arcs = donutArcs(v.parts.map((p) => p.percent))
  const size = 200
  const r = 78
  const focus = hover !== null ? v.parts[hover] : v.parts.reduce((a, b) => (b.percent > a.percent ? b : a), v.parts[0])
  const lang = i18n.language.startsWith('es') ? 'es' : 'en'
  return (
    <div className="flex flex-col items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" onMouseLeave={() => setHover(null)}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill2)" strokeWidth={26} />
        {arcs.map((a, i) => (
          <motion.path
            key={i}
            d={arcPath(size / 2, size / 2, r, a.start, a.end)}
            fill="none"
            stroke={seriesColor(i, dark)}
            strokeWidth={hover === i ? 32 : 26}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1, opacity: hover === null || hover === i ? 1 : 0.35 }}
            transition={{ pathLength: { duration: 0.55, delay: 0.1 + i * 0.22, ease: [0.3, 0.6, 0.3, 1] }, opacity: { duration: 0.2 } }}
            onMouseEnter={() => setHover(i)}
            style={{ cursor: 'default' }}
          />
        ))}
        {focus && (
          <>
            <text x={size / 2} y={size / 2 - 4} textAnchor="middle" fontSize={30} fontFamily="var(--font-serif)" fill="var(--text)" className="tabular">
              {formatNumber(focus.percent, { comma, sig: 3, maxDecimals: 1 })}{percentSign(comma)}
            </text>
            <text x={size / 2} y={size / 2 + 20} textAnchor="middle" fontSize={13} fill="var(--text2)">
              {focus.symbol}
            </text>
          </>
        )}
      </svg>
      <div className="w-full min-w-0">
        {v.parts.map((p, i) => {
          const el = PeriodicTable.byNumber(p.z)
          return (
            <motion.div
              key={p.symbol}
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: hover === null || hover === i ? 1 : 0.5, x: 0 }}
              transition={{ delay: 0.15 + i * 0.08 }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className="flex items-center gap-2.5 py-1.5 border-t-[0.5px] border-line-soft first:border-t-0"
            >
              <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: seriesColor(i, dark) }} />
              <span className="w-7 t-headline">{p.symbol}</span>
              <span className="flex-1 min-w-0 truncate t-ui text-text2">
                {el ? localizedElementName(el, lang) : ''} · {p.count} × {comma ? p.massText.replace('.', ',') : p.massText}
              </span>
              <span className="t-number-inline text-text tabular">{formatNumber(p.percent, { comma, sig: 4, maxDecimals: 2 })}{percentSign(comma)}</span>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
