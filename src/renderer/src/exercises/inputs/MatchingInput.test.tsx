import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AnswerOf } from '@shared/schema/exercises'
import '@renderer/i18n'
import { StudyLanguage } from '@renderer/lib/contentLanguage'
import { initialDraft } from '../model'
import { MatchingInput } from './MatchingInput'

const ANSWER: AnswerOf<'matching'> = { kind: 'matching', pairs: [{ left: 'ماء', right: 'H_2O' }, { left: 'ملح', right: 'NaCl' }], extraRights: [] }

describe('relacionar en un curso de derecha a izquierda', () => {
  it('la caja de las líneas va de izquierda a derecha (las anclas son a la derecha de la izquierda y a la izquierda de la derecha)', () => {
    const html = renderToStaticMarkup(
      <div dir="rtl">
        <StudyLanguage.Provider value="ar">
          <MatchingInput
            answer={ANSWER}
            draft={initialDraft({ id: 'm1', answer: ANSWER })}
            set={() => undefined}
            locked={false}
            reveal="none"
            exerciseId="m1"
            lang="ar"
            ctx={{ packId: null, language: 'ar', assetUrl: (p) => p, mode: 'lesson' }}
            onSubmit={() => undefined}
            autoFocus={false}
            active={false}
            exam={false}
          />
        </StudyLanguage.Provider>
      </div>
    )
    expect(html).toMatch(/<div dir="ltr" class="relative flex items-start select-none">/)
    // el texto de cada elemento sí va de derecha a izquierda
    expect(html).toContain('lang="ar" dir="rtl"')
  })
})
