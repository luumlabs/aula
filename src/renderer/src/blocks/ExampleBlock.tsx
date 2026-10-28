// Ejemplo resuelto: el estudiante descubre los pasos uno a uno («Siguiente paso») o todos («Ver solución completa»). Los
// pasos entran creciendo en altura; el resultado cierra el ejemplo. Al imprimir se ve entero.
import { AnimatePresence, motion } from 'motion/react'
import { Button, cx, Icon, useTheme } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import type { BlockProps } from './types'
import { BlockTitle, Eyebrow, Inline, Prose, useAnimate, useBlockMemory, useBlocksT } from './shared'
import { inkColor } from './colors'

export function ExampleBlockView({ block, ctx }: BlockProps<BlockOf<'example'>>) {
  const t = useBlocksT()
  const { dark } = useTheme()
  const animate = useAnimate(ctx)
  const print = ctx.mode === 'print'
  const chat = ctx.mode === 'chat'
  const total = block.steps.length
  const [stored, setShown] = useBlockMemory(ctx, block.id, 'example', 0)
  const shown = print ? total : Math.min(stored, total)
  const done = shown >= total
  const ink = inkColor(ctx.hue, dark)
  const show = (n: number) => {
    setShown(n)
    ctx.onInteract?.(block.id, n >= total ? 'example.complete' : 'example.step')
  }
  return (
    <section className={cx('relative bg-surface border-[0.5px] border-line', chat ? 'rounded-[16px] p-4' : 'rounded-[22px] p-6')} style={{ boxShadow: print || chat ? undefined : 'var(--e1)' }}>
      <div className="flex items-center gap-3 text-text2">
        <Eyebrow icon="checklist" label={t('example.eyebrow')} />
        {!print && total > 0 && (
          <div className="ml-auto flex items-center gap-2" aria-label={t('example.progress', { shown, total })}>
            <span className="flex gap-[3px]" aria-hidden>
              {block.steps.map((_, i) => (
                <motion.span key={i} className="block h-[7px] w-[7px] rounded-[1.5px]" initial={false} animate={{ backgroundColor: i < shown ? ink : 'var(--fill3)', scale: i === shown - 1 && animate ? [1, 1.35, 1] : 1 }} transition={{ duration: 0.35 }} />
              ))}
            </span>
            <span className="t-caption tabular text-text3">{t('example.progress', { shown, total })}</span>
          </div>
        )}
      </div>
      <BlockTitle text={block.title} ctx={ctx} className="mt-2" />
      <div className={block.title ? 'mt-2' : 'mt-3'}>
        <Prose text={block.problem} ctx={ctx} />
      </div>
      <ol className="m-0 list-none p-0">
        <AnimatePresence initial={false}>
          {block.steps.slice(0, shown).map((s, i) => (
            <motion.li
              key={i}
              initial={animate ? { height: 0, opacity: 0 } : false}
              animate={{ height: 'auto', opacity: 1 }}
              exit={animate ? { height: 0, opacity: 0 } : undefined}
              transition={{ height: { type: 'spring', stiffness: 224, damping: 30 }, opacity: { duration: 0.25, delay: animate ? 0.06 : 0 } }}
              className="overflow-hidden"
            >
              <div className={cx('flex gap-3', i === 0 ? 'pt-4' : 'pt-3')}>
                <span className="w-6 shrink-0 text-right font-serif text-[17px] leading-[28px] tabular" style={{ color: i === shown - 1 && !print ? ink : 'var(--text3)' }}>
                  {i + 1}.
                </span>
                <div className="min-w-0 flex-1">
                  <Prose text={s.md} ctx={ctx} size="body" />
                  {s.note?.trim() && (
                    <div className="mt-1.5 flex items-start gap-1.5 t-callout text-text2">
                      <Icon name="lightbulb" size={13} className="mt-[3px] text-text3" />
                      <span><Inline text={s.note} /></span>
                    </div>
                  )}
                </div>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      <AnimatePresence initial={false}>
        {done && block.answer?.trim() && (
          <motion.div
            key="answer"
            initial={animate ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={animate ? { height: 0, opacity: 0 } : undefined}
            transition={{ height: { type: 'spring', stiffness: 224, damping: 30 }, opacity: { duration: 0.3, delay: animate ? 0.1 : 0 } }}
            className="overflow-hidden"
          >
            <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t-[0.5px] border-line pt-4">
              <span className="inline-flex items-center gap-1.5 t-ui font-semibold text-success">
                <Icon name="check-circle" size={15} className="translate-y-[2px]" />
                {t('example.result')}
              </span>
              <div className="min-w-0 flex-1">
                <Prose text={block.answer} ctx={ctx} size="body" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!print && total > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {!done ? (
            <>
              <Button size={chat ? 'sm' : 'md'} variant="secondary" onClick={() => show(shown + 1)} iconRight={<Icon name="arrow-down" size={14} />}>
                {shown === 0 ? t('example.first') : t('example.next')}
              </Button>
              {total > 1 && (
                <Button size={chat ? 'sm' : 'md'} variant="ghost" onClick={() => show(total)}>
                  {t('example.all')}
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => show(0)} icon={<Icon name="undo" size={14} />}>
              {t('example.hide')}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
