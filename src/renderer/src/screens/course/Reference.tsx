// Referencia: glosario con búsqueda y hoja de fórmulas (KaTeX), en tarjetas.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, Icon, SectionTitle, Stagger, StaggerItem, TextField } from '@renderer/design'
import type { Pack } from '@shared/schema/pack'
import { RichText } from '@renderer/lib/RichText'
import { splitFormula } from '@engine/content/tex'

function norm(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

export function ReferenceTab({ pack }: { pack: Pack }) {
  const { t } = useTranslation('course')
  const [q, setQ] = useState('')
  const glossary = useMemo(() => {
    const n = norm(q.trim())
    const list = [...pack.glossary].sort((a, b) => a.term.localeCompare(b.term))
    return n ? list.filter((g) => norm(`${g.term} ${g.aliases.join(' ')} ${g.definition}`).includes(n)) : list
  }, [pack.glossary, q])
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 @5xl:col-span-7">
        <Card padded="lg" className="h-full">
          <SectionTitle title={t('formulas')} />
          {pack.formulaSheet.length === 0 && <p className="t-callout text-text3 mt-2">{t('noFormulas')}</p>}
          <Stagger className="flex flex-col gap-5 mt-3">
            {pack.formulaSheet.map((g, gi) => (
              <StaggerItem key={gi}>
                <div className="t-ui font-semibold text-text2 mb-2">{g.title}</div>
                <div className="grid gap-2 @6xl:grid-cols-2">
                  {g.items.map((f, i) => (
                    <div key={i} className="rounded-[14px] bg-sunken p-3.5">
                      <div className="t-ui text-text2">{f.name}</div>
                      {/* varias igualdades en una línea: cada una en su renglón si no caben */}
                      <div className="aula-formula mt-1.5 text-[17px] flex flex-wrap items-center gap-x-6 gap-y-3 overflow-x-auto overflow-y-hidden">
                        {splitFormula(f.tex).map((part, pi) => (
                          // cada parte con su aire: las fracciones de dos renglones no chocan al partirse la línea
                          <div key={pi} className="py-1">
                            <RichText text={`$$${part}$$`} />
                          </div>
                        ))}
                      </div>
                      {f.when && (
                        <div className="t-ui text-text3 mt-1">
                          <RichText text={f.when} inline />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </Card>
      </div>
      <div className="col-span-12 @5xl:col-span-5">
        <Card padded="lg" className="h-full">
          <SectionTitle title={t('glossary')} detail={t('terms', { count: pack.glossary.length })} />
          <div className="mt-3">
            <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchGlossary')} icon={<Icon name="search" size={15} />} />
          </div>
          {pack.glossary.length === 0 && <p className="t-callout text-text3 mt-3">{t('noGlossary')}</p>}
          <div className="mt-3 flex flex-col">
            {glossary.map((g, i) => (
              <div key={g.term + i} className="py-2.5 border-t-[0.5px] border-line-soft first:border-t-0">
                <div className="font-serif text-[17px] leading-6">{g.term}</div>
                <div className="t-callout text-text2 mt-0.5">
                  <RichText text={g.definition} inline />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
