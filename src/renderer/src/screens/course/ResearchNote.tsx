// En Materiales sin ninguna fuente: si la última creación investigó en internet y no guardó nada (o falló), se dice aquí, para
// que una cita «(Fuente: Wikipedia…)» de las lecciones no parezca respaldada por un material que no existe.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { useCourseRun } from './runs'

export function ResearchNote({ packId }: { packId: string }) {
  const { t } = useTranslation('course')
  const last = useCourseRun(packId)
  const [note, setNote] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!last) return
    let alive = true
    api.invoke('generation.run', { id: last.id }).then((r) => alive && setNote(r?.report?.researchNote)).catch(() => {})
    return () => {
      alive = false
    }
  }, [last?.id, last?.state])
  if (!note) return null
  return (
    <div className="mt-4 flex items-start gap-2.5 rounded-[14px] bg-warning-soft px-4 py-3" role="note">
      <Icon name="alert-circle" size={15} className="mt-[2px] shrink-0 text-warning" />
      <div className="min-w-0">
        <div className="t-ui font-semibold text-text">{t('research.title')}</div>
        <p className="t-callout text-text2 mt-0.5">{note}</p>
      </div>
    </div>
  )
}
