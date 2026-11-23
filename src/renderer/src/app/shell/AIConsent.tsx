// El aviso de la IA de terceros en un dispositivo (guía 5.1.2(i) del App Store): antes de mandar lo primero a la IA, a quién
// lo manda Aula y para qué; «Continuar» o «Cancelar» (no se manda nada). En la demostración, un aviso propio: no se manda nada.
// La lógica está en lib/aiConsentGuard.ts; aquí, solo la hoja.
import { useTranslation } from 'react-i18next'
import { AulaMark, Button, Dialog, Icon } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { useAIConsent } from '@renderer/lib/aiConsent'
import { recipientLabel, type AIRecipient } from '@shared/ai/recipient'
import { publicDocURL } from '@shared/legal'

export function AIConsentDialog() {
  const { t, i18n } = useTranslation()
  const asking = useAIConsent((s) => s.asking)
  const demo = useAIConsent((s) => s.demo)
  const answer = useAIConsent((s) => s.answer)
  const server = api.server
  // en el dispositivo, el puente lo abre en su navegador
  const openPrivacy = (): void => void api.invoke('app.openExternal', { url: publicDocURL('privacy', i18n.language) }).catch(() => undefined)
  return (
    <Dialog
      open={!!asking}
      onClose={() => answer?.(false)}
      size="sm"
      title={
        <span className="flex items-center gap-3">
          <AulaMark size={34} state="waiting" />
          {t('aiConsent.title')}
        </span>
      }
      footer={
        <>
          <Button variant="secondary" size="lg" data-ai-consent="cancel" onClick={() => answer?.(false)}>{t('aiConsent.cancel')}</Button>
          <Button variant="primary" size="lg" data-ai-consent="accept" onClick={() => answer?.(true)}>{t('aiConsent.accept')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {demo ? (
          <p className="t-callout text-text2">{t('aiConsent.demo')}</p>
        ) : (
          <>
            <p className="t-callout text-text2">{t(server ? 'aiConsent.leadServer' : 'aiConsent.lead')}</p>
            <ul className="flex flex-col gap-2" data-ai-consent="recipients">
              {(asking?.recipients ?? []).map((r) => <RecipientRow key={r.id} r={r} />)}
            </ul>
            <p className="t-footnote text-text2">{t('aiConsent.policy')} {t(server ? 'aiConsent.changeServer' : 'aiConsent.change')}</p>
          </>
        )}
        {/* también en la demostración: el revisor ve el mismo enlace que el estudiante */}
        <button type="button" className="relative touch-target self-start t-ui text-accent-text hover:underline" onClick={openPrivacy}>
          {t('aiConsent.privacy')}
        </button>
      </div>
    </Dialog>
  )
}

/** Una empresa: su nombre (un dato, no se traduce) y para qué recibe datos. */
function RecipientRow({ r }: { r: AIRecipient }) {
  const { t } = useTranslation()
  return (
    <li className="rounded-[14px] bg-fill1 px-3.5 py-2.5">
      <div className="t-callout font-semibold">{recipientLabel(r)}</div>
      {r.uses.map((use) => (
        <div key={use} className="mt-1 flex items-start gap-2 t-footnote text-text2">
          <Icon name={use === 'answers' ? 'chat' : 'audio'} size={13} className="mt-[2px] shrink-0 text-text3" />
          <span>{t(use === 'answers' ? 'aiConsent.usesAnswers' : 'aiConsent.usesRecordings')}</span>
        </div>
      ))}
    </li>
  )
}
