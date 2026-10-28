// Balanceo: los coeficientes caen en su sitio uno a uno y la tabla comprueba los átomos de cada lado (antes y después).
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Check, X } from 'lucide-react'
import { Card, cx, spring, useTheme } from '@renderer/design'
import { ChemicalEquation } from '@engine/chem/equation'
import { Tex } from '../shared/Tex'
import { CardTitle, Examples, TextInput, useStored } from '../shared/ui'
import { balanceView, englishBalanceMessage } from './lib/chem'

const EXAMPLES = ['Fe + O2 -> Fe2O3', 'C3H8 + O2 -> CO2 + H2O', 'Al + H2SO4 -> Al2(SO4)3 + H2', 'KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2', 'NH3 + O2 -> NO + H2O']

export default function Balance() {
  const { t, i18n } = useTranslation('tools')
  const es = i18n.language.startsWith('es')
  const [text, setText] = useStored('aula.tools.chem.balance', 'C3H8 + O2 -> CO2 + H2O')
  const v = useMemo(() => balanceView(text), [text])
  // átomos tal como se escribió (para ver qué fallaba antes de balancear)
  const before = useMemo(() => {
    try {
      const eq = ChemicalEquation.parse(text)
      const l = eq.atomTotals('reactants')
      const r = eq.atomTotals('products')
      const m = new Map<string, { left: number; right: number }>()
      for (const [k, q] of l) m.set(k.symbol, { left: q.toNumber(), right: 0 })
      for (const [k, q] of r) m.set(k.symbol, { left: m.get(k.symbol)?.left ?? 0, right: q.toNumber() })
      return m
    } catch {
      return null
    }
  }, [text])
  const ok = v?.status === 'balanced' || v?.status === 'alreadyBalanced' || v?.status === 'multipleSolutions'
  const message = v ? (es ? v.message.replace(/^Ecuación balanceada: .*/, t('chemistry.balancedOk')) : englishBalanceMessage(v.status)) : ''

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card padded="lg" className="col-span-12">
        <TextInput value={text} onChange={setText} mono label={t('chemistry.equation')} placeholder="Fe + O2 -> Fe2O3" ariaLabel={t('chemistry.equation')} />
        <div className="mt-2.5">
          <Examples items={EXAMPLES} onPick={setText} />
        </div>
        <div className="mt-7 min-h-[64px]">
          {v && ok && (
            <div key={v.ce} className="flex flex-wrap items-center gap-x-3 gap-y-3 text-[26px]">
              {v.terms.map((term, i) => {
                const firstProduct = term.side === 'products' && (i === 0 || v.terms[i - 1].side === 'reactants')
                return (
                  <span key={`${i}-${term.ce}`} className="inline-flex items-center gap-3">
                    {i > 0 && (
                      <span className="text-text3 font-serif">{firstProduct ? <Tex tex={v.reversible ? '\\rightleftharpoons' : '\\longrightarrow'} /> : '+'}</span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      <motion.span
                        key={`${term.coef}`}
                        initial={{ opacity: 0, y: -18, scale: 1.5 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ ...spring.bouncy, delay: 0.15 + i * 0.12 }}
                        className={cx('font-serif tabular min-w-[0.6em] text-center', term.coef === 1 ? 'text-text3/50' : 'text-accent-text')}
                      >
                        {term.coef === 1 ? '' : term.coef}
                      </motion.span>
                      <Tex tex={`\\ce{${term.ce}}`} />
                    </span>
                  </span>
                )
              })}
            </div>
          )}
          {v && (
            <motion.div key={v.status + text} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className={cx('mt-4 t-callout', ok ? 'text-text2' : 'text-danger')}>
              {message}
            </motion.div>
          )}
        </div>
      </Card>
      {v && ok && v.atoms.length > 0 && (
        <Card padded className="col-span-12 @4xl:col-span-7">
          <CardTitle title={t('chemistry.atomCheck')} detail={t('chemistry.atomCheckHint')} />
          <AtomTable rows={v.atoms} before={before} charge={v.charge} />
        </Card>
      )}
      {v && ok && (
        <Card padded className="col-span-12 @4xl:col-span-5">
          <CardTitle title={t('chemistry.howTitle')} />
          <p className="t-callout text-text2">{t('chemistry.howBody')}</p>
          <div className="mt-4 text-[15px] overflow-x-auto overflow-y-hidden">
            <Tex tex={v.ce ?? ''} display />
          </div>
        </Card>
      )}
    </div>
  )
}

function AtomTable({ rows, before, charge }: { rows: { symbol: string; left: number; right: number }[]; before: Map<string, { left: number; right: number }> | null; charge: { left: number; right: number } | null }) {
  const { t } = useTranslation('tools')
  const { reducedMotion } = useTheme()
  const max = Math.max(1, ...rows.map((r) => Math.max(r.left, r.right)))
  return (
    <div>
      <div className="grid grid-cols-[48px_1fr_1fr_28px] gap-x-3 t-caption pb-1.5">
        <span />
        <span>{t('chemistry.reactants')}</span>
        <span>{t('chemistry.products')}</span>
        <span />
      </div>
      {rows.map((r, i) => {
        const b = before?.get(r.symbol)
        const wasOff = b && b.left !== b.right
        return (
          <div key={r.symbol} className="grid grid-cols-[48px_1fr_1fr_28px] gap-x-3 items-center py-1.5 border-t-[0.5px] border-line-soft">
            <span className="t-headline">{r.symbol}</span>
            {[r.left, r.right].map((n, j) => (
              <div key={j} className="flex items-center gap-2 min-w-0">
                <div className="flex-1 h-2 rounded-full bg-fill2 overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{ background: j === 0 ? 'var(--accent)' : 'var(--accent-text)' }} initial={{ width: 0 }} animate={{ width: `${(n / max) * 100}%` }} transition={{ duration: 0.6, delay: 0.3 + i * 0.07 }} />
                </div>
                <span className="w-8 text-right t-number-inline tabular">{n}</span>
              </div>
            ))}
            <AnimatePresence>
              <motion.span key="ok" initial={reducedMotion ? false : { scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ ...spring.bouncy, delay: 0.6 + i * 0.08 }} className={cx('grid place-items-center w-6 h-6 rounded-full', r.left === r.right ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
                {r.left === r.right ? <Check size={14} strokeWidth={2.4} /> : <X size={14} strokeWidth={2.4} />}
              </motion.span>
            </AnimatePresence>
            {wasOff && (
              <span className="col-start-2 col-span-2 t-caption -mt-0.5">
                {t('chemistry.wasBefore', { left: b.left, right: b.right })}
              </span>
            )}
          </div>
        )
      })}
      {charge && (
        <div className="flex items-center justify-between pt-2 mt-1 border-t-[0.5px] border-line-soft t-ui text-text2">
          <span>{t('chemistry.charge')}</span>
          <span className="tabular">
            {charge.left} = {charge.right}
          </span>
        </div>
      )}
    </div>
  )
}
