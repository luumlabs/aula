// Estudiar: los modos a pantalla completa (la barra lateral sigue) con una columna de lectura tranquila, la cápsula de
// progreso que flota arriba y atajos de teclado: aprender, practicar, tarjetas, simulacro, errores y el plan de hoy.
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState, Spinner } from '@renderer/design'
import { useRoute, navigate, routeKey, type Route } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { flushProgress, useCourseData } from './data'
import { LearnMode } from './learn/LearnMode'
import { PracticeMode } from './practice/PracticeMode'
import { CardsMode } from './cards/CardsMode'
import { ExamMode } from './exam/ExamMode'
import { MistakesMode } from './mistakes/MistakesMode'
import { PlanMode } from './plan/PlanMode'
import { TutorPanel } from './TutorPanel'

export default function StudyScreen() {
  const { t } = useTranslation('study')
  const route = useRoute()
  const r = route.name === 'study' ? route : null
  const id = r?.id ?? ''
  const { data, status } = useCourseData(id)
  useScreenTitle(data ? `${t(`modes.${r?.mode ?? 'learn'}`)} · ${data.pack.title}` : t(`modes.${r?.mode ?? 'learn'}`), null, [data?.pack.title, r?.mode])
  // lo pendiente se guarda al salir del modo
  useEffect(() => () => void flushProgress(id), [id])

  if (!r) return null
  if (status === 'loading' && !data)
    return (
      <div className="grid flex-1 place-items-center text-text3">
        <Spinner size={18} />
      </div>
    )
  if (!data)
    return (
      <EmptyState
        title={status === 'error' ? t('common.loadError') : t('common.notFound')}
        body={status === 'error' ? t('common.loadErrorBody') : undefined}
        action={<Button onClick={() => navigate({ name: 'home' })}>{t('common.home')}</Button>}
      />
    )

  const key = `${r.mode}:${r.skill ?? ''}`
  return (
    <>
      {modeView(r.mode, key, data, r.skill)}
      {/* en el simulacro no hay tutor: «sin pistas ni explicaciones hasta entregar» */}
      {r.mode !== 'exam' && <TutorPanel screenKey={routeKey(r)} />}
    </>
  )
}

function modeView(mode: StudyRouteMode, key: string, data: NonNullable<ReturnType<typeof useCourseData>['data']>, skill?: string) {
  switch (mode) {
    case 'learn': return <LearnMode key={key} data={data} skillId={skill} />
    case 'practice': return <PracticeMode key={key} data={data} skillId={skill} />
    case 'cards': return <CardsMode key={key} data={data} skillId={skill} />
    case 'exam': return <ExamMode key={key} data={data} />
    case 'mistakes': return <MistakesMode key={key} data={data} skillId={skill} />
    case 'plan': return <PlanMode key={key} data={data} />
  }
}

type StudyRouteMode = Extract<Route, { name: 'study' }>['mode']
