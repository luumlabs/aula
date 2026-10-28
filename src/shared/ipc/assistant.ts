// Contrato del chat con Aula y del tutor (lo implementa src/main/services/assistant).
// Mientras Aula responde, el proceso principal emite 'chat.message' con el mensaje completo (cada ~60 ms como mucho):
// la interfaz simplemente lo sustituye. Así el texto que va llegando, los pasos y las tarjetas viajan juntos.
// Lo que se escribe mientras responde espera en una cola del proceso principal ('chat.queue' la cuenta entera cada vez que cambia).
import type {
  AssistantCitation, AssistantMessage, AssistantNavigateTarget, AssistantRef, AssistantRunState, AssistantThread, AssistantThreadSummary, TutorContext
} from '../assistant/types'

/** Una conversación tal como la recibe la interfaz: la guardada y, si está respondiendo, lo que solo vive en memoria. */
export type AssistantThreadView = AssistantThread & { run?: AssistantRunState }

declare module './contract' {
  interface RpcMethods {
    'chat.threads': { args: void; result: AssistantThreadSummary[] }
    'chat.thread': { args: { id: string }; result: AssistantThreadView | null }
    'chat.newThread': { args: { context?: TutorContext } | void; result: AssistantThread }
    /** El tutor de un curso: su última conversación (o una nueva, sin guardar hasta el primer mensaje). */
    'chat.tutorThread': { args: { courseID: string }; result: AssistantThreadView }
    /** Envía un mensaje; la respuesta llega por eventos. `attachments` son rutas de archivos elegidos o soltados. `messageId` (opcional):
     * el id del mensaje que ya enseña la interfaz (el optimista); así sus cambios (adjuntos ya leídos) llegan por 'chat.message' y lo
     * sustituyen. Sin él, el mensaje del estudiante no se emite (la interfaz ya lo enseña). `queued`: Aula estaba respondiendo y el
     * mensaje espera en cola (se envía solo al terminar; 'chat.queue' avisa). */
    'chat.send': { args: { threadId: string; text: string; mentions?: AssistantRef[]; attachments?: string[]; context?: TutorContext; messageId?: string }; result: { messageId: string; queued: boolean } }
    /** Detiene SOLO la respuesta en curso: lo que esperaba en cola se envía a continuación. */
    'chat.stop': { args: { threadId: string }; result: void }
    /** Quita un mensaje de la cola (el «×» de la burbuja que espera). `removed` = false si ya se había enviado. */
    'chat.cancelQueued': { args: { threadId: string; messageId: string }; result: { removed: boolean } }
    /** Continúa una respuesta interrumpida (la app se cerró a mitad). */
    'chat.continue': { args: { threadId: string; messageId: string }; result: void }
    /** Responde a una tarjeta: pregunta (optionId o answer), permiso (approve), cuestionario o tarjetas (answer = JSON con
     * `results`, `inputs` y, para guardarlo en una lección, `save: { courseID, skillID }`). */
    'chat.answerCard': { args: { threadId: string; messageId: string; cardId: string; optionId?: string; answer?: string; approve?: boolean }; result: void }
    'chat.renameThread': { args: { id: string; title: string }; result: void }
    'chat.pinThread': { args: { id: string; pinned: boolean }; result: void }
    'chat.deleteThread': { args: { id: string }; result: void }
    /** Sugerencias para empezar según el contexto (curso, lección, ejercicio…). */
    'chat.suggestions': { args: { context?: TutorContext } | void; result: string[] }
    /** Para @menciones: cursos, lecciones, ejercicios, materiales y eventos que coinciden. */
    'chat.mentionSearch': { args: { query: string }; result: AssistantRef[] }
    /** Busca el material de una cita («Apuntes del tema 3», p. 12): en el tutor, su curso primero; después el resto y los adjuntos. */
    'chat.resolveCitation': { args: { threadId?: string; title: string; page?: number }; result: AssistantCitation | null }
  }
  interface RpcEvents {
    'chat.message': { threadId: string; message: AssistantMessage }
    'chat.threads': { changed: true }
    'chat.status': { threadId: string; busy: boolean; label?: string }
    /** La cola de una conversación cambió (entera). `sent`: lo que esperaba acaba de enviarse, en un solo mensaje del estudiante. */
    'chat.queue': { threadId: string; queued: AssistantMessage[]; sent?: AssistantMessage }
    /** Aula pide abrir una pantalla (herramienta `open_screen`): la interfaz navega si quiere. */
    'chat.navigate': { threadId: string; target: AssistantNavigateTarget }
  }
}
export {}
