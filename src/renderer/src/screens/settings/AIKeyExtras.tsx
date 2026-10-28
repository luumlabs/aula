// Lo que acompaña a «Con una clave de API» en Ajustes → Tu IA: elegir el modelo de un proveedor, un servicio propio compatible
// con OpenAI (URL base, modelo y clave opcional) y el gasto de hoy y del mes con un tope diario opcional (apagado por defecto).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, ProgressBar, ProviderLogo, ProviderLogoRow, Select, Switch, TextField, cx, logoForModel, logoForProvider, spring } from '@renderer/design'
import type { AIProviderView } from '@shared/ai/views'
import { validateAPIKey } from '@shared/ai/apiKey'
import { CUSTOM_PROVIDER_ID, checkCustomBaseURL } from '@shared/ai/customProvider'
import { aiClient } from '@renderer/lib/aiClient'
import { useRpc } from '@renderer/lib/useRpc'
import { useSettings } from '@renderer/lib/settings'
import { parseDailyBudget } from '@shared/settings/ai'

/** Selector pequeño del modelo de un proveedor con varios modelos conocidos (el recomendado, por defecto). */
export function ModelSelect({ provider, onChanged }: { provider: AIProviderView; onChanged: () => void }) {
  const { t } = useTranslation('settings')
  const models = provider.models ?? []
  const value = provider.model ?? provider.defaultModel ?? models[0]?.id ?? ''
  // en los que sirven modelos de varias casas (OpenRouter, Groq, Zen…), cada modelo lleva el logo de quien lo hizo
  const own = logoForProvider(provider)
  const withLogos = models.some((m) => {
    const maker = logoForModel(m.id)
    return maker !== null && maker !== own
  })
  const choose = async (id: string) => {
    if (id === value) return
    // el recomendado se guarda como «sin elegir»: así sigue al preset si Aula lo actualiza
    await aiClient.configure({ providerId: provider.id, model: id === provider.defaultModel ? '' : id, activate: false }).catch(() => undefined)
    onChanged()
  }
  return (
    <div className="basis-full flex items-center gap-2 pl-12">
      <span className="t-ui text-text3 shrink-0">{t('ai.model')}</span>
      <Select
        className="flex-1 min-w-0 max-w-[280px]"
        value={value}
        onChange={(v) => void choose(v)}
        options={models.map((m) => ({
          value: m.id,
          label: m.label,
          hint: m.id === provider.defaultModel ? t('ai.recommended') : m.label !== m.id ? m.id : undefined,
          icon: withLogos ? <ProviderLogo logo={logoForModel(m.id) ?? 'custom'} size={16} tone="brand" decorative /> : undefined
        }))}
      />
    </div>
  )
}

/** Un servicio propio compatible con OpenAI: la URL base (https, o http en este ordenador), el modelo y la clave si la pide. */
export function CustomProvider({ current, onSaved }: { current?: AIProviderView; onSaved: (el: HTMLElement) => Promise<void> }) {
  const { t } = useTranslation('settings')
  const configured = !!current?.baseURL
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(current?.baseURL ?? '')
  const [model, setModel] = useState(current?.model ?? '')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) return
    setUrl(current?.baseURL ?? '')
    setModel(current?.model ?? '')
  }, [open, current?.baseURL, current?.model])

  const save = async (el: HTMLElement) => {
    const u = checkCustomBaseURL(url)
    if (!u.ok) return setError(t(`ai.custom.url.${u.problem}`))
    if (!model.trim()) return setError(t('ai.custom.modelMissing'))
    let cleanKey: string | null = null
    if (key.trim()) {
      const v = validateAPIKey(key)
      if (!v.ok) return setError(t('ai.custom.keyInvalid'))
      cleanKey = v.key
    }
    setBusy(true)
    setError(null)
    try {
      // la clave va en la misma llamada: si la dirección cambia de servidor, la guardada se borra
      await aiClient.configure({ providerId: CUSTOM_PROVIDER_ID, baseURL: u.url, model: model.trim(), activate: false, ...(cleanKey ? { key: cleanKey } : {}) })
      await onSaved(el)
      setKey('')
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button className="flex w-full items-center gap-1.5 t-ui text-text2 hover:text-text py-1" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name={configured ? 'edit' : 'plus'} size={13} className="text-text3" />
        <span className="flex-1 text-left">{configured ? t('ai.custom.edit') : t('ai.custom.title')}</span>
        <Icon name="chevron-down" size={13} className={cx('text-text3 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.smooth}>
            <div className="flex flex-col gap-2.5 pt-2 pb-1">
              <TextField label={t('ai.custom.baseURL')} value={url} onChange={(e) => { setUrl(e.target.value); setError(null) }} placeholder="https://api.example.com/v1" spellCheck={false} autoCapitalize="off" icon={<Icon name="link" size={14} />} />
              <TextField label={t('ai.custom.model')} value={model} onChange={(e) => { setModel(e.target.value); setError(null) }} placeholder={t('ai.custom.modelPlaceholder')} spellCheck={false} autoCapitalize="off" />
              <TextField
                label={t('ai.custom.key')}
                type="password"
                value={key}
                onChange={(e) => { setKey(e.target.value); setError(null) }}
                placeholder={current?.hasKey ? t('ai.custom.keyKept', { hint: current.keyHint ?? '' }) : t('ai.custom.keyPlaceholder')}
                icon={<Icon name="key" size={14} />}
              />
              <AnimatePresence>
                {error && (
                  <motion.p role="alert" className="t-footnote text-danger flex items-start gap-1.5" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Icon name="alert-circle" size={13} className="mt-[2px] shrink-0" />
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
              <div className="flex items-center justify-between gap-2">
                <span className="t-footnote text-text3">{t('ai.custom.hint')}</span>
                <Button size="sm" variant="primary" loading={busy} onClick={(e) => void save(e.currentTarget)}>
                  {t('ai.save')}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const DEFAULT_CAP_USD = 2

/** Gasto de hoy y del mes con las claves de API, y el tope diario (apagado por defecto). */
export function SpendingPanel({ customInUse, providers = [] }: { customInUse: boolean; providers?: AIProviderView[] }) {
  const { t, i18n } = useTranslation('settings')
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const { data: costs } = useRpc('ai.costs', undefined, { events: ['ai.done', 'ai.changed', 'settings.changed'] })
  const cap = settings?.ai.dailyBudgetUSD ?? 0
  const on = cap > 0
  const [draft, setDraft] = useState(on ? String(cap) : '')
  const [lastCap, setLastCap] = useState(on ? cap : DEFAULT_CAP_USD)
  useEffect(() => {
    if (cap > 0) {
      setDraft(capText(cap, i18n.language))
      setLastCap(cap)
    }
  }, [cap, i18n.language])

  const toggle = (v: boolean) => void update({ ai: { dailyBudgetUSD: v ? lastCap : 0 } })
  const commit = () => {
    const v = parseDailyBudget(draft)
    if (v === null) return setDraft(capText(cap, i18n.language))
    if (v !== cap) void update({ ai: { dailyBudgetUSD: v } })
  }
  const level = costs?.level
  const used = on && costs ? Math.min(1, costs.committedUSD / Math.max(cap, 1e-9)) : 0

  return (
    <div className="mt-1 pt-3 border-t-[0.5px] border-line-soft flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Figure value={costs?.today.text} label={t('ai.spend.today')} />
        <Figure value={costs?.month.text} label={t('ai.spend.month')} />
      </div>
      {providers.length > 0 && (
        <div className="flex items-center gap-2 t-ui text-text3">
          <span>{t('ai.spend.with')}</span>
          <ProviderLogoRow providers={providers} size={16} />
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="t-callout font-medium">{t('ai.budget')}</div>
          <div className="t-ui text-text3 mt-0.5">{t('ai.spend.capHint')}</div>
        </div>
        <Switch checked={on} onChange={toggle} label={t('ai.budget')} />
      </div>
      <AnimatePresence initial={false}>
        {on && (
          <motion.div className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.smooth}>
            <div className="flex items-center gap-2">
              <div className="w-[96px]">
                <TextField
                  inputMode="decimal"
                  aria-label={t('ai.budget')}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                  className="tabular text-right"
                />
              </div>
              <span className="t-ui text-text2">{t('ai.spend.perDay')}</span>
            </div>
            {costs && (
              <div className="mt-2.5">
                <ProgressBar value={used} height={6} color={level === 'reached' ? 'var(--danger)' : level === 'warning' ? 'var(--warning)' : 'var(--accent)'} label={costs.statusText} />
                <div className={cx('t-footnote mt-1.5', level === 'reached' ? 'text-danger' : level === 'warning' ? 'text-warning' : 'text-text3')}>
                  {level === 'reached' ? t('ai.spend.reached') : costs.statusText}
                </div>
              </div>
            )}
            {customInUse && <p className="t-footnote text-warning mt-1.5">{t('ai.spend.customUnknown')}</p>}
          </motion.div>
        )}
      </AnimatePresence>
      <p className="t-footnote text-text3 flex items-start gap-1.5">
        <Icon name="info" size={12} className="mt-[3px] shrink-0" />
        {t('ai.spend.notCounted')}
      </p>
    </div>
  )
}

function capText(v: number, lang: string): string {
  if (!(v > 0)) return ''
  return new Intl.NumberFormat(lang, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2, useGrouping: false }).format(v)
}

function Figure({ value, label }: { value?: string; label: string }) {
  return (
    <div className="rounded-[14px] bg-sunken px-3 py-2.5 min-w-0">
      <div className="t-number text-[22px] leading-[28px] truncate">{value ?? '—'}</div>
      <div className="t-ui text-text3">{label}</div>
    </div>
  )
}
