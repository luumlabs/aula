// Química: masa molar con composición, balanceo animado, estequiometría con reactivo limitante, disoluciones, gases
// ideales y pH. Todo lo calcula el motor de química (src/engine/chem); aquí solo se dibuja.
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Beaker, Droplets, FlaskConical, Scale, Sigma, Wind } from 'lucide-react'
import { SegmentedTabs, Spinner } from '@renderer/design'
import { useStored } from '../shared/ui'
import type { ToolProps } from '../registry'

const TABS = {
  molar: lazy(() => import('./MolarMass')),
  balance: lazy(() => import('./Balance')),
  stoich: lazy(() => import('./Stoich')),
  solutions: lazy(() => import('./Solutions')),
  gas: lazy(() => import('./Gas')),
  ph: lazy(() => import('./PH'))
}
type Tab = keyof typeof TABS

const ICONS: Record<Tab, typeof Scale> = { molar: Scale, balance: Sigma, stoich: FlaskConical, solutions: Beaker, gas: Wind, ph: Droplets }

export default function ChemistryTool(_props: ToolProps) {
  const { t } = useTranslation('tools')
  const [tab, setTab] = useStored<Tab>('aula.tools.chem.tab', 'molar', (v): v is Tab => typeof v === 'string' && v in TABS)
  const Comp = TABS[tab]
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto -mx-1 px-1 pb-0.5">
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          items={(Object.keys(TABS) as Tab[]).map((id) => {
            const Icon = ICONS[id]
            return { id, label: t(`chemistry.tab.${id}`), icon: <Icon size={14} /> }
          })}
        />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          <Suspense fallback={<div className="grid place-items-center h-60"><Spinner size={20} /></div>}>
            <Comp />
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
