// Por dónde salen las peticiones del proceso principal. Con un proxy del sistema (redes de centros y empresas),
// src/main/electron/proxy.ts cambia `globalThis.fetch` por la red de Chromium y lo apunta aquí: entonces es el proxy quien
// resuelve los nombres y no se puede conectar directamente. Sin proxy, Node conecta por su cuenta.
let viaSystemProxy = false

/** Lo llama proxy.ts al poner la red de Chromium (y las pruebas). */
export function setSystemProxyActive(active: boolean): void {
  viaSystemProxy = active
}

/** ¿Las peticiones van por el proxy del sistema? */
export function systemProxyActive(): boolean {
  return viaSystemProxy
}
