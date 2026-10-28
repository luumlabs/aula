// Herramientas fijadas: ventanitas de cristal que flotan encima de cualquier pantalla y se arrastran.
import { Suspense, type MouseEvent } from 'react'
import { create } from 'zustand'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { GripHorizontal, Maximize2, Pin, PinOff, X } from 'lucide-react'
import { Button, IconButton, Spinner, spring } from '@renderer/design'
import { toolById } from './registry'
import { navigate } from '@renderer/app/router'

interface PinnedState {
  pinned: string[]
  pin: (id: string) => void
  unpin: (id: string) => void
}

const load = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem('aula.tools.pinned') ?? '[]') as string[]
  } catch {
    return []
  }
}

export const usePinnedTools = create<PinnedState>((set, get) => ({
  pinned: load(),
  pin: (id) => {
    const next = [...get().pinned.filter((x) => x !== id), id].slice(-3)
    localStorage.setItem('aula.tools.pinned', JSON.stringify(next))
    set({ pinned: next })
  },
  unpin: (id) => {
    const next = get().pinned.filter((x) => x !== id)
    localStorage.setItem('aula.tools.pinned', JSON.stringify(next))
    set({ pinned: next })
  }
}))

/** Fijar o quitar una herramienta flotante: el mismo botón en la cabecera de la herramienta (`button`) y en su baldosa (`icon`). */
export function PinToolButton({ id, look = 'button', onPinned }: { id: string; look?: 'button' | 'icon'; onPinned?: () => void }) {
  const { t } = useTranslation('tools')
  const pinned = usePinnedTools((s) => s.pinned.includes(id))
  const pin = usePinnedTools((s) => s.pin)
  const unpin = usePinnedTools((s) => s.unpin)
  const label = pinned ? t('unpinFloating') : t('pin')
  const toggle = (e: MouseEvent) => {
    e.stopPropagation()
    if (pinned) return unpin(id)
    pin(id)
    onPinned?.()
  }
  const glyph = pinned ? <PinOff size={14} /> : <Pin size={14} />
  if (look === 'icon') {
    return (
      <IconButton label={label} size="sm" active={pinned} onClick={toggle} onPointerDown={(e) => e.stopPropagation()} className={pinned ? 'text-accent-text!' : undefined}>
        {glyph}
      </IconButton>
    )
  }
  return (
    <Button size="sm" variant="secondary" icon={glyph} onClick={toggle}>
      {label}
    </Button>
  )
}

export function FloatingTools() {
  const pinned = usePinnedTools((s) => s.pinned)
  return (
    <AnimatePresence>
      {pinned.map((id, i) => (
        <FloatingTool key={id} id={id} index={i} />
      ))}
    </AnimatePresence>
  )
}

function FloatingTool({ id, index }: { id: string; index: number }) {
  const { t } = useTranslation('tools')
  const tool = toolById(id)
  const unpin = usePinnedTools((s) => s.unpin)
  const controls = useDragControls()
  if (!tool) return null
  const Comp = tool.component
  const Icon = tool.icon
  return (
    <motion.div
      drag
      dragListener={false}
      dragControls={controls}
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.85, y: -20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: -14 }}
      transition={spring.smooth}
      className="fixed z-[60] material-menu rounded-[18px] w-[340px] overflow-hidden"
      // arriba a la derecha, bajo la cápsula del estudio: abajo están los botones principales (Comprobar, Girar…)
      style={{ right: 24 + index * 24, top: `calc(var(--titlebar-h, 0px) + ${112 + index * 28}px)` }}
    >
      <div className="flex items-center gap-2 px-3 h-10 border-b-[0.5px] border-line cursor-grab active:cursor-grabbing" onPointerDown={(e) => controls.start(e)}>
        <span className="grid place-items-center w-6 h-6 rounded-[7px] bg-tile text-text2">
          <Icon size={14} />
        </span>
        <span className="flex-1 t-ui font-semibold truncate">{t(`${id}.name`)}</span>
        <GripHorizontal size={15} className="text-text3" />
        <IconButton label={t('expand')} size="sm" onClick={() => navigate({ name: 'tools', tool: id })}>
          <Maximize2 size={14} />
        </IconButton>
        <IconButton label={t('unpin')} size="sm" onClick={() => unpin(id)}>
          <X size={15} />
        </IconButton>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <Suspense fallback={<div className="grid place-items-center h-40"><Spinner /></div>}>
          <Comp compact />
        </Suspense>
      </div>
    </motion.div>
  )
}
