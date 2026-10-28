// Tablas (cifras alineadas a la derecha en tabular, fórmulas en las celdas, filas destacadas) y comparaciones en columnas.
import { Fragment } from 'react'
import { motion } from 'motion/react'
import { cx } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import type { BlockProps } from './types'
import { BlockTitle, Caption, Inline, Prose, useAnimate } from './shared'
import { displayFractions, isNumericCell } from './text'


type Align = 'left' | 'center' | 'right'

/** Alineación de cada columna: la del autor; si no, a la derecha si casi todas sus celdas son cifras. */
export function columnAligns(headers: string[], rows: string[][], given: string[]): Align[] {
  const n = Math.max(headers.length, ...rows.map((r) => r.length), 0)
  return Array.from({ length: n }, (_, c) => {
    const g = given[c]?.toLowerCase()
    if (g === 'left' || g === 'center' || g === 'right') return g
    const cells = rows.map((r) => r[c] ?? '').filter((x) => x.trim())
    const numeric = cells.filter(isNumericCell).length
    return cells.length > 0 && numeric / cells.length >= 0.8 ? 'right' : 'left'
  })
}

const alignClass = (a: Align): string => (a === 'right' ? 'text-right tabular' : a === 'center' ? 'text-center' : 'text-left')

export function TableBlockView({ block, ctx }: BlockProps<BlockOf<'table'>>) {
  const animate = useAnimate(ctx)
  const chat = ctx.mode === 'chat'
  // con tope (1000 filas × 50 columnas): una tabla gigante solo congelaría la vista
  const headers = block.headers.slice(0, 50)
  const rows = block.rows.slice(0, 1000).map((r) => r.slice(0, 50))
  const aligns = columnAligns(headers, rows, block.align)
  const highlight = new Set(block.highlightRows)
  const cols = aligns.length
  const cell = chat ? 'px-3 py-2' : 'px-4 py-2.5'
  return (
    <div>
      <div className={cx('blk-table overflow-x-auto bg-surface border-[0.5px] border-line', chat ? 'rounded-[12px]' : 'rounded-[16px]')}>
        <table className={cx('w-full border-collapse', chat ? 't-callout' : 'text-[15px] leading-[22px]')}>
          {headers.length > 0 && (
            <thead>
              <tr className="bg-sunken">
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c} scope="col" className={cx(cell, 't-ui font-semibold text-text2 whitespace-nowrap border-b-[0.5px] border-line', alignClass(aligns[c]))}>
                    <Inline text={displayFractions(headers[c] ?? '')} />
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((r, ri) => {
              const on = highlight.has(ri)
              return (
                <motion.tr
                  key={ri}
                  className={cx('transition-colors', on ? 'bg-accent-wash' : 'hover:bg-fill1', ri > 0 && 'border-t-[0.5px] border-line-soft')}
                  initial={animate && ri < 40 ? { opacity: 0 } : false}
                  whileInView={animate && ri < 40 ? { opacity: 1 } : undefined}
                  viewport={{ once: true, margin: '-20px' }}
                  transition={{ duration: 0.35, delay: Math.min(ri, 14) * 0.035 }}
                >
                  {Array.from({ length: cols }, (_, c) => {
                    const head = block.firstColumnIsHeader && c === 0
                    const Tag = head ? 'th' : 'td'
                    return (
                      <Tag key={c} scope={head ? 'row' : undefined} className={cx(cell, 'align-middle', on && c === 0 ? 'font-semibold text-accent-text' : 'text-text', head && 'font-semibold', alignClass(aligns[c]))}>
                        <Inline text={displayFractions(r[c] ?? '')} />
                      </Tag>
                    )
                  })}
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Caption text={block.caption} className="mt-2 px-1" />
    </div>
  )
}

// MARK: Comparar

export function CompareBlockView({ block, ctx }: BlockProps<BlockOf<'compare'>>) {
  const animate = useAnimate(ctx)
  const chat = ctx.mode === 'chat'
  const rows = block.rows.slice(0, 200)
  const labels = rows.some((r) => r.label?.trim())
  const grid = labels ? (chat ? 'grid-cols-[minmax(72px,auto)_1fr_1fr]' : 'grid-cols-[minmax(96px,160px)_1fr_1fr]') : 'grid-cols-2'
  const panel = 'bg-surface border-[0.5px] border-line'
  return (
    <section>
      <BlockTitle text={block.title} ctx={ctx} className="mb-3" />
      <div className={cx('relative grid gap-x-3', grid)}>
        {/* fondos de las dos columnas (burbujas detrás de las celdas) */}
        <div aria-hidden className={cx('pointer-events-none row-span-full', labels ? 'col-start-2' : 'col-start-1', panel, chat ? 'rounded-[12px]' : 'rounded-[18px]')} style={{ gridRow: `1 / span ${rows.length + 1}`, boxShadow: chat ? undefined : 'var(--e1)' }} />
        <div aria-hidden className={cx('pointer-events-none row-span-full', labels ? 'col-start-3' : 'col-start-2', panel, chat ? 'rounded-[12px]' : 'rounded-[18px]')} style={{ gridRow: `1 / span ${rows.length + 1}`, boxShadow: chat ? undefined : 'var(--e1)' }} />
        {labels && <div style={{ gridRow: 1, gridColumn: 1 }} />}
        {[block.leftTitle, block.rightTitle].map((title, k) => (
          <div key={k} className={cx('relative z-[1] flex items-center gap-2', chat ? 'px-3 pt-3 pb-2' : 'px-5 pt-4 pb-3')} style={{ gridRow: 1, gridColumn: (labels ? 2 : 1) + k }}>
            <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-[6px] t-caption font-bold', k === 0 ? 'bg-accent-wash text-accent-text' : 'bg-fill2 text-text2')}>{k === 0 ? 'A' : 'B'}</span>
            <span className={cx('font-serif font-medium text-text', chat ? 'text-[15px]' : 'text-[18px] leading-[24px]')}><Inline text={title} /></span>
          </div>
        ))}
        {rows.map((r, i) => {
          const last = i === rows.length - 1
          const pad = chat ? 'px-3 py-2' : 'px-5 py-3'
          const line = 'border-t-[0.5px] border-line-soft'
          return (
            <Fragment key={i}>
              {labels && (
                <motion.div className={cx('relative z-[1] t-ui font-semibold text-text2', chat ? 'py-2 pr-1' : 'py-3 pr-2', 'pt-[14px]')} style={{ gridRow: i + 2, gridColumn: 1 }} initial={animate ? { opacity: 0 } : false} whileInView={animate ? { opacity: 1 } : undefined} viewport={{ once: true }} transition={{ delay: i * 0.05 }}>
                  <Inline text={r.label ?? ''} />
                </motion.div>
              )}
              {[r.left, r.right].map((text, k) => (
                <motion.div
                  key={k}
                  className={cx('relative z-[1] min-w-0', pad, line, last && (chat ? 'pb-3' : 'pb-4'))}
                  style={{ gridRow: i + 2, gridColumn: (labels ? 2 : 1) + k }}
                  initial={animate ? { opacity: 0, y: 6 } : false}
                  whileInView={animate ? { opacity: 1, y: 0 } : undefined}
                  viewport={{ once: true, margin: '-20px' }}
                  transition={{ duration: 0.35, delay: i * 0.05 + k * 0.04 }}
                >
                  <Prose text={displayFractions(text)} ctx={ctx} size="small" />
                </motion.div>
              ))}
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}
