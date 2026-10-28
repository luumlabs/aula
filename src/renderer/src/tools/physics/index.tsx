// Física: un patio de simulaciones (tiro parabólico, péndulo, muelle, ondas y choques) con deslizadores, lecturas y
// gráficas en vivo. Cada simulación se carga al elegirla.
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Activity, ArrowRightLeft, CircleDot, Rocket, Waves } from 'lucide-react'
import { SegmentedTabs, Spinner } from '@renderer/design'
import { useStored } from '../shared/ui'
import type { ToolProps } from '../registry'

const SIMS = {
  projectile: lazy(() => import('./sims/Projectile')),
  pendulum: lazy(() => import('./sims/Pendulum')),
  spring: lazy(() => import('./sims/Spring')),
  waves: lazy(() => import('./sims/Waves')),
  collisions: lazy(() => import('./sims/Collisions'))
}
type Sim = keyof typeof SIMS
const ICONS: Record<Sim, typeof Rocket> = { projectile: Rocket, pendulum: CircleDot, spring: Activity, waves: Waves, collisions: ArrowRightLeft }

export default function PhysicsTool(_props: ToolProps) {
  const { t } = useTranslation('tools')
  const [sim, setSim] = useStored<Sim>('aula.tools.physics.sim', 'projectile', (v): v is Sim => typeof v === 'string' && v in SIMS)
  const Comp = SIMS[sim]
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto -mx-1 px-1 pb-0.5">
        <SegmentedTabs
          value={sim}
          onChange={setSim}
          items={(Object.keys(SIMS) as Sim[]).map((id) => {
            const Icon = ICONS[id]
            return { id, label: t(`physics.sim.${id}`), icon: <Icon size={14} /> }
          })}
        />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={sim} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          <Suspense fallback={<div className="grid place-items-center h-60"><Spinner size={20} /></div>}>
            <Comp />
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
