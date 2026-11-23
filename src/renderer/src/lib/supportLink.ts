// ¿Se enseña «Apoya a Aula» (Ajustes → Acerca de, con su botón a GitHub Sponsors)? En el ordenador y en un navegador, sí.
// Dentro de una app nativa (window.aulaApp), solo si ella lo dice con supportLink(): la del iPhone y el iPad, solo con la
// tienda de Estados Unidos (guía 3.1.1(a) del App Store: native/ios/Aula/SupportLink.swift); la de Android, siempre. Una
// app que no lo dice (una versión anterior) no lo enseña. La regla es pura (supportLink.test.ts); el gancho la aplica.
import { useSyncExternalStore } from 'react'

export const SPONSORS_URL = 'https://github.com/sponsors/luumlabs'

/** La app nativa avisa así de que cambió lo que ofrece (iOS: otra tienda) y la interfaz vuelve a mirar. */
export const APP_BRIDGE_EVENT = 'aula:app'

/** Ayuda → «Apoyar a Aula…» con Ajustes ya en ese apartado: la ruta no cambia, así que se avisa a la pantalla para que
 *  vuelva a bajar hasta él (AppCommands.tsx → screens/settings). */
export const SUPPORT_AGAIN_EVENT = 'aula:support-again'

/** `bridge`: window.aulaApp tal cual (undefined fuera de las apps nativas). */
export function showsSupportLink(bridge: unknown): boolean {
  // sin app nativa: la ventana del ordenador o un navegador
  if (bridge === undefined || bridge === null) return true
  if (typeof bridge !== 'object') return false
  const app = bridge as { supportLink?: unknown }
  if (typeof app.supportLink !== 'function') return false
  try {
    // como método: en Android el objeto lo pone addJavascriptInterface y no admite llamadas sueltas
    return (app as { supportLink: () => unknown }).supportLink() === true
  } catch {
    return false
  }
}

function subscribe(changed: () => void): () => void {
  window.addEventListener(APP_BRIDGE_EVENT, changed)
  return () => window.removeEventListener(APP_BRIDGE_EVENT, changed)
}

const snapshot = (): boolean => showsSupportLink((window as { aulaApp?: unknown }).aulaApp)

/** Lo de arriba para esta página; cambia en cuanto la app avisa con 'aula:app'. */
export function useSupportLink(): boolean {
  return useSyncExternalStore(subscribe, snapshot)
}
