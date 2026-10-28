// «Veámoslo de otra forma»: la reexplicación tras un error, ordenada en lo que pasó (la explicación del error), la idea
// clave (las pistas), la solución paso a paso con la respuesta comprobada y otro ejemplo resuelto distinto.
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import type { Block } from '@shared/schema'
import type { BlockContext } from '@renderer/blocks/types'
import { Icon, type IconName } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { ToneRule } from '@renderer/exercises/ui'
import { StaticBlocks } from '@renderer/exercises'

export interface RemediationParts {
  feedback: Block[]
  hints: Block[]
  solution: Block[]
  answer?: Block
  example: Block[]
}

/** Separa los bloques de la reexplicación del motor por su papel (ids «-feedback-n», «-hint-n», «-checked-answer»…). */
export function groupRemediation(blocks: Block[]): RemediationParts {
  const out: RemediationParts = { feedback: [], hints: [], solution: [], example: [] }
  for (const b of blocks) {
    if (/-feedback-\d+$/.test(b.id)) out.feedback.push(b)
    else if (/-hint-\d+$/.test(b.id)) out.hints.push(b)
    else if (/-(checked|model)-answer$/.test(b.id)) out.answer = b
    else if (b.type === 'example' && (/-alternate-example$/.test(b.id) || out.answer)) out.example.push(b)
    else out.solution.push(b)
  }
  return out
}

const mdOf = (b: Block | undefined): string => (b && b.type === 'text' ? b.md : '')

function Section({ icon, title, children, delay }: { icon: IconName; title: string; children: ReactNode; delay: number }) {
  return (
    <motion.section className="mx-auto flex w-full max-w-[720px] flex-col gap-2.5" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36, delay, ease: [0.2, 0.7, 0.2, 1] }}>
      <div className="flex items-center gap-2 t-ui font-semibold text-text2">
        <Icon name={icon} size={15} />
        {title}
      </div>
      {children}
    </motion.section>
  )
}

export function RemediationView({ blocks, ctx }: { blocks: Block[]; ctx: BlockContext }) {
  const { t } = useTranslation('study')
  const g = groupRemediation(blocks)
  let d = 0
  const next = (): number => (d += 0.08)
  return (
    <div className="flex flex-col gap-8">
      {g.feedback.length > 0 && (
        <Section icon="alert-circle" title={t('learn.remWhat')} delay={next()}>
          <ToneRule color="var(--danger)">
            {g.feedback.map((b) => <div key={b.id} className="t-reading text-text"><RichText text={mdOf(b)} /></div>)}
          </ToneRule>
        </Section>
      )}
      {g.hints.length > 0 && (
        <Section icon="lightbulb" title={t('learn.remKey')} delay={next()}>
          <ol className="flex flex-col gap-2">
            {g.hints.map((b, i) => (
              <li key={b.id} className="flex gap-3 rounded-[14px] bg-fill1 px-4 py-3">
                <span className="mt-[3px] inline-grid h-[22px] min-w-[22px] place-items-center rounded-full bg-fill3 text-[12px] font-semibold tabular text-text2">{i + 1}</span>
                <span className="t-body text-text"><RichText text={mdOf(b)} /></span>
              </li>
            ))}
          </ol>
        </Section>
      )}
      {(g.solution.length > 0 || g.answer) && (
        <Section icon="book" title={t('learn.remSolution')} delay={next()}>
          {g.solution.length > 0 && <StaticBlocks blocks={g.solution} ctx={ctx} />}
          {g.answer && (
            <div className="inline-flex max-w-full items-center gap-2 self-start rounded-full bg-success-soft px-4 py-2 t-callout">
              <Icon name="check-circle" size={16} className="shrink-0 text-success" />
              <RichText text={mdOf(g.answer)} inline />
            </div>
          )}
        </Section>
      )}
      {g.example.length > 0 && (
        <Section icon="repeat" title={t('learn.remOther')} delay={next()}>
          <StaticBlocks blocks={g.example} ctx={ctx} />
        </Section>
      )}
    </div>
  )
}
