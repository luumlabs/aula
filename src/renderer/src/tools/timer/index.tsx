// Temporizador de estudio (pomodoro): anillo grande que se vacía, partículas que suben mientras te concentras,
// bloques de hoy y aviso al terminar. Sigue contando aunque cambies de pantalla (estado global).
import { api } from '@renderer/lib/api'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import { Button, Card, ProgressRing, SegmentedTabs, Slider, pixelBurst, cx, useTheme } from '@renderer/design'
import { useAmbient } from '@renderer/design/ambient'
import type { ToolProps } from '../registry'

type Phase = 'focus' | 'short' | 'long'

interface TimerState {
  phase: Phase
  lengths: Record<Phase, number> // minutos
  endsAt: number | null // marca de tiempo cuando corre
  remaining: number // segundos cuando está en pausa
  sessionsToday: number
  day: string
  setPhase: (p: Phase) => void
  setLength: (p: Phase, m: number) => void
  start: () => void
  pause: () => void
  reset: () => void
  finish: () => void
}

const today = () => new Date().toDateString()
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('aula.timer') ?? '{}') as Partial<TimerState>
  } catch {
    return {}
  }
})()

export const useTimer = create<TimerState>((set, get) => ({
  phase: 'focus',
  lengths: saved.lengths ?? { focus: 25, short: 5, long: 15 },
  endsAt: null,
  remaining: (saved.lengths?.focus ?? 25) * 60,
  sessionsToday: saved.day === today() ? saved.sessionsToday ?? 0 : 0,
  day: today(),
  setPhase: (p) => set({ phase: p, endsAt: null, remaining: get().lengths[p] * 60 }),
  setLength: (p, m) => {
    const lengths = { ...get().lengths, [p]: m }
    set({ lengths, ...(get().phase === p && !get().endsAt ? { remaining: m * 60 } : {}) })
    persist()
  },
  start: () => set({ endsAt: Date.now() + get().remaining * 1000 }),
  pause: () => {
    const { endsAt } = get()
    if (endsAt) set({ remaining: Math.max(0, Math.round((endsAt - Date.now()) / 1000)), endsAt: null })
  },
  reset: () => set({ endsAt: null, remaining: get().lengths[get().phase] * 60 }),
  finish: () => {
    const s = get()
    const wasFocus = s.phase === 'focus'
    const sessions = wasFocus ? (s.day === today() ? s.sessionsToday + 1 : 1) : s.sessionsToday
    const next: Phase = wasFocus ? (sessions % 4 === 0 ? 'long' : 'short') : 'focus'
    set({ sessionsToday: sessions, day: today(), phase: next, endsAt: null, remaining: s.lengths[next] * 60 })
    persist()
  }
}))

function persist() {
  const { lengths, sessionsToday, day } = useTimer.getState()
  localStorage.setItem('aula.timer', JSON.stringify({ lengths, sessionsToday, day }))
}

/** Reloj global: cuando el bloque termina, avisa (notificación del sistema si la ventana no está a la vista). */
let ticker: ReturnType<typeof setInterval> | null = null
function ensureTicker(t: (k: string) => string) {
  // solo con un bloque en marcha (antes quedaba un intervalo de 500 ms para siempre, J4-12)
  if (ticker || !useTimer.getState().endsAt) return
  ticker = setInterval(() => {
    const s = useTimer.getState()
    if (!s.endsAt) {
      if (ticker) clearInterval(ticker)
      ticker = null
      return
    }
    if (Date.now() >= s.endsAt) {
      const wasFocus = s.phase === 'focus'
      s.finish()
      const msg = wasFocus ? t('tools:timer.doneFocus') : t('tools:timer.doneBreak')
      const ring = document.querySelector('[data-timer-ring]')
      if (wasFocus && ring) pixelBurst(ring)
      // por el proceso principal: la página de la app no tiene permiso de avisos (J3-8). Se pide SIEMPRE y el proceso principal
      // decide si hace falta: en macOS `document.hidden` es false aun minimizada, oculta o detrás de otra app (A5-P1-2)
      void api.invoke('app.notify', { body: msg, whenAway: true }).catch(() => undefined)
    }
  }, 500)
}

export function useTimerRemaining(): number {
  const { endsAt, remaining } = useTimer()
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!endsAt) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [endsAt])
  return endsAt ? Math.max(0, Math.round((endsAt - Date.now()) / 1000)) : remaining
}

export default function TimerTool({ compact }: ToolProps) {
  const { t } = useTranslation('tools')
  const s = useTimer()
  const remaining = useTimerRemaining()
  const { reducedMotion } = useTheme()
  useEffect(() => ensureTicker(t), [t, s.endsAt])
  const live = useAmbient('activity')
  const total = s.lengths[s.phase] * 60
  const running = !!s.endsAt
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  const size = compact ? 200 : 320

  return (
    <div className={cx(compact ? 'p-4' : 'grid gap-5 @4xl:grid-cols-[1fr_320px]')}>
      <Card padded={compact ? false : 'lg'} className={cx('flex flex-col items-center', compact && 'bg-transparent! border-0! shadow-none!')}>
        <SegmentedTabs
          size="sm"
          value={s.phase}
          onChange={(p) => s.setPhase(p)}
          items={[
            { id: 'focus', label: t('timer.focus') },
            { id: 'short', label: t('timer.short') },
            { id: 'long', label: t('timer.long') }
          ]}
        />
        <div className="relative my-6 grid place-items-center" data-timer-ring>
          <ProgressRing value={remaining / total} size={size} stroke={compact ? 6 : 8} color="var(--accent)" delay={0}>
            <div className="text-center">
              <motion.div
                className={cx('font-serif tabular tracking-[-0.03em] leading-none', compact ? 'text-[46px]' : 'text-[78px]')}
                animate={running && !reducedMotion && live ? { opacity: [1, 0.86, 1] } : { opacity: 1 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                {mm}:{ss}
              </motion.div>
              <div className="t-eyebrow mt-3">{t(`timer.${s.phase}`)}</div>
            </div>
          </ProgressRing>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size={compact ? 'sm' : 'md'} icon={<RotateCcw size={16} />} onClick={s.reset} aria-label={t('timer.reset')} />
          <Button variant="primary" size={compact ? 'md' : 'lg'} icon={running ? <Pause size={15} /> : <Play size={15} />} onClick={running ? s.pause : s.start} className="min-w-[140px]">
            {running ? t('timer.pause') : remaining < total ? t('timer.resume') : t('timer.start')}
          </Button>
          <Button variant="ghost" size={compact ? 'sm' : 'md'} icon={<SkipForward size={16} />} onClick={s.finish} aria-label={t('timer.skip')} />
        </div>
        <div className="flex items-center gap-1.5 mt-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <motion.span key={i} className="w-2 h-2 rounded-[2px]" animate={{ scale: i < s.sessionsToday % 4 || (s.sessionsToday > 0 && s.sessionsToday % 4 === 0) ? 1.15 : 1 }} style={{ background: i < s.sessionsToday % 4 || (s.sessionsToday > 0 && s.sessionsToday % 4 === 0) ? 'var(--accent)' : 'var(--fill3)' }} />
          ))}
          <span className="t-ui text-text3 ml-2">{t('timer.sessions', { count: s.sessionsToday })}</span>
        </div>
      </Card>
      {!compact && (
        <Card padded="lg" className="self-start">
          <div className="flex flex-col gap-5">
            <Slider label={t('timer.focusLength')} min={5} max={90} step={5} value={s.lengths.focus} onChange={(v) => s.setLength('focus', v)} format={(v) => `${v} ${t('timer.minutes')}`} />
            <Slider label={t('timer.breakLength')} min={1} max={30} step={1} value={s.lengths.short} onChange={(v) => s.setLength('short', v)} format={(v) => `${v} ${t('timer.minutes')}`} />
            <Slider label={t('timer.long')} min={5} max={45} step={5} value={s.lengths.long} onChange={(v) => s.setLength('long', v)} format={(v) => `${v} ${t('timer.minutes')}`} />
          </div>
        </Card>
      )}
    </div>
  )
}
