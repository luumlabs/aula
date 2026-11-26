import { describe, expect, it } from 'vitest'
import type { Route } from '../router'
import { tabOwner, tabTap } from './tabs'
import { decideCompact } from './compact'

const home: Route = { name: 'home' }
const course: Route = { name: 'course', id: 'c1' }

describe('la pestaña de la pantalla de ahora', () => {
  it('un curso abierto desde «Hoy» es de «Hoy»', () => {
    expect(tabOwner([home, course], 1)).toBe('home')
  })
  it('lo abierto desde otra pestaña es de esa pestaña', () => {
    expect(tabOwner([home, { name: 'courses' }, { name: 'settings' }], 2)).toBe('courses')
    expect(tabOwner([home, { name: 'calendar' }, course, { name: 'stats' }], 3)).toBe('calendar')
  })
  it('mira solo hasta la entrada de ahora (no lo que queda delante)', () => {
    expect(tabOwner([home, course, { name: 'chat' }], 1)).toBe('home')
  })
  it('sin ninguna raíz en la pila, «Hoy»', () => {
    expect(tabOwner([{ name: 'tools' }], 0)).toBe('home')
  })
})

describe('tocar una pestaña', () => {
  it('otra pestaña: se cambia a ella', () => {
    expect(tabTap('chat', { stack: [home], index: 0, route: home })).toBe('switch')
  })
  it('la de ahora en su raíz: sube arriba', () => {
    expect(tabTap('home', { stack: [home], index: 0, route: home })).toBe('top')
    expect(tabTap('courses', { stack: [home, { name: 'courses' }], index: 1, route: { name: 'courses' } })).toBe('top')
  })
  it('la de ahora en una pantalla abierta desde ella: vuelve a su raíz', () => {
    expect(tabTap('home', { stack: [home, course], index: 1, route: course })).toBe('pop')
    expect(tabTap('chat', { stack: [home, { name: 'chat', conversation: 'x' }], index: 1, route: { name: 'chat', conversation: 'x' } })).toBe('pop')
  })
})

describe('pantalla de teléfono', () => {
  it('estrecha, siempre', () => {
    expect(decideCompact({ narrow: true, coarse: false, screenShort: 1080 })).toBe(true)
  })
  it('un teléfono girado (táctil, pantalla de teléfono) también', () => {
    expect(decideCompact({ narrow: false, coarse: true, screenShort: 440 })).toBe(true)
  })
  it('el iPad apaisado no, aunque el teclado deje poca altura', () => {
    expect(decideCompact({ narrow: false, coarse: true, screenShort: 1032 })).toBe(false)
    expect(decideCompact({ narrow: false, coarse: true, screenShort: 744 })).toBe(false)
  })
  it('un ordenador con pantalla pequeña no (no es táctil)', () => {
    expect(decideCompact({ narrow: false, coarse: false, screenShort: 400 })).toBe(false)
  })
  it('sin saber la pantalla, solo el ancho', () => {
    expect(decideCompact({ narrow: false, coarse: true, screenShort: 0 })).toBe(false)
  })
})
