// pH: ácidos y bases fuertes o débiles, o directamente [H₃O⁺] o el pH. La escala de 0 a 14 está hecha de píxeles
// (ácido a la izquierda, básico a la derecha, en dos tonos tranquilos) y el marcador se desliza hasta el valor.
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, cx, spring, useTheme } from '@renderer/design'
import { AcidBase, type PHResult } from '@engine/chem/acid-base'
import { formatFixed, formatNumber, parseNumber, percentSign } from '../shared/lib/num'
import { toneFill } from '../shared/palette'
import { CardTitle, ErrorLine, KV, NumField, useComma, useStored } from '../shared/ui'
import { chemErrorText } from './lib/chem'

type Mode = 'strongAcid' | 'strongBase' | 'weakAcid' | 'weakBase' | 'hydronium' | 'ph'

interface Saved {
  mode: Mode
  c: string
  k: string
  n: string
  h: string
  ph: string
}

export default function PH() {
  const { t, i18n } = useTranslation('tools')
  const es = i18n.language.startsWith('es')
  const comma = useComma()
  const [s, setS] = useStored<Saved>('aula.tools.chem.ph', { mode: 'weakAcid', c: '0,1', k: '1,8e-5', n: '1', h: '1e-3', ph: '3,5' })
  const res = useMemo((): { ok: true; r: PHResult } | { ok: false; error: unknown } | null => {
    try {
      const c = parseNumber(s.c)
      const k = parseNumber(s.k)
      const n = Math.max(1, Math.round(parseNumber(s.n) ?? 1))
      switch (s.mode) {
        case 'strongAcid':
          return c === null ? null : { ok: true, r: AcidBase.strongAcid(c, n) }
        case 'strongBase':
          return c === null ? null : { ok: true, r: AcidBase.strongBase(c, n) }
        case 'weakAcid':
          return c === null || k === null ? null : { ok: true, r: AcidBase.weakAcid(c, k) }
        case 'weakBase':
          return c === null || k === null ? null : { ok: true, r: AcidBase.weakBase(c, k) }
        case 'hydronium': {
          const h = parseNumber(s.h)
          return h === null ? null : { ok: true, r: AcidBase.fromHydronium(h) }
        }
        case 'ph': {
          const p = parseNumber(s.ph)
          return p === null ? null : { ok: true, r: AcidBase.fromPH(p) }
        }
      }
    } catch (error) {
      return { ok: false, error }
    }
  }, [s])
  const r = res?.ok ? res.r : null
  const sci = (x: number) => formatNumber(x, { comma, sig: 3 })
  const weak = s.mode === 'weakAcid' || s.mode === 'weakBase'
  const strong = s.mode === 'strongAcid' || s.mode === 'strongBase'

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card padded="lg" className="col-span-12 @4xl:col-span-5">
        <CardTitle title={t('chemistry.phTitle')} detail={t('chemistry.phHint')} />
        <div className="flex flex-wrap gap-1.5">
          {(['strongAcid', 'strongBase', 'weakAcid', 'weakBase', 'hydronium', 'ph'] as Mode[]).map((m) => (
            <button key={m} onClick={() => setS((p) => ({ ...p, mode: m }))} className={cx('h-7 px-3 rounded-full t-ui transition-colors', s.mode === m ? 'bg-accent-wash text-accent-text font-medium' : 'bg-fill2 text-text2 hover:bg-fill3')}>
              {t(`chemistry.ph.${m}`)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          {(strong || weak) && <NumField label={t('chemistry.concentration')} unit="M" value={s.c} onChange={(c) => setS((p) => ({ ...p, c }))} />}
          {weak && <NumField label={s.mode === 'weakAcid' ? 'Ka' : 'Kb'} value={s.k} onChange={(k) => setS((p) => ({ ...p, k }))} />}
          {strong && <NumField label={s.mode === 'strongAcid' ? t('chemistry.protons') : t('chemistry.hydroxides')} value={s.n} onChange={(n) => setS((p) => ({ ...p, n }))} />}
          {s.mode === 'hydronium' && <NumField label="[H₃O⁺]" unit="M" value={s.h} onChange={(h) => setS((p) => ({ ...p, h }))} />}
          {s.mode === 'ph' && <NumField label="pH" value={s.ph} onChange={(ph) => setS((p) => ({ ...p, ph }))} />}
        </div>
        {res && !res.ok && (
          <div className="mt-4">
            <ErrorLine>{chemErrorText(res.error, es)}</ErrorLine>
          </div>
        )}
        {r && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 mt-6">
            <KV k="pOH" v={formatFixed(r.pOH, r.decimals, comma)} />
            <KV k="[H₃O⁺]" v={`${sci(r.hydronium)} M`} />
            <KV k="[OH⁻]" v={`${sci(r.hydroxide)} M`} />
            {r.percentIonization !== null && <KV k={t('chemistry.ionization')} v={`${formatNumber(r.percentIonization, { comma, sig: 3 })}${percentSign(comma)}`} hint={r.approximationValid === false ? t('chemistry.approxInvalid') : undefined} />}
          </div>
        )}
      </Card>
      <Card padded="lg" className="col-span-12 @4xl:col-span-7 flex flex-col justify-between">
        {r ? <PHScale ph={r.pH} decimals={r.decimals} /> : <div className="t-callout text-text3">{t('chemistry.phEmpty')}</div>}
      </Card>
    </div>
  )
}

function PHScale({ ph, decimals }: { ph: number; decimals: number }) {
  const { t } = useTranslation('tools')
  const { dark } = useTheme()
  const comma = useComma()
  const pos = Math.max(0, Math.min(14, ph)) / 14
  const acid = toneFill('coral', dark)
  const base = toneFill('slate', dark)
  const label = Math.abs(ph - 7) < 0.005 ? t('chemistry.neutral') : ph < 7 ? t('chemistry.acidic') : t('chemistry.basic')
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="font-serif text-[22px] text-text3 italic">pH</span>
        <motion.span key={ph} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="font-serif text-[64px] leading-none tracking-[-0.03em] tabular">
          {formatFixed(ph, decimals, comma)}
        </motion.span>
        <span className="t-headline text-text2">{label}</span>
      </div>
      <div className="relative mt-10">
        <motion.div className="absolute -top-7 -translate-x-1/2 flex flex-col items-center" animate={{ left: `${pos * 100}%` }} transition={spring.smooth}>
          <span className="t-caption font-semibold text-accent-text tabular">{formatFixed(ph, 1, comma)}</span>
          <svg width="12" height="8" viewBox="0 0 12 8">
            <path d="M0 0 H12 L6 8 Z" fill="var(--accent)" />
          </svg>
        </motion.div>
        <div className="flex gap-[3px]">
          {Array.from({ length: 14 }, (_, i) => {
            const d = (7 - (i + 0.5)) / 7
            const bg = `color-mix(in oklab, ${d > 0 ? acid : base} ${Math.round(10 + Math.abs(d) * 56)}%, var(--surface))`
            return <motion.div key={i} className="h-9 flex-1 rounded-[4px]" style={{ background: bg }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: i * 0.025 }} />
          })}
        </div>
        <div className="flex justify-between t-caption mt-1.5 tabular">
          {Array.from({ length: 15 }, (_, i) => (
            <span key={i} className="w-0 flex justify-center">
              {i}
            </span>
          ))}
        </div>
        <div className="flex justify-between t-footnote mt-3">
          <span>{t('chemistry.acidic')}</span>
          <span>{t('chemistry.neutral')}</span>
          <span>{t('chemistry.basic')}</span>
        </div>
      </div>
      <div className="mt-8 rounded-[14px] bg-sunken px-4 py-3 t-callout text-text2">
        {Math.abs(ph - 7) < 0.005
          ? t('chemistry.compareNeutral')
          : t(ph < 7 ? 'chemistry.compareAcid' : 'chemistry.compareBase', { times: formatNumber(Math.pow(10, Math.abs(7 - ph)), { comma, sig: 2 }) })}
      </div>
    </div>
  )
}
