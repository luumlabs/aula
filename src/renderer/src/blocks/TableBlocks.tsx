// Tablas (cifras alineadas a la derecha en tabular, fórmulas en las celdas, filas destacadas) y comparaciones en columnas.
// La comparación marca la diferencia decisiva (`tone: "key"`) y apaga lo común (`"same"`), y en modo analogía une cada parte
// del concepto con su pareja cotidiana. Patrones «comparación» y «metáfora» adaptados de Sketchy
// (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/patterns.ts.
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { cx, useTheme } from '@renderer/design'
import { Ink } from '@renderer/design/paint/Ink'
import { dashLineInk } from '@renderer/design/paint/penInk'
import { inkColor } from './colors'
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
  // la tinta del curso: la línea bajo la cabecera y la fila destacada (antes, una banda gris y el ladrillo de la app)
  const { dark } = useTheme()
  const ink = inkColor(ctx.hue, dark)
  // en una tabla larga, filas alternas apenas teñidas: el ojo no se pierde al cruzarla
  const zebra = rows.length > 5
  return (
    <div>
      <div className={cx('blk-table overflow-x-auto bg-surface border-[0.5px] border-line', chat ? 'rounded-[12px]' : 'rounded-[16px]')}>
        <table className={cx('w-full border-collapse', chat ? 't-callout' : 'text-[15px] leading-[22px]')}>
          {headers.length > 0 && (
            <thead>
              <tr style={{ background: `color-mix(in oklab, ${ink} 7%, transparent)` }}>
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c} scope="col" className={cx(cell, 'font-serif text-[15.5px] font-medium text-text whitespace-nowrap', alignClass(aligns[c]))} style={{ borderBottom: `1.5px solid color-mix(in oklab, ${ink} 62%, transparent)` }}>
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
                  className={cx('transition-colors', !on && 'hover:bg-fill1', !on && zebra && ri % 2 === 1 && 'bg-fill1/50', ri > 0 && 'border-t-[0.5px] border-line-soft')}
                  style={on ? { background: `color-mix(in oklab, ${ink} ${dark ? 20 : 12}%, transparent)` } : undefined}
                  initial={animate && ri < 40 ? { opacity: 0 } : false}
                  whileInView={animate && ri < 40 ? { opacity: 1 } : undefined}
                  viewport={{ once: true, margin: '-20px' }}
                  transition={{ duration: 0.35, delay: Math.min(ri, 14) * 0.035 }}
                >
                  {Array.from({ length: cols }, (_, c) => {
                    const head = block.firstColumnIsHeader && c === 0
                    const Tag = head ? 'th' : 'td'
                    return (
                      <Tag key={c} scope={head ? 'row' : undefined} className={cx(cell, 'align-middle text-text', on && c === 0 && 'font-semibold', head && 'font-semibold', alignClass(aligns[c]))} style={on && c === 0 ? { color: ink } : undefined}>
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

/** ¿Dicen lo mismo las dos celdas? (entonces la fila «igual» se escribe una vez para las dos columnas) */
const sameText = (a: string, b: string): boolean => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

/** Rótulo corto para «marca y pregunta al tutor». */
const askLabel = (s: string): string => (s.length > 90 ? s.slice(0, 88) + '…' : s)

export function CompareBlockView({ block, ctx }: BlockProps<BlockOf<'compare'>>) {
  const { t } = useTranslation('visual')
  const animate = useAnimate(ctx)
  const { dark } = useTheme()
  const ink = inkColor(ctx.hue, dark)
  const chat = ctx.mode === 'chat'
  const printing = ctx.mode === 'print'
  const analogy = block.mode === 'analogy'
  const rows = block.rows.slice(0, 200)
  const labels = rows.some((r) => r.label?.trim())
  // en una analogía, una columna estrecha en medio para el «es como» de cada pareja
  const mid = analogy ? (chat ? '44px' : '64px') : undefined
  const cols = [labels ? (chat ? 'minmax(72px,auto)' : 'minmax(96px,160px)') : undefined, '1fr', mid, '1fr'].filter(Boolean).join(' ')
  const colA = labels ? 2 : 1
  const colB = colA + (analogy ? 2 : 1)
  const panel = 'bg-surface border-[0.5px] border-line'
  const keyChip = (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-accent-wash px-1.5 py-[1px] t-caption font-semibold text-accent-text">{t('compare.key')}</span>
  )
  return (
    <section aria-label={block.title?.trim() ? block.title : undefined}>
      {analogy && <div className="mb-1 t-caption font-semibold uppercase tracking-[0.06em] text-text3">{t('compare.analogy')}</div>}
      <BlockTitle text={block.title} ctx={ctx} className="mb-3" />
      <div className={cx('relative grid', analogy ? 'gap-x-0' : 'gap-x-3')} style={{ gridTemplateColumns: cols }}>
        {/* fondos de las dos columnas (burbujas detrás de las celdas) */}
        {[colA, colB].map((col) => (
          <div key={col} aria-hidden className={cx('pointer-events-none row-span-full', panel, chat ? 'rounded-[12px]' : 'rounded-[18px]')} style={{ gridRow: `1 / span ${rows.length + 1}`, gridColumn: col, boxShadow: chat ? undefined : 'var(--e1)' }} />
        ))}
        {/* la diferencia clave: una banda de la tinta del curso por toda la fila */}
        {rows.map((r, i) =>
          r.tone === 'key' ? (
            <div key={`k-${i}`} aria-hidden className="pointer-events-none relative z-[1] rounded-[10px]" style={{ gridRow: i + 2, gridColumn: '1 / -1', background: `color-mix(in oklab, ${ink} ${dark ? 18 : 10}%, transparent)`, margin: '2px -4px' }} />
          ) : r.tone === 'same' && !analogy && sameText(r.left, r.right) ? (
            // lo común, escrito una vez: un puente neutro entre las dos columnas
            <div key={`s-${i}`} aria-hidden className="pointer-events-none relative z-[1] rounded-[10px] bg-fill1" style={{ gridRow: i + 2, gridColumn: `${colA} / ${colB + 1}`, margin: '3px 6px' }} />
          ) : null
        )}
        {labels && <div style={{ gridRow: 1, gridColumn: 1 }} />}
        {[block.leftTitle, block.rightTitle].map((title, k) => (
          <div key={k} className={cx('relative z-[2] flex items-center gap-2', chat ? 'px-3 pt-3 pb-2' : 'px-5 pt-4 pb-3')} style={{ gridRow: 1, gridColumn: k === 0 ? colA : colB }}>
            {analogy ? (
              <span className="flex min-w-0 flex-col">
                <span className="t-caption text-text3">{t(k === 0 ? 'compare.real' : 'compare.everyday')}</span>
                <span className={cx('font-serif font-medium text-text', chat ? 'text-[15px]' : 'text-[18px] leading-[24px]')}><Inline text={title} /></span>
              </span>
            ) : (
              <>
                <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-[6px] t-caption font-bold', k === 0 ? 'bg-accent-wash text-accent-text' : 'bg-fill2 text-text2')}>{k === 0 ? 'A' : 'B'}</span>
                <span className={cx('font-serif font-medium text-text', chat ? 'text-[15px]' : 'text-[18px] leading-[24px]')}><Inline text={title} /></span>
              </>
            )}
          </div>
        ))}
        {rows.map((r, i) => {
          const last = i === rows.length - 1
          const pad = chat ? 'px-3 py-2' : 'px-5 py-3'
          const line = r.tone === 'key' || rows[i - 1]?.tone === 'key' ? '' : 'border-t-[0.5px] border-line-soft'
          const same = r.tone === 'same'
          const merged = same && !analogy && sameText(r.left, r.right)
          const muted = same ? 'text-text2' : undefined
          const enter = (k: number) => ({
            initial: animate ? { opacity: 0, y: 6 } : false,
            whileInView: animate ? { opacity: 1, y: 0 } : undefined,
            viewport: { once: true, margin: '-20px' },
            transition: { duration: 0.35, delay: i * 0.05 + k * 0.04 }
          })
          return (
            <Fragment key={i}>
              {labels && (
                <motion.div
                  className={cx('relative z-[2] t-ui font-semibold', same ? 'text-text3' : 'text-text2', chat ? 'py-2 pr-1' : 'py-3 pr-2', 'pt-[14px]', r.tone === 'key' && 'pl-2')}
                  style={{ gridRow: i + 2, gridColumn: 1 }}
                  initial={animate ? { opacity: 0 } : false}
                  whileInView={animate ? { opacity: 1 } : undefined}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                  data-ask-part={`row-${i}`}
                  data-ask-label={askLabel(r.label ?? '')}
                >
                  <Inline text={r.label ?? ''} />
                  {r.tone === 'key' && <div className="mt-1">{keyChip}</div>}
                </motion.div>
              )}
              {merged ? (
                <motion.div
                  className={cx('relative z-[2] min-w-0 text-center', pad, 'border-t-[0.5px] border-line-soft', last && (chat ? 'pb-3' : 'pb-4'))}
                  style={{ gridRow: i + 2, gridColumn: `${colA} / ${colB + 1}` }}
                  {...enter(0)}
                  data-ask-part={`row-${i}`}
                  data-ask-label={askLabel(r.label ? `${r.label}: ${r.left}` : r.left)}
                >
                  <Prose text={displayFractions(r.left)} ctx={ctx} size="small" className="text-text2" />
                  <span className="mt-1 inline-block rounded-full bg-fill2 px-1.5 py-[1px] t-caption text-text3">{t('compare.same')}</span>
                </motion.div>
              ) : (
                [r.left, r.right].map((text, k) => (
                  <motion.div
                    key={k}
                    className={cx('relative z-[2] min-w-0', pad, line, last && (chat ? 'pb-3' : 'pb-4'))}
                    style={{ gridRow: i + 2, gridColumn: k === 0 ? colA : colB }}
                    {...enter(k)}
                    data-ask-part={`row-${i}-${k === 0 ? 'a' : 'b'}`}
                    data-ask-label={askLabel(`${k === 0 ? block.leftTitle : block.rightTitle}: ${text}`)}
                  >
                    {!labels && k === 0 && r.tone === 'key' && <div className="mb-1">{keyChip}</div>}
                    <Prose text={displayFractions(text)} ctx={ctx} size="small" className={cx(muted, r.tone === 'key' && 'font-medium')} />
                  </motion.div>
                ))
              )}
              {analogy && (
                <div aria-hidden className="relative z-[2] flex flex-col items-center justify-center gap-0.5" style={{ gridRow: i + 2, gridColumn: colA + 1 }}>
                  <span className="font-serif italic text-[11.5px] leading-[14px] text-text3 whitespace-nowrap">{t('compare.isLike')}</span>
                  <Ink drawing={dashLineInk(chat ? 40 : 56, 10, `cmp:${block.id}:${i}`)} color="var(--text3)" draw={!printing} drawKey={`cmp:${block.id}:${i}`} delay={animate ? 300 + i * 120 : 0} style={{ width: chat ? 40 : 56, height: 10 }} />
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}
