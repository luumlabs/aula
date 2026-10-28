// Solo desarrollo y capturas (AULA_SEED=demo, nunca en la app empaquetada): una bandeja «Novedades» y dos automatizaciones de
// ejemplo, con mensajes y tarjetas de verdad, para diseñar y revisar la pantalla.
import { IDs } from '@engine/base/ids'
import { tr } from '@shared/ai/i18n'
import type { AssistantCard, AssistantMessage } from '@shared/assistant/types'
import { defaultSchedule, inboxDedupeKey, previewLine, type Automation, type AutomationRun, type InboxEntry, type InboxKind } from '@shared/automations'
import type { AutomationCenter } from './center'
import { actionsCard, cardAction } from './routines'
import { capitalizeFirst, longDay, timeDisplay } from './texts'

const HOUR = 3_600_000

function message(text: string, at: number, cards: AssistantCard[], title: string, kind: NonNullable<AssistantMessage['origin']>['kind']): AssistantMessage {
  return { id: 'msg-' + IDs.short(12), role: 'assistant', text, date: new Date(at).toISOString(), mentions: [], attachments: [], cards, steps: [], notices: [], failed: false, interrupted: false, origin: { kind, title } }
}

function entry(kind: InboxKind, title: string, msg: AssistantMessage, o: { read?: boolean; priority?: 0 | 1 | 2; course?: string; automationID?: string; snoozedUntil?: number } = {}): InboxEntry {
  return {
    id: msg.id, threadID: 'aula-novedades', kind, priority: o.priority ?? 1, title, preview: previewLine(msg.text), source: msg.origin?.title ?? '', date: msg.date,
    read: o.read ?? false, archived: false, resurfaced: false, dedupeKey: inboxDedupeKey(kind, o.automationID, msg.text), notified: !o.read, message: msg,
    ...(o.course ? { course: o.course } : {}), ...(o.automationID ? { automationID: o.automationID } : {}), ...(o.snoozedUntil ? { snoozedUntil: new Date(o.snoozedUntil).toISOString() } : {})
  }
}

export function seedDemoAutomations(center: AutomationCenter, now = Date.now()): void {
  const canvas: Automation = {
    id: 'auto-demo-canvas', title: tr('Revisar Canvas', 'Check Canvas'), instruction: tr('Revisa mis notificaciones de Canvas cada mañana y avísame si me llegó algo nuevo (tareas, anuncios, notas).', 'Check my Canvas notifications every morning and tell me if anything new arrived (assignments, announcements, grades).'),
    schedule: { ...defaultSchedule('daily'), times: ['08:00'], weekdays: [2, 3, 4, 5, 6] }, capabilities: ['platform', 'calendar', 'courses'], notify: 'news', untilFound: false, enabled: true,
    origin: 'student', platformIDs: [], created: new Date(now - 9 * 24 * HOUR).toISOString(), updated: new Date(now - 9 * 24 * HOUR).toISOString()
  }
  const semester: Automation = {
    id: 'auto-demo-semester', title: tr('¿Ya están las asignaciones del semestre?', 'Are the semester assignments up yet?'), instruction: tr('Mira tres veces al día si ya están las asignaciones del nuevo semestre y avísame cuando aparezcan.', 'Check three times a day whether the new semester assignments are up and tell me when they appear.'),
    schedule: { ...defaultSchedule('interval'), everyHours: 7, windowStart: '08:00', windowEnd: '22:00' }, capabilities: ['platform'], notify: 'news', untilFound: true, enabled: true,
    origin: 'student', platformIDs: [], created: new Date(now - 3 * 24 * HOUR).toISOString(), updated: new Date(now - 3 * 24 * HOUR).toISOString()
  }
  const t = (h: number) => now - h * HOUR
  const task = tr('Tarea 4: Identidades trigonométricas', 'Homework 4: Trigonometric identities')
  // horas en el formato del idioma: «23:59» en español, «11:59 PM» en inglés
  const due = timeDisplay('23:59')
  const klass = timeDisplay('10:00')
  // el parcial de química, dentro de 9 días (la fecha en el idioma y la zona del estudiante)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const midterm = capitalizeFirst(longDay(now + 9 * 24 * HOUR, tz))
  const entries: InboxEntry[] = [
    entry('platform', tr(`1 asignación nueva: «${task}»`, `1 new assignment: “${task}”`), message(
      tr(`Hay una **tarea nueva** en MATH 101: «${task}». Vence el **jueves a las ${due}** y cubre las identidades pitagóricas y las de ángulo doble.\n\nSi quieres, la organizamos juntos paso a paso.`, `There's a **new assignment** in MATH 101: “${task}”. It's due **Thursday at ${due}** and covers the Pythagorean and double-angle identities.\n\nIf you want, we can organize it together step by step.`),
      t(1.2), [actionsCard(tr(`1 asignación nueva: «${task}»`, `1 new assignment: “${task}”`), [
        cardAction('ask', tr('¿Lo vemos juntos?', 'Shall we look at it together?'), { prominent: true, value: tr(`Cuéntame qué piden en «${task}» y ayúdame a organizarme.`, `Tell me what “${task}” asks and help me get organized.`) }),
        cardAction('openURL', tr('Abrir en la plataforma', 'Open on the platform'), { value: 'https://canvas.example.edu/courses/7/assignments/4' }),
        cardAction('openAutomation', tr('Ver la automatización', 'See the automation'), { value: canvas.id })
      ], { facts: [{ label: tr('Asignación', 'Assignment'), value: task + tr(` · el jueves a las ${due}`, ` · Thursday at ${due}`) }] })],
      tr('Automatización: Revisar Canvas', 'Automation: Check Canvas'), 'automation'), { priority: 2, course: 'MATH 101', automationID: canvas.id }),
    entry('reminder', tr(`Entrega mañana a las ${due}: Ensayo de inglés`, `Due tomorrow at ${due}: English essay`), message(
      tr(`**Mañana a las ${due}** vence la entrega «Ensayo de inglés» (ENG 102). ¿La preparamos juntos? Te ayudo a entender lo que piden y a organizarla paso a paso.\n\n_Te ayudo a entenderla y a organizarte; la entrega la escribes y la envías tú._`, `**Tomorrow at ${due}** the assignment “English essay” (ENG 102) is due. Shall we prepare it together?\n\n_I help you understand it and get organized; you write and submit it yourself._`),
      t(2.5), [actionsCard(tr('Ensayo de inglés', 'English essay'), [
        cardAction('ask', tr('¿Lo hacemos juntos?', 'Shall we do it together?'), { prominent: true, value: tr('Ayúdame a preparar el ensayo de inglés.', 'Help me prepare the English essay.') }),
        cardAction('openCalendar', tr('Ver en el calendario', 'See in the calendar'))
      ], { detail: 'ENG 102' })], tr('Recordatorio', 'Reminder'), 'reminder'), { priority: 2, course: 'ENG 102', automationID: 'routine-deadlineReminders' }),
    entry('summary', tr('Buenos días: tu plan de hoy', "Good morning: today's plan"), message(
      tr(`¡Buenos días! Esto es lo de hoy:\n\n- **Clases de hoy:** Trigonometría (${klass})\n- **Vence pronto:** «Ensayo de inglés» mañana a las ${due}\n- **Para hoy:** Trigonometría: repasar identidades (15 min)`, `Good morning! Here's today:\n\n- **Today's classes:** Trigonometry (${klass})\n- **Due soon:** “English essay” tomorrow at ${due}\n- **For today:** Trigonometry: review identities (15 min)`),
      t(4), [actionsCard(tr('Tu día', 'Your day'), [cardAction('openToday', tr('Empezar el plan de hoy', "Start today's plan"), { prominent: true }), cardAction('openCalendar', tr('Ver el calendario', 'See the calendar'))])],
      tr('Rutina de la mañana', 'Morning routine'), 'routine'), { read: true, priority: 0, automationID: 'routine-morningBrief' }),
    entry('offer', tr('¿Preparo «Parcial de Química»?', 'Shall I prepare “Chemistry midterm”?'), message(
      tr(`Se acerca «Parcial de Química» (CHEM 110), el ${longDay(now + 9 * 24 * HOUR, tz)} (en 9 días), y aún no tienes un curso para prepararlo. ¿Lo preparo? Busco en tu plataforma lo que entra y te armo lecciones, práctica y un simulacro.`, `“Chemistry midterm” (CHEM 110) is coming up on ${midterm} (in 9 days), and you don't have a course for it yet. Shall I prepare it?`),
      t(26), [actionsCard(tr('¿Preparo «Parcial de Química»?', 'Shall I prepare “Chemistry midterm”?'), [
        cardAction('prepareCourse', tr('Preparar el curso', 'Prepare the course'), { prominent: true, value: 'platform:demo:quimica' }),
        cardAction('neverForEvent', tr('Ahora no', 'Not now'), { value: 'platform:demo:quimica' })
      ], { detail: 'CHEM 110' })], tr('Se acerca un examen', 'An exam is coming up'), 'routine'), { course: 'CHEM 110', automationID: 'routine-examOffers' }),
    entry('problem', tr('Inicia sesión otra vez en Canvas', 'Sign in again to Canvas'), message(
      tr('La sesión de Aula en Canvas caducó y no pude revisarlo. Aula nunca inicia sesión por su cuenta: hazlo tú en su ventana y vuelvo a mirar.', "Aula's session on Canvas expired and I couldn't check it. Aula never signs in on its own: do it in its window and I'll look again."),
      t(30), [actionsCard(tr('Inicia sesión otra vez en Canvas', 'Sign in again to Canvas'), [cardAction('signIn', tr('Iniciar sesión', 'Sign in'), { prominent: true }), cardAction('runAutomation', tr('Volver a revisar', 'Check again'), { value: canvas.id })])],
      tr('Automatización: Revisar Canvas', 'Automation: Check Canvas'), 'automation'), { read: true, automationID: canvas.id }),
    entry('followup', tr('¿Subió las diapositivas de la clase?', 'Did the slides get posted?'), message(
      tr('Ya están las diapositivas de la clase del lunes («Ley de senos y cosenos»). Te dejé 3 ideas clave y dos preguntas para comprobarlo.', "The slides from Monday's class are up (“Law of sines and cosines”). I left you 3 key ideas and two quick check questions."),
      t(70), [], tr('Seguimiento de Aula: ¿Subió las diapositivas?', 'Aula follow-up: Slides posted?'), 'followup'), { read: true, course: 'MATH 101' }),
    entry('automation', tr('Revisar Canvas: nada nuevo', 'Check Canvas: nothing new'), message(tr('Nada nuevo en Canvas desde ayer.', 'Nothing new on Canvas since yesterday.'), t(150), [], tr('Automatización: Revisar Canvas', 'Automation: Check Canvas'), 'automation'), { read: true, automationID: canvas.id }),
    entry('system', tr('Presupuesto de hoy usado', "Today's budget used"), message(tr('Hoy ya usé el presupuesto que pusiste para lo que hago sola. Lo urgente sigue llegando; lo demás vuelve mañana.', 'Today I used the budget you set. Urgent things keep coming; the rest comes back tomorrow.'), t(5), [], 'Aula', 'system'), { read: true, snoozedUntil: now + 5 * HOUR })
  ]
  center.importDemo(entries, [canvas, semester])
  if (center.store.recentRuns(1).length) return
  const run = (a: Automation, hoursAgo: number, outcome: AutomationRun['outcome'], summary: string, extra: Partial<AutomationRun> = {}): AutomationRun => ({
    id: 'run-' + IDs.short(8), automationID: a.id, title: a.title, trigger: 'scheduled', started: new Date(t(hoursAgo)).toISOString(), finished: new Date(t(hoursAgo) + 40_000).toISOString(),
    outcome, summary, newItems: [], changedItems: [], knownCount: 4, tokens: 5200, tokensEstimated: false, notified: outcome === 'news', created: [], skippedActions: [], provider: 'Claude', ...extra
  })
  center.store.record(run(canvas, 150, 'nothingNew', tr('Nada nuevo en Canvas desde ayer.', 'Nothing new on Canvas since yesterday.')))
  center.store.record(run(canvas, 30, 'needsSignIn', tr('No pude entrar en Canvas: la sesión caducó.', "I couldn't get into Canvas: the session expired."), { signIn: 'Canvas' }))
  center.store.record(run(semester, 9, 'nothingNew', tr('Aún no están las asignaciones del nuevo semestre.', "The new semester's assignments aren't up yet.")))
  center.store.record(run(canvas, 1.2, 'news', tr(`Hay una **tarea nueva** en MATH 101: «${task}».`, `There's a **new assignment** in MATH 101: “${task}”.`), { newItems: [{ key: 'demo-4', title: task, kind: 'assignment', course: 'MATH 101', fresh: true }], skippedActions: [tr('Pulsar «Entregar tarea»', 'Press “Submit assignment”')] }))
}
