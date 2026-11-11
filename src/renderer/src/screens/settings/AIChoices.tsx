// «Tu IA» en un dispositivo (iPad, iPhone): solo elegir entre las IA que ya están listas en el Mac, con su modelo y su
// razonamiento. Conectar otra, las claves, las descargas y el gasto se llevan desde el Mac (allí está AIPicker); el servidor
// tampoco deja hacerlo desde aquí (remote/policy.ts).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, Icon, Spinner, pixelBurst, toast } from '@renderer/design'
import type { AIProviderView, AIStatus } from '@shared/ai/views'
import { aiClient } from '@renderer/lib/aiClient'
import { api } from '@renderer/lib/api'
import { LiveModelSelect, ModelSelect, ReasoningSelect } from './AIKeyExtras'
import { Option } from './AIPicker'

/** Las que tienen nombre propio en Aula (el mismo que en el Mac); las demás, el de su servicio. */
const NAMES: Record<string, string> = { 'claude-cli': 'ai.claude', 'codex-cli': 'ai.chatgpt', 'aula-local': 'ai.logo.aula', ollama: 'ai.ollama', lmstudio: 'ai.lmstudio' }

export function AIChoices() {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [choices, setChoices] = useState<AIProviderView[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = async () => {
    const [st, list] = await Promise.all([aiClient.status().catch(() => null), aiClient.choices().catch(() => [] as AIProviderView[])])
    setStatus(st)
    setChoices(list)
  }
  useEffect(() => {
    void load()
    // se eligió otra en el Mac o en otro dispositivo
    return api.on('ai.changed', () => void load())
  }, [])

  const use = async (id: string, el: HTMLElement) => {
    setBusy(id)
    try {
      await aiClient.select({ providerId: id })
      if (el.isConnected) pixelBurst(el)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!choices)
    return (
      <div className="grid place-items-center py-10 text-text3">
        <Spinner size={18} />
      </div>
    )
  const activeId = status?.resolved?.providerId ?? null
  const reload = () => void load()
  return (
    <Card padded="lg" className="flex flex-col gap-2" data-testid="ai-choices">
      {choices.length === 0 && <p className="t-body text-text2">{t('ai.remote.none')}</p>}
      {choices.map((p) => {
        const pickModel = !!p.models && p.models.length > 1
        const live = p.group === 'custom'
        return (
          <Option
            key={p.id}
            active={activeId === p.id}
            title={NAMES[p.id] ? t(NAMES[p.id]) : p.label}
            detail={[t('ai.remote.ready'), !pickModel && !live ? p.model : undefined].filter(Boolean).join(' · ')}
            ready
            action={(el) => void use(p.id, el)}
            busy={busy === p.id}
            provider={p}
            extra={
              <>
                {pickModel && <ModelSelect provider={p} onChanged={reload} />}
                {live && <LiveModelSelect provider={p} onChanged={reload} />}
                <ReasoningSelect provider={p} onChanged={reload} />
              </>
            }
          />
        )
      })}
      <p className="t-footnote text-text3 mt-1 flex items-start gap-1.5">
        <Icon name="info" size={12} className="mt-[3px] shrink-0" />
        {t('ai.remote.hint')}
      </p>
    </Card>
  )
}
