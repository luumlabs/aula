// Quién está cambiando cosas (port de StudyModel/History/ChangeContext.swift).
//
// Las escrituras de cursos, calendario y memoria solo se apuntan en el historial cuando las hace Aula (el chat, el tutor, la
// tubería de crear cursos, una automatización…). Quien trabaja lo dice alrededor de su trabajo:
//
//     await ChangeContext.run(ChangeContext.newActor('chat', 'Añade ejercicios de…'), () => turno())
//
// y todo lo que se llame dentro (también tras `await`) lo hereda. Los ayudantes MCP (otro proceso) lo reciben por el entorno
// (`ChangeContext.environment(actor)`). Lo que hace el estudiante a mano no lleva actor: no se apunta (y deshacer nunca lo pisa).
import { tr } from '@shared/ai/i18n'
import { AsyncLocalStorage } from 'node:async_hooks'
import { IDs } from '@engine/base/ids'
import { CHANGE_ACTOR_KINDS, type ChangeActor, type ChangeActorKind } from '@shared/schema/history'

interface Scope {
  actor?: ChangeActor
  suppressed?: boolean
}

const als = new AsyncLocalStorage<Scope>()
const ENV_KEY = 'AULA_CHANGE_ACTOR'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function normalizeActor(raw: unknown): ChangeActor | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if (typeof o.group !== 'string' || typeof o.label !== 'string') return undefined
  const kind = (CHANGE_ACTOR_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as ChangeActorKind) : 'other'
  const actor: ChangeActor = { kind, group: o.group, label: Array.from(o.label).slice(0, 300).join('') }
  if (typeof o.courseID === 'string') actor.courseID = o.courseID
  return actor
}

let envActorCache: { raw: string | undefined; actor: ChangeActor | undefined } | null = null

export const ChangeContext = {
  /** Variable de entorno con la que un proceso ayudante (MCP) sabe a quién atribuir lo que escribe. */
  environmentKey: ENV_KEY,

  /** Un actor con un grupo nuevo y único («chat-20261013-101500-k3f9»). */
  newActor(kind: ChangeActorKind, label: string, courseID?: string, now: Date = new Date()): ChangeActor {
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const actor: ChangeActor = { kind, group: `${kind}-${stamp}-${IDs.short(4)}`, label: Array.from(label).slice(0, 300).join('') }
    if (courseID !== undefined) actor.courseID = courseID
    return actor
  },

  /** Ejecuta `fn` (y todo lo que llame, también asíncrono) en nombre de `actor`. */
  run<T>(actor: ChangeActor | undefined, fn: () => T): T {
    return als.run({ ...als.getStore(), actor }, fn)
  },

  /** Lo que se escriba dentro no es un cambio de contenido (contadores, marcas internas): no se apunta. */
  suppress<T>(fn: () => T): T {
    return als.run({ ...als.getStore(), suppressed: true }, fn)
  },

  /** El actor en vigor: el de la tarea o, si no hay, el del entorno del proceso (ayudantes MCP). */
  get current(): ChangeActor | undefined {
    const scope = als.getStore()
    if (scope?.suppressed) return undefined
    return scope?.actor ?? ChangeContext.environmentActor
  },

  /** El actor que viene en el entorno del proceso (ayudante MCP), si lo hay. */
  get environmentActor(): ChangeActor | undefined {
    const raw = process.env[ENV_KEY]
    if (!envActorCache || envActorCache.raw !== raw) envActorCache = { raw, actor: ChangeContext.decode({ [ENV_KEY]: raw }) }
    return envActorCache.actor
  },

  /** Entorno para un proceso ayudante que escribirá en nombre de `actor`. */
  environment(actor: ChangeActor | undefined): Record<string, string> {
    if (!actor) return {}
    return { [ENV_KEY]: Buffer.from(JSON.stringify(actor), 'utf8').toString('base64') }
  },

  decode(env: Record<string, string | undefined>): ChangeActor | undefined {
    const raw = env[ENV_KEY]
    if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return undefined
    try {
      return normalizeActor(JSON.parse(Buffer.from(raw, 'base64').toString('utf8')))
    } catch {
      return undefined
    }
  }
}

/** Título de quién hizo el cambio (para la lista). */
export function actorKindTitle(kind: ChangeActorKind): string {
  switch (kind) {
    case 'chat': return tr('Chat con Aula', 'Chat with Aula')
    case 'tutor': return tr('Tutor', 'Tutor')
    case 'pipeline': return tr('Crear o cambiar el curso', 'Create or change the course')
    case 'automation': return tr('Lo que Aula hace sola', 'What Aula does on its own')
    case 'memory': return tr('Memoria', 'Memory')
    case 'undo': return tr('Deshacer', 'Undo')
    default: return 'Aula'
  }
}
