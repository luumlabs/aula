// Pantalla de un curso: al entrar, una cortina de píxeles con el tono del curso se abre y su icono se enciende píxel
// a píxel. Pestañas en cápsula: Resumen, Aprender, Practicar, Tarjetas, Simulacro, Errores, Materiales, Referencia.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, PixelCurtain, SegmentedTabs, Spinner, toneForHue, useTheme, Button } from '@renderer/design'
import { useRoute, navigate, type CourseTab } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { useCoursePack, useOverview } from './data'
import { CourseHeader } from './Header'
import { Overview } from './Overview'
import { LearnTab } from './Learn'
import { ReferenceTab } from './Reference'
import { PracticeTab } from './Practice'
import { CardsTab } from './Cards'
import { ExamTab } from './Exam'
import { MistakesTab } from './Mistakes'
import { MaterialsTab } from './Materials'
import { CourseCreationFailed, CoursePartialBanner } from './Failed'
import { courseRunIssue, coursePartial } from './failure'
import { useCourseRun } from './runs'

const TABS: CourseTab[] = ['overview', 'learn', 'practice', 'cards', 'exam', 'mistakes', 'materials', 'reference']

const curtainSeen = new Set<string>()

export default function CourseScreen() {
  const { t } = useTranslation(['course', 'common'])
  const route = useRoute()
  const id = route.name === 'course' ? route.id : ''
  const tab: CourseTab = route.name === 'course' && route.tab ? route.tab : 'overview'
  const { pack, loading, missing } = useCoursePack(id)
  const ov = useOverview(pack)
  const lastRun = useCourseRun(id)
  const { dark } = useTheme()
  // la cortina de píxeles solo la primera vez que se abre cada curso en la sesión (no al volver de estudiar)
  const [curtain, setCurtain] = useState(() => !curtainSeen.has(id))
  useEffect(() => {
    if (id) curtainSeen.add(id)
  }, [id])
  useScreenTitle(pack?.title ?? '', null, [pack?.title])

  // casi nunca se ve: la navegación espera a tener el curso (con tope) y lo guarda para la próxima visita
  if (loading)
    return (
      <div className="screen-fallback grid flex-1 place-items-center text-text3">
        <Spinner size={18} />
      </div>
    )
  if (missing || !pack) return <EmptyState title={t('notFound')} body={t('notFoundBody')} action={<Button onClick={() => navigate({ name: 'home' })}>{t('common:nav.home')}</Button>} />

  const tone = toneForHue(pack.hue)
  const setTab = (next: CourseTab) => navigate({ name: 'course', id: pack.id, tab: next }, { replace: true })
  // la creación falló o se detuvo sin ningún tema: qué pasó y qué hacer, no un resumen vacío
  const issue = courseRunIssue(lastRun, pack.skills.length)
  // la creación se cortó con temas ya escritos: parece terminado, pero no lo está (J2-2)
  const partial = coursePartial(lastRun, pack.skills.length)
  if (issue && lastRun)
    return (
      <div className="@container flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-24">
        <CourseCreationFailed pack={pack} runId={lastRun.id} issue={issue} />
      </div>
    )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="@container flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-24">
        {/* la cortina de píxeles solo sobre la cabecera y breve (antes tapaba toda la pantalla ~1 s: J1-7) */}
        <div className="relative">
          <CourseHeader pack={pack} />
          {curtain && (
            <div className="absolute -inset-x-2 -inset-y-1 z-30 pointer-events-none overflow-hidden rounded-[18px]" style={{ ['--curtain' as string]: `color-mix(in oklab, ${dark ? tone.fillDark : tone.fillLight} ${dark ? 40 : 26}%, var(--paper))` }}>
              <PixelCurtain color={tone.top} duration={240} onDone={() => setCurtain(false)} />
            </div>
          )}
        </div>
        {partial && lastRun && <CoursePartialBanner run={lastRun} partial={partial} />}
        {/* en ventanas estrechas las pestañas se desplazan en horizontal en vez de partirse; centradas solo si caben («safe»:
            si no, empiezan por la izquierda y «Overview» no queda cortado fuera de alcance: A4-P2-17) */}
        <div className="mt-6 mb-5 flex [justify-content:safe_center] overflow-x-auto no-scrollbar -mx-6 px-6">
          <SegmentedTabs className="shrink-0" value={tab} onChange={setTab} items={TABS.map((x) => ({ id: x, label: t(`tabs.${x}`) }))} />
        </div>
        {/* cambiar de pestaña: la nueva entra al momento (sin esperar a que se vaya la anterior ni pasar por el vacío) */}
        <div key={tab} className="tab-enter">
            {tab === 'overview' && <Overview pack={pack} ov={ov} />}
            {tab === 'learn' && <LearnTab pack={pack} ov={ov} />}
            {tab === 'reference' && <ReferenceTab pack={pack} />}
            {tab === 'practice' && <PracticeTab pack={pack} />}
            {tab === 'cards' && <CardsTab pack={pack} />}
            {tab === 'exam' && <ExamTab pack={pack} />}
            {tab === 'mistakes' && <MistakesTab pack={pack} />}
            {tab === 'materials' && <MaterialsTab pack={pack} />}
        </div>
      </div>
    </div>
  )
}
