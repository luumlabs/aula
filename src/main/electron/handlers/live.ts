// IPC del navegador de Aula en vivo (browser/live.ts): abrirlo, verlo, manejarlo, pasar el turno y confirmar un inicio de
// sesión hecho en él. Lo usan la ventana del Mac y los dispositivos del estudiante; desde un dispositivo solo llega a sus
// plataformas y su inicio de sesión (engine/live/reach.ts), así que cada orden dice quién la da.
import { app } from 'electron'
import { invalidArgs } from '@main/services/errors'
import { tr } from '@shared/ai/i18n'
import { handle, emit, type RpcContext } from '../rpc'
import { platformBrowser } from '../browser'
import { LiveBrowser, type LiveDriver } from '../browser/live'

let instance: LiveBrowser | null = null

/** Las ventanas en vivo (una sola instancia; avisa a la interfaz de cada cambio). */
export function liveBrowser(): LiveBrowser {
  instance ??= new LiveBrowser({
    changed: (state) => emit('live.changed', state),
    closed: (id) => emit('live.closed', { id }),
    focus: (focus) => emit('live.focus', focus),
    fields: (fields) => emit('live.fields', fields)
  })
  return instance
}

/** Quién maneja: la ventana del ordenador o un dispositivo (iPhone, iPad, Android; también un propietario de un servidor). */
const driverOf = (ctx: RpcContext | undefined): LiveDriver => (ctx?.remote ? 'device' : 'window')

const idOf = (args: { id?: unknown } | null | undefined): string => {
  if (typeof args?.id !== 'string' || !/^live-[\w-]{1,80}$/.test(args.id)) throw invalidArgs(tr('Ventana no válida', 'Invalid window'))
  return args.id
}

export function register(): void {
  const live = liveBrowser()
  handle('live.open', (args, ctx) => {
    const accountId = typeof args?.accountId === 'string' && args.accountId ? args.accountId : null
    const purpose = args?.purpose === 'signin' || args?.purpose === 'task' || args?.purpose === 'browse' ? args.purpose : undefined
    // quien lo abre desde la interfaz es el estudiante: el turno es suyo
    return live.open({ accountId, url: typeof args?.url === 'string' ? args.url : undefined, purpose, holder: 'student', via: driverOf(ctx) })
  })
  handle('live.state', (args) => live.state(idOf(args)))
  handle('live.list', () => live.list())
  handle('live.frame', (args, ctx) => live.frame(idOf(args), args?.after, args?.maxWidth, driverOf(ctx)))
  handle('live.input', (args, ctx) => live.input(idOf(args), args?.controlId, args?.events, driverOf(ctx)))
  handle('live.navigate', (args, ctx) => live.navigate(idOf(args), args?.controlId, args?.action, args?.url, driverOf(ctx)))
  // mirar o pasarle el turno a Aula no es manejar: no cambian quién conduce
  handle('live.viewport', (args) => live.viewport(idOf(args), args?.width, args?.height))
  handle('live.take', (args, ctx) => live.hold(idOf(args), 'student', undefined, driverOf(ctx)))
  handle('live.give', (args) => live.hold(idOf(args), 'aula'))
  handle('live.close', (args) => live.close(idOf(args)))
  handle('live.confirmSignIn', async (args) => {
    const state = live.state(idOf(args))
    if (!state?.accountId) return { signedIn: false, account: null }
    const r = await platformBrowser().confirmSignIn(state.accountId)
    return { signedIn: r.signedIn, account: r.account }
  })
  app.on('before-quit', () => live.shutdown())
}
