// Aviso de logro: al conseguir uno, entra arriba a la derecha (lejos de los botones del estudio) una tarjeta con su dibujo pixel-art que se enciende píxel a píxel y una ráfaga de
// píxeles. Si llegan varios, uno detrás de otro. Pulsarla abre la estantería en Estadísticas.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { AchievementId } from '@shared/ipc/achievements'
import { api } from '@renderer/lib/api'
import { navigate } from '@renderer/app/router'
import { DrawnTile, InkBurst, pixelBurst, spring, useTheme } from '@renderer/design'
import { AchievementArt } from '@renderer/screens/stats/Achievements'

const SHOW_MS = 5200
/** Si llegan muchos a la vez, cada uno se ve menos tiempo. */
const SHOW_MS_BUSY = 3000

export function AchievementToast() {
  const { t } = useTranslation('stats')
  const { reducedMotion } = useTheme()
  const [queue, setQueue] = useState<AchievementId[]>([])
  const art = useRef<HTMLDivElement>(null)
  const current = queue[0]

  useEffect(() => api.on('achievements.earned', ({ ids }) => setQueue((q) => [...q, ...ids.filter((id) => !q.includes(id))])), [])
  useEffect(() => {
    if (!current) return
    const burst = setTimeout(() => { if (art.current) pixelBurst(art.current, { count: 18 }) }, reducedMotion ? 0 : 420)
    const next = setTimeout(() => setQueue((q) => q.slice(1)), queue.length > 2 ? SHOW_MS_BUSY : SHOW_MS)
    return () => { clearTimeout(burst); clearTimeout(next) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar el que se muestra
  }, [current, reducedMotion])

  return (
    <div className="pointer-events-none fixed right-6 top-[60px] z-[120] flex justify-end" aria-live="polite">
      <AnimatePresence mode="wait">
        {current && (
          <motion.button
            key={current}
            initial={{ opacity: 0, x: 28, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 16, scale: 0.98 }}
            transition={spring.bouncy}
            onClick={() => { setQueue((q) => q.slice(1)); navigate({ name: 'stats' }) }}
            className="pointer-events-auto flex items-center gap-4 rounded-[22px] bg-surface border-[0.5px] border-line pl-4 pr-6 py-3.5 text-left no-drag"
            style={{ boxShadow: 'var(--e3)' }}
          >
            {/* el logro, sobre una losa dibujada a mano (relleno ladrillo plano y su contorno a pincel; cada logro, su trazo) */}
            <div ref={art} className="relative">
              {/* unas rayitas de alegría a pincel, una tras otra, alrededor del dibujo */}
              <InkBurst seed={current} size={96} className="-left-5 -top-5 pointer-events-none" />
              <DrawnTile seed={current} size={56} radius={16} fill="color-mix(in oklab, var(--pigment-brick) 16%, var(--surface))" ink="var(--pigment-brick)" inkAlpha={0.85}>
                <AchievementArt id={current} size={40} animation="dissolve" />
              </DrawnTile>
            </div>
            <div>
              <div className="t-caption uppercase tracking-[0.06em] text-accent-text font-semibold">{t('achievements.unlocked')}</div>
              <div className="font-serif text-[20px] leading-6 text-text mt-0.5">{t(`achievements.items.${current}.name`)}</div>
              <div className="t-footnote text-text3 mt-0.5">{t(`achievements.items.${current}.how`)}</div>
            </div>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
