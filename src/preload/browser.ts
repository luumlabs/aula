// Preload del navegador de plataformas: NO expone nada a las páginas. En las pestañas de lectura ocultas (marcadas con
// `--aula-reader`) solo se apagan los diálogos de JavaScript (alert/confirm/prompt/print), que en una ventana que nadie ve
// bloquearían la página o aparecerían de golpe al estudiante. La ventana de inicio de sesión (visible) queda tal cual.
import { contextBridge } from 'electron'

if (process.argv.includes('--aula-reader')) {
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

export {}
