// Valores por defecto (los mismos que la app Swift) y lo que cambia con cada estilo de «Aula siempre activa».
import type { AttentionLimits, AutomationSchedule, AutomationState, ProactiveRoutine, ProactiveSettings, ProactiveStyle } from './types'
import { timeFromMinutes, timeMinutes, WEEKDAYS } from './time'

export function defaultSchedule(kind: AutomationSchedule['kind'] = 'daily'): AutomationSchedule {
  return { kind, times: kind === 'daily' ? ['08:00'] : [], weekdays: [], everyHours: 8, windowStart: '08:00', windowEnd: '22:00', hoursBefore: kind === 'beforeEvents' ? [24, 2] : [], eventKinds: [] }
}

export function emptyAutomationState(): AutomationState {
  return { runCount: 0, consecutiveFailures: 0, retries: 0, seen: [], baselineDone: false, firedKeys: [], completed: false, failureNotified: false }
}

export function defaultProactiveSettings(): ProactiveSettings {
  return {
    enabled: false,
    morningBrief: true,
    morningTime: '07:45',
    platformCheck: true,
    platformCheckTime: '20:00',
    platformCheckDays: [...WEEKDAYS.schoolDays],
    deadlineReminders: true,
    reminderHours: [24, 2],
    examOffers: true,
    examOfferDays: 21,
    weeklySummary: true,
    weeklyDay: 1,
    weeklyTime: '18:00',
    followups: true,
    maxFollowupsPerDay: 6,
    quiet: { enabled: true, from: '22:30', to: '07:30' },
    dailyTokenLimit: 150_000,
    noticesPerHour: 2,
    style: 'balanced',
    notifications: true,
    dockBadge: true
  }
}

/** Los números de cada estilo (`null` = «Personalizada»: los que puso el estudiante). */
export function styleLimits(s: ProactiveStyle): AttentionLimits | null {
  switch (s) {
    case 'discreet': return { dailyTokens: 60_000, noticesPerHour: 1, followupsPerDay: 2, morningInterrupts: false, summariesInterrupt: false, normalSound: false }
    case 'balanced': return { dailyTokens: 150_000, noticesPerHour: 2, followupsPerDay: 6, morningInterrupts: true, summariesInterrupt: false, normalSound: true }
    case 'attentive': return { dailyTokens: 400_000, noticesPerHour: 4, followupsPerDay: 12, morningInterrupts: true, summariesInterrupt: true, normalSound: true }
    case 'custom': return null
  }
}

/** Aplica un estilo (sus números). Devuelve una copia. */
export function applyStyle(p: ProactiveSettings, s: ProactiveStyle): ProactiveSettings {
  const l = styleLimits(s)
  return l ? { ...p, style: s, dailyTokenLimit: l.dailyTokens, noticesPerHour: l.noticesPerHour, maxFollowupsPerDay: l.followupsPerDay } : { ...p, style: s }
}

/** Los límites de ahora (los del estilo o los números a mano). */
export function limitsOf(p: ProactiveSettings): AttentionLimits {
  const base = styleLimits(p.style) ?? styleLimits('balanced')!
  return { ...base, dailyTokens: p.dailyTokenLimit, noticesPerHour: Math.max(1, p.noticesPerHour), followupsPerDay: p.maxFollowupsPerDay }
}

/** Si los números ya no son los de su estilo, pasa a «Personalizada». */
export function markCustomIfEdited(p: ProactiveSettings): ProactiveSettings {
  const l = styleLimits(p.style)
  if (!l) return p
  return l.dailyTokens !== p.dailyTokenLimit || l.noticesPerHour !== p.noticesPerHour || l.followupsPerDay !== p.maxFollowupsPerDay ? { ...p, style: 'custom' } : p
}

/** ¿Activa ahora (encendida y sin pausa)? */
export function proactiveIsActive(p: ProactiveSettings, now: number = Date.now()): boolean {
  if (!p.enabled) return false
  if (!p.pausedUntil) return true
  const t = Date.parse(p.pausedUntil)
  return Number.isNaN(t) || t <= now
}

export function routineIncluded(p: ProactiveSettings, r: ProactiveRoutine): boolean {
  return p[r]
}

export function withRoutine(p: ProactiveSettings, r: ProactiveRoutine, on: boolean): ProactiveSettings {
  return { ...p, [r]: on }
}

/** El horario de cada rutina. */
export function routineSchedule(p: ProactiveSettings, r: ProactiveRoutine): AutomationSchedule {
  const base = defaultSchedule('daily')
  switch (r) {
    case 'morningBrief': return { ...base, times: [p.morningTime] }
    case 'platformCheck': return { ...base, times: [p.platformCheckTime], weekdays: [...p.platformCheckDays] }
    case 'deadlineReminders': return { ...defaultSchedule('beforeEvents'), hoursBefore: p.reminderHours.length ? [...p.reminderHours] : [24, 2] }
    case 'examOffers': return { ...base, times: [timeFromMinutes(timeMinutes(p.morningTime) + 1)] }
    case 'weeklySummary': return { ...base, times: [p.weeklyTime], weekdays: [p.weeklyDay] }
  }
}
