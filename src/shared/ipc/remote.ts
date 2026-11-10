// Usar Aula desde el iPad o el iPhone del estudiante, con todo (cursos, IA, datos) en su Mac. Los dispositivos llegan por la
// red privada de Tailscale del propio estudiante; cada uno se vincula una vez con un código que enseña Aula en el Mac.
export interface RemoteDeviceInfo {
  id: string
  name: string
  /** ipad, iphone o web. */
  platform: string
  created: string
  lastSeen: string
}

/** La red privada: unavailable = esta instalación no trae el componente de Tailscale. */
export type TailnetState = 'unavailable' | 'off' | 'starting' | 'needsLogin' | 'needsApproval' | 'running' | 'error'

export interface RemoteStatus {
  enabled: boolean
  /** La dirección en este mismo Mac (para probar sin red privada). */
  localURL?: string
  tailnet: {
    state: TailnetState
    /** Página de Tailscale donde iniciar sesión (con `needsLogin`). */
    authURL?: string
    /** Nombre del Mac en la red privada («aula-mac»). */
    name?: string
    /** La cuenta de Tailscale con la que entró. */
    user?: string
    message?: string
  }
  /** La dirección que abren los dispositivos («http://aula-mac»), cuando la red privada está en marcha. */
  deviceURL?: string
  devices: RemoteDeviceInfo[]
  /** Un código esperando a que un dispositivo lo use. */
  pairing?: { code: string; expires: string }
  /** Dispositivos conectados ahora mismo. */
  connected: number
}

declare module './contract' {
  interface RpcMethods {
    'remote.status': { args: void; result: RemoteStatus }
    'remote.setEnabled': { args: { enabled: boolean }; result: RemoteStatus }
    /** Enseña un código de un solo uso (10 minutos) para vincular un dispositivo. */
    'remote.startPairing': { args: void; result: RemoteStatus }
    'remote.cancelPairing': { args: void; result: RemoteStatus }
    'remote.revoke': { args: { id: string }; result: RemoteStatus }
    /** Abre en el navegador la página para iniciar sesión en Tailscale. */
    'remote.tailnetLogin': { args: void; result: RemoteStatus }
    'remote.tailnetLogout': { args: void; result: RemoteStatus }
  }
  interface RpcEvents {
    'remote.changed': RemoteStatus
  }
}
