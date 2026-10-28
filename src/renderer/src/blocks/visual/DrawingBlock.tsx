// Dibujo vectorial (`drawing`): líneas, flechas, formas, arcos, ángulos y textos con fórmulas que se trazan uno tras otro al
// entrar en la vista (port de StudyUI/Blocks/DrawingView.swift). En papel y con «Reducir movimiento», ya dibujado.
import { useTranslation } from 'react-i18next'
import { useTheme } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import { RichText } from '@renderer/lib/RichText'
import type { BlockProps } from '../types'
import { canvasSize } from './lib/drawing'
import { DrawingCanvas } from './shared/DrawingCanvas'
import { Caption, useInView, useInk, useSize } from './shared/ui'

export default function DrawingBlock({ block, ctx }: BlockProps<BlockOf<'drawing'>>) {
  const { t } = useTranslation('visual')
  const ink = useInk(ctx.hue)
  const { reducedMotion } = useTheme()
  const { W, H } = canvasSize(block.width, block.height)
  const [box, size] = useSize<HTMLDivElement>()
  const seen = useInView(box, true, '-40px')
  const animate = ctx.mode !== 'print' && !reducedMotion
  const maxW = Math.min(W * 1.6, ctx.mode === 'chat' ? 560 : 760)
  const label = [block.title, block.caption].filter(Boolean).join('. ') || t('drawing')
  return (
    <figure className="flex flex-col gap-2 m-0" style={ink} aria-label={label} role="img">
      {block.title && (
        <figcaption className="font-serif text-[19px] leading-[26px] font-medium text-text">
          <RichText text={block.title} inline />
        </figcaption>
      )}
      <div className="w-full flex justify-center">
        <div ref={box} className="relative w-full" style={{ maxWidth: maxW, aspectRatio: `${W} / ${H}` }}>
          {size.width > 0 && <DrawingCanvas items={block.items} W={W} H={H} pixelWidth={size.width} animate={animate} play={seen} />}
        </div>
      </div>
      <Caption text={block.caption} />
    </figure>
  )
}
