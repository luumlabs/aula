// Los guiones del mundo aislado son texto: aquí se comprueba que compilan (un error de sintaxis solo saldría en la app).
import { describe, expect, it } from 'vitest'
import {
  domClickScript, hasTextScript, hintBannerScript, identityStateScript, locateRefScript, pageStateScript, signInStateScript, readabilityParseScript, readabilityScript,
  rememberMeScript, scrollScript, snapshotScript, successBannerScript
} from './scripts'

const compiles = (code: string): void => {
  // eslint-disable-next-line no-new-func
  expect(() => new Function(`return ${code}`)).not.toThrow()
}

describe('guiones de página', () => {
  it('todos compilan, también con textos con comillas y saltos de línea', () => {
    compiles(pageStateScript())
    compiles(signInStateScript({ signedIn: ['a[href*="logout" i]', '#x'], signedOut: ['body.notloggedin'] }))
    compiles(snapshotScript({ start: 5, budget: 1000, maxElements: 10, full: true }))
    compiles(locateRefScript('e12', { label: 'Tema "1"\n', href: 'https://x/a?b=1', submits: false, formAction: '' }))
    compiles(locateRefScript('e1', null))
    compiles(domClickScript('e3'))
    compiles(scrollScript({ direction: 'down', amount: 0.5 }))
    compiles(hasTextScript("l'examen </script>"))
    compiles(rememberMeScript())
    compiles(successBannerScript('Sesión iniciada'))
    compiles(readabilityParseScript())
    compiles(identityStateScript())
    compiles(signInStateScript({ signedIn: [], signedOut: [] }, false))
    compiles(hintBannerScript({ kind: 'blocked:login.microsoftonline.com', title: 'Aula no ha abierto «x» </script>', detail: 'a\nb "c"' }, 'Cerrar aviso'))
    compiles(hintBannerScript({ kind: 'step', title: 'Moodle' }, 'Close'))
  })

  it('los avisos y la ventana de acceso no leen campos ni usan estilos en línea que una CSP cortaría', () => {
    const banner = hintBannerScript({ kind: 'passkey', title: 't' }, 'x')
    expect(banner).not.toContain('setAttribute("style"')
    expect(banner).not.toContain('innerHTML')
    expect(successBannerScript('t')).not.toContain('setAttribute("style"')
    expect(identityStateScript()).not.toMatch(/\.value\b/)
    expect(identityStateScript()).toContain('data-aula-passkey')
  })

  it('Readability está disponible para leer artículos', () => {
    const src = readabilityScript()
    expect(src).toBeTruthy()
    // eslint-disable-next-line no-new-func
    expect(() => new Function(src!)).not.toThrow()
  })

  it('el texto de los campos de formulario nunca entra en la lectura', () => {
    expect(snapshotScript({ start: 1 })).toContain('INPUT:1,TEXTAREA:1,SELECT:1')
  })
})

/** Un DOM mínimo para ejecutar los guiones de avisos (sin navegador): lo justo que usan. */
class FakeEl {
  attrs = new Map<string, string>()
  children: FakeEl[] = []
  parent: FakeEl | null = null
  style: Record<string, string> = { cssText: '' }
  listeners = new Map<string, (() => void)[]>()
  textContent = ''
  id = ''
  type = ''
  title = ''
  innerText = ''
  shadow: FakeEl | null = null
  constructor(readonly tagName: string) {}
  setAttribute(k: string, v: string): void { this.attrs.set(k, String(v)) }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null }
  appendChild(c: FakeEl): FakeEl { c.parent = this; this.children.push(c); return c }
  attachShadow(): FakeEl { this.shadow = new FakeEl('#shadow'); return this.shadow }
  addEventListener(t: string, fn: () => void): void { this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]) }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this) }
  click(): void { for (const fn of this.listeners.get('click') ?? []) fn() }
  find(pred: (e: FakeEl) => boolean): FakeEl | null {
    if (pred(this)) return this
    for (const c of [...this.children, ...(this.shadow ? [this.shadow] : [])]) { const hit = c.find(pred); if (hit) return hit }
    return null
  }
}

function fakePage(bodyText = '') {
  const html = new FakeEl('HTML')
  const body = html.appendChild(new FakeEl('BODY'))
  body.innerText = bodyText
  const document = {
    documentElement: html, body,
    createElement: (t: string) => new FakeEl(t.toUpperCase()),
    getElementById: (id: string) => html.find((e) => e.id === id)
  }
  const window = { matchMedia: () => ({ matches: false }) }
  // eslint-disable-next-line no-new-func
  const run = (code: string): unknown => new Function('document', 'window', 'requestAnimationFrame', 'setTimeout', `return ${code}`)(document, window, (fn: () => void) => fn(), (fn: () => void) => fn())
  return { html, body, run }
}

describe('avisos de la ventana de acceso (DOM mínimo)', () => {
  it('se pone una vez por tipo, se puede cerrar y no vuelve en esa página', () => {
    const page = fakePage()
    const hint = { kind: 'passkey', title: 'Las llaves de acceso no funcionan', detail: 'Elige otra forma' }
    expect(page.run(hintBannerScript(hint, 'Cerrar aviso'))).toBe('shown')
    expect(page.run(hintBannerScript(hint, 'Cerrar aviso'))).toBe('present')
    expect(page.run(hintBannerScript({ kind: 'step', title: 'Moodle' }, 'Cerrar aviso'))).toBe('shown')
    const host = page.html.find((e) => e.getAttribute('data-aula-hint') === 'passkey')!
    expect(host.shadow?.find((e) => e.textContent === 'Las llaves de acceso no funcionan')).toBeTruthy()
    const close = host.shadow!.find((e) => e.tagName === 'BUTTON')!
    expect(close.getAttribute('aria-label')).toBe('Cerrar aviso')
    close.click()
    expect(page.html.find((e) => e.getAttribute('data-aula-hint') === 'passkey')).toBeNull()
    expect(page.html.getAttribute('data-aula-hints-closed')).toBe('passkey')
    expect(page.run(hintBannerScript(hint, 'Cerrar aviso'))).toBe('dismissed')
    // el otro aviso sigue
    expect(page.html.find((e) => e.getAttribute('data-aula-hint') === 'step')).toBeTruthy()
  })

  it('la página de identidad cuenta la marca de las llaves, los avisos cerrados y el primer código de Entra', () => {
    const page = fakePage('Sorry, but we’re having trouble signing you in.\nAADSTS53003: Access has been blocked by Conditional Access policies. AADSTS50196')
    page.html.setAttribute('data-aula-passkey', 'asked')
    page.html.setAttribute('data-aula-hints-closed', 'loop')
    expect(page.run(identityStateScript())).toEqual({ passkey: 'asked', closed: 'loop', aadsts: 'AADSTS53003' })
    expect(fakePage('nada').run(identityStateScript())).toEqual({ passkey: '', closed: '', aadsts: '' })
  })
})
