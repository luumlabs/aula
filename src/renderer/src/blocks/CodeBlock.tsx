// Bloque `code` de la lección: la superficie común del código (lib/code/CodeSurface: resaltado, copiar, números de línea y
// la salida) con su pie. En un ejercicio sin resolver, `stripRevealedCodeOutput` quita la salida solo cuando da la respuesta.
import { useContext } from 'react'
import type { BlockOf } from '@shared/schema/blocks'
import { CodeSurface, CompactCode } from '@renderer/lib/code/CodeSurface'
import type { BlockProps } from './types'
import { Caption } from './shared'

export function CodeBlockView({ block, ctx }: BlockProps<BlockOf<'code'>>) {
  const compact = useContext(CompactCode)
  return (
    <div>
      <CodeSurface
        code={block.code}
        language={block.language}
        output={block.output}
        compact={ctx.mode === 'chat' || compact}
        copyable={ctx.mode !== 'print'}
        onCopy={() => ctx.onInteract?.(block.id, 'code.copy')}
      />
      <Caption text={block.caption} className="mt-2 px-1" />
    </div>
  )
}
