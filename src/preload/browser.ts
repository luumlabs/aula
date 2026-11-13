// Preload del navegador de plataformas: NO expone nada a las páginas.
// - Pestañas de lectura ocultas (`--aula-reader`): se apagan los diálogos de JavaScript (alert/confirm/prompt/print), que en
//   una ventana que nadie ve bloquearían la página o aparecerían de golpe al estudiante.
// - Pestañas de lectura, ventana de inicio de sesión (`--aula-signin`) y ventana «en vivo» (`--aula-live`, también para
//   iniciar sesión desde el iPhone, el iPad o Android): guarda de las llaves de acceso (WebAuthn), para que una petición de
//   passkey no deje la página esperando para siempre (ver webauthn-guard.ts).
import { contextBridge } from 'electron'
import { installWebAuthnGuard, webAuthnCapMs, webAuthnNativeUI, type WebAuthnWindow } from './webauthn-guard'

const reader = process.argv.includes('--aula-reader')
const signIn = process.argv.includes('--aula-signin')
const live = process.argv.includes('--aula-live')

if (reader) {
  try {
    contextBridge.executeInMainWorld({
      func: () => {
        const w = globalThis as unknown as Record<string, unknown>
        w.alert = () => undefined
        w.confirm = () => false
        w.prompt = () => null
        w.print = () => undefined
      }
    })
  } catch {
    // sin la API (versión antigua): los diálogos siguen como siempre
  }
}

const where: WebAuthnWindow | null = reader ? 'reader' : live ? 'live' : signIn ? 'signin' : null

if (where) {
  try {
    // se serializa: la función va sola y recibe sus datos como argumentos (null = el objeto global de la página)
    contextBridge.executeInMainWorld({
      func: installWebAuthnGuard,
      args: [null, { noNativeUI: !webAuthnNativeUI(process.platform, where), capMs: webAuthnCapMs(process.platform, where) }]
    })
  } catch {
    // sin la API: las llaves de acceso se quedan como en Electron
  }
}

export {}
