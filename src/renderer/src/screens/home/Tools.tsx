// Herramientas a mano: baldosas que se levantan, cada una con su loseta pintada; la loseta se inclina un poco al pasar
// el ratón.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { SectionTitle } from '@renderer/design'
import { navigate } from '@renderer/app/router'
import { TOOLS } from '@renderer/tools/registry'
import { ToolTile } from '@renderer/tools/ToolTile'

export function ToolsStrip() {
  const { t } = useTranslation(['home', 'tools'])
  const list = TOOLS.slice(0, 6)
  return (
    <section>
      <SectionTitle
        title={t('tools')}
        action={
          <button className="text-accent-text font-medium hover:underline underline-offset-2" onClick={() => navigate({ name: 'tools' })}>
            {t('allTools')}
          </button>
        }
      />
      <div className="grid gap-3 mt-3 grid-cols-3 @3xl:grid-cols-6">
        {list.map((tool, i) => {
          return (
            <motion.button
              key={tool.id}
              className="group flex flex-col items-center gap-2.5 rounded-[20px] bg-surface border-[0.5px] border-line shadow-[var(--e1)] p-4 hover:shadow-[var(--e2)] transition-shadow"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.1 + i * 0.04 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate({ name: 'tools', tool: tool.id })}
            >
              {/* la misma loseta pintada que en «Herramientas», un poco más pequeña */}
              <motion.span className="block w-11 h-11" whileHover={{ rotate: -6 }}>
                <ToolTile tool={tool} size={44} />
              </motion.span>
              <span className="t-ui font-medium text-center leading-tight">{t(`tools:${tool.id}.name`)}</span>
            </motion.button>
          )
        })}
      </div>
    </section>
  )
}
