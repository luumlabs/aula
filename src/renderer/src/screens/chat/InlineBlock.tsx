// Un bloque visual dentro de un mensaje (gráfica, tabla, diagrama…): se dibuja con el visor de bloques de las lecciones
// en modo «chat». Si el bloque no es válido se muestra como código, sin romper la conversación.
import { lazy, Suspense, useMemo, type ComponentType } from 'react'
import { decodeBlock } from '@shared/schema/blocks'
import { Card, Spinner } from '@renderer/design'
import { makeBlockContext, type BlockProps } from '@renderer/blocks/types'

const mods = import.meta.glob('../../blocks/BlockView.tsx')
const loader = mods['../../blocks/BlockView.tsx']
const BlockView = loader
  ? lazy(async () => {
      const m = (await loader()) as { BlockView: ComponentType<BlockProps> }
      return { default: m.BlockView }
    })
  : null

export function InlineBlock({ raw, packId, language }: { raw: unknown; packId: string | null; language: string }) {
  const block = useMemo(() => decodeBlock(raw), [raw])
  const ctx = useMemo(() => makeBlockContext(packId, language, { mode: 'chat' }), [packId, language])
  if (!block) return <pre className="t-mono bg-sunken rounded-[14px] p-3 overflow-x-auto">{JSON.stringify(raw, null, 1)}</pre>
  if (!BlockView) return <Card padded="sm" className="t-ui text-text3">{(block as { title?: string }).title ?? block.type}</Card>
  return (
    <div className="my-3">
      <Suspense fallback={<div className="grid place-items-center h-24 text-text3"><Spinner /></div>}>
        <BlockView block={block} ctx={ctx} />
      </Suspense>
    </div>
  )
}
