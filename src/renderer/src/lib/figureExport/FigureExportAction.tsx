import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FigureSvg } from '@shared/figures'
import { Icon, IconButton, Menu, Spinner, toast } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { figurePng } from './png'

/** Acción común: la figura aporta una instantánea, no rutas ni datos ocultos del bloque. */
export function FigureExportAction({ captureSvg, capturePng, kind }: { captureSvg?: (signal: AbortSignal) => Promise<FigureSvg>; capturePng?: (signal: AbortSignal) => Promise<Uint8Array>; kind: string }) {
  const { t } = useTranslation('visual')
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const save = async (format: 'svg' | 'png'): Promise<void> => {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    try {
      if (format === 'svg' && !captureSvg) return
      const request = format === 'svg'
        ? { format, suggestedName: kind, svg: await captureSvg!(controller.signal) }
        : { format, suggestedName: kind, data: capturePng ? await capturePng(controller.signal) : await figurePng(await captureSvg!(controller.signal), controller.signal) }
      if (controller.signal.aborted) return
      const result = await api.invoke('figures.save', request)
      if (result && !controller.signal.aborted) toast.success(t('figureExport.saved'))
    } catch {
      if (!controller.signal.aborted) toast.error(t('figureExport.failed'))
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  // El guardado nativo pertenece al equipo que muestra la figura, nunca al servidor de una sesión remota.
  if (api.remote || (!captureSvg && !capturePng)) return null
  return (
    <span className="inline-flex print:hidden" data-figure-export={kind} aria-busy={busy}>
      <Menu
        trigger={(open, expanded) => <IconButton size="sm" label={t(busy ? 'figureExport.saving' : 'figureExport.label')}
          // No se deshabilita nativamente: perdería el foco al cancelar el diálogo. Tab sigue libre durante la captura.
          aria-disabled={busy} className="aria-disabled:opacity-35" aria-haspopup="menu" aria-expanded={expanded}
          onClick={() => { if (!pending.current) open() }}
          onKeyDown={(event) => {
            // Menu escucha estas teclas en su contenedor; tampoco debe abrirse mientras se guarda.
            if (pending.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}>
          {busy ? <Spinner size={14} /> : <Icon name="download" size={15} />}
        </IconButton>}
        items={(captureSvg ? ['svg', 'png'] as const : ['png'] as const).map((format) => ({ label: t(`figureExport.${format}`), disabled: busy, onSelect: () => void save(format) }))}
      />
      <span className="sr-only" role="status">{busy ? t('figureExport.saving') : ''}</span>
    </span>
  )
}
