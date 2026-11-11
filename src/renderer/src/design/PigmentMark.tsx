// Muestra de pigmento: el color de identidad de una burbuja (un curso, un tipo de nota, un resultado) como unas pasadas de
// pincel plano en su esquina, igual que se prueba un color en el margen del papel. Es pintura, no luz: plana, mate y QUIETA
// (no deriva ni sigue al ratón); se pinta una vez en un hilo aparte (paint/recipes.ts → `swatch`) y en reposo no cuesta nada.
// Sustituye a la antigua «luz tras el cristal». El contenedor debe ser `relative` + `isolate`.
import { useId } from 'react'
import { cx } from './cx'
import { Paint } from './paint'
import { seedOf } from './paint/random'
import './pigmentMark.css'

export interface PigmentMarkProps {
  /** Color de identidad (un tono de curso, `var(--success)`…). */
  color: string
  size?: 'md' | 'sm'
  /** Lo que identifica la burbuja: la misma semilla pinta siempre la misma muestra. Sin ella, la da su sitio en la pantalla. */
  seed?: string | number
  className?: string
}

/** Unas pocas muestras distintas bastan (y solo se pinta una máscara por cada una, del mismo tamaño). */
const VARIANTS = 6
const MASK = { w: 240, h: 144 }

export function PigmentMark({ color, size = 'md', seed, className }: PigmentMarkProps) {
  const place = useId()
  const variant = seedOf(String(seed ?? place)) % VARIANTS
  return (
    <span aria-hidden className={cx('pigment-mark', className)} data-size={size === 'sm' ? 'sm' : undefined}>
      <Paint kind="swatch" seed={`muestra:${variant}`} color={color} size={MASK} className="pigment-mark__paint" />
    </span>
  )
}
