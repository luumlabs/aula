// Opción múltiple: tarjetas que se levantan, con su letra (A, B, C… o 1, 2, 3 con el teclado); varias correctas, casillas.
// Tras comprobar: la elegida mal en rojo; al terminar, la correcta en verde y el porqué de cada una.
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { AnswerOf, ChoiceOption } from '@shared/schema/exercises'
import { RichText } from '@renderer/lib/RichText'
import { cx } from '@renderer/design'
import { choiceOrder } from '../model'
import { optionIndexForKey, optionLetter } from '../normalize'
import { OptionCard, type Mark } from '../ui'
import { useKeys, type InputProps, type RevealLevel } from './shared'

export function choiceMark(o: ChoiceOption, selected: boolean, reveal: RevealLevel): Mark {
  switch (reveal) {
    case 'none': return 'none'
    case 'mistakesOnly': return selected && !o.correct ? 'wrong' : 'none'
    case 'all': return o.correct ? 'right' : selected ? 'wrong' : 'dimmed'
  }
}

export function ChoiceInput({ answer, draft, set, locked, reveal, exerciseId, active }: InputProps<AnswerOf<'choice'>>) {
  const { t } = useTranslation('study')
  const ids = useMemo(() => choiceOrder(exerciseId, answer).filter((id) => answer.options.some((o) => o.id === id)), [exerciseId, answer])
  const options = ids.map((id) => answer.options.find((o) => o.id === id)!)
  // opciones cortas: en dos columnas
  const twoCols = options.length >= 4 && options.every((o) => o.md.replace(/\$[^$]*\$/g, 'xxxx').length <= 34)

  const toggle = (id: string): void => {
    if (locked) return
    set((d) => {
      if (answer.multi) return { ...d, choice: d.choice.includes(id) ? d.choice.filter((x) => x !== id) : [...d.choice, id] }
      return { ...d, choice: [id] }
    })
  }

  useKeys(active && !locked, (e) => {
    const i = optionIndexForKey(e.key)
    if (i === null || i >= ids.length) return
    toggle(ids[i])
    return true
  })

  return (
    <div role={answer.multi ? 'group' : 'radiogroup'} className="flex flex-col gap-2">
      {answer.multi && <div className="t-ui text-text2">{t('ex.markAll')}</div>}
      <div className={cx('grid gap-2.5', twoCols ? 'grid-cols-1 @md:grid-cols-2' : 'grid-cols-1')}>
        {options.map((o, i) => {
          const selected = draft.choice.includes(o.id)
          const m = choiceMark(o, selected, reveal)
          return (
            <OptionCard
              key={o.id}
              index={i}
              letter={optionLetter(i)}
              selected={selected}
              mark={m}
              multi={answer.multi}
              role={answer.multi ? 'checkbox' : 'radio'}
              locked={locked}
              onSelect={() => toggle(o.id)}
              detail={
                <AnimatePresence initial={false}>
                  {o.why && (m === 'right' || m === 'wrong') && (
                    <motion.span className="mt-1.5 block t-callout text-text2" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                      <RichText text={o.why} inline />
                    </motion.span>
                  )}
                </AnimatePresence>
              }
            >
              <RichText text={o.md} inline />
            </OptionCard>
          )
        })}
      </div>
    </div>
  )
}
