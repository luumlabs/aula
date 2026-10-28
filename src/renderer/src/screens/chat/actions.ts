// Lo que las tarjetas de un mensaje pueden pedir a la conversación que las contiene (el chat o el tutor del estudio): escribirle a
// Aula («Explícame mi error» de un cuestionario). Sin proveedor (vistas previas), no se ofrece.
import { createContext, useContext } from 'react'

export interface ChatActions {
  /** Envía un mensaje del estudiante en esta conversación (a la cola si Aula está respondiendo). */
  ask: (text: string) => void
}

export const ChatActionsContext = createContext<ChatActions | null>(null)

export const useChatActions = (): ChatActions | null => useContext(ChatActionsContext)
