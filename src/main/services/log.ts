// Registro mínimo e independiente de Electron (el proceso principal lo redirige a electron-log al arrancar).
type Sink = (level: 'info' | 'warn' | 'error' | 'debug', ...args: unknown[]) => void

let sink: Sink = (level, ...args) => {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn(`[${level}]`, ...args)
}

export const log = {
  info: (...a: unknown[]) => sink('info', ...a),
  warn: (...a: unknown[]) => sink('warn', ...a),
  error: (...a: unknown[]) => sink('error', ...a),
  debug: (...a: unknown[]) => sink('debug', ...a),
  setSink(s: Sink) {
    sink = s
  }
}
