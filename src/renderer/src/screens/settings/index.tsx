// Ajustes: una columna de lectura (720 px como mucho) con un índice fijo a la izquierda. Cada sección va sobre el papel,
// separada por un filete, y lleva su ancla `data-settings-section` (⌘K, el chat y los avisos llevan directamente a ella).
// Todo viene activado por defecto salvo «Aula siempre activa».
// Desde un dispositivo (iPad, iPhone) son los mismos ajustes, los de Aula en el Mac, pero solo lo de uso diario: las claves,
// las plataformas, los dispositivos, los datos y las actualizaciones se llevan desde el Mac (y el servidor no deja otra cosa:
// src/main/services/remote/policy.ts).
// Con Aula como servidor (sin Mac), el dispositivo PROPIETARIO hace de ventana: ve también la IA con sus claves, las
// plataformas y los dispositivos (no los datos ni las actualizaciones, que se llevan en el servidor).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Brain, Cpu, GraduationCap, Info, Languages, MonitorSmartphone, Palette, Power, Shield, type LucideIcon } from 'lucide-react'
import { fmtPercent } from '@renderer/lib/format'
import { Button, ConfirmDialog, Icon, Rule, Section, SegmentedTabs, Select, Slider, Stagger, Switch, TextField, AulaMark, buttonClass, cx, toast } from '@renderer/design'
import { useScreenTitle } from '@renderer/app/title'
import { navigate, useRoute } from '@renderer/app/router'
import { useSettings } from '@renderer/lib/settings'
import { useRpc } from '@renderer/lib/useRpc'
import { useUpdateState } from '@renderer/lib/updates'
import { api } from '@renderer/lib/api'
import { isDemo } from '@renderer/lib/demo'
import { SPONSORS_URL, SUPPORT_AGAIN_EVENT, useSupportLink } from '@renderer/lib/supportLink'
import { AIPicker } from './AIPicker'
import { AIChoices } from './AIChoices'
import { PlatformsSection } from './Platforms'
import { AutomationsSection } from './Automations'
import { MemorySection } from './Memory'
import { DevicesSection } from './Devices'
import { UpdateButtons, UpdateStatus } from './Updates'
import type { AppSettings } from '@shared/settings'
import type { SettingsSection } from '@shared/settings/sections'
import { resolveCourseLanguage } from '@shared/settings/courseLanguage'
import { CourseLanguages } from '@engine/base/language'
import { AULA_REPO_URL, publicDocURL, sourceCodeURL, type LegalDoc } from '@shared/legal'

type Upd = ReturnType<typeof useSettings.getState>['update']

/** Las secciones, en el orden de la página (y del índice): lo que se configura una vez, cómo se ve y habla, lo que Aula hace
 *  sola, lo que guarda y, al final, la versión. */
const ORDER: readonly SettingsSection[] = ['ai', 'platforms', 'appearance', 'general', 'persistent', 'devices', 'memory', 'data', 'about']

const INDEX_ICONS: Record<SettingsSection, LucideIcon> = {
  ai: Cpu,
  platforms: GraduationCap,
  appearance: Palette,
  general: Languages,
  persistent: Power,
  devices: MonitorSmartphone,
  memory: Brain,
  data: Shield,
  about: Info
}

export default function SettingsScreen() {
  const { t } = useTranslation('settings')
  useScreenTitle(t('title'))
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const route = useRoute()
  const section = route.name === 'settings' ? route.section : undefined
  const scroller = useRef<HTMLDivElement>(null)
  // Ayuda → «Apoyar a Aula…» otra vez con la ruta ya en 'support' (AppCommands): la ruta no cambia, así que se cuenta aquí y
  // se vuelve a bajar como al llegar (lo de encima puede seguir cargando y crecer)
  const [again, setAgain] = useState(0)
  useEffect(() => {
    const bump = (): void => setAgain((n) => n + 1)
    window.addEventListener(SUPPORT_AGAIN_EVENT, bump)
    return () => window.removeEventListener(SUPPORT_AGAIN_EVENT, bump)
  }, [])
  useScrollToSection(scroller, section, !!settings, again)
  // `remote`: un dispositivo con solo lo de uso diario; un propietario ve como la ventana (salvo datos y actualizaciones)
  const owner = api.owner
  const remote = api.remote && !owner
  const shown = ORDER.filter((id) => !(remote && (id === 'platforms' || id === 'devices' || id === 'data')))
  const active = useActiveSection(scroller, shown, !!settings)
  if (!settings) return null
  const note = owner ? t('remote.subtitleOwner') : remote ? (api.server ? t('remote.subtitleServer') : t('remote.subtitle')) : null
  const body: Record<SettingsSection, ReactNode> = {
    ai: (
      <Section title={t('ai.title')} detail={remote ? (api.server ? t('ai.remote.detailServer') : t('ai.remote.detail')) : t('ai.auto')} rule={false}>
        {remote ? <AIChoices /> : <AIPicker plain />}
      </Section>
    ),
    platforms: <PlatformsSection />,
    appearance: <AppearanceSection s={settings} update={update} />,
    general: <GeneralSection s={settings} update={update} />,
    persistent: <AutomationsSection />,
    devices: <DevicesSection />,
    memory: <MemorySection />,
    data: <DataSection s={settings} update={update} />,
    about: <AboutSection s={settings} update={update} />
  }
  // un enlace del índice baja a su sección (también si ya era la del enlace y se había desplazado); sin llenar el historial
  const go = (id: SettingsSection): void => {
    if (id === section) scrollToSection(id)
    else navigate({ name: 'settings', section: id }, { replace: true })
  }
  return (
    <div ref={scroller} className="@container flex-1 min-h-0 overflow-y-auto px-6 max-[700px]:px-4 pt-2 pb-16">
      {/* el título visible es el de la barra superior */}
      <h1 className="sr-only">{t('title')}</h1>
      <div data-settings-page className="mx-auto flex max-w-[976px] gap-14">
        <SettingsIndex sections={shown} active={active} onPick={go} />
        <Stagger className="min-w-0 max-w-[720px] flex-1">
          {note && <p className="t-callout text-text2 pt-4">{note}</p>}
          {shown.map((id, i) => (
            <div key={id} data-settings-section={id} className="scroll-mt-2">
              {i > 0 && <Rule />}
              {body[id]}
            </div>
          ))}
        </Stagger>
      </div>
    </div>
  )
}

/** El índice de la izquierda: las secciones con su icono; la que se está leyendo, marcada. Sin `data-settings-section`
 *  (cada ancla está una sola vez: la de su sección). Solo si cabe al lado de la columna. */
function SettingsIndex({ sections, active, onPick }: { sections: readonly SettingsSection[]; active: SettingsSection | null; onPick: (id: SettingsSection) => void }) {
  const { t } = useTranslation('settings')
  return (
    <nav aria-label={t('title')} className="hidden @4xl:block w-[200px] shrink-0 self-start sticky top-0 pt-6">
      <ul className="m-0 flex list-none flex-col gap-px p-0">
        {sections.map((id) => {
          const IconFor = INDEX_ICONS[id]
          const on = id === active
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onPick(id)}
                aria-current={on ? 'location' : undefined}
                className={cx('flex w-full items-center gap-2.5 h-8 rounded-[8px] px-2.5 text-left t-ui transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent-line', on ? 'bg-fill1 text-text font-medium' : 'text-text2 hover:text-text hover:bg-fill1')}
              >
                <IconFor size={15} strokeWidth={1.8} aria-hidden className="shrink-0 text-text2" />
                {/* el mismo nombre que el título de la sección */}
                <span className="min-w-0 flex-1 truncate">{t(`${id}.title`)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Anclas dentro de una sección (`data-settings-anchor`: Ayuda → «Apoyar a Aula…» lleva a 'support') y la sección que
 *  las lleva, por si no se pintan (en la app del iPhone fuera de la tienda de EE. UU., «Apoya a Aula» no está). */
const ANCHORS: Readonly<Record<string, SettingsSection>> = { support: 'about' }

/** Baja hasta una sección (o un ancla de dentro); con movimiento reducido (o `instant`), sin deslizarse. Con `focus`, un ancla
 *  además se lleva el foco (su `[data-settings-focus]`, sin volver a desplazar) y devuelve true: con el teclado o un lector
 *  de pantalla se sigue desde ahí y no desde donde se estaba. A un ancla solo lleva un comando (Ayuda → «Apoyar a Aula…»);
 *  el índice, ⌘K, el chat y los avisos llevan a secciones, y con ellas el foco se queda donde estaba. */
function scrollToSection(id: string, instant = false, focus = false): boolean {
  const behavior = instant || document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth'
  const find = (attr: string, v: string): Element | null => document.querySelector(`[${attr}="${CSS.escape(v)}"]`)
  const parent = Object.hasOwn(ANCHORS, id) ? ANCHORS[id] : undefined
  const anchor = find('data-settings-anchor', id)
  const target = find('data-settings-section', id) ?? anchor ?? (parent ? find('data-settings-section', parent) : null)
  target?.scrollIntoView({ behavior, block: 'start' })
  const heading = focus && target && target === anchor ? target.querySelector<HTMLElement>('[data-settings-focus]') : null
  heading?.focus({ preventScroll: true })
  return !!heading
}

/** Lo que dura vigilar que la sección pedida se quede arriba mientras termina de cargar lo de encima. */
const SETTLE_MS = 2000

/** «Ajustes → Memoria» (⌘K, el chat, el índice): baja hasta esa sección. Al abrir la pantalla, de golpe; después, deslizándose.
 *  Mientras lo de encima termina de cargar (la IA, las plataformas, los recuerdos…) y cambia de alto, la sección se queda
 *  arriba, hasta que la persona se mueva por su cuenta. `again` sube para volver a hacerlo con la misma sección. A un ancla,
 *  el foco va una sola vez por llegada: después se queda donde lo lleve la persona (también a otro panel, sin tocar este). */
function useScrollToSection(scroller: React.RefObject<HTMLDivElement | null>, section: string | undefined, ready: boolean, again = 0): void {
  const mounted = useRef(false)
  useEffect(() => {
    if (!ready) return
    const first = !mounted.current
    mounted.current = true
    const box = scroller.current
    const content = box?.querySelector(':scope > [data-settings-page]')
    if (!section || !box || !content) return
    let moved = false
    const stop = (): void => {
      moved = true
    }
    const userEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const e of userEvents) box.addEventListener(e, stop, { passive: true })
    // ni el primer desplazamiento ni los de después si ya se movió; el foco, hasta que llega una vez al ancla
    let focused = false
    const settle = (instant: boolean): void => {
      if (moved) return
      if (scrollToSection(section, instant, !focused)) focused = true
    }
    let height = content.getBoundingClientRect().height
    const ro = new ResizeObserver(() => {
      const h = content.getBoundingClientRect().height
      if (h === height) return
      height = h
      settle(true)
    })
    ro.observe(content)
    const timer = setTimeout(() => settle(first), first ? 120 : 0)
    const done = setTimeout(() => ro.disconnect(), SETTLE_MS)
    return () => {
      clearTimeout(timer)
      clearTimeout(done)
      ro.disconnect()
      for (const e of userEvents) box.removeEventListener(e, stop)
    }
  }, [section, ready, scroller, again])
}

/** La sección que se está leyendo: la última cuyo principio ya ha pasado por arriba (o la última, al llegar al final). Se mira
 *  al desplazar, una vez por fotograma como mucho. */
function useActiveSection(scroller: React.RefObject<HTMLDivElement | null>, ids: readonly SettingsSection[], ready: boolean): SettingsSection | null {
  const [active, setActive] = useState<SettingsSection | null>(ids[0] ?? null)
  const key = ids.join(',')
  useEffect(() => {
    const el = scroller.current
    if (!el || !ready) return
    let frame = 0
    const measure = (): void => {
      frame = 0
      const top = el.getBoundingClientRect().top
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
      let current: SettingsSection | null = ids[0] ?? null
      for (const id of ids) {
        const anchor = el.querySelector(`[data-settings-section="${id}"]`)
        if (anchor && anchor.getBoundingClientRect().top - top <= 96) current = id
      }
      setActive(atEnd && el.scrollTop > 0 ? (ids[ids.length - 1] ?? current) : current)
    }
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, scroller])
  return active
}

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

function AppearanceSection({ s, update }: { s: AppSettings; update: Upd }) {
  const { t } = useTranslation('settings')
  const themes: { id: AppSettings['general']['theme']; label: string; paper: string; ink: string; side: string }[] = [
    { id: 'system', label: t('appearance.system'), paper: 'linear-gradient(90deg,#fcfaf5 50%,#181613 50%)', ink: '#b4502f', side: 'linear-gradient(90deg,#ece8e1 50%,#221f1c 50%)' },
    { id: 'light', label: t('appearance.light'), paper: '#fcfaf5', ink: '#b4502f', side: '#ece8e1' },
    { id: 'dark', label: t('appearance.dark'), paper: '#181613', ink: '#ea9a6c', side: '#221f1c' }
  ]
  return (
    <Section title={t('appearance.title')} rule={false}>
      {/* los controles, a lo ancho de una mano: en la columna entera quedarían larguísimos */}
      <div className="max-w-[480px]">
        <div className="grid grid-cols-3 gap-3">
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
        <div className="mt-6 flex flex-col gap-5">
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
          {/* el cursor es de la ventana del Mac: un dispositivo táctil no tiene */}
          {!api.remote && (
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
          )}
        </div>
      </div>
    </Section>
  )
}

function GeneralSection({ s, update }: { s: AppSettings; update: Upd }) {
  const { t, i18n } = useTranslation('settings')
  const [name, setName] = useState(s.general.name)
  // «Automático» dice qué idioma sale ahora (el primero del sistema en el que Aula escribe cursos, o el de Aula)
  const { data: systemLanguages } = useRpc('settings.systemLanguages', undefined)
  const autoLanguage = CourseLanguages.of(resolveCourseLanguage('auto', systemLanguages ?? [], s.general.language, i18n.language))
  return (
    <Section title={t('general.title')} rule={false}>
      <div className="grid grid-cols-2 max-[700px]:grid-cols-1 gap-3">
        <TextField label={t('general.name')} value={name} maxLength={80} placeholder={t('general.namePlaceholder')} onChange={(e) => setName(e.target.value)} onBlur={() => name !== s.general.name && void update({ general: { name: name.trim() } })} />
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
        <Select
          label={t('general.courseLanguage')}
          value={s.general.courseLanguage}
          onChange={(v) => void update({ general: { courseLanguage: v } })}
          options={[
            { value: 'auto', label: t('general.courseLanguageAuto', { name: autoLanguage.nativeName }) },
            ...CourseLanguages.all.map((l) => ({ value: l.id, label: l.nativeName }))
          ]}
        />
      </div>
      <div className="mt-4">
        <ToggleRow title={t('general.reminders')} checked={s.general.reminders} onChange={(v) => void update({ general: { reminders: v } })} />
        {s.general.reminders && (
          <div className="flex items-center justify-between gap-3 pb-3">
            <span className="t-ui text-text2">{t('general.reminderTime')}</span>
            <input type="time" aria-label={t('general.reminderTimeLabel')} value={s.general.reminderTime} onChange={(e) => void update({ general: { reminderTime: e.target.value } })} className="h-8 rounded-[8px] bg-field border-[0.5px] border-line px-2 t-ui tabular outline-none" />
          </div>
        )}
      </div>
    </Section>
  )
}

function DataSection({ s, update }: { s: AppSettings; update: Upd }) {
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
    <Section title={t('data.title')} rule={false}>
      <div>
        <ToggleRow title={t('data.memory')} hint={t('data.memoryHint')} checked={s.data.memory} onChange={(v) => void update({ data: { memory: v } })} />
        <ToggleRow title={t('data.web')} hint={t('data.webHint')} checked={s.data.webSearch} onChange={(v) => void update({ data: { webSearch: v } })} />
      </div>
      {/* abrir, exportar o borrar los datos de un servidor se hace allí (su carpeta de datos), no desde un propietario */}
      {!api.remote && (
        <div className="flex flex-wrap gap-2 mt-3">
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
      )}
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
    </Section>
  )
}

/** Lo que ofrece la app nativa que abre la interfaz en un dispositivo (native/ios, native/android). */
const appBridge = (): { switchAula?: () => void } | undefined => (window as { aulaApp?: { switchAula?: () => void } }).aulaApp

const openLegal = (which: LegalDoc) => void api.invoke('app.openLicenses', { which }).catch(() => undefined)
const openURL = (url: string) => void api.invoke('app.openExternal', { url }).catch(() => undefined)

type AboutLinkLook = { children?: ReactNode; className?: string; inline?: boolean }

/** Las clases de un enlace de Acerca de: suelto, con su zona para el dedo; dentro de una frase (`inline`), subrayado siempre
 *  (que no se distinga solo por el color: WCAG 1.4.1) y sin agrandar la zona sobre las líneas de al lado. */
const aboutLinkClass = ({ className = 't-ui', inline = false }: AboutLinkLook): string =>
  cx('text-accent-text', inline ? 'underline underline-offset-2 hover:no-underline' : 'relative touch-target hover:underline', className)

/** Un enlace de Acerca de. `children` opcional: dentro de <Trans> el texto lo pone la traducción. */
function AboutLink({ onClick, children, ...look }: AboutLinkLook & { onClick: () => void }) {
  return (
    <button type="button" className={aboutLinkClass(look)} onClick={onClick}>
      {children}
    </button>
  )
}

/** Una página web: en un dispositivo, un enlace de verdad que abre su navegador (iOS: WebView.swift createWebViewWith;
 *  Android: shouldOverrideUrlLoading); en el Mac, shell.openExternal (solo http(s)). */
function AboutWebLink({ url, children, ...look }: AboutLinkLook & { url: string }) {
  if (api.remote) {
    return (
      <a className={aboutLinkClass(look)} href={url} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  }
  return <AboutLink onClick={() => openURL(url)} {...look}>{children}</AboutLink>
}

/** Un botón que abre una página web. En un dispositivo, un enlace de verdad con aspecto de botón (como AboutWebLink: lo
 *  abre su navegador; con api.invoke('app.openExternal') el window.open llegaría tras una espera y iOS podría bloquearlo);
 *  en el ordenador, shell.openExternal. */
function WebButton({ url, children }: { url: string; children: ReactNode }) {
  const out = <Icon name="external" size={14} />
  if (api.remote) {
    return (
      <a href={url} target="_blank" rel="noreferrer" data-variant="secondary" className={buttonClass('secondary', 'md')}>
        <span>{children}</span>
        {out}
      </a>
    )
  }
  return (
    <Button variant="secondary" size="md" iconRight={out} onClick={() => openURL(url)}>
      {children}
    </Button>
  )
}

/** «Apoya a Aula»: qué es Aula y, para quien quiera, dónde donar. Al final de Acerca de, tras un filete y con un botón neutro
 *  (el ladrillo es para estudiar); nada más en la app lo pide: ni avisos, ni ventanas, ni recordatorios. En la app del
 *  iPhone y el iPad, solo con la tienda de EE. UU. (lib/supportLink.ts). */
function SupportAula() {
  const { t } = useTranslation('settings')
  const head = useId()
  const shown = useSupportLink()
  if (!shown) return null
  return (
    <section aria-labelledby={head} data-testid="about-support" data-settings-anchor="support" className="mt-6 scroll-mt-2 border-t border-rule pt-5">
      {/* Ayuda → «Apoyar a Aula…» deja aquí el foco (scrollToSection): el siguiente Tab va al botón. Sin anillo (`!`: el de
          :focus-visible no va en capa): es un título, no se pulsa */}
      <h3 id={head} tabIndex={-1} data-settings-focus className="font-serif text-[calc(17rem/15)] leading-[calc(22rem/15)] font-medium tracking-[-0.1px] text-text outline-none!">
        {t('about.supportTitle')}
      </h3>
      <p className="t-callout text-text2 mt-1.5 max-w-[64ch]">{t('about.supportBody')}</p>
      <div className="mt-3">
        <WebButton url={SPONSORS_URL}>{t('about.supportDonate')}</WebButton>
      </div>
      <p className="t-footnote text-text3 mt-3">
        <Trans t={t} i18nKey="about.supportFree" components={{ star: <AboutWebLink url={AULA_REPO_URL} className="t-footnote" inline /> }} />
      </p>
    </section>
  )
}

function AboutSection({ s, update }: { s: AppSettings; update: Upd }) {
  const { t, i18n } = useTranslation('settings')
  const { data: info } = useRpc('app.info', undefined)
  const upd = useUpdateState()
  const [asked, setAsked] = useState(false)
  const current = info?.version ?? ''
  // desde un dispositivo: la versión y los avisos legales; las actualizaciones (y lo que abre ventanas) son del Mac (o del
  // servidor, que se actualiza con su imagen)
  const remote = api.remote
  const privacyURL = publicDocURL('privacy', i18n.language)
  const supportURL = publicDocURL('support', i18n.language)
  return (
    <Section title={t('about.title')} rule={false}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AulaMark size={28} state={!remote && (upd.status === 'checking' || upd.status === 'downloading') ? 'working' : 'idle'} />
          <div className="t-callout text-text2">{t('about.version', { version: info?.version ?? '—' })}</div>
        </div>
        {!remote && <UpdateButtons state={upd} asked={asked} current={current} onAsk={() => setAsked(true)} />}
      </div>
      {!remote && (
        <>
          <UpdateStatus state={upd} asked={asked} current={current} />
          <div className="mt-3">
            <ToggleRow title={t('about.autoUpdate')} checked={s.data.autoUpdate} onChange={(v) => void update({ data: { autoUpdate: v } })} />
          </div>
          {/* «instala GNOME Keyring o KWallet»: solo Linux (en macOS y Windows nunca se guarda sin cifrar) */}
          {info?.secretProtection === 'basic' && info.platform === 'linux' && <div className="t-footnote text-warning mt-2">{t('about.noKeyring')}</div>}
        </>
      )}
      {api.owner && info?.secretProtection === 'basic' && <div className="t-footnote text-text3 mt-3">{t('about.noKeyringServer')}</div>}
      {/* avisos legales de la AGPL (§0, §5(d)) y, para todos (App Store 5.1.1(i)), la política de privacidad y la ayuda */}
      <div className="mt-4 flex flex-col items-start gap-0.5 min-w-0" data-testid="about-legal">
        <span className="t-footnote text-text3">{t('about.copyright')}</span>
        <span className="t-footnote text-text3">{t('about.license')}</span>
        {remote ? (
          <span className="flex flex-wrap items-center gap-x-3">
            {/* enlaces de verdad: se abren en el dispositivo, no en el Mac */}
            <AboutWebLink url={sourceCodeURL(current)}>{t('about.source')}</AboutWebLink>
            <AboutWebLink url={privacyURL}>{t('about.privacy')}</AboutWebLink>
            <AboutWebLink url={supportURL}>{t('about.help')}</AboutWebLink>
            {/* la app del iPhone, el iPad o Android: con más de una Aula en la red (un Mac y un servidor), abrir otra; en la
                demostración no hay otra (la app no hace nada) */}
            {appBridge()?.switchAula && !isDemo() && <AboutLink onClick={() => appBridge()?.switchAula?.()}>{t('about.switchAula')}</AboutLink>}
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-x-3">
            <AboutLink onClick={() => openLegal('aula')}>{t('about.licenseText')}</AboutLink>
            <AboutWebLink url={sourceCodeURL(current)}>{t('about.source')}</AboutWebLink>
            <AboutLink onClick={() => openLegal('third-party')}>{t('about.licenses')}</AboutLink>
            <AboutWebLink url={privacyURL}>{t('about.privacy')}</AboutWebLink>
            <AboutWebLink url={supportURL}>{t('about.help')}</AboutWebLink>
          </span>
        )}
      </div>
      <SupportAula />
    </Section>
  )
}
