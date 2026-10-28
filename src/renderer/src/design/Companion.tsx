// Compañeros pixel-art (24×24): cada agente del equipo que crea un curso tiene el suyo. Cada uno tiene su pequeña
// historia dibujada (reposo de vez en cuando, la historia completa al pasar el ratón, celebración con `celebrate`).
// Cuando trabajan (`working`) parpadean, cambian de pose y flotan un píxel (la animación de Luna, del mismo autor).
import { memo, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { COMPANIONS } from './pixel/companions'
import { companionAnim, workingIndex } from './pixel/characters'
import { PixelCanvas, usePixelPlayer } from './Pixel'
import { useTheme } from './theme'

/** Papel de cada agente → su compañero (el mapa de la app original). */
export const ROLE_COMPANION = {
  gatherer: 'abeja',
  reader: 'libro',
  planner: 'farol',
  lesson: 'pluma',
  exercises: 'cohete',
  cards: 'sobre',
  verifier: 'buho',
  arbiter: 'cristal',
  glossary: 'hoja',
  formulas: 'reloj',
  polish: 'estrella',
  tutor: 'luna',
  aula: 'sol'
} as const
export type CompanionRole = keyof typeof ROLE_COMPANION

export const Companion = memo(function Companion({ id, role, size = 36, working = false, tile = true, appear = false, celebrate }: { id?: string; role?: CompanionRole; size?: number; working?: boolean; tile?: boolean; appear?: boolean; celebrate?: boolean | number }) {
  const { reducedMotion } = useTheme()
  const anim = companionAnim(id ?? (role ? ROLE_COMPANION[role] : 'luna'))
  const inner = Math.round(size * (tile ? 0.78 : 1))
  const ref = useRef<HTMLCanvasElement>(null)
  const player = usePixelPlayer(ref, anim, inner, { entrance: 'none', delay: 0, celebrate: true, idle: true, loop: null }, celebrate)
  // el bucle «trabajando» se enciende y se apaga sin recrear el lienzo
  useEffect(() => {
    player.current?.setLoop(working ? { frames: anim.working, at: (t) => workingIndex(anim.data, t) } : null)
  }, [working, anim, player])
  const body = <PixelCanvas canvasRef={ref} anim={anim} size={inner} />
  const shown = appear && !reducedMotion ? (
    <motion.div initial={{ scale: 0.3, opacity: 0, y: 6 }} animate={{ scale: 1, opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 18 }} style={{ display: 'grid' }}>
      {body}
    </motion.div>
  ) : (
    body
  )
  if (!tile) return shown
  return (
    <div className="grid place-items-center shrink-0 bg-tile" style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}>
      {shown}
    </div>
  )
})

export const COMPANION_IDS = COMPANIONS.map((c) => c.id)
