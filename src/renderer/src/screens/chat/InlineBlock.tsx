// Un bloque visual dentro de un mensaje (gráfica, tabla, diagrama…): se dibuja con el visor de bloques de las lecciones
// en modo «chat», después de pasar por el normalizador como en las lecciones (así las formas abreviadas que documenta la guía
// —un Venn con `sets`/`items`, un mapa mental con `root`, un `process`— se dibujan). Si el bloque no es válido se muestra
// como código, sin romper la conversación.
import { lazy, Suspense, useMemo, type ComponentType } from 'react'
import type { JSONValue } from '@engine/base/json'
import { decodeAIBlock } from '@engine/assistant/parser'
import type { TutorContext } from '@shared/assistant/types'
import type { Block } from '@shared/schema/blocks'
import { Card, Spinner } from '@renderer/design'
import { makeBlockContext, type BlockProps } from '@renderer/blocks/types'
import { useChatActions } from './actions'

const mods = import.meta.glob('../../blocks/BlockView.tsx')
const loader = mods['../../blocks/BlockView.tsx']
const SafeBlockView = loader
  ? lazy(async () => {
      const m = (await loader()) as { SafeBlockView: ComponentType<BlockProps> }
      return { default: m.SafeBlockView }
    })
  : null

/** El bloque que escribió la IA, normalizado (o undefined si no es un objeto de bloque que se pueda leer). */
export function inlineBlockOf(raw: unknown): Block | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  try {
    return decodeAIBlock(raw as JSONValue)
  } catch {
    return undefined
  }
}

/** Contexto al marcar y preguntar sobre una figura que apareció dentro de una conversación (chat o tutor). */
export function chatFigureContext(packId: string | null, blockId: string, markedFigure?: TutorContext['markedFigure']): TutorContext {
  return {
    ...(packId ? { courseID: packId } : {}),
    screen: 'chat',
    blockID: blockId,
    ...(markedFigure ? { markedFigure } : {})
  }
}

export function InlineBlock({ raw, packId, language, live = false }: { raw: unknown; packId: string | null; language: string; live?: boolean }) {
  const block = useMemo(() => inlineBlockOf(raw), [raw])
  const actions = useChatActions()
  const ctx = useMemo(
    () =>
      makeBlockContext(packId, language, {
        mode: 'chat',
        onAskTutor:
          actions && !live
            ? (blockId, message, _from, markedFigure) => actions.ask(message, chatFigureContext(packId, blockId, markedFigure))
            : undefined
      }),
    [packId, language, actions, live]
  )
  if (!block) return <pre className="t-mono bg-sunken rounded-[14px] p-3 overflow-x-auto">{JSON.stringify(raw, null, 1)}</pre>
  if (!SafeBlockView) return <Card padded="sm" className="t-ui text-text3">{(block as { title?: string }).title ?? block.type}</Card>
  return (
    <div className="my-3">
      <Suspense fallback={<div className="grid place-items-center h-24 text-text3"><Spinner /></div>}>
        <SafeBlockView block={block} ctx={ctx} />
      </Suspense>
    </div>
  )
}
