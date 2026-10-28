// Ajustes: pocas tarjetas, claras. Todo viene activado por defecto salvo «Aula siempre activa».
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fmtPercent } from '@renderer/lib/format'
import { motion } from 'motion/react'
import { Button, Card, ConfirmDialog, Icon, PageHeader, SectionTitle, SegmentedTabs, Select, Slider, Stagger, StaggerItem, Switch, TextField, AulaMark, cx, Companion, toast } from '@renderer/design'
import { useScreenTitle } from '@renderer/app/title'
import { useRoute } from '@renderer/app/router'
import { useSettings } from '@renderer/lib/settings'
import { useRpc } from '@renderer/lib/useRpc'
import { useUpdateState } from '@renderer/lib/updates'
import { api } from '@renderer/lib/api'
import { AIPicker } from './AIPicker'
import { PlatformsCard } from './Platforms'
import { AutomationsSettingsCard } from './Automations'
import { MemoryCard } from './Memory'
import { UpdateButtons, UpdateStatus } from './Updates'
import type { AppSettings } from '@shared/settings'
import { sourceCodeURL, type LegalDoc } from '@shared/legal'

export default function SettingsScreen() {
  const { t } = useTranslation('settings')
  useScreenTitle(t('title'))
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  // «Ajustes → Memoria» (⌘K, el chat): baja hasta esa tarjeta
  const route = useRoute()
  const section = route.name === 'settings' ? route.section : undefined
  useEffect(() => {
    if (!section || !settings) return
    const timer = setTimeout(() => document.querySelector(`[data-settings-section="${CSS.escape(section)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 260)
    return () => clearTimeout(timer)
  }, [section, !!settings])
  if (!settings) return null
  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-24">
      <PageHeader title={t('title')} subtitle={t('subtitle')} className="mb-6" />
      <Stagger className="grid grid-cols-12 gap-4">
        <StaggerItem className="col-span-12">
          <SectionTitle title={t('ai.title')} detail={t('ai.auto')} className="px-1" data-settings-section="ai" />
          <AIPicker />
        </StaggerItem>
        {/* plataformas y apariencia, una sobre otra, junto a «Aula siempre activa» (la más alta): sin huecos en las tarjetas */}
        <div className="col-span-12 @5xl:col-span-7 flex flex-col gap-4">
          <StaggerItem>
            <PlatformsCard className="" />
          </StaggerItem>
          <StaggerItem className="flex-1 flex flex-col">
            <AppearanceCard s={settings} update={update} />
          </StaggerItem>
        </div>
        <StaggerItem className="col-span-12 @5xl:col-span-5">
          <AutomationsSettingsCard />
        </StaggerItem>
        {/* el resto en dos columnas que se reparten solas (cada tarjeta con su altura, sin estirarse) */}
        <div className="col-span-12 @4xl:columns-2 gap-4">
          {[
            <MemoryCard key="memory" />,
            <GeneralCard key="general" s={settings} update={update} />,
            <DataCard key="data" s={settings} update={update} />,
            <AboutCard key="about" s={settings} update={update} />
          ].map((card) => (
            <StaggerItem key={card.key} className="break-inside-avoid mb-4" data-settings-section={card.key ?? undefined}>
              {card}
            </StaggerItem>
          ))}
        </div>
      </Stagger>
    </div>
  )
}

type Upd = ReturnType<typeof useSettings.getState>['update']

function ToggleRow({ title, hint, checked, onChange }: { title: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-t-[0.5px] border-line-soft first:border-t-0">
      <div className="min-w-0">
        <div className="t-callout font-medium">{title}</div>
        {hint && <div className="t-ui text-text3 mt-0.5">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  )
}

function AppearanceCard({ s, update }: { s: AppSettings; update: Upd }) {
  const { t } = useTranslation('settings')
  const themes: { id: AppSettings['general']['theme']; label: string; paper: string; ink: string; side: string }[] = [
    { id: 'system', label: t('appearance.system'), paper: 'linear-gradient(90deg,#fcfaf5 50%,#181613 50%)', ink: '#b4502f', side: 'linear-gradient(90deg,#ece8e1 50%,#221f1c 50%)' },
    { id: 'light', label: t('appearance.light'), paper: '#fcfaf5', ink: '#b4502f', side: '#ece8e1' },
    { id: 'dark', label: t('appearance.dark'), paper: '#181613', ink: '#ea9a6c', side: '#221f1c' }
  ]
  return (
    <Card padded="lg" className="flex-1">
      <SectionTitle title={t('appearance.title')} />
      <div className="grid grid-cols-3 gap-3 mt-4">
        {themes.map((th) => {
          const active = s.general.theme === th.id
          return (
            <motion.button key={th.id} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} onClick={() => void update({ general: { theme: th.id } })} className="flex flex-col items-center gap-2">
              <div className={cx('w-full aspect-[4/3] rounded-[14px] overflow-hidden border-[0.5px] flex', active ? 'ring-2 ring-accent border-transparent' : 'border-line')} style={{ background: th.paper }}>
                <div className="w-[30%] h-full" style={{ background: th.side }} />
                <div className="flex-1 p-2 flex flex-col gap-1.5">
                  <div className="h-1.5 w-2/3 rounded-full bg-current opacity-30" style={{ color: th.id === 'dark' ? '#f0eae3' : '#201e1a' }} />
                  <div className="h-3 w-1/2 rounded-[4px]" style={{ background: th.ink }} />
                </div>
              </div>
              <span className={cx('t-ui', active ? 'font-semibold text-text' : 'text-text2')}>{th.label}</span>
            </motion.button>
          )
        })}
      </div>
      <div className="mt-5 flex flex-col gap-4">
        <Slider label={t('appearance.textSize')} min={0.85} max={1.3} step={0.05} value={s.general.textScale} onChange={(v) => void update({ general: { textScale: v } })} format={(v) => fmtPercent(v)} />
        <div>
          <div className="t-ui font-medium text-text2 mb-1.5">{t('appearance.motion')}</div>
          <SegmentedTabs
            fill
            size="sm"
            value={s.general.motion}
            onChange={(v) => void update({ general: { motion: v } })}
            items={[
              { id: 'system', label: t('appearance.motionSystem') },
              { id: 'full', label: t('appearance.motionFull') },
              { id: 'reduced', label: t('appearance.motionReduced') }
            ]}
          />
        </div>
        <div>
          <div className="t-ui font-medium text-text2 mb-1.5">{t('appearance.cursor')}</div>
          <SegmentedTabs
            fill
            size="sm"
            value={s.general.cursor}
            onChange={(v) => void update({ general: { cursor: v } })}
            items={[
              { id: 'sun', label: t('appearance.cursorSun') },
              { id: 'system', label: t('appearance.cursorSystem') }
            ]}
          />
          <div className="t-ui text-text3 mt-1.5">{t('appearance.cursorHint')}</div>
        </div>
      </div>
    </Card>
  )
}

function GeneralCard({ s, update }: { s: AppSettings; update: Upd }) {
  const { t } = useTranslation('settings')
  const [name, setName] = useState(s.general.name)
  return (
    <Card padded="lg" className="h-full">
      <SectionTitle title={t('general.title')} />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <TextField label={t('general.name')} value={name} placeholder={t('general.namePlaceholder')} onChange={(e) => setName(e.target.value)} onBlur={() => name !== s.general.name && void update({ general: { name: name.trim() } })} />
        <Select
          label={t('general.language')}
          value={s.general.language}
          onChange={(v) => void update({ general: { language: v } })}
          options={[
            { value: 'system', label: t('general.languageSystem') },
            { value: 'es', label: 'Español' },
            { value: 'en', label: 'English' }
          ]}
        />
      </div>
      <div className="mt-3">
        <ToggleRow title={t('general.reminders')} checked={s.general.reminders} onChange={(v) => void update({ general: { reminders: v } })} />
        {s.general.reminders && (
          <div className="flex items-center justify-between gap-3 pb-3">
            <span className="t-ui text-text2">{t('general.reminderTime')}</span>
            <input type="time" aria-label={t('general.reminderTimeLabel')} value={s.general.reminderTime} onChange={(e) => void update({ general: { reminderTime: e.target.value } })} className="h-8 rounded-[8px] bg-field border-[0.5px] border-line px-2 t-ui tabular outline-none" />
          </div>
        )}
      </div>
    </Card>
  )
}

function DataCard({ s, update }: { s: AppSettings; update: Upd }) {
  const { t } = useTranslation(['settings', 'common'])
  const [confirm, setConfirm] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { data: info } = useRpc('app.info', undefined)
  const exportAll = async () => {
    setExporting(true)
    try {
      const r = await api.invoke('data.exportAll')
      if (r) toast.success(t('data.exported'), r.path)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(false)
    }
  }
  return (
    <Card padded="lg" className="h-full">
      <div className="flex items-center justify-between">
        <SectionTitle title={t('data.title')} />
        <Companion id="buho" size={36} />
      </div>
      <div className="mt-2">
        <ToggleRow title={t('data.memory')} hint={t('data.memoryHint')} checked={s.data.memory} onChange={(v) => void update({ data: { memory: v } })} />
        <ToggleRow title={t('data.web')} hint={t('data.webHint')} checked={s.data.webSearch} onChange={(v) => void update({ data: { webSearch: v } })} />
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <Button size="md" icon={<Icon name="folder-open" size={15} />} onClick={() => info && void api.invoke('app.showItemInFolder', { path: info.dataPath + '/settings.json' })}>
          {t('data.openFolder')}
        </Button>
        <Button size="md" loading={exporting} icon={<Icon name="archive" size={15} />} onClick={() => void exportAll()}>
          {t('data.exportAll')}
        </Button>
        <Button size="md" variant="ghost" className="text-danger!" icon={<Icon name="trash" size={15} />} onClick={() => setConfirm(true)}>
          {t('data.deleteAll')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => void api.invoke('data.deleteAll').catch((e: unknown) => toast.error((e as Error).message))}
        title={t('data.deleteConfirm')}
        description={t('data.deleteConfirmBody')}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        danger
      />
    </Card>
  )
}

// Apoyar el desarrollo de Aula (opcional; todo sigue siendo gratis)
const SPONSORS_URL = 'https://github.com/sponsors/luumlabs'

const openLegal = (which: LegalDoc) => void api.invoke('app.openLicenses', { which }).catch(() => undefined)
const openURL = (url: string) => void api.invoke('app.openExternal', { url }).catch(() => undefined)

function AboutLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="t-ui text-accent-text hover:underline" onClick={onClick}>
      {children}
    </button>
  )
}

function AboutCard({ s, update }: { s: AppSettings; update: Upd }) {
  const { t } = useTranslation('settings')
  const { data: info } = useRpc('app.info', undefined)
  const upd = useUpdateState()
  const [asked, setAsked] = useState(false)
  const current = info?.version ?? ''
  return (
    <Card padded="lg" className="h-full flex flex-col">
      <div className="flex items-center gap-3">
        <AulaMark size={36} state={upd.status === 'checking' || upd.status === 'downloading' ? 'working' : 'idle'} />
        <div>
          <div className="t-title2">Aula</div>
          <div className="t-ui text-text3">{t('about.version', { version: info?.version ?? '—' })}</div>
        </div>
      </div>
      <div className="mt-3">
        <ToggleRow title={t('about.autoUpdate')} checked={s.data.autoUpdate} onChange={(v) => void update({ data: { autoUpdate: v } })} />
      </div>
      <UpdateStatus state={upd} asked={asked} current={current} />
      {info?.secretProtection === 'basic' && <div className="t-footnote text-warning mt-2">{t('about.noKeyring')}</div>}
      <div className="mt-auto pt-3 flex items-center justify-between gap-3">
        {/* avisos legales de la AGPL (§0, §5(d)): copyright, sin garantía, la licencia y el código de esta versión */}
        <div className="flex flex-col items-start gap-0.5 min-w-0" data-testid="about-legal">
          <span className="t-footnote text-text3">{t('about.copyright')}</span>
          <span className="t-footnote text-text3">{t('about.license')}</span>
          <span className="flex flex-wrap items-center gap-x-3">
            <AboutLink onClick={() => openLegal('aula')}>{t('about.licenseText')}</AboutLink>
            <AboutLink onClick={() => openURL(sourceCodeURL(current))}>{t('about.source')}</AboutLink>
            <AboutLink onClick={() => openLegal('third-party')}>{t('about.licenses')}</AboutLink>
            <AboutLink onClick={() => openURL(SPONSORS_URL)}>{t('about.support')}</AboutLink>
          </span>
        </div>
        <UpdateButtons state={upd} asked={asked} current={current} onAsk={() => setAsked(true)} />
      </div>
    </Card>
  )
}
