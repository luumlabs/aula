// Bienvenida del primer arranque: tres pasos y listo. Aula detecta sola la IA y nada más hace falta.
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { AulaMark, Button, Companion, InkArrow, PixelMedal, TextField, cx, spring, useTabTrap } from '@renderer/design'
import { useSettings } from '@renderer/lib/settings'
import { useCourses } from '@renderer/lib/courses'
import { navigate } from '@renderer/app/router'
import { AIPicker } from '../settings/AIPicker'
import { PlatformsCard } from '../settings/Platforms'

const PARADE = ['libro', 'pluma', 'buho', 'cohete', 'sobre', 'farol', 'estrella']

export function Onboarding() {
  const { t } = useTranslation('onboarding')
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const courses = useCourses((s) => s.courses)
  const [step, setStep] = useState(0)
  const [name, setName] = useState(settings?.general.name ?? '')
  const total = 4
  // la bienvenida tapa la app entera: es una capa modal y Tab no sale a los botones de Hoy de detrás (A4-P2-11)
  const layer = useRef<HTMLDivElement>(null)
  useTabTrap(layer, true)
  const finish = async (go: 'create' | 'sample' | 'home') => {
    await update({ onboarded: true, general: { name: name.trim() } })
    if (go === 'create') navigate({ name: 'create' })
    else if (go === 'sample' && courses[0]) navigate({ name: 'course', id: courses[0].id })
  }
  return (
    <motion.div ref={layer} role="dialog" aria-modal="true" aria-label={t('hello')} className="fixed inset-0 z-[120] flex flex-col bg-paper" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="drag h-10 shrink-0" />
      <div className="flex justify-center gap-1.5 pt-2" aria-label={t('step', { n: step + 1, total })}>
        {Array.from({ length: total }, (_, i) => (
          <motion.span key={i} className="h-1.5 rounded-[2px]" animate={{ width: i === step ? 22 : 8, background: i <= step ? 'var(--accent)' : 'var(--fill3)' }} transition={spring.snappy} />
        ))}
      </div>
      <div className="@container flex-1 min-h-0 overflow-y-auto">
        {/* cada paso entra al momento (sin AnimatePresence «wait», que con prisa podía dejar la vista en blanco: J1-6) */}
        <div key={step} className="screen-enter mx-auto flex min-h-full max-w-[1080px] flex-col items-center justify-center px-8 py-10">
            {step === 0 && (
              <div className="flex flex-col items-center text-center max-w-[560px]">
                {/* la marca a pincel, en ladrillo como el icono de la app: el pincel la dibuja, el sol sale y luego respira, y la
                    línea «hierve» casi sin verse */}
                <div className="text-[var(--pigment-brick)]">
                  <AulaMark size={96} state="idle" draw alive boil />
                </div>
                <h1 className="t-display mt-6">{t('hello')}</h1>
                <p className="t-body text-text2 mt-3">{t('helloBody')}</p>
                <div className="flex gap-2 mt-7">
                  {PARADE.map((id, i) => (
                    <motion.div key={id} initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...spring.bouncy, delay: 0.3 + i * 0.07 }}>
                      <Companion id={id} size={42} working />
                    </motion.div>
                  ))}
                </div>
                <div className="w-full max-w-[340px] mt-8 text-left">
                  <TextField label={t('name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} onKeyDown={(e) => e.key === 'Enter' && setStep(1)} autoFocus />
                </div>
                <div className="relative mt-6">
                  {/* una flecha a mano que señala por dónde se empieza (se dibuja una vez, cuando ya está todo) */}
                  <InkArrow seed="welcome-start" w={96} h={64} from={{ x: 88, y: 6 }} to={{ x: 10, y: 44 }} delay={1700} className="left-full top-[-28px] ml-2" />
                  <Button variant="primary" size="xl" className="min-w-[200px]" onClick={() => setStep(1)}>
                    {t('start')}
                  </Button>
                </div>
              </div>
            )}
            {step === 1 && (
              <div className="w-full">
                <div className="text-center max-w-[620px] mx-auto">
                  <h1 className="t-title1 text-[34px] leading-[40px]">{t('aiTitle')}</h1>
                  <p className="t-body text-text2 mt-2">{t('aiBody')}</p>
                </div>
                <div className="mt-8">
                  <AIPicker />
                </div>
                <Footer onSkip={() => setStep(2)} onNext={() => setStep(2)} skipLabel={t('later')} nextLabel={t('continue')} />
              </div>
            )}
            {step === 2 && (
              <div className="w-full max-w-[640px]">
                <div className="text-center">
                  <div className="flex justify-center">
                    <Companion id="abeja" size={64} working appear />
                  </div>
                  <h1 className="t-title1 text-[34px] leading-[40px] mt-4">{t('platformTitle')}</h1>
                  <p className="t-body text-text2 mt-2">{t('platformBody')}</p>
                </div>
                <div className="mt-7">
                  <PlatformsCard heading={false} />
                </div>
                <Footer onSkip={() => setStep(3)} onNext={() => setStep(3)} skipLabel={t('platformSkip')} nextLabel={t('continue')} />
              </div>
            )}
            {step === 3 && (
              <div className="flex flex-col items-center text-center max-w-[560px]">
                <motion.div initial={{ scale: 0.4, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={spring.bouncy}>
                  <PixelMedal size={88} />
                </motion.div>
                <h1 className="t-display mt-6">{t('doneTitle')}</h1>
                <p className="t-body text-text2 mt-3">{t('doneBody')}</p>
                <div className="flex flex-wrap justify-center gap-2 mt-8">
                  <Button variant="primary" size="xl" onClick={() => void finish('create')}>
                    {t('create')}
                  </Button>
                  <Button variant="secondary" size="xl" onClick={() => void finish(courses.length ? 'sample' : 'home')}>
                    {t('explore')}
                  </Button>
                </div>
              </div>
            )}
        </div>
      </div>
    </motion.div>
  )
}

function Footer({ onSkip, onNext, skipLabel, nextLabel }: { onSkip: () => void; onNext: () => void; skipLabel: string; nextLabel: string }) {
  return (
    // fijo abajo mientras se desplaza: en ventanas bajas (1000×680) «Continuar» quedaba fuera de la vista (J1-20). Papel liso
    // detrás, con un velo del mismo papel por encima (un solo color, sin degradado de colores).
    <div className={cx('sticky bottom-0 z-10 mt-8 -mx-4 flex items-center justify-center gap-3 bg-paper px-4 py-4 shadow-[0_-14px_14px_-6px_var(--paper)]')} data-onboarding-footer>
      <Button variant="ghost" size="lg" onClick={onSkip}>
        {skipLabel}
      </Button>
      <Button variant="primary" size="lg" className="min-w-[160px]" onClick={onNext}>
        {nextLabel}
      </Button>
    </div>
  )
}
