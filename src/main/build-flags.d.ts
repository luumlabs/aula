// Constantes que fija electron.vite.config.ts al compilar el proceso principal.
/** Compilación de auditoría (AULA_AUDIT_BUILD=1): la app empaquetada acepta --remote-debugging-port. Nunca en una release. */
declare const __AULA_AUDIT_BUILD__: boolean | undefined
