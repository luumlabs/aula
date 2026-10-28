// Página de desarrollo: todos los tipos de bloque, con las lecciones del curso de ejemplo y muestras escritas a mano, en modo
// lección, chat o impresión. Ruta `{ name: 'blocks-preview', skill? }`: `skill` elige una sección (id de una muestra o de un
// tema del curso, `samples`, o `type:plot` para un tipo) y admite `@chat` / `@print` al final para el modo.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader, SectionTitle, SegmentedTabs, Select, toast } from '@renderer/design'
import { useRoute } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { decodeSkill, type Skill } from '@shared/schema/pack'
import { decodeBlocks, type Block } from '@shared/schema/blocks'
import { BlockList } from '../BlockView'
import { makeBlockContext, type BlockContext } from '../types'
import { SAMPLE_ASSETS, SAMPLE_SECTIONS } from './samples'

type Mode = BlockContext['mode']

const skillFiles = import.meta.glob('../../../../../resources/demo-course/Packs/exam-2-math112/skills/*.json', { eager: true }) as Record<string, { default: unknown }>
const packFile = import.meta.glob('../../../../../resources/demo-course/Packs/exam-2-math112/pack.json', { eager: true }) as Record<string, { default: { hue?: number; skills?: Array<{ id: string; order?: number }> } }>

const DEMO_PACK = 'exam-2-math112'

interface Section {
  id: string
  title: string
  language: string
  packId: string | null
  blocks: Block[]
}

function demoSections(): Section[] {
  const pack = Object.values(packFile)[0]?.default
  const order = new Map((pack?.skills ?? []).map((s, i) => [s.id, s.order ?? i]))
  const skills: Skill[] = Object.values(skillFiles).map((m) => decodeSkill(m.default))
  skills.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
  return skills.map((s) => ({ id: s.id, title: s.title, language: 'en', packId: DEMO_PACK, blocks: s.lesson }))
}

function sampleSections(): Section[] {
  return SAMPLE_SECTIONS.map((s) => ({ id: s.id, title: s.title, language: 'es', packId: null, blocks: decodeBlocks(s.blocks, 0) }))
}

export default function BlocksPreview() {
  const { t } = useTranslation('blocks')
  useScreenTitle(t('preview.title'))
  const route = useRoute()
  const param = route.name === 'blocks-preview' ? route.skill ?? '' : ''
  const [initialSection, initialMode] = param.split('@')
  const [mode, setMode] = useState<Mode>(initialMode === 'chat' || initialMode === 'print' ? initialMode : 'lesson')
  const [section, setSection] = useState<string>(initialSection || 'all')
  const samples = useMemo(sampleSections, [])
  const demo = useMemo(demoSections, [])
  const hue = Object.values(packFile)[0]?.default.hue

  const shown = useMemo((): Section[] => {
    if (section.startsWith('type:')) {
      const type = section.slice(5)
      return [...samples, ...demo].map((s) => ({ ...s, blocks: s.blocks.filter((b) => b.type === type) })).filter((s) => s.blocks.length > 0)
    }
    if (section === 'samples') return samples
    if (section === 'all') return [...samples, ...demo]
    return [...samples, ...demo].filter((s) => s.id === section)
  }, [section, samples, demo])

  const options = [
    { value: 'all', label: t('preview.all') },
    { value: 'samples', label: t('preview.samples') },
    ...samples.map((s) => ({ value: s.id, label: s.title, hint: t('preview.blocks', { count: s.blocks.length }) })),
    ...demo.map((s) => ({ value: s.id, label: s.title, hint: t('preview.blocks', { count: s.blocks.length }) })),
    ...(section.startsWith('type:') ? [{ value: section, label: section.slice(5) }] : [])
  ]

  const ctxFor = (s: Section): BlockContext => {
    const base = makeBlockContext(s.packId, s.language, { mode, skillId: s.id, hue: s.packId ? hue : undefined })
    return {
      ...base,
      assetUrl: (p) => SAMPLE_ASSETS[p] ?? base.assetUrl(p),
      onTryIt: (ids) => toast.info(t('preview.tryit', { count: ids.length }), ids.join(', ')),
      sourceTitle: () => 'Apuntes de clase',
      onOpenSource: (ref) => toast.info(t('preview.source', { page: ref.page ?? 1 }))
    }
  }

  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 pt-1 pb-24">
      <PageHeader
        title={t('preview.title')}
        subtitle={t('preview.subtitle')}
        className="mx-auto mb-8 max-w-[880px]"
        actions={
          <>
            <Select value={section} options={options} onChange={setSection} className="w-[240px]" />
            <SegmentedTabs items={(['lesson', 'chat', 'print'] as const).map((m) => ({ id: m, label: t(`preview.mode.${m}`) }))} value={mode} onChange={setMode} />
          </>
        }
      />
      <div className="flex flex-col gap-14">
        {shown.map((s) => (
          <section key={`${s.id}-${mode}`} className={mode === 'chat' ? 'mx-auto w-full max-w-[600px]' : undefined}>
            <SectionTitle title={s.title} detail={`${s.id} · ${t('preview.blocks', { count: s.blocks.length })}`} className={mode === 'chat' ? 'mb-4' : 'mx-auto mb-6 max-w-[880px]'} />
            {mode === 'chat' ? (
              <div className="rounded-[22px] bg-surface p-4 border-[0.5px] border-line" style={{ boxShadow: 'var(--e1)' }}>
                <BlockList blocks={s.blocks} ctx={ctxFor(s)} />
              </div>
            ) : (
              <BlockList blocks={s.blocks} ctx={ctxFor(s)} />
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
