// Selector de IA (Ajustes y bienvenida). Aula detecta sola lo que ya tienes (Claude Code, ChatGPT/Codex, Ollama,
// LM Studio, claves guardadas) y lo propone primero; pegar una clave reconoce el proveedor por su forma.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Card, Companion, Icon, ProgressBar, ProviderLogo, Spinner, TextField, cx, toast, pixelBurst, spring, type LogoId } from '@renderer/design'
import type { AIProviderView, AIStatus } from '@shared/ai/views'
import type { AgentsDetection, LocalProgressEvent } from '@shared/agents'
import { validateAPIKey } from '@shared/ai/apiKey'
import { aiClient, guessProviderFromKey } from '@renderer/lib/aiClient'
import { isDemo } from '@renderer/lib/demo'
import { api } from '@renderer/lib/api'
import i18n from '@renderer/i18n'
import { CUSTOM_PROVIDER_ID } from '@shared/ai/customProvider'
import { CustomProvider, ModelSelect, SpendingPanel } from './AIKeyExtras'
import { downloadFraction, useChatGPTLogin, type ChatGPTLoginView } from './chatgptLogin'

interface PickerData {
  status: AIStatus | null
  providers: AIProviderView[]
  detection: AgentsDetection | null
}

function useAIData() {
  const [data, setData] = useState<PickerData>({ status: null, providers: [], detection: null })
  const [loading, setLoading] = useState(true)
  const load = async (refresh = false) => {
    setLoading(true)
    const [status, providers, detection] = await Promise.all([
      aiClient.status().catch(() => null),
      aiClient.providers().catch(() => [] as AIProviderView[]),
      aiClient.detect(refresh).catch(() => null)
    ])
    setData(isDemo() && !status && !detection ? demoData() : { status, providers, detection })
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])
  return { ...data, loading, reload: load }
}

type OptionId = 'claude-cli' | 'codex-cli' | 'aula-local' | 'ollama' | 'lmstudio' | string

export function AIPicker({ onChosen, compact }: { onChosen?: (providerId: string) => void; compact?: boolean }) {
  const { t } = useTranslation('settings')
  const { status, providers, detection, loading, reload } = useAIData()
  const [busy, setBusy] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const guessed = useMemo(() => guessProviderFromKey(key), [key])
  const activeId = status?.resolved?.providerId ?? null
  const claude = detection?.clis.find((c) => c.kind === 'claude')
  const codex = detection?.clis.find((c) => c.kind === 'codex')
  const ollama = detection?.servers.find((s) => s.kind === 'ollama')
  const lmstudio = detection?.servers.find((s) => s.kind === 'lmstudio')
  const keyed = providers.filter((p) => p.needsKey && p.hasKey && p.id !== CUSTOM_PROVIDER_ID)
  const keyProviders = providers.filter((p) => p.needsKey && p.id !== CUSTOM_PROVIDER_ID)
  const custom = providers.find((p) => p.id === CUSTOM_PROVIDER_ID)
  const customSet = !!custom?.baseURL
  // el gasto solo tiene sentido si hay algo de pago por uso listo (las suscripciones y lo local no cuentan)
  const paid = providers.some((p) => p.billing === 'perToken' && p.available && p.configured)
  const local = useLocalDownload(detection?.recommendedModel?.id ?? null)

  const use = async (id: OptionId, el?: HTMLElement | null) => {
    setBusy(id)
    try {
      await aiClient.configure({ providerId: id })
      if (el) pixelBurst(el)
      onChosen?.(id)
      await reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  // «Conectar con ChatGPT»: el estado vive en un store (sigue a la vista al volver a esta pantalla) y se puede cancelar
  const login = useChatGPTLogin()
  const loginBusy = login.phase !== 'idle'
  const seenConnected = useRef(login.connected)
  useEffect(() => {
    // terminó (quizá con esta tarjeta desmontada): recargar lo detectado
    if (login.connected === seenConnected.current) return
    seenConnected.current = login.connected
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login.connected])
  const connectChatGPT = async (el: HTMLElement | null, deviceAuth = false) => {
    const ok = await useChatGPTLogin.getState().start({ deviceAuth, onError: (m) => toast.error(m) })
    if (!ok) return
    if (el?.isConnected) pixelBurst(el)
    onChosen?.('codex-cli')
  }
  const chatgptButton = useRef<HTMLElement | null>(null)

  /** Modelo local: si ya está descargado se usa; si no, se descarga (motor + modelo, verificado) y después se usa. */
  const useLocal = async (el: HTMLElement) => {
    if (local.installed) return use('aula-local', el)
    const ok = await local.download()
    if (ok) await use('aula-local', el)
  }

  const saveKey = async (el: HTMLElement) => {
    const v = validateAPIKey(key)
    if (!v.ok) return toast.warning(t('ai.pasteKey'))
    const id = guessed ?? 'openai'
    setBusy('key')
    try {
      await aiClient.setKey(id, v.key)
      await use(id, el)
      setKey('')
    } catch (e) {
      toast.error((e as Error).message)
      setBusy(null)
    }
  }

  if (loading && !detection && !status)
    return (
      <div className="grid place-items-center py-10 text-text3">
        <Spinner size={18} />
      </div>
    )

  return (
    // dos columnas: suscripción y local una sobre otra, la clave al lado; sin estirar (ninguna tarjeta con hueco vacío)
    <div className={cx('grid gap-4', compact ? 'grid-cols-1' : 'grid-cols-1 @4xl:grid-cols-2 items-start')}>
      <div className={cx('contents', !compact && '@4xl:flex @4xl:flex-col @4xl:gap-4')}>
        <Group title={t('ai.subscription')} hint={t('ai.subscriptionHint')} companion="luna">
          <Option
            active={activeId === 'claude-cli'}
            title={t('ai.claude')}
            detail={claude?.installed && claude.loggedIn !== false ? t('ai.claudeReady') : t('ai.claudeMissing')}
            ready={!!claude?.installed && claude.loggedIn !== false}
            action={claude?.installed ? (e) => use('claude-cli', e) : undefined}
            busy={busy === 'claude-cli'}
            logo="claude"
          />
          <Option
            active={activeId === 'codex-cli'}
            title={t('ai.chatgpt')}
            detail={detection?.codexManagedLoggedIn || codex?.loggedIn ? t('ai.chatgptReady') : t('ai.chatgptConnect')}
            ready={!!(detection?.codexManagedLoggedIn || codex?.loggedIn)}
            action={loginBusy ? undefined : (e) => {
              chatgptButton.current = e
              return detection?.codexManagedLoggedIn || codex?.loggedIn ? use('codex-cli', e) : connectChatGPT(e)
            }}
            actionLabel={detection?.codexManagedLoggedIn || codex?.loggedIn ? undefined : t('ai.chatgptConnect')}
            busy={busy === 'codex-cli'}
            logo="chatgpt"
          />
          <AnimatePresence>
            {loginBusy && (
              <ChatGPTLoginPanel
                key="chatgpt-login"
                view={login}
                onCancel={login.cancel}
                onUseCode={() => void connectChatGPT(chatgptButton.current, true)}
              />
            )}
          </AnimatePresence>
        </Group>

        <Group title={t('ai.local')} hint={t('ai.localHint')} companion="farol">
          {detection?.recommendedModel && (
            <>
              <Option
                active={activeId === 'aula-local'}
                title={detection.recommendedModel.name}
                detail={local.installed ? t('ai.localReady') : t('ai.localModel')}
                ready={local.installed || !!detection.engine?.running}
                action={local.progress ? undefined : (e) => void useLocal(e)}
                actionLabel={local.installed ? undefined : t('ai.localDownload')}
                busy={busy === 'aula-local'}
                logo="aula"
              />
              <AnimatePresence>
                {local.progress && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="rounded-[14px] bg-sunken p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="t-ui text-text2">{t(`ai.localPhase.${local.progress.phase}`, { percent: Math.round(local.progress.fraction * 100) })}</span>
                      <Button size="sm" variant="plain" onClick={() => local.cancel()}>
                        {t('ai.localCancel')}
                      </Button>
                    </div>
                    <ProgressBar value={local.progress.fraction} height={6} label={t('ai.localModel')} />
                    {local.progress.bytesTotal > 0 && <div className="t-caption text-text3 mt-1.5 tabular">{fmtBytes(local.progress.bytesDone)} / {fmtBytes(local.progress.bytesTotal)}</div>}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
          {!detection?.recommendedModel && !ollama && !lmstudio && (
            <p className="t-ui text-text3 leading-relaxed">{detection ? t('ai.localNone') : t('ai.localChecking')}</p>
          )}
          {ollama && <Option active={activeId === 'ollama'} title={t('ai.ollama')} detail={t('ai.running', { count: ollama.models.length })} ready action={(e) => use('ollama', e)} busy={busy === 'ollama'} logo="ollama" />}
          {lmstudio && <Option active={activeId === 'lmstudio'} title={t('ai.lmstudio')} detail={t('ai.running', { count: lmstudio.models.length })} ready action={(e) => use('lmstudio', e)} busy={busy === 'lmstudio'} logo="lmstudio" />}
        </Group>
      </div>

      <Group title={t('ai.key')} hint={t('ai.keyHint')} companion="cristal">
        {keyed.map((p) => (
          <Option
            key={p.id}
            active={activeId === p.id}
            title={p.label}
            detail={p.keyHint ?? ''}
            ready={p.available}
            action={(e) => use(p.id, e)}
            busy={busy === p.id}
            provider={p}
            extra={p.models && p.models.length > 1 ? <ModelSelect provider={p} onChanged={() => void reload()} /> : undefined}
          />
        ))}
        {custom && customSet && (
          <Option
            active={activeId === custom.id}
            title={hostOf(custom.baseURL) ?? custom.label}
            detail={custom.available ? custom.model ?? '' : custom.availability ?? custom.model ?? ''}
            ready={custom.available}
            action={(e) => use(custom.id, e)}
            busy={busy === custom.id}
            provider={custom}
          />
        )}
        <div className="flex flex-col gap-2">
          <TextField type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('ai.pasteKey')} icon={<Icon name="key" size={15} />} />
          <AnimatePresence>
            {key && (
              <motion.div className="flex items-center justify-between gap-2" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <span className="t-ui text-text2 flex items-center gap-2 min-w-0">
                  <ProviderLogo provider={{ id: guessed ?? 'openai' }} size={16} tone="brand" decorative />
                  <span className="truncate">{t('ai.detected', { provider: providers.find((p) => p.id === guessed)?.label ?? guessed ?? 'OpenAI' })}</span>
                </span>
                <Button size="sm" variant="primary" loading={busy === 'key'} onClick={(e) => void saveKey(e.currentTarget)}>
                  {t('ai.save')}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <CustomProvider current={custom} onSaved={(el) => use(CUSTOM_PROVIDER_ID, el)} />
        {/* con qué proveedores funciona y dónde queda la clave (cifrada, nunca sale de este ordenador salvo a su proveedor) */}
        {!compact && !keyed.length && !customSet && (
          <div className="mt-1">
            <div className="flex flex-wrap gap-1.5">
              {keyProviders.slice(0, 6).map((p) => (
                <span key={p.id} data-logo-hover className="t-footnote inline-flex items-center gap-1.5 rounded-full bg-fill1 pl-2 pr-2.5 py-1 text-text2">
                  <ProviderLogo provider={p} size={14} decorative />
                  {p.label}
                </span>
              ))}
              {keyProviders.length > 6 && (
                <span className="t-footnote rounded-full px-2 py-1 text-text3" title={keyProviders.slice(6).map((p) => p.label).join(', ')}>+{keyProviders.length - 6}</span>
              )}
            </div>
            <p className="t-footnote text-text3 mt-2.5 flex items-start gap-1.5">
              <Icon name="lock" size={12} className="mt-[3px] shrink-0" />
              {t('ai.keySafe')}
            </p>
          </div>
        )}
        {!compact && paid && <SpendingPanel customInUse={activeId === CUSTOM_PROVIDER_ID} providers={providers.filter((p) => p.billing === 'perToken' && p.available && p.configured)} />}
      </Group>
    </div>
  )
}

/** Descarga del modelo recomendado para el motor propio de Aula, con su progreso ('local.progress'). */
function useLocalDownload(modelId: string | null) {
  const [installed, setInstalled] = useState(false)
  const [progress, setProgress] = useState<LocalProgressEvent | null>(null)
  useEffect(() => {
    if (!modelId) return
    let alive = true
    api
      .invoke('local.catalog')
      .then((c) => {
        if (!alive) return
        const e = c.entries.find((x) => x.card.id === modelId)
        setInstalled(!!e?.installed)
      })
      .catch(() => {})
    const off = api.on('local.progress', (p) => {
      if (p.modelId !== modelId) return
      setProgress(p.state === 'running' ? p : null)
      if (p.state === 'done' && p.phase !== 'engine') setInstalled(true)
    })
    return () => {
      alive = false
      off()
    }
  }, [modelId])
  const download = async (): Promise<boolean> => {
    if (!modelId) return false
    setProgress({ modelId, phase: 'model', state: 'running', bytesDone: 0, bytesTotal: 0, fraction: 0 })
    try {
      await api.invoke('local.download', { modelId })
      setInstalled(true)
      return true
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code !== 'cancelled') toast.error(i18n.t('settings:ai.localFailed'), (e as Error).message)
      return false
    } finally {
      setProgress(null)
    }
  }
  const cancel = () => {
    if (modelId) void api.invoke('local.cancel', { modelId }).catch(() => {})
  }
  return { installed, progress, download, cancel }
}

/** En qué va «Conectar con ChatGPT»: la descarga del Codex oficial, la página del navegador (con «Abrir otra vez» y la opción
 * de entrar con un código) o el código de un solo uso; siempre con «Cancelar». */
function ChatGPTLoginPanel({ view, onCancel, onUseCode }: { view: ChatGPTLoginView; onCancel: () => void; onUseCode: () => void }) {
  const { t } = useTranslation('settings')
  const fraction = downloadFraction(view)
  const open = (url: string) => void api.invoke('app.openExternal', { url }).catch((e: unknown) => toast.error((e as Error).message))
  const copy = (code: string) =>
    void navigator.clipboard
      ?.writeText(code)
      .then(() => toast.success(t('ai.chatgptLogin.copied')))
      .catch(() => {})
  return (
    <motion.div
      data-testid="chatgpt-login"
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="rounded-[14px] bg-sunken p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="t-ui text-text2 flex items-center gap-2 min-w-0">
          {view.phase !== 'device' && <Spinner size={13} />}
          <span>{t(`ai.chatgptLogin.${view.phase === 'idle' ? 'starting' : view.phase}`)}</span>
        </span>
        <Button size="sm" variant="plain" onClick={onCancel}>
          {t('ai.localCancel')}
        </Button>
      </div>
      {view.phase === 'downloading' && (
        <div className="mt-2">
          <ProgressBar value={fraction ?? 0} height={6} label={t('ai.chatgptLogin.downloading')} />
          {view.bytesTotal > 0 && <div className="t-caption text-text3 mt-1.5 tabular">{fmtBytes(view.bytesDone)} / {fmtBytes(view.bytesTotal)}</div>}
        </div>
      )}
      {view.phase === 'browser' && (
        <>
          <p className="t-caption text-text3 mt-1.5">{t('ai.chatgptLogin.browserHint')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {view.url && (
              <Button size="sm" variant="secondary" icon={<Icon name="external" size={13} />} onClick={() => open(view.url!)}>
                {t('ai.chatgptLogin.openAgain')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onUseCode}>
              {t('ai.chatgptLogin.useCode')}
            </Button>
          </div>
        </>
      )}
      {view.phase === 'device' && view.code && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="t-headline tabular rounded-[10px] bg-fill1 px-3 py-1.5 tracking-[0.12em] selectable" aria-label={t('ai.chatgptLogin.codeLabel')}>
            {view.code}
          </code>
          <Button size="sm" variant="secondary" icon={<Icon name="copy" size={13} />} onClick={() => copy(view.code!)}>
            {t('ai.chatgptLogin.copy')}
          </Button>
          {view.url && (
            <Button size="sm" variant="ghost" icon={<Icon name="external" size={13} />} onClick={() => open(view.url!)}>
              {t('ai.chatgptLogin.openPage')}
            </Button>
          )}
        </div>
      )}
    </motion.div>
  )
}

/** El host de una URL base («api.together.xyz»), o undefined. */
function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host || undefined
  } catch {
    return undefined
  }
}

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`
  return `${Math.round(n / 1e3)} kB`
}

function Group({ title, hint, companion, children }: { title: string; hint: string; companion: string; children: React.ReactNode }) {
  return (
    <Card padded="lg" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Companion id={companion} size={40} />
        <div>
          <div className="t-headline">{title}</div>
          <div className="t-ui text-text3">{hint}</div>
        </div>
      </div>
      <div className="flex flex-col gap-2 mt-1">{children}</div>
    </Card>
  )
}

function Option({ title, detail, ready, active, action, actionLabel, busy, logo, provider, extra }: { title: string; detail: string; ready: boolean; active: boolean; action?: (el: HTMLElement) => void; actionLabel?: string; busy?: boolean; logo?: LogoId; provider?: AIProviderView; extra?: React.ReactNode }) {
  const { t } = useTranslation('settings')
  return (
    <motion.div layout transition={spring.smooth} className={cx('group flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] p-3 border-[0.5px] transition-colors', active ? 'bg-accent-wash border-accent-line' : 'bg-sunken border-transparent')}>
      <ProviderLogo logo={logo} provider={provider} size={36} tile active={active} decorative />
      <div className="min-w-[140px] flex-1">
        <div className="t-callout font-medium">{title}</div>
        <div className={cx('t-ui', ready ? 'text-success' : 'text-text3')}>{detail}</div>
      </div>
      {active ? (
        <span className="ml-auto t-ui font-semibold text-accent-text flex items-center gap-1">
          <Icon name="check" size={14} /> {t('ai.inUse')}
        </span>
      ) : action ? (
        <Button size="sm" variant={ready ? 'secondary' : 'plain'} loading={busy} className="ml-auto" onClick={(e) => action(e.currentTarget)}>
          {actionLabel ?? t('ai.use')}
        </Button>
      ) : null}
      {extra}
    </motion.div>
  )
}

function demoData(): PickerData {
  return {
    status: { activeProvider: null, auto: true, resolved: { providerId: 'claude-cli', label: 'Claude', kind: 'claude-cli', model: 'claude-sonnet' }, ready: true },
    providers: [],
    detection: {
      clis: [
        { kind: 'claude', installed: true, loggedIn: true, detail: '', version: '2.1' },
        { kind: 'codex', installed: false, loggedIn: null, detail: '' },
        { kind: 'opencode', installed: false, loggedIn: null, detail: '' }
      ],
      servers: [{ kind: 'ollama', baseURL: 'http://127.0.0.1:11434', models: [{ id: 'qwen3:8b', label: 'Qwen 3 8B', isChat: true }, { id: 'gemma3:12b', label: 'Gemma 3 12B', isChat: true }], needsKey: false }],
      installedApps: [],
      hardware: {} as AgentsDetection['hardware'],
      recommendedModel: { id: 'qwen3-8b', name: 'Qwen 3 8B (5 GB)', fit: {} as never },
      engine: { running: false } as unknown as AgentsDetection['engine'],
      codexManagedLoggedIn: false
    }
  }
}
