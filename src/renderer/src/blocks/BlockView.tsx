// Dibuja los bloques de una lección (port de BlockView.swift). `BlockView` elige la vista de cada tipo; los visuales (diagrama,
// dibujo, figura rotulada, 3D, simulación, mapa) se cargan bajo demanda. `BlockList` los coloca con el aire de lectura y los
// hace entrar suavemente al llegar a ellos.
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { cx } from '@renderer/design'
import type { Block, BlockOf, BlockType } from '@shared/schema/blocks'
import type { BlockContext, BlockProps } from './types'
import { useAnimate } from './shared'
import { CalloutBlockView, MathBlockView, QuoteBlockView, RecapBlockView, StepsBlockView, TextBlockView } from './TextBlocks'
import { ExampleBlockView } from './ExampleBlock'
import { CompareBlockView, TableBlockView } from './TableBlocks'
import { FormulasBlockView } from './FormulasBlock'
import { PredictBlockView, SpotBlockView, TryItBlockView } from './InteractiveBlocks'
import { CodeBlockView } from './CodeBlock'
import { ImageBlockView } from './ImageBlock'
import { NumberLineBlockView } from './NumberLineBlock'
import { ExploreBlockView, PlotBlockView } from './plot/PlotBlock'
import { ChartBlockView } from './chart/ChartBlock'
import { TimelineBlockView } from './timeline/TimelineBlock'
import { BlockBoundary, UnknownBlockView } from './UnknownBlock'
import './blocks.css'

type Lazy<T extends BlockType> = LazyExoticComponent<ComponentType<BlockProps<BlockOf<T>>>>

const DiagramBlock: Lazy<'diagram'> = lazy(() => import('./visual/DiagramBlock'))
const DrawingBlock: Lazy<'drawing'> = lazy(() => import('./visual/DrawingBlock'))
const LabeledBlock: Lazy<'labeled'> = lazy(() => import('./visual/LabeledBlock'))
const Model3DBlock: Lazy<'model3d'> = lazy(() => import('./visual/Model3DBlock'))
const SimulationBlock: Lazy<'simulation'> = lazy(() => import('./visual/SimulationBlock'))
const MapBlock: Lazy<'map'> = lazy(() => import('./visual/MapBlock'))
// Las diapositivas no tienen tipo propio en el esquema: llegan como bloque desconocido con `rawType: 'slides'`
const SlidesBlock: Lazy<'unknown'> = lazy(() => import('./visual/SlidesBlock'))

/** Tipos que ocupan el ancho de figura (más que la columna de lectura). */
const WIDE: ReadonlySet<string> = new Set(['plot', 'explore', 'chart', 'timeline', 'diagram', 'drawing', 'labeled', 'model3d', 'simulation', 'map', 'image', 'table', 'compare', 'formulas', 'slides'])

function VisualFallback({ ctx }: { ctx: BlockContext }) {
  return <div className={cx('skeleton w-full', ctx.mode === 'chat' ? 'h-[180px] rounded-[16px]' : 'h-[280px] rounded-[22px]')} aria-busy />
}

/** El bloque con su vista nativa. */
export function BlockView({ block, ctx }: BlockProps) {
  switch (block.type) {
    case 'text': return <TextBlockView block={block} ctx={ctx} />
    case 'math': return <MathBlockView block={block} ctx={ctx} />
    case 'callout': return <CalloutBlockView block={block} ctx={ctx} />
    case 'example': return <ExampleBlockView block={block} ctx={ctx} />
    case 'steps': return <StepsBlockView block={block} ctx={ctx} />
    case 'recap': return <RecapBlockView block={block} ctx={ctx} />
    case 'quote': return <QuoteBlockView block={block} ctx={ctx} />
    case 'code': return <CodeBlockView block={block} ctx={ctx} />
    case 'table': return <TableBlockView block={block} ctx={ctx} />
    case 'compare': return <CompareBlockView block={block} ctx={ctx} />
    case 'formulas': return <FormulasBlockView block={block} ctx={ctx} />
    case 'predict': return <PredictBlockView block={block} ctx={ctx} />
    case 'spot': return <SpotBlockView block={block} ctx={ctx} />
    case 'tryit': return <TryItBlockView block={block} ctx={ctx} />
    case 'chart': return <ChartBlockView block={block} ctx={ctx} />
    case 'timeline': return <TimelineBlockView block={block} ctx={ctx} />
    case 'plot': return <PlotBlockView block={block} ctx={ctx} />
    case 'explore': return <ExploreBlockView block={block} ctx={ctx} />
    case 'numberline': return <NumberLineBlockView block={block} ctx={ctx} />
    case 'image': return <ImageBlockView block={block} ctx={ctx} />
    case 'diagram': return <Suspense fallback={<VisualFallback ctx={ctx} />}><DiagramBlock block={block} ctx={ctx} /></Suspense>
    case 'drawing': return <Suspense fallback={<VisualFallback ctx={ctx} />}><DrawingBlock block={block} ctx={ctx} /></Suspense>
    case 'labeled': return <Suspense fallback={<VisualFallback ctx={ctx} />}><LabeledBlock block={block} ctx={ctx} /></Suspense>
    case 'model3d': return <Suspense fallback={<VisualFallback ctx={ctx} />}><Model3DBlock block={block} ctx={ctx} /></Suspense>
    case 'simulation': return <Suspense fallback={<VisualFallback ctx={ctx} />}><SimulationBlock block={block} ctx={ctx} /></Suspense>
    case 'map': return <Suspense fallback={<VisualFallback ctx={ctx} />}><MapBlock block={block} ctx={ctx} /></Suspense>
    case 'unknown':
      if (block.rawType === 'slides') return <Suspense fallback={<VisualFallback ctx={ctx} />}><SlidesBlock block={block} ctx={ctx} /></Suspense>
      return <UnknownBlockView block={block} ctx={ctx} />
  }
}

/** Un bloque protegido: si falla al dibujarse, un aviso en su lugar. */
export function SafeBlockView({ block, ctx }: BlockProps) {
  const { t } = useTranslation('blocks')
  return (
    <BlockBoundary title={t('unknown.title')} detail={t('unknown.failed')} compact={ctx.mode === 'chat'}>
      <BlockView block={block} ctx={ctx} />
    </BlockBoundary>
  )
}

/**
 * Una secuencia de bloques con el espaciado de lectura: la columna de texto a ~68 caracteres y las figuras algo más anchas
 * (en la lección); compacta en el chat. Cada bloque entra subiendo al llegar a él.
 */
export function BlockList({ blocks, ctx, className }: { blocks: Block[]; ctx: BlockContext; className?: string }) {
  const animate = useAnimate(ctx)
  const lesson = ctx.mode !== 'chat'
  return (
    <div className={cx('flex w-full flex-col', lesson ? 'gap-7' : 'gap-3', ctx.mode === 'print' && 'blk-static', className)}>
      {blocks.map((b, i) => {
        const tight = i > 0 && b.type === 'text' && blocks[i - 1].type === 'text'
        const width = lesson ? (WIDE.has(b.type === 'unknown' ? b.rawType : b.type) ? 'mx-auto w-full max-w-[880px]' : 'mx-auto w-full max-w-[720px]') : 'w-full'
        const cls = cx(width, tight && (lesson ? '-mt-3' : '-mt-1'))
        // por posición: los ids de bloque del contenido pueden repetirse
        const key = `${i}:${b.id}`
        if (!animate) {
          return (
            <div key={key} className={cls} data-block={b.type}>
              <SafeBlockView block={b} ctx={ctx} />
            </div>
          )
        }
        return (
          <motion.div
            key={key}
            className={cls}
            data-block={b.type}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '0px 0px -48px 0px' }}
            transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <SafeBlockView block={b} ctx={ctx} />
          </motion.div>
        )
      })}
    </div>
  )
}
