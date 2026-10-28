import type { AppSettings, SettingsPatch } from '../settings'

declare module './contract' {
  interface RpcMethods {
    'settings.get': { args: void; result: AppSettings }
    'settings.update': { args: SettingsPatch; result: AppSettings }
    /** «Exportar todo»: elige dónde y guarda un .zip de la carpeta de datos (sin claves ni cookies). null = cancelado. */
    'data.exportAll': { args: void; result: { path: string } | null }
    /** «Borrar todos los datos»: Aula se reinicia y vacía su carpeta de datos antes de leer nada. */
    'data.deleteAll': { args: void; result: void }
  }
  interface RpcEvents {
    'settings.changed': AppSettings
  }
}
export {}
