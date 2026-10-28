// Contrato IPC del dominio «platforms»: cuentas de plataformas de estudio, inicio de sesión y permisos.
import type { PlatformKind } from '../settings/platforms'
import type {
  PlatformAccountView,
  PlatformApprovalRequest,
  PlatformApprovalResolution,
  PlatformCourse,
  PlatformProbeResult
} from '../platforms/types'

declare module './contract' {
  interface RpcMethods {
    'platforms.list': { args: void; result: PlatformAccountView[] }
    /** Sondea una dirección sin sesión (detecta el tipo y propone el nombre). */
    'platforms.probe': { args: { url: string }; result: PlatformProbeResult }
    /** Crea la cuenta (detecta el tipo si no se indica). Si ya existe ese sitio, devuelve la existente. */
    'platforms.add': { args: { url: string; kind?: PlatformKind; label?: string }; result: PlatformAccountView }
    /** Abre la ventana de inicio de sesión; se resuelve al iniciarla o al cerrar la ventana. */
    'platforms.signIn': { args: { accountId: string }; result: { signedIn: boolean; account: PlatformAccountView } }
    /** «Ya he iniciado sesión»: vuelve a comprobar ya (la ventana se cierra sola si es así; si no, se trae al frente). */
    'platforms.confirmSignIn': { args: { accountId: string }; result: { signedIn: boolean; account: PlatformAccountView } }
    /** Cierra la sesión: borra el almacenamiento de la cuenta y las cookies guardadas. */
    'platforms.signOut': { args: { accountId: string }; result: PlatformAccountView }
    'platforms.remove': { args: { accountId: string }; result: void }
    'platforms.update': { args: { accountId: string; label?: string; notes?: string }; result: PlatformAccountView }
    'platforms.check': { args: { accountId: string }; result: PlatformAccountView }
    /** Cursos de Canvas o Moodle (para «crear un curso desde mi plataforma»). */
    'platforms.courses': { args: { accountId: string }; result: PlatformCourse[] }
    /** Conecta el calendario privado (.ics) con la sesión (Canvas y Moodle). */
    'platforms.connectCalendar': { args: { accountId: string }; result: PlatformAccountView }
    /** Modo token de Canvas (opcional; sin token se usa la sesión). `token: null` lo quita. El token nunca vuelve a la interfaz. */
    'platforms.setCanvasToken': { args: { accountId: string; token: string | null }; result: PlatformAccountView }
    /** Responde a una petición de permiso. */
    'platforms.approve': { args: { id: string; allow: boolean }; result: void }
    /** Peticiones de permiso pendientes (por si la interfaz se recarga). */
    'platforms.approvals': { args: void; result: PlatformApprovalRequest[] }
  }
  interface RpcEvents {
    'platforms.status': PlatformAccountView
    'platforms.signedIn': { accountId: string; account: PlatformAccountView }
    'platforms.approval': { request: PlatformApprovalRequest } | { resolved: PlatformApprovalResolution }
  }
}
export {}
