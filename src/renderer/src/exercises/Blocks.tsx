// Bloques dentro de un ejercicio (enunciado, solución, pistas): sin la entrada propia de cada bloque al llegar a él, porque
// el ejercicio ya entra entero (y una animación dentro de otra se quedaba a medias).
import type { Block } from '@shared/schema/blocks'
import { SafeBlockView } from '@renderer/blocks/BlockView'
import type { BlockContext } from '@renderer/blocks/types'
import { cx } from '@renderer/design'

const WIDE = new Set(['plot', 'explore', 'chart', 'timeline', 'diagram', 'drawing', 'labeled', 'model3d', 'simulation', 'map', 'image', 'table', 'compare', 'formulas'])

export function StaticBlocks({ blocks, ctx, className }: { blocks: Block[]; ctx: BlockContext; className?: string }) {
  const compact = ctx.mode === 'chat'
  return (
    <div className={cx('flex w-full flex-col', compact ? 'gap-3' : 'gap-4', className)}>
      {blocks.map((b, i) => (
        <div key={`${i}:${b.id}`} data-block={b.type} className={cx('w-full', WIDE.has(b.type) && !compact && 'my-1', i > 0 && b.type === 'text' && blocks[i - 1].type === 'text' && '-mt-1')}>
          <SafeBlockView block={b} ctx={ctx} />
        </div>
      ))}
    </div>
  )
}
