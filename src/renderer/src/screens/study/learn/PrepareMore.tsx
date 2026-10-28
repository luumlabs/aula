// Banco agotado: Aula prepara más ejercicios con la tubería real del curso (se sigue en su monitor) o, sin IA, se sigue
// sin comprobar el concepto (queda marcado y la lección no se atasca).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AulaMark, Button, Icon, ProgressBar } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { navigate } from '@renderer/app/router'
import { prepareMore } from '../ai'
import { loadCourse } from '../data'

type Phase = 'idle' | 'starting' | 'running' | 'done' | 'failed' | 'noAI'

export function PrepareMore({ packId, skillId, conceptId, focus, onPrepared, onContinueUnchecked }: { packId: string; skillId: string; conceptId?: string; focus: string; onPrepared: () => void; onContinueUnchecked?: () => void }) {
  const { t } = useTranslation('study')
  const [phase, setPhase] = useState<Phase>('idle')
  const [runId, setRunId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!runId) return
    return api.on('generation.update', (r) => {
      if (r.id !== runId) return
      setProgress(r.progress)
      if (r.state === 'done') {
        setPhase('done')
        void loadCourse(packId, true).then(onPrepared)
      } else if (r.state === 'failed' || r.state === 'cancelled' || r.state === 'limit') setPhase('failed')
    })
  }, [runId, packId, onPrepared])

  const start = async (): Promise<void> => {
    setPhase('starting')
    const r = await prepareMore(packId, skillId, conceptId, focus)
    if (!r) return setPhase('noAI')
    setRunId(r.runId)
    setPhase('running')
  }
  const check = (): void => void loadCourse(packId, true).then(onPrepared)

  return (
    <div className="flex flex-col gap-3 rounded-[18px] bg-sunken p-5">
      {phase === 'running' || phase === 'starting' ? (
        <>
          <div className="flex items-center gap-2.5 t-callout">
            <AulaMark size={22} state="working" />
            <span>{t('learn.preparing')}</span>
          </div>
          <ProgressBar value={progress} className="max-w-[320px]" />
          <div className="flex flex-wrap gap-2">
            {runId && <Button size="sm" variant="secondary" onClick={() => navigate({ name: 'run', id: runId })}>{t('learn.seeRun')}</Button>}
            {onContinueUnchecked && <Button size="sm" variant="ghost" onClick={onContinueUnchecked}>{t('learn.continueUnchecked')}</Button>}
          </div>
        </>
      ) : phase === 'noAI' ? (
        <>
          <div className="t-callout text-text2">{t('learn.noAI')}</div>
          <div className="flex flex-wrap gap-2">
            {onContinueUnchecked && <Button size="lg" variant="primary" onClick={onContinueUnchecked}>{t('learn.continueUnchecked')}</Button>}
            <Button size="lg" variant="secondary" icon={<Icon name="settings" size={15} />} onClick={() => navigate({ name: 'settings', section: 'ai' })}>{t('learn.setupAI')}</Button>
          </div>
        </>
      ) : (
        <>
          {phase === 'failed' && <div className="t-callout text-warning">{t('learn.prepareFailed')}</div>}
          {phase === 'done' && <div className="t-callout text-success">{t('learn.prepared')}</div>}
          <div className="flex flex-wrap gap-2">
            <Button size="lg" variant="primary" icon={<Icon name="refine" size={15} />} onClick={() => void start()}>{t('learn.prepareMore')}</Button>
            {onContinueUnchecked && (
              <Button size="lg" variant="secondary" onClick={onContinueUnchecked} title={t('learn.continueUncheckedHelp')}>
                {t('learn.continueUnchecked')}
              </Button>
            )}
          </div>
        </>
      )}
      {phase !== 'running' && phase !== 'starting' && (
        <div>
          <Button size="sm" variant="ghost" onClick={check}>{t('learn.checkNew')}</Button>
        </div>
      )}
    </div>
  )
}
