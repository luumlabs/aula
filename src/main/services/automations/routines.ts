// Rutinas sin IA de «Aula siempre activa» (AutomationRoutines.swift): recordatorios antes de entregas y exámenes, «se acerca
// un examen sin curso → ¿lo preparo?» y los resúmenes de la mañana y de la semana cuando no hay IA o se llegó al límite del
// día (con el calendario y el plan de cada curso). No gastan nada.
import { IDs } from '@engine/base/ids'
import { tr } from '@shared/ai/i18n'
import type { AssistantCard, AssistantCardAction, AssistantCardActionKind, AssistantFact, AssistantRef } from '@shared/assistant/types'
import type { HomeSummary } from '@shared/ipc/home'
import type { PackSummary } from '@shared/schema/library'
import { effectiveStart, titleTokens, type AutomationSlot, type PlannerEvent } from '@shared/automations'
import { isSameDay } from '@engine/calendar/time'
import { capitalizeFirst, clock, daysLeft, inTime, list, when } from './texts'

/** Lo que usa una rutina de un evento del calendario (lo cumple `CalendarEvent`). */
export interface RoutineEvent extends PlannerEvent {
  course?: string
  url?: string
  packID?: string
  origin?: string
}

export interface Composed {
  text: string
  cards: AssistantCard[]
  noticeTitle: string
  noticeBody: string
  urgent: boolean
}

// MARK: Tarjetas

export function cardAction(kind: AssistantCardActionKind, label: string, opts: { symbol?: string; prominent?: boolean; value?: string; courseID?: string; ref?: AssistantRef } = {}): AssistantCardAction {
  return {
    id: 'act-' + IDs.short(6), kind, label, prominent: opts.prominent ?? false,
    ...(opts.symbol ? { symbol: opts.symbol } : {}), ...(opts.value !== undefined ? { value: opts.value } : {}),
    ...(opts.courseID ? { courseID: opts.courseID } : {}), ...(opts.ref ? { ref: opts.ref } : {})
  }
}

export function actionsCard(title: string, actions: AssistantCardAction[], opts: { detail?: string; icon?: string; facts?: AssistantFact[]; automationID?: string; kind?: AssistantCard['kind'] } = {}): AssistantCard {
  return {
    id: 'card-' + IDs.short(8), kind: opts.kind ?? 'actions', title, options: [], allowsOther: false, items: [], facts: opts.facts ?? [],
    state: 'pending', actions, ...(opts.detail ? { detail: opts.detail } : {}), ...(opts.icon ? { icon: opts.icon } : {}),
    ...(opts.automationID ? { automationID: opts.automationID } : {})
  }
}

const integrityNote = () => tr('_Te ayudo a entenderla y a organizarte; la entrega la escribes y la envías tú._', '_I help you understand it and get organized; you write and submit it yourself._')

// MARK: Recordatorios

/** El recordatorio de un evento (entrega, examen o prueba) N horas antes. */
export function reminder(e: RoutineEvent, slot: AutomationSlot, course: PackSummary | undefined, now: number, tz: string): Composed {
  const start = effectiveStart(e, tz)
  const left = (start - now) / 1000
  const soon = left <= 3 * 3600
  const whenText = soon ? inTime(left) + (e.allDay ? '' : ` (${clock(start, tz)})`) : when(start, e.allDay, now, tz)
  const where = [e.course, course?.title].find((x) => !!x && x.trim() !== '')
  const what = where ? `«${e.title}» (${where})` : `«${e.title}»`
  const actions: AssistantCardAction[] = []
  let text: string
  let title: string
  if (e.kind === 'assignment') {
    text = tr(`**${capitalizeFirst(whenText)}** vence la entrega ${what}.`, `**${capitalizeFirst(whenText)}** the assignment ${what} is due.`)
    if (!soon) text += ' ' + tr('¿La preparamos juntos? Te ayudo a entender lo que piden y a organizarla paso a paso.', "Shall we prepare it together? I'll help you understand what they ask and plan it step by step.")
    text += '\n\n' + integrityNote()
    title = soon ? tr(`Entrega ${inTime(left)}: ${e.title}`, `Due ${inTime(left)}: ${e.title}`) : tr(`Entrega ${when(start, e.allDay, now, tz)}: ${e.title}`, `Due ${when(start, e.allDay, now, tz)}: ${e.title}`)
    actions.push(cardAction('ask', tr('¿Lo hacemos juntos?', 'Shall we do it together?'), {
      symbol: 'users', prominent: true,
      value: tr(`Ayúdame a preparar la entrega «${e.title}»: explícame qué piden y hagamos un plan paso a paso (sin hacerla por mí).`, `Help me prepare the assignment “${e.title}”: explain what they ask and let's make a step-by-step plan (without doing it for me).`)
    }))
  } else if (e.kind === 'exam' || e.kind === 'quiz') {
    const kindWord = e.kind === 'exam' ? tr('el examen', 'the exam') : tr('la prueba', 'the quiz')
    text = tr(`**${capitalizeFirst(whenText)}** tienes ${kindWord} ${what}.`, `**${capitalizeFirst(whenText)}** you have ${kindWord} ${what}.`)
    text += ' ' + (soon
      ? tr('Repasa la hoja de fórmulas y lo que más te cuesta; nada nuevo a última hora. ¡Tú puedes!', 'Go over the formula sheet and what you find hardest; nothing new at the last minute. You can do it!')
      : tr('Hoy lo que más ayuda es un simulacro corto y repasar tus errores.', 'Today, a short practice exam and reviewing your mistakes help the most.'))
    const w = soon ? inTime(left) : when(start, e.allDay, now, tz)
    title = e.kind === 'exam' ? tr(`Examen ${w}: ${e.title}`, `Exam ${w}: ${e.title}`) : tr(`Prueba ${w}: ${e.title}`, `Quiz ${w}: ${e.title}`)
    if (course) {
      actions.push(cardAction('open', soon ? tr('Repasar errores', 'Review mistakes') : tr('Hacer un simulacro', 'Take a practice exam'), {
        symbol: soon ? 'mistakes' : 'exam', prominent: true, value: soon ? 'mistakes' : 'exam',
        ref: { kind: 'course', courseID: course.id, title: course.title, icon: course.icon, hue: course.hue }
      }))
    } else if (!soon) {
      actions.push(cardAction('prepareCourse', tr('Preparar un curso', 'Prepare a course'), { symbol: 'create', prominent: true, value: e.id }))
    }
  } else {
    text = `**${capitalizeFirst(whenText)}**: ${what}.`
    title = e.title
  }
  if (e.url) actions.push(cardAction('openURL', tr('Abrir en la plataforma', 'Open on the platform'), { symbol: 'external', value: e.url }))
  actions.push(cardAction('openCalendar', tr('Ver en el calendario', 'See in the calendar'), { symbol: 'calendar', value: e.id }))
  const card = actionsCard(e.title, actions, { detail: where, icon: e.kind === 'assignment' ? 'checklist' : 'exam' })
  const body = soon
    ? tr(`Es ${whenText}. ¡Tú puedes!`, `It's ${whenText}. You can do it!`)
    : e.kind === 'assignment'
      ? tr('¿La preparamos juntos? Abre Aula y te ayudo paso a paso.', "Shall we prepare it together? Open Aula and I'll help you step by step.")
      : tr('Un simulacro corto hoy te va a venir genial.', 'A short practice exam today will help a lot.')
  return { text, cards: [card], noticeTitle: title, noticeBody: (where ? where + ' · ' : '') + body, urgent: soon }
}

// MARK: Exámenes sin curso

/** Exámenes próximos sin curso de Aula (ni vinculado ni con la misma fecha y un título parecido) que aún no se ofrecieron. */
export function examsWithoutCourse(events: readonly RoutineEvent[], packs: readonly PackSummary[], packIDFor: (eventID: string) => string | undefined, offered: ReadonlySet<string>, days: number, now: number, tz: string): RoutineEvent[] {
  const limit = now + days * 86_400_000
  return events.filter((e) => {
    const start = e.start.getTime()
    if (e.kind !== 'exam' || start <= now || start > limit || offered.has(e.id)) return false
    if (e.origin === 'course') return false
    const p = e.packID ?? packIDFor(e.id)
    if (p && packs.some((x) => x.id === p)) return false
    // un curso con un examen ese mismo día y un nombre parecido ya lo cubre
    const words = titleTokens(e.title + ' ' + (e.course ?? ''))
    return !packs.some((p) => {
      if (!p.examDate || !isSameDay(Date.parse(p.examDate), start, tz)) return false
      return [...titleTokens(p.title)].some((w) => words.has(w))
    })
  }).sort((a, b) => a.start.getTime() - b.start.getTime())
}

export function examOffer(e: RoutineEvent, now: number, tz: string): Composed {
  const days = daysLeft(e.start.getTime(), now, tz)
  const whenText = when(e.start.getTime(), e.allDay, now, tz)
  const name = e.course ? `«${e.title}» (${e.course})` : `«${e.title}»`
  const left = days <= 1 ? '' : ' ' + tr(`(en ${days} días)`, `(in ${days} days)`)
  let text = tr(`Se acerca ${name}, ${whenText}${left}, y aún no tienes un curso para prepararlo.`, `${name} is coming up, ${whenText}${left}, and you don't have a course to prepare it yet.`)
  text += ' ' + tr('¿Lo preparo? Busco en tu plataforma lo que entra y te armo lecciones, práctica y un simulacro.', "Shall I prepare it? I'll look on your platform for what's included and build lessons, practice and a practice exam.")
  const title = tr(`¿Preparo «${e.title}»?`, `Shall I prepare “${e.title}”?`)
  const card = actionsCard(title, [
    cardAction('prepareCourse', tr('Preparar el curso', 'Prepare the course'), { symbol: 'create', prominent: true, value: e.id }),
    cardAction('adjustCourse', tr('Ajustar antes', 'Adjust first'), { symbol: 'sliders', value: e.id }),
    cardAction('neverForEvent', tr('Ahora no', 'Not now'), { value: e.id })
  ], { detail: e.course, icon: 'exam' })
  return { text, cards: [card], noticeTitle: title, noticeBody: tr(`Es ${whenText} y aún no tienes curso. Un clic y me pongo.`, `It's ${whenText} and you have no course yet. One click and I'll start.`), urgent: false }
}

// MARK: Resúmenes sin IA

export function morningCard(): AssistantCard {
  return actionsCard(tr('Tu día', 'Your day'), [
    cardAction('openToday', tr('Empezar el plan de hoy', "Start today's plan"), { symbol: 'play', prominent: true }),
    cardAction('openCalendar', tr('Ver el calendario', 'See the calendar'), { symbol: 'calendar' })
  ], { icon: 'today' })
}

export function weeklyCard(): AssistantCard {
  return actionsCard(tr('Tu semana', 'Your week'), [
    cardAction('ask', tr('Planear la semana juntos', 'Plan the week together'), { symbol: 'checklist', prominent: true, value: tr('Ayúdame a planear esta semana de estudio con mis exámenes y entregas.', 'Help me plan this study week with my exams and deadlines.') }),
    cardAction('openCalendar', tr('Ver el calendario', 'See the calendar'), { symbol: 'calendar' })
  ], { icon: 'calendar' })
}

const isAssessment = (e: RoutineEvent) => e.kind === 'exam' || e.kind === 'quiz'

/** Resumen de la mañana con el calendario y el plan de cada curso. */
export function morning(events: readonly RoutineEvent[], study: HomeSummary | null, now: number, tz: string): Composed {
  const lines: string[] = []
  const classes = events.filter((e) => e.kind === 'lecture' && isSameDay(e.start, now, tz)).sort((a, b) => a.start.getTime() - b.start.getTime())
  if (classes.length) lines.push(tr('**Clases de hoy:** ', "**Today's classes:** ") + list(classes.slice(0, 5).map((e) => `${e.title} (${clock(e.start.getTime(), tz)})`)))
  // lo «de todo el día» de hoy sigue pendiente hasta el final del día
  const due = events.filter((e) => e.kind === 'assignment' && effectiveStart(e, tz) > now && e.start.getTime() <= now + 48 * 3_600_000).sort((a, b) => a.start.getTime() - b.start.getTime())
  if (due.length) lines.push(tr('**Vence pronto:** ', '**Due soon:** ') + list(due.slice(0, 4).map((e) => `«${e.title}» ${when(effectiveStart(e, tz), e.allDay, now, tz)}`)))
  const exams = events.filter((e) => isAssessment(e) && effectiveStart(e, tz) > now && e.start.getTime() <= now + 14 * 86_400_000).sort((a, b) => a.start.getTime() - b.start.getTime())
  if (exams.length) {
    lines.push(tr('**Exámenes:** ', '**Exams:** ') + list(exams.slice(0, 3).map((e) => {
      const d = daysLeft(e.start.getTime(), now, tz)
      return d <= 1 ? `«${e.title}» ${when(e.start.getTime(), e.allDay, now, tz)}` : tr(`«${e.title}» (en ${d} días)`, `“${e.title}” (in ${d} days)`)
    })))
  }
  const plan: string[] = []
  const seenCourses = new Set<string>()
  for (const p of study?.plan ?? []) {
    if (p.done || seenCourses.has(p.courseId)) continue
    seenCourses.add(p.courseId)
    plan.push(`${p.courseTitle}: ${p.title}${p.minutes > 0 ? ` (${p.minutes} min)` : ''}`)
    if (plan.length >= 3) break
  }
  if (plan.length) lines.push(tr('**Para hoy:** ', '**For today:** ') + plan.join(' · '))
  if (!lines.length) lines.push(tr('Hoy no tienes clases, entregas ni exámenes apuntados. Buen día para adelantar un repaso corto.', 'No classes, deadlines or exams today. A good day to get ahead with a short review.'))
  const text = tr('¡Buenos días! Esto es lo de hoy:', "Good morning! Here's today:") + '\n\n' + lines.map((l) => '- ' + l).join('\n')
  const body = [
    classes.length ? tr(`${classes.length} ${classes.length === 1 ? 'clase' : 'clases'}`, `${classes.length} ${classes.length === 1 ? 'class' : 'classes'}`) : null,
    due.length ? tr(`${due.length} ${due.length === 1 ? 'entrega pronto' : 'entregas pronto'}`, `${due.length} due soon`) : null,
    exams.length ? tr(`${exams.length} ${exams.length === 1 ? 'examen cerca' : 'exámenes cerca'}`, `${exams.length} ${exams.length === 1 ? 'exam' : 'exams'} coming up`) : null
  ].filter((x): x is string => !!x)
  return { text, cards: [morningCard()], noticeTitle: tr('Buenos días: tu plan de hoy', "Good morning: today's plan"), noticeBody: body.length ? capitalizeFirst(list(body)) : tr('Mira lo que toca estudiar hoy.', "See what's on for today."), urgent: false }
}

/** Resumen semanal con el calendario y lo pendiente. */
export function weekly(events: readonly RoutineEvent[], study: HomeSummary | null, now: number, tz: string): Composed {
  const lines: string[] = []
  const next = events.filter((e) => (isAssessment(e) || e.kind === 'assignment') && effectiveStart(e, tz) > now && e.start.getTime() <= now + 7 * 86_400_000).sort((a, b) => a.start.getTime() - b.start.getTime())
  if (next.length) lines.push(tr('**La semana que viene:** ', '**Next week:** ') + list(next.slice(0, 5).map((e) => `«${e.title}» ${when(effectiveStart(e, tz), e.allDay, now, tz)}`)))
  const weak = (study?.courses ?? []).filter((c) => c.dueCards + c.mistakes > 0).slice(0, 3).map((c) => tr(`${c.title}: ${c.dueCards + c.mistakes} por repasar`, `${c.title}: ${c.dueCards + c.mistakes} to review`))
  if (weak.length) lines.push(tr('**Pendiente:** ', '**Pending:** ') + weak.join(' · '))
  if (!lines.length) lines.push(tr('Semana tranquila: sin exámenes ni entregas a la vista. Un repaso corto al día mantiene lo aprendido.', 'A quiet week: no exams or deadlines in sight. A short daily review keeps what you learned.'))
  const text = tr('Tu resumen de la semana:', 'Your weekly summary:') + '\n\n' + lines.map((l) => '- ' + l).join('\n')
  return {
    text, cards: [weeklyCard()], noticeTitle: tr('Tu resumen de la semana', 'Your weekly summary'),
    noticeBody: next.length ? tr(`${next.length} ${next.length === 1 ? 'fecha importante' : 'fechas importantes'} la semana que viene.`, `${next.length} important ${next.length === 1 ? 'date' : 'dates'} next week.`) : tr('Semana tranquila a la vista.', 'A quiet week ahead.'),
    urgent: false
  }
}

