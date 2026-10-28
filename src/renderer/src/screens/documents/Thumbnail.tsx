// Miniatura de un documento: la primera página (o la que se dejó) de un PDF dibujada con pdf.js, la foto si es una imagen y,
// para el resto, una hoja de papel con su título en serif y unas líneas de texto.
import { useEffect, useState } from 'react'
import type { DocumentEntry } from '@shared/documents'
import { Icon, cx, toneForHue, useTheme } from '@renderer/design'
import { kindIcon, kindLabel } from './lib'
import { openEntryPdf, pageThumbnail, pdfKey } from './pdf'

export function Thumbnail({ entry, width, page = 1, className }: { entry: DocumentEntry; width: number; page?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const height = Math.round(width * 1.32)
  useEffect(() => {
    if (entry.mode !== 'pdf') return
    let alive = true
    openEntryPdf(entry)
      .then((pdf) => pageThumbnail(pdf, pdfKey(entry), Math.min(page, pdf.numPages), width))
      .then((s) => alive && setSrc(s))
      .catch(() => alive && setFailed(true))
    return () => { alive = false }
  }, [entry, page, width])

  const frame = cx('relative overflow-hidden rounded-[6px] bg-white shadow-[var(--e2)] border-[0.5px] border-line', className)
  if (entry.mode === 'image' && entry.fileUrl) {
    return <div className={frame} style={{ width, height }}><img src={entry.fileUrl} alt="" className="h-full w-full object-cover" draggable={false} /></div>
  }
  if (entry.mode === 'pdf' && src && !failed) {
    return <div className={frame} style={{ width }}><img src={src} alt="" className="block w-full" draggable={false} /></div>
  }
  return <PaperFace entry={entry} width={width} height={height} loading={entry.mode === 'pdf' && !failed} className={className} />
}

/** Hoja de papel con el título del documento (para lo que no es un PDF). */
function PaperFace({ entry, width, height, loading, className }: { entry: DocumentEntry; width: number; height: number; loading: boolean; className?: string }) {
  const { dark } = useTheme()
  const tone = toneForHue(entry.courseHue)
  const ink = entry.courseId ? (dark ? tone.inkDark : tone.inkLight) : 'var(--accent)'
  return (
    <div className={cx('relative isolate overflow-hidden rounded-[6px] bg-surface shadow-[var(--e2)] border-[0.5px] border-line', className)} style={{ width, height }}>
      {/* el color del curso como una luz quieta tras el papel (antes, un lomo de 3 px) */}
      <span aria-hidden className="absolute -z-10 -left-1/3 -top-1/4 h-[90%] aspect-square rounded-full" style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${ink} 22%, transparent), transparent)` }} />
      <div className="px-3 pt-3">
        <div className="flex items-center gap-1 text-text3"><Icon name={kindIcon(entry.kind)} size={10} /><span className="text-[8px] font-semibold tracking-wide uppercase">{kindLabel(entry.kind)}</span></div>
        <div className="mt-1.5 font-serif text-[11px] leading-[14px] text-text line-clamp-3">{entry.title}</div>
        <div className={cx('mt-2.5 flex flex-col gap-[5px]', loading && 'animate-pulse')}>
          {[92, 100, 84, 96, 70, 100, 88, 60].map((w, i) => <span key={i} className="h-[3px] rounded-full bg-fill3" style={{ width: `${w}%` }} />)}
        </div>
      </div>
    </div>
  )
}
