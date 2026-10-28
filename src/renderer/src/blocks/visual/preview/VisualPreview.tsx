// Página de desarrollo de los bloques visuales: todos los ejemplos (VISUAL_SAMPLES), uno debajo de otro; `only` deja unos tipos
// e `ids` unos ejemplos. Se puede montar en la ruta `blocks-preview`.
import { lazy, Suspense, type ComponentType } from 'react'
import type { Block } from '@shared/schema/blocks'
import { Card } from '@renderer/design'
import { makeBlockContext, type BlockContext, type BlockProps } from '../../types'
import { VISUAL_PREVIEW_ASSETS, VISUAL_SAMPLES } from './samples'

type AnyBlock = ComponentType<BlockProps<Block>>
const view = (load: () => Promise<{ default: unknown }>): AnyBlock => lazy(load as () => Promise<{ default: AnyBlock }>)

const VIEWS: Record<string, AnyBlock> = {
  diagram: view(() => import('../DiagramBlock')),
  drawing: view(() => import('../DrawingBlock')),
  labeled: view(() => import('../LabeledBlock')),
  simulation: view(() => import('../SimulationBlock')),
  map: view(() => import('../MapBlock')),
  model3d: view(() => import('../Model3DBlock')),
  slides: view(() => import('../SlidesBlock'))
}

export function VisualPreview({ only, ids, mode = 'lesson' }: { only?: string; ids?: string; mode?: BlockContext['mode'] }) {
  const base = makeBlockContext('demo', 'es', { mode })
  const ctx: BlockContext = { ...base, assetUrl: (p) => VISUAL_PREVIEW_ASSETS[p] ?? base.assetUrl(p) }
  const kinds = Object.keys(VISUAL_SAMPLES).filter((k) => !only || only.split(',').includes(k))
  return (
    <div className="flex flex-col gap-6 p-6 max-w-[980px] mx-auto">
      {kinds.flatMap((k) =>
        VISUAL_SAMPLES[k].filter((b) => !ids || ids.split(',').includes(b.id)).map((b: Block) => {
          const View = VIEWS[k]
          if (!View) return null
          return (
            <Card key={b.id} padded="lg">
              <Suspense fallback={<div className="h-40" />}>
                <View block={b} ctx={ctx} />
              </Suspense>
            </Card>
          )
        })
      )}
    </div>
  )
}
