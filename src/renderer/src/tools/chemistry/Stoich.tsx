// Estequiometría: con las cantidades de los reactivos encuentra el reactivo limitante, lo que sobra de cada uno y lo que
// se forma (rendimiento teórico y, si das el real, el porcentual). Las barras muestran cuánto se gasta de cada reactivo.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, LiveDot, Select, cx } from '@renderer/design'
import { solveStoichiometry, type StoichiometryReport } from '@engine/chem/stoichiometry'
import { Tex } from '../shared/Tex'
import { formatNumber, percentSign } from '../shared/lib/num'
import { CardTitle, CountUp, ErrorLine, Examples, TextInput, useComma, useStored } from '../shared/ui'
import { balanceView, chemErrorText } from './lib/chem'

const EXAMPLES = ['2H2 + O2 -> 2H2O', 'N2 + H2 -> NH3', 'Fe2O3 + CO -> Fe + CO2', 'C3H8 + O2 -> CO2 + H2O']

interface Saved {
  eq: string
  given: Record<string, string>
  target: string
}

export default function Stoich() {
  const { t, i18n } = useTranslation('tools')
  const es = i18n.language.startsWith('es')
  const comma = useComma()
  const [s, setS] = useStored<Saved>('aula.tools.chem.stoich', { eq: '2H2 + O2 -> 2H2O', given: { H2: '4 g', O2: '16 g' }, target: 'H2O' })
  const [actual, setActual] = useState('')
  const bv = useMemo(() => balanceView(s.eq), [s.eq])
  const terms = bv && (bv.status === 'balanced' || bv.status === 'alreadyBalanced') ? bv.terms : []
  const reactants = terms.filter((x) => x.side === 'reactants')
  const target = terms.some((x) => x.plain === s.target) ? s.target : (terms.find((x) => x.side === 'products')?.plain ?? '')
  const result = useMemo((): { ok: true; r: StoichiometryReport } | { ok: false; error: unknown } | null => {
    const given: Record<string, string> = {}
    for (const r of reactants) {
      const v = s.given[r.plain]?.trim()
      if (v) given[r.plain] = v
    }
    if (!terms.length || !Object.keys(given).length) return null
    try {
      return { ok: true, r: solveStoichiometry(s.eq, given, target || null, actual.trim() || null) }
    } catch (error) {
      return { ok: false, error }
    }
  }, [s.eq, s.given, target, actual, terms, reactants])
  const fmt = (x: number | null) => (x === null ? '—' : formatNumber(x, { comma, sig: 4 }))
  const r = result?.ok ? result.r : null

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card padded="lg" className="col-span-12 @4xl:col-span-7">
        <TextInput value={s.eq} onChange={(eq) => setS((x) => ({ ...x, eq }))} mono label={t('chemistry.equation')} ariaLabel={t('chemistry.equation')} />
        <div className="mt-2.5">
          <Examples items={EXAMPLES} onPick={(eq) => setS((x) => ({ ...x, eq }))} />
        </div>
        {bv && bv.ce && terms.length > 0 && (
          <div className="mt-5 text-[20px] overflow-x-auto overflow-y-hidden">
            <Tex tex={bv.ce} />
          </div>
        )}
        {bv && !terms.length && <div className="mt-4 t-callout text-danger">{es ? bv.message : t('chemistry.cantBalance')}</div>}
        {terms.length > 0 && (
          <div className="mt-5 grid gap-3 @2xl:grid-cols-2">
            {reactants.map((x) => (
              <label key={x.plain} className="block">
                <span className="flex items-center gap-1.5 t-ui font-medium text-text2 mb-1.5">
                  <Tex tex={`\\ce{${x.ce}}`} />
                  {r?.limitingReagent?.plainText === x.plain && <span className="t-caption text-accent-text">· {t('chemistry.limiting')}</span>}
                </span>
                <input
                  value={s.given[x.plain] ?? ''}
                  onChange={(e) => setS((p) => ({ ...p, given: { ...p.given, [x.plain]: e.target.value } }))}
                  placeholder={comma ? '10 g · 0,5 mol' : '10 g · 0.5 mol'}
                  className="w-full h-9 rounded-[10px] bg-field border-[0.5px] border-line-strong/40 px-3 text-[14px] outline-none focus:border-accent-line focus:shadow-[0_0_0_3px_var(--accent-wash)] tabular"
                />
              </label>
            ))}
            <div>
              <span className="block t-ui font-medium text-text2 mb-1.5">{t('chemistry.find')}</span>
              <Select value={target} onChange={(v) => setS((p) => ({ ...p, target: v }))} options={terms.map((x) => ({ value: x.plain, label: <Tex tex={`\\ce{${x.ce}}`} /> }))} />
            </div>
            <label className="block">
              <span className="block t-ui font-medium text-text2 mb-1.5">{t('chemistry.actualYield')}</span>
              <input value={actual} onChange={(e) => setActual(e.target.value)} placeholder={t('chemistry.optional')} className="w-full h-9 rounded-[10px] bg-field border-[0.5px] border-line-strong/40 px-3 text-[14px] outline-none focus:border-accent-line tabular" />
            </label>
          </div>
        )}
        <p className="t-footnote mt-4">{t('chemistry.amountHint')}</p>
        {result && !result.ok && (
          <div className="mt-3">
            <ErrorLine>{chemErrorText(result.error, es)}</ErrorLine>
          </div>
        )}
      </Card>

      <Card padded="lg" className="col-span-12 @4xl:col-span-5" wash={r?.limitingReagent ? 'var(--accent)' : undefined}>
        {r ? (
          <div className="flex flex-col gap-6">
            {r.limitingReagent && (
              <div>
                <div className="flex items-center gap-2 t-eyebrow">
                  <LiveDot color="var(--accent)" size={6} />
                  {t('chemistry.limitingReagent')}
                </div>
                <motion.div key={r.limitingReagent.plainText} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-2 text-[34px]">
                  <Tex tex={r.limitingReagent.ce} />
                </motion.div>
              </div>
            )}
            {r.target && r.targetGrams !== null && (
              <div>
                <div className="t-eyebrow">{r.target && terms.find((x) => x.plain === r.target?.plainText)?.side === 'products' ? t('chemistry.theoretical') : t('chemistry.needed')}</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <CountUp value={r.targetGrams} decimals={r.targetGrams >= 100 ? 1 : 2} className="font-serif text-[48px] leading-none tracking-[-0.03em]" />
                  <span className="t-headline text-text3">g</span>
                  <span className="text-[18px] ml-1">
                    <Tex tex={r.target.ce} />
                  </span>
                </div>
                <div className="t-callout text-text2 mt-1 tabular">= {fmt(r.targetMoles)} mol</div>
              </div>
            )}
            {r.percentYield !== null && (
              <div>
                <div className="t-eyebrow">{t('chemistry.percentYield')}</div>
                <div className="mt-1 font-serif text-[30px] tabular">{formatNumber(r.percentYield, { comma, sig: 3, maxDecimals: 1 })}{percentSign(comma)}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="t-callout text-text3">{t('chemistry.stoichEmpty')}</div>
        )}
      </Card>

      {r && (
        <Card padded className="col-span-12 overflow-x-auto">
          <CardTitle title={t('chemistry.table')} />
          <table className="w-full text-[13.5px] tabular min-w-[560px]">
            <thead>
              <tr className="t-caption text-left">
                <th className="font-medium py-1.5">{t('chemistry.species')}</th>
                <th className="font-medium py-1.5 text-right">M (g/mol)</th>
                <th className="font-medium py-1.5 text-right">{t('chemistry.givenMol')}</th>
                <th className="font-medium py-1.5 text-right">{t('chemistry.changeMol')}</th>
                <th className="font-medium py-1.5 text-right">{t('chemistry.leftMol')}</th>
                <th className="font-medium py-1.5 pl-4 w-[28%]">{t('chemistry.used')}</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l, i) => {
                const used = l.givenMoles ? Math.min(1, l.changeMoles / l.givenMoles) : null
                const lim = r.limitingReagent?.plainText === l.formula.plainText
                return (
                  <tr key={i} className={cx('border-t-[0.5px] border-line-soft', lim && 'bg-accent-wash')}>
                    <td className="py-2 pr-2">
                      <Tex tex={`${l.coefficient.toNumber() === 1 ? '' : l.coefficient.toNumber() + '\\,'}${l.formula.ce}`} />
                    </td>
                    <td className="py-2 text-right text-text2">{fmt(l.molarMass)}</td>
                    <td className="py-2 text-right">{fmt(l.givenMoles)}</td>
                    <td className="py-2 text-right">
                      {l.isReactant ? '−' : '+'}
                      {fmt(l.changeMoles)}
                    </td>
                    <td className="py-2 text-right">{fmt(l.remainingMoles)}</td>
                    <td className="py-2 pl-4">
                      {used !== null ? (
                        <div className="h-2 rounded-full bg-fill2 overflow-hidden">
                          <motion.div className="h-full rounded-full" style={{ background: lim ? 'var(--accent)' : 'var(--text3)' }} initial={{ width: 0 }} animate={{ width: `${used * 100}%` }} transition={{ duration: 0.8, delay: 0.2 + i * 0.1 }} />
                        </div>
                      ) : (
                        <span className="t-caption">{l.isReactant ? '' : t('chemistry.forms')}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
