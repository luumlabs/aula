// Usar Aula desde el iPad, el iPhone o el Android del estudiante, con todo (cursos, IA, datos) en su Mac o en su servidor (Aula
// sin ventana, `--server`). Los dispositivos llegan por la red privada de Tailscale del propio estudiante (la de su cuenta);
// cada uno se vincula una vez con un código que enseña Aula.
export interface RemoteDeviceInfo {
  id: string
  name: string
  /** ipad, iphone, android o web. */
  platform: string
  /** Hace de ventana de Aula como servidor: lleva las claves, las plataformas y los demás dispositivos. */
  owner?: boolean
  created: string
  lastSeen: string
}

/** La red privada: unavailable = esta instalación no trae el componente de Tailscale. */
export type TailnetState = 'unavailable' | 'off' | 'starting' | 'needsLogin' | 'needsApproval' | 'running' | 'error'

export interface RemoteStatus {
  enabled: boolean
  /** Aula como servidor (sin ventana): el acceso a distancia va siempre encendido y se lleva desde un propietario. */
  server?: boolean
  /** La dirección en este mismo Mac (para probar sin red privada). */
  localURL?: string
  tailnet: {
    state: TailnetState
    /** Página de Tailscale donde iniciar sesión (con `needsLogin`). */
    authURL?: string
    /** Nombre del equipo en la red privada («aula-mac», «aula-server»). */
    name?: string
    /** La cuenta de Tailscale con la que entró. */
    user?: string
    message?: string
  }
  /** La dirección que abren los dispositivos («http://aula-mac»), cuando la red privada está en marcha. */
  deviceURL?: string
  devices: RemoteDeviceInfo[]
  /** Un código esperando a que un dispositivo lo use (`owner`: quien lo use será propietario). */
  pairing?: { code: string; expires: string; owner?: boolean }
  /** Dispositivos conectados ahora mismo. */
  connected: number
}

declare module './contract' {
  interface RpcMethods {
    'remote.status': { args: void; result: RemoteStatus }
    'remote.setEnabled': { args: { enabled: boolean }; result: RemoteStatus }
    /** Enseña un código de un solo uso (10 minutos) para vincular un dispositivo; en Aula como servidor, un propietario
     *  puede pedirlo para otro propietario (`owner`). */
    'remote.startPairing': { args: { owner?: boolean } | void; result: RemoteStatus }
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
