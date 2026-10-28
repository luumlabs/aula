// Verdadero o falso: dos tarjetas lado a lado (1 y 2 con el teclado, también V/T y F).
import { useTranslation } from 'react-i18next'
import type { AnswerOf } from '@shared/schema/exercises'
import { trueFalseForKey } from '../normalize'
import { OptionCard, type Mark } from '../ui'
import { useKeys, type InputProps } from './shared'

export function TrueFalseInput({ answer, draft, set, locked, reveal, active }: InputProps<AnswerOf<'truefalse'>>) {
  const { t } = useTranslation('study')
  const pick = (v: boolean): void => {
    if (!locked) set((d) => ({ ...d, bool: v }))
  }
  useKeys(active && !locked, (e) => {
    const v = trueFalseForKey(e.key)
    if (v === null) return
    pick(v)
    return true
  })
  const mark = (v: boolean): Mark => (reveal !== 'all' ? (reveal === 'mistakesOnly' && draft.bool === v && answer.value !== v ? 'wrong' : 'none') : answer.value === v ? 'right' : draft.bool === v ? 'wrong' : 'dimmed')
  return (
    <div role="radiogroup" className="grid grid-cols-2 gap-2.5">
      {[true, false].map((v, i) => (
        <OptionCard key={String(v)} index={i} letter={v ? '1' : '2'} selected={draft.bool === v} mark={mark(v)} locked={locked} onSelect={() => pick(v)}>
          <span className="t-headline">{v ? t('ex.true') : t('ex.false')}</span>
        </OptionCard>
      ))}
    </div>
  )
}
