// A2-P1-5 y A2-P2-11: el navegador de plataformas de verdad solo lee. Reproduce las pruebas del juez A2 (`ai/policy.test.ts`):
// los clics que antes salían sin preguntar (votar, asistencia, reservas, prórrogas, valorar, fijar, favoritos, actualizar, ocultar)
// y las peticiones de fondo que pasaban la guarda (marcar un módulo como hecho, el planificador, los ajustes, editar un mensaje
// propio del foro, Moodle) ya no funcionan; la lectura normal (pestañas, ver más, consultas, el inicio de sesión) sigue igual.
import { describe, expect, it } from 'vitest'
import { classifyLabel } from './danger'
import { clickPolicy, guardRequest, isReadOnlyRequest, type PageElement } from './page'

const canvas = { kind: 'canvas' as const, baseURL: 'https://school.instructure.com' }
const moodle = { kind: 'moodle' as const, baseURL: 'https://campus.uni.edu' }
const classroom = { kind: 'classroom' as const, baseURL: 'https://classroom.google.com' }
const ctx = { pageURL: 'https://school.instructure.com/courses/1/modules', account: canvas }

function button(p: Partial<PageElement>): PageElement {
  return { ref: 'e1', tag: 'button', role: 'button', label: '', type: '', href: '', submits: false, formAction: '', formMethod: '', inPasswordForm: false, disabled: false, newWindow: false, expanded: null, sensitive: false, ...p }
}
const click = (label: string, p: Partial<PageElement> = {}) => clickPolicy(button({ label, ...p }), ctx)

describe('A2-P1-5 · clics que cambian algo', () => {
  it('lo que el juez pulsó sin preguntar: ahora nunca (en español y en inglés)', () => {
    for (const label of ['Rate', 'Pin', 'Add to favorites', 'Update', 'Actualizar', 'Hide', 'Ocultar', 'Request extension', 'Solicitar prórroga',
      'Book a slot', 'Reservar', 'Vote', 'Votar', 'Confirm attendance', 'Confirmar asistencia', 'Check in', 'Registrar asistencia']) {
      expect(click(label), label).toMatchObject({ decision: 'block', category: 'modify' })
    }
  })

  it('la lista completa del juez: ninguno se pulsa sin preguntar', () => {
    const labels = ['Mark as done', 'Marcar como hecho', 'Marcar como completado', 'Mark as complete', 'Subscribe', 'Suscribirse', 'Unsubscribe', 'Like', 'Me gusta',
      'Rate', 'Accept invitation', 'Aceptar invitación', 'Join group', 'Unirse al grupo', 'Enroll me', 'Matricularme', 'Dismiss', 'Pin', 'Add to favorites',
      'Turn on notifications', 'Change language', 'Save', 'Guardar', 'Guardar cambios', 'Save changes', 'Update', 'Actualizar', 'Reset', 'Restablecer',
      'Leave group', 'Abandonar grupo', 'Remove from dashboard', 'Hide', 'Ocultar', 'Mark all as read', 'Request extension', 'Solicitar prórroga',
      'Book a slot', 'Reservar', 'Sign up', 'Inscribirse', 'Vote', 'Votar', 'Confirm attendance', 'Confirmar asistencia', 'Check in', 'Registrar asistencia']
    for (const label of labels) expect(click(label).decision, label).toBe('block')
  })

  it('en los demás idiomas', () => {
    for (const label of ['Votar', 'Confirmar presença', 'Voter', 'Demander une prolongation', 'Abstimmen', 'Anwesenheit bestätigen', 'Prenota', 'Richiedi proroga',
      'Проголосовать', 'Подтвердить присутствие', 'تأكيد الحضور', 'उपस्थिति दर्ज करें', '投票', '申请延期', '签到', '出席を確認', '予約する', '투표하기', '출석 체크', '연장 신청']) {
      expect(click(label), label).toMatchObject({ decision: 'block' })
    }
  })

  it('un botón que Aula no conoce pide permiso (antes: se pulsaba)', () => {
    expect(click('Frobnicate')).toMatchObject({ decision: 'ask', category: 'action' })
    expect(click('Sí')).toMatchObject({ decision: 'ask', category: 'action' })
  })

  it('lo que solo enseña algo se sigue pulsando sin preguntar', () => {
    for (const label of ['Next', 'Siguiente', 'Anterior', 'Ver más', 'Show more posts', 'Load more', 'Expand all', 'Contraer todo', 'Buscar', 'Filtrar', 'Cerrar',
      'Cancelar', '2', 'Página 3', 'Download', 'Descargar', '下一页', '더 보기']) {
      expect(click(label), label).toEqual({ decision: 'allow' })
    }
    // pestañas y desplegables, aunque su etiqueta suene a cambio
    expect(click('Hide details', { expanded: 'true' })).toEqual({ decision: 'allow' })
    expect(click('Calificaciones', { role: 'tab' })).toEqual({ decision: 'allow' })
    expect(clickPolicy(button({ tag: 'summary', label: 'Tema 2' }), ctx)).toEqual({ decision: 'allow' })
    // los enlaces de la plataforma, igual que antes
    expect(clickPolicy(button({ tag: 'a', role: 'link', label: 'Módulo 2', href: 'https://school.instructure.com/courses/1/modules/2' }), ctx)).toEqual({ decision: 'allow' })
    // pero una pestaña «Entregar» sigue sin pulsarse
    expect(click('Submit assignment', { role: 'tab' }).decision).toBe('block')
  })

  it('un formulario POST no se envía ni aprobándolo', () => {
    expect(click('Go', { submits: true, formAction: 'https://school.instructure.com/x', formMethod: 'post' })).toMatchObject({ decision: 'block', category: 'form' })
    expect(click('Buscar', { submits: true, formAction: 'https://school.instructure.com/search', formMethod: 'get' })).toEqual({ decision: 'allow' })
  })
})

describe('A2-P1-5 · peticiones de fondo a la plataforma', () => {
  const xhr = (method: string, url: string, body?: string, account = url.includes('instructure') ? canvas : url.includes('classroom') ? classroom : moodle) =>
    guardRequest({ url, method, resourceType: 'xhr', account, kind: account.kind, body })

  it('lo que el juez vio pasar: ahora se corta', () => {
    expect(xhr('PUT', 'https://school.instructure.com/api/v1/courses/1/modules/2/items/3/done')).toBe(false)
    expect(xhr('POST', 'https://school.instructure.com/api/v1/planner/overrides', '{"plannable_type":"assignment","plannable_id":5,"marked_complete":true}')).toBe(false)
    expect(xhr('PUT', 'https://school.instructure.com/api/v1/users/self/settings', '{"manual_mark_as_read":true}')).toBe(false)
    expect(xhr('PUT', 'https://school.instructure.com/api/v1/users/self/communication_channels/1/notification_preferences/x')).toBe(false)
    expect(xhr('POST', 'https://school.instructure.com/api/v1/users/self/favorites/courses/1')).toBe(false)
    expect(xhr('PUT', 'https://school.instructure.com/api/v1/courses/1/discussion_topics/2/subscribed')).toBe(false)
    expect(xhr('POST', 'https://school.instructure.com/api/graphql', '{"operationName":"UpdateDiscussionEntry","query":"mutation UpdateDiscussionEntry($id:ID!,$message:String){updateDiscussionEntry(input:{discussionEntryId:$id,message:$message}){discussionEntry{id}}}"}')).toBe(false)
    expect(xhr('POST', 'https://school.instructure.com/api/graphql', '{"operationName":"SetModuleItemCompletion","query":"mutation SetModuleItemCompletion{setModuleItemCompletion(input:{}){moduleItem{id}}}"}')).toBe(false)
    expect(xhr('POST', 'https://campus.uni.edu/lib/ajax/service.php?sesskey=x&info=core_completion_update_activity_completion_status_manually', '[{"index":0,"methodname":"core_completion_update_activity_completion_status_manually","args":{"cmid":1,"completed":true}}]')).toBe(false)
    expect(xhr('POST', 'https://campus.uni.edu/lib/ajax/service.php?sesskey=x&info=core_user_update_user_preferences', '[{"index":0,"methodname":"core_user_update_user_preferences"}]')).toBe(false)
    expect(xhr('POST', 'https://campus.uni.edu/lib/ajax/service.php?sesskey=x&info=mod_forum_toggle_favourite_state', '[{"index":0,"methodname":"mod_forum_toggle_favourite_state"}]')).toBe(false)
  })

  it('A2-P2-11: ni con la barra final ni con una consulta guardada sin texto', () => {
    const create = '{"operationName":"CreateDiscussionEntry","query":"mutation CreateDiscussionEntry{createDiscussionEntry(input:{}){discussionEntry{id}}}"}'
    expect(xhr('POST', 'https://school.instructure.com/api/graphql/', create)).toBe(false)
    expect(xhr('POST', 'https://school.instructure.com/api/graphql', '{"operationName":"CreateDiscussionEntry","variables":{},"extensions":{"persistedQuery":{"version":1,"sha256Hash":"abc"}}}')).toBe(false)
    expect(xhr('POST', 'https://school.instructure.com/api/graphql', '{"operationName":"GetCourseModules","variables":{},"extensions":{"persistedQuery":{"version":1,"sha256Hash":"abc"}}}')).toBe(true)
  })

  it('cualquier otro PUT/POST/PATCH/DELETE que no sea claramente de lectura, también (Google Classroom incluido)', () => {
    expect(xhr('POST', 'https://classroom.google.com/_/ClassroomUi/data/batchexecute?rpcids=x', 'f.req=...')).toBe(false)
    expect(xhr('PATCH', 'https://school.instructure.com/api/v1/anything')).toBe(false)
    expect(xhr('DELETE', 'https://school.instructure.com/api/v1/courses/1/discussion_topics/2/entries/9/read')).toBe(false)
    expect(xhr('POST', 'https://school.instructure.com/courses/1/modules/items/3/mark_as_done')).toBe(false)
    expect(guardRequest({ url: 'https://school.instructure.com/api/v1/x', method: 'POST', resourceType: 'ping', account: canvas })).toBe(false)
  })

  it('la lectura normal sigue pasando: consultas, Moodle de lectura, búsquedas, marcar como leído, telemetría y otros sitios', () => {
    expect(xhr('GET', 'https://school.instructure.com/api/v1/courses/1/modules')).toBe(true)
    expect(xhr('POST', 'https://school.instructure.com/api/graphql', '{"query":"query GetCourse { course(id: 1) { name } }"}')).toBe(true)
    expect(xhr('POST', 'https://school.instructure.com/api/graphql', '[{"operationName":"A","query":"query A { a }"},{"operationName":"B","query":"query B { b }"}]')).toBe(true)
    expect(xhr('POST', 'https://school.instructure.com/api/graphql', '{"operationName":"UpdateDiscussionReadState","query":"mutation UpdateDiscussionReadState { updateDiscussionReadState(input: {read: true}) { discussionTopic { id } } }"}')).toBe(true)
    expect(xhr('POST', 'https://campus.uni.edu/lib/ajax/service.php?sesskey=x&info=core_course_get_enrolled_courses_by_timeline_classification,core_fetch_notifications')).toBe(true)
    expect(xhr('POST', 'https://campus.uni.edu/lib/ajax/service.php?sesskey=x&info=core_session_touch')).toBe(true)
    expect(xhr('PUT', 'https://school.instructure.com/api/v1/courses/1/discussion_topics/5/entries/9/read')).toBe(true)
    expect(xhr('POST', 'https://school.instructure.com/page_views/abc')).toBe(true)
    expect(xhr('POST', 'https://www.google-analytics.com/g/collect')).toBe(true)
    expect(isReadOnlyRequest({ url: 'https://graph.microsoft.com/v1.0/$batch', method: 'POST', body: '{"requests":[{"id":"1","method":"GET","url":"/me"}]}' })).toBe(true)
    expect(isReadOnlyRequest({ url: 'https://graph.microsoft.com/v1.0/$batch', method: 'POST', body: '{"requests":[{"id":"1","method":"PATCH","url":"/me"}]}' })).toBe(false)
  })

  it('salvo el propio inicio de sesión (SSO, servidor de identidad, tokens)', () => {
    expect(xhr('POST', 'https://school.instructure.com/login/saml')).toBe(true)
    expect(xhr('POST', 'https://login.microsoftonline.com/common/GetCredentialType')).toBe(true)
    expect(xhr('POST', 'https://lms.uni.edu/d2l/lp/auth/oauth2/token', '', { kind: 'brightspace' as never, baseURL: 'https://lms.uni.edu' } as never)).toBe(true)
    expect(guardRequest({ url: 'https://idp.uni.edu/idp/profile/SAML2/POST/SSO', method: 'POST', resourceType: 'mainFrame', account: canvas })).toBe(true)
  })
})

describe('A2-P2-11 · trucos de texto en las etiquetas', () => {
  it('espacio de anchura cero, letra cirílica y letras separadas ya no esconden «Submit»', () => {
    expect(classifyLabel('Sub\u200bmit')?.category).toBe('submit')
    expect(classifyLabel('\u0405ubmit')?.category).toBe('submit')
    expect(classifyLabel('S u b m i t')?.category).toBe('submit')
    expect(classifyLabel('\uff33\uff55\uff42\uff4d\uff49\uff54')?.category).toBe('submit')
    expect(classifyLabel('En\u00adtregar')?.category).toBe('submit')
    // el ruso de verdad sigue funcionando
    expect(classifyLabel('Отправить сообщение')?.category).toBe('message')
  })
})
