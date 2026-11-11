// La fila elegida de una lista (la barra lateral, las conversaciones): una pasada de pincel plano en ladrillo muy aguado,
// en vez de una píldora gris. Es pintura quieta (se pinta una vez, paint/recipes.ts → `pass`); quien la usa la coloca
// (`absolute inset-0`) y, si quiere, la desliza de una fila a otra con `layoutId`.
import { Paint } from './paint'
import { seedOf } from './paint/random'
import { cx } from './cx'

/** Una sola máscara por variante (se estira a la fila): unas pocas bastan para que dos listas no pinten igual. */
const VARIANTS = 3
const MASK = { w: 232, h: 34 }

export function SelectionPaint({ seed = 'fila', className }: { seed?: string | number; className?: string }) {
  return <Paint kind="pass" seed={`eleccion:${seedOf(String(seed)) % VARIANTS}`} color="var(--pigment-brick)" alpha={0.2} size={MASK} className={cx('inset-0 h-full w-full', className)} />
}
