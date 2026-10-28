// Hoja de fórmulas: una tarjeta por fórmula con su nombre, la fórmula en grande, cuándo se usa y qué es cada símbolo.
// Se copia el LaTeX con un botón.
import { useState } from 'react'
import { motion } from 'motion/react'
import { cx, enter, Icon, IconButton, toast } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import type { FormulaItem } from '@shared/schema/common'
import type { BlockContext, BlockProps } from './types'
import { BlockTitle, Inline, InViewStagger, MathTex, useAnimate, useBlocksT } from './shared'

export function FormulasBlockView({ block, ctx }: BlockProps<BlockOf<'formulas'>>) {
  const animate = useAnimate(ctx)
  const items = block.items.slice(0, 60)
  const grid = cx('grid gap-3', ctx.mode !== 'chat' && items.length > 1 && '@xl:grid-cols-2')
  return (
    <section className="@container">
      <BlockTitle text={block.title} ctx={ctx} className="mb-3" />
      <InViewStagger className={grid} animate={animate}>
        {items.map((f, i) => (
          <motion.div key={i} variants={animate ? enter : undefined} className="flex">
            <FormulaCard f={f} ctx={ctx} />
          </motion.div>
        ))}
      </InViewStagger>
    </section>
  )
}

function FormulaCard({ f, ctx }: { f: FormulaItem; ctx: BlockContext }) {
  const t = useBlocksT()
  const [copied, setCopied] = useState(false)
  const chat = ctx.mode === 'chat'
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(f.tex)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      toast.error(t('code.copyFailed'))
    }
  }
  return (
    <article className={cx('group/formula relative flex w-full flex-col bg-surface border-[0.5px] border-line', chat ? 'rounded-[14px] p-3' : 'rounded-[18px] p-5')} style={{ boxShadow: ctx.mode === 'lesson' ? 'var(--e1)' : undefined }}>
      <div className="flex items-start gap-2">
        <div className="t-headline min-w-0 flex-1 text-text"><Inline text={f.name} /></div>
        {ctx.mode !== 'print' && (
          <IconButton label={copied ? t('code.copied') : t('formulas.copy')} size="sm" onClick={() => void copy()} className={cx('-mr-1 -mt-1 transition-opacity', copied ? 'opacity-100 text-success' : 'opacity-0 group-hover/formula:opacity-100 focus-visible:opacity-100')}>
            <Icon name={copied ? 'check' : 'copy'} size={14} />
          </IconButton>
        )}
      </div>
      <div className={cx('my-3 rounded-[12px] bg-sunken px-3 text-text', chat ? 'py-2' : 'py-3')}>
        <MathTex tex={f.tex} className="blk-formula" />
      </div>
      {f.when?.trim() && (
        <div className="t-callout text-text2">
          <span className="font-semibold text-text">{t('formulas.when')} </span>
          <Inline text={f.when} />
        </div>
      )}
      {f.vars.length > 0 && (
        <dl className="m-0 mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t-[0.5px] border-line pt-3">
          {f.vars.slice(0, 30).map((v, i) => (
            <div key={i} className="contents">
              <dt className="min-w-[28px] text-text"><MathTex tex={v.symbol} display={false} className="blk-inline-math" /></dt>
              <dd className="m-0 t-callout text-text2">
                <Inline text={v.meaning} />
                {v.unit?.trim() && <span className="text-text3"> · {v.unit}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  )
}
