// Contenido que esta versión no sabe dibujar (de una versión futura, dañado o anidado sin fin) y el recuadro que sustituye a
// un bloque que falla al dibujarse: se avisa sin romper la lección.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cx, Icon } from '@renderer/design'
import { BLOCK_TYPES, TOO_DEEP_TYPE, type BlockOf } from '@shared/schema/blocks'
import type { BlockProps } from './types'

function QuietCard({ title, detail, compact }: { title: string; detail: string; compact?: boolean }) {
  return (
    <div className={cx('flex items-start gap-3 bg-fill1', compact ? 'rounded-[12px] px-3 py-2.5' : 'rounded-[16px] px-4 py-3.5')} role="note">
      <Icon name="help" size={16} className="mt-[2px] shrink-0 text-text3" />
      <div className="min-w-0">
        <div className="t-callout font-medium text-text2">{title}</div>
        <div className="t-footnote text-text3 mt-0.5">{detail}</div>
      </div>
    </div>
  )
}

export function UnknownBlockView({ block, ctx }: BlockProps<BlockOf<'unknown'>>) {
  const { t } = useTranslation('blocks')
  const type = block.rawType
  const detail = type === TOO_DEEP_TYPE ? t('unknown.tooDeep') : (BLOCK_TYPES as readonly string[]).includes(type.toLowerCase()) ? t('unknown.damaged') : t('unknown.newer', { type: Array.from(type).slice(0, 40).join('') })
  return <QuietCard title={t('unknown.title')} detail={detail} compact={ctx.mode === 'chat'} />
}

/** Si un bloque falla al dibujarse, solo él se sustituye por un aviso; el resto de la lección sigue. */
export class BlockBoundary extends Component<{ children: ReactNode; title: string; detail: string; compact?: boolean }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[bloque]', error, info.componentStack)
  }
  override render(): ReactNode {
    if (this.state.failed) return <QuietCard title={this.props.title} detail={this.props.detail} compact={this.props.compact} />
    return this.props.children
  }
}
