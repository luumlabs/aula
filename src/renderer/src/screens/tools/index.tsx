// Herramientas: galería de baldosas animadas; al abrir una, ocupa toda la pantalla (y se puede fijar flotante).
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { ArrowLeft } from 'lucide-react'
import { Card, PageHeader, Spinner, Stagger } from '@renderer/design'
import { useAmbient } from '@renderer/design/ambient'
import { useRoute, navigate } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { TOOLS, toolById } from '@renderer/tools/registry'
import { PinToolButton } from '@renderer/tools/floating'

export default function ToolsScreen() {
  const { t } = useTranslation('tools')
  const route = useRoute()
  const toolId = route.name === 'tools' ? route.tool : undefined
  const tool = toolById(toolId)
  // los iconos flotan solo mientras alguien usa la app (design/ambient.ts)
  const moving = useAmbient()
  useScreenTitle(tool ? t(`${tool.id}.name`) : t('title'), tool?.floating ? <PinToolButton id={tool.id} onPinned={() => navigate({ name: 'tools' })} /> : null, [tool?.id])

  // sus comandos de ⌘K los registra el armazón (app/shell/commands.tsx), no esta pantalla

  if (tool) {
    const Comp = tool.component
    return (
      <div className="@container flex-1 min-h-0 overflow-y-auto px-6 pb-24">
        <button className="mb-3 inline-flex items-center gap-1.5 t-ui font-medium text-text2 hover:text-text" onClick={() => navigate({ name: 'tools' })}>
          <ArrowLeft size={15} /> {t('back')}
        </button>
        <Suspense fallback={<div className="grid place-items-center h-80"><Spinner size={22} /></div>}>
          <Comp />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-24">
      <PageHeader title={t('title')} subtitle={t('subtitle')} className="mb-6" />
      <Stagger className="grid gap-4 grid-cols-1 @2xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
        {TOOLS.map((x, i) => {
          const Icon = x.icon
          return (
            <Card key={x.id} enterAnim interactive padded={false} onClick={() => navigate({ name: 'tools', tool: x.id })} className="group min-h-[164px]">
              <div className="relative p-6 flex flex-col h-full">
                <motion.div
                  className="grid place-items-center w-12 h-12 rounded-[14px] bg-tile text-text2 group-hover:text-accent-text transition-colors"
                  animate={moving ? { y: [0, -2, 0] } : { y: 0 }}
                  transition={moving ? { duration: 6 + (i % 3), repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 } : { duration: 0.6 }}
                >
                  <Icon size={22} strokeWidth={1.7} />
                </motion.div>
                {x.floating && (
                  <div className="absolute right-4 top-4">
                    <PinToolButton id={x.id} look="icon" />
                  </div>
                )}
                <div className="t-title2 text-[19px] mt-4">{t(`${x.id}.name`)}</div>
                <div className="t-callout text-text2 mt-0.5">{t(`${x.id}.desc`)}</div>
              </div>
            </Card>
          )
        })}
      </Stagger>
    </div>
  )
}
