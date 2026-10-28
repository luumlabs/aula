import type { AulaBridge } from './index'

declare global {
  interface Window {
    aula: AulaBridge
  }
}
export {}
