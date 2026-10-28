// Energía: el proceso principal le cuenta a la interfaz si la ventana se ve, para que lo ambiental (tarjetas que flotan,
// la luz tras el cristal, el reposo del pixel art…) se quede quieto cuando nadie lo mira. En macOS la página sigue
// «visible» (rAF a 120 fps) aunque la ventana esté minimizada u oculta en la bandeja: Chromium no la frena sola.

declare module './contract' {
  interface RpcMethods {
    /** El estado de ahora (al arrancar la interfaz, que pudo perderse los avisos). */
    'app.powerState': { args: void; result: PowerState }
  }
  interface RpcEvents {
    /** Cambió la ventana (foco, minimizada, oculta), la pantalla se bloqueó o cambió la batería. */
    'app.power': PowerState
  }
}

/** ¿Hace falta un aviso del sistema para que el estudiante se entere? Sí, salvo con la ventana a la vista, con el foco y la
 *  pantalla sin bloquear (entonces ya lo ve dentro de la app). */
export function noticeNeeded(s: Pick<PowerState, 'window' | 'locked'>): boolean {
  return s.locked || s.window !== 'active'
}

/** active: a la vista y con el foco; inactive: a la vista, sin foco; minimized; hidden (oculta en la bandeja o con Cmd+H). */
export type WindowPresence = 'active' | 'inactive' | 'minimized' | 'hidden'

export interface PowerState {
  window: WindowPresence
  /** Pantalla bloqueada, equipo en reposo o sesión del usuario en segundo plano. */
  locked: boolean
  /** Con batería (no enchufado): lo ambiental se duerme antes. */
  battery: boolean
  /** Solo en desarrollo (capturas y vídeos con la ventana oculta, o AULA_AMBIENT=run): todo se mueve siempre. */
  pinned?: boolean
}
