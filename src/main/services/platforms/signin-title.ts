// Título de la ventana de inicio de sesión: siempre dice EN QUÉ DOMINIO se está escribiendo la contraseña (J3-13). Así una
// redirección a un proveedor de identidad falso o una dirección de plataforma mal escrita se notan; sin cifrar, se avisa.
import { tr } from '@shared/ai/i18n'

export function signInTitle(platformName: string, url: string | null): string {
  const base = tr(`Inicia sesión · ${platformName}`, `Sign in · ${platformName}`)
  let u: URL
  try {
    u = new URL(url ?? '')
  } catch {
    return base
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return base
  const host = u.port ? `${u.hostname}:${u.port}` : u.hostname
  return u.protocol === 'https:' ? `${base} — ${host}` : `${base} — ${host} ${tr('(SIN CIFRAR: no escribas tu contraseña)', '(NOT ENCRYPTED: don’t type your password)')}`
}
