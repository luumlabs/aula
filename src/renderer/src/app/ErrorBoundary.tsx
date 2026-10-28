// Si una pantalla falla, se muestra un aviso amable con «Reintentar» en lugar de dejar la ventana en blanco.
import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import i18n from '@renderer/i18n'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  override componentDidCatch(error: Error) {
    console.error('[aula] pantalla', error)
  }
  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid flex-1 place-items-center p-10">
        <div className="bg-surface border-[0.5px] border-line shadow-[var(--e2)] rounded-[22px] p-8 max-w-[460px] text-center">
          <AlertTriangle className="mx-auto text-warning" size={26} />
          <h2 className="t-title2 mt-3">{i18n.t('errors.generic')}</h2>
          <p className="text-text2 mt-1 t-callout">{i18n.t('errors.screen')}</p>
          {/* el mensaje técnico (puede llevar rutas) queda plegado */}
          <details className="mt-3 text-left">
            <summary className="t-footnote text-text3 cursor-default text-center">{i18n.t('errors.details')}</summary>
            <p className="t-footnote text-text3 mt-2 break-words font-mono select-text">{this.state.error.message}</p>
          </details>
          <button className="mt-5 h-8 px-4 rounded-[10px] bg-accent text-on-accent font-semibold t-ui" onClick={() => this.setState({ error: null })}>
            {i18n.t('actions.retry')}
          </button>
        </div>
      </div>
    )
  }
}
