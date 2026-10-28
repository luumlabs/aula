// La app instalada no acepta la depuración remota de Chromium (A2-P2-6, A5-P2-7). Con `--remote-debugging-port` (o
// `-pipe`) cualquier programa que pueda lanzar Aula manejaría la interfaz (todo su RPC) y leería las cookies ya descifradas
// del navegador de plataformas; los fusibles ya apagan `--inspect` y NODE_OPTIONS, pero no este interruptor de Chromium.
// Las auditorías que lo necesiten compilan aparte con AULA_AUDIT_BUILD=1 (electron.vite.config.ts; release-local.sh se
// niega a publicar así).

/** Interruptores que abren el protocolo de depuración (CDP). */
export const REMOTE_DEBUGGING_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe'] as const

/** El interruptor que hay que rechazar, o null si se puede seguir. */
export function refusedDebugSwitch(packaged: boolean, hasSwitch: (name: string) => boolean, auditBuild: boolean): string | null {
  if (!packaged || auditBuild) return null
  return REMOTE_DEBUGGING_SWITCHES.find((s) => hasSwitch(s)) ?? null
}

/** ¿Compilada para auditar (AULA_AUDIT_BUILD=1)? Se fija al compilar; en las pruebas, nunca. */
export function isAuditBuild(): boolean {
  return typeof __AULA_AUDIT_BUILD__ !== 'undefined' && __AULA_AUDIT_BUILD__ === true
}
