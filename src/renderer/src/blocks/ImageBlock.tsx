// Imagen del curso con pie y atribución, puntos de interés que laten despacio (al pulsarlos, una burbuja con su explicación)
// y vista ampliada al hacer clic (con zoom). Si la imagen no está, un pozo tranquilo con su descripción.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { cx, Icon, IconButton } from '@renderer/design'
import type { BlockOf, ImageHotspot } from '@shared/schema/blocks'
import type { BlockContext, BlockProps } from './types'
import { Caption, Inline, SourceLink, useAnimate, useBlocksT } from './shared'

/** Coordenada relativa entre 0 y 1 (una posición enorme o NaN se queda en el centro). */
const unit = (v: number): number => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0.5)

/** Separa el pie en descripción y crédito («Célula animal. LadyofHats, dominio público, Wikimedia Commons»). */
export function splitCredit(caption: string): { text: string; credit?: string } {
  const marks = ['wikimedia', 'dominio público', 'public domain', 'cc by', 'cc-by', 'cc0', 'licencia', 'license', 'foto:', 'imagen:', '©', 'fuente:', 'créditos', 'photo:', 'credit:', 'source:']
  const parts = caption.split('. ')
  if (parts.length <= 1) {
    const low = caption.toLowerCase()
    return marks.some((m) => low.startsWith(m)) ? { text: '', credit: caption } : { text: caption }
  }
  for (let i = 1; i < parts.length; i++) {
    if (marks.some((m) => parts[i].toLowerCase().includes(m))) {
      const text = parts.slice(0, i).join('. ') + '.'
      const credit = parts.slice(i).join('. ').replace(/^[.\s]+|[.\s]+$/g, '')
      return { text, credit: credit || undefined }
    }
  }
  return { text: caption }
}

export function ImageBlockView({ block, ctx }: BlockProps<BlockOf<'image'>>) {
  const t = useBlocksT()
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const src = block.asset && !failed ? ctx.assetUrl(block.asset) : undefined
  const hotspots = block.hotspots.slice(0, 60)
  const parts = block.caption ? splitCredit(block.caption) : { text: '' }
  const credit = block.credit?.trim() || parts.credit
  const print = ctx.mode === 'print'
  const chat = ctx.mode === 'chat'

  return (
    <figure className="m-0">
      {src ? (
        <div className={cx('relative overflow-visible', print && 'blk-static')}>
          <button
            type="button"
            className={cx('group/img relative block w-full overflow-hidden border-[0.5px] border-line bg-sunken outline-none focus-visible:ring-2 focus-visible:ring-accent-line', chat ? 'rounded-[12px]' : 'rounded-[18px]', !print && 'cursor-zoom-in')}
            onClick={() => !print && setZoomed(true)}
            aria-label={t('image.zoom', { alt: block.alt || t('image.image') })}
            disabled={print}
          >
            <img src={src} alt={block.alt} onError={() => setFailed(true)} className="block h-auto max-h-[560px] w-full object-contain" draggable={false} />
            {!print && (
              <span className="pointer-events-none absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-raised/90 text-text2 opacity-0 shadow-[var(--e2)] transition-opacity group-hover/img:opacity-100">
                <Icon name="expand" size={15} />
              </span>
            )}
          </button>
          <Hotspots spots={hotspots} open={open} setOpen={setOpen} ctx={ctx} />
        </div>
      ) : (
        <div className={cx('flex items-center gap-3 bg-sunken p-4', chat ? 'rounded-[12px]' : 'rounded-[18px]')}>
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-fill2 text-text3">
            <Icon name={block.source ? 'file-text' : 'image'} size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="t-callout text-text">{block.alt || t('image.image')}</div>
            {block.source ? <SourceLink source={block.source} ctx={ctx} /> : <div className="t-footnote text-text2">{t('image.missing')}</div>}
          </div>
        </div>
      )}
      {src && hotspots.length > 0 && (
        <ol className="m-0 mt-3 grid list-none gap-x-4 gap-y-1.5 p-0 sm:grid-cols-2">
          {hotspots.map((h, i) => (
            <li key={i}>
              <button type="button" onClick={() => setOpen(open === i ? null : i)} disabled={print} className={cx('flex w-full items-baseline gap-2 rounded-[8px] px-1.5 py-0.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-line', !print && 'hover:bg-fill1', open === i && 'bg-accent-wash')}>
                <span className="t-caption font-bold tabular text-accent-text">{i + 1}</span>
                <span className="t-callout text-text2"><Inline text={h.label} /></span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {(parts.text || credit) && (
        <figcaption className="mt-2 flex flex-col gap-0.5 px-1">
          <Caption text={parts.text} />
          {credit && <div className="t-caption text-text3">{credit}</div>}
        </figcaption>
      )}
      {src && <Lightbox open={zoomed} onClose={() => setZoomed(false)} src={src} alt={block.alt} caption={parts.text} spots={hotspots} ctx={ctx} />}
    </figure>
  )
}

/** Puntos numerados sobre la imagen; el abierto muestra su burbuja (Escape o clic fuera la cierran). */
function Hotspots({ spots, open, setOpen, ctx, large }: { spots: ImageHotspot[]; open: number | null; setOpen: (i: number | null) => void; ctx: BlockContext; large?: boolean }) {
  const t = useBlocksT()
  const animate = useAnimate(ctx)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open === null) return
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open, setOpen])
  if (!spots.length) return null
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      {spots.map((h, i) => {
        const x = unit(h.x) * 100
        const y = unit(h.y) * 100
        const on = open === i
        return (
          <div key={i} className="absolute" style={{ left: `${x}%`, top: `${y}%` }}>
            <motion.button
              type="button"
              className={cx('blk-pulse pointer-events-auto relative isolate grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-accent font-bold text-on-accent shadow-[0_0_0_2px_var(--surface),var(--e2)] outline-none focus-visible:ring-2 focus-visible:ring-accent-line', large ? 'h-8 w-8 text-[13px]' : 'h-6 w-6 text-[11.5px]', on && 'blk-static')}
              initial={animate ? { scale: 0 } : false}
              whileInView={animate ? { scale: 1 } : undefined}
              viewport={{ once: true }}
              transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.25 + i * 0.07 }}
              whileHover={{ scale: 1.12 }}
              onClick={(e) => {
                e.stopPropagation()
                if (ctx.mode !== 'print') setOpen(on ? null : i)
              }}
              aria-label={t('image.point', { n: i + 1, label: h.label })}
              aria-expanded={on}
            >
              {i + 1}
            </motion.button>
            <AnimatePresence>
              {on && (
                <motion.div
                  role="tooltip"
                  className={cx('pointer-events-auto absolute z-20 w-max max-w-[260px] rounded-[12px] border-[0.5px] border-line bg-raised px-3 py-2 t-callout text-text', y > 55 ? 'bottom-[18px]' : 'top-[18px]', x > 65 ? 'right-[-12px]' : x < 35 ? 'left-[-12px]' : '-translate-x-1/2')}
                  style={{ boxShadow: 'var(--e3)' }}
                  initial={{ opacity: 0, y: y > 55 ? 4 : -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.16 }}
                >
                  <span className="mr-1.5 t-caption font-bold text-accent-text">{i + 1}</span>
                  <Inline text={h.label} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

/** Vista ampliada: la imagen a pantalla casi completa; un clic acerca al punto pulsado. */
function Lightbox({ open, onClose, src, alt, caption, spots, ctx }: { open: boolean; onClose: () => void; src: string; alt: string; caption: string; spots: ImageHotspot[]; ctx: BlockContext }) {
  const t = useBlocksT()
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null)
  const [spot, setSpot] = useState<number | null>(null)
  useEffect(() => {
    if (!open) {
      setZoom(null)
      setSpot(null)
      return
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [open, onClose])
  const toggleZoom = (e: ReactMouseEvent<HTMLImageElement>) => {
    e.stopPropagation()
    if (zoom) return setZoom(null)
    const r = e.currentTarget.getBoundingClientRect()
    setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 })
  }
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[rgba(16,13,10,0.82)] p-8 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} role="dialog" aria-modal aria-label={alt || t('image.image')}>
          <IconButton label={t('common.close')} variant="raised" className="absolute right-5 top-5" onClick={onClose}>
            <Icon name="close" size={16} />
          </IconButton>
          <motion.div className="relative max-h-[84vh] max-w-[92vw] overflow-hidden rounded-[16px]" initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} transition={{ type: 'spring', stiffness: 224, damping: 30 }} onClick={(e) => e.stopPropagation()}>
            <motion.img
              src={src}
              alt={alt}
              onClick={toggleZoom}
              className={cx('block max-h-[84vh] max-w-[92vw] select-none object-contain', zoom ? 'cursor-zoom-out' : 'cursor-zoom-in')}
              animate={{ scale: zoom ? 2.2 : 1 }}
              style={{ transformOrigin: zoom ? `${zoom.x}% ${zoom.y}%` : 'center' }}
              transition={{ type: 'spring', stiffness: 224, damping: 30 }}
              draggable={false}
            />
            {!zoom && <Hotspots spots={spots} open={spot} setOpen={setSpot} ctx={ctx} large />}
          </motion.div>
          {caption && (
            <div className="mt-4 max-w-[720px] text-center t-callout text-[#efe7dc]" onClick={(e) => e.stopPropagation()}>
              <Inline text={caption} />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
