// Estado vacío: la marca de Aula en grande (el pincel la dibuja y unos rayos a lápiz la esbozan: un amanecer tranquilo), una
// frase honesta y una acción clara.
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { AulaMark, type MarkState } from './AulaMark'
import { PencilRays } from './paint'

export function EmptyState({ icon, title, body, action, className = '', mark = 'idle' }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode; className?: string; mark?: MarkState }) {
  return (
    <motion.div className={`flex flex-col items-center text-center px-6 py-14 ${className}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      {icon ? (
        <div className="text-text2">{icon}</div>
      ) : (
        <div className="relative text-text2">
          {mark === 'idle' && <PencilRays seed="empty" size={56} className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />}
          <AulaMark size={56} state={mark} draw alive />
        </div>
      )}
      <h3 className="t-title2 mt-4">{title}</h3>
      {body && <p className="t-body text-text2 mt-1.5 max-w-[440px]">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  )
}
