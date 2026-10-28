import { describe, expect, it } from 'vitest'
import type { PowerState } from '@shared/ipc/power'
import { ambientAllows, ambientLevel, ambientLevelFor, CALM_AFTER_BATTERY_MS, CALM_AFTER_MS, CALM_AFTER_UNFOCUSED_MS, onAmbientChange, setAmbientLevel } from './ambient'

const state = (o: Partial<PowerState> = {}): PowerState => ({ window: 'active', locked: false, battery: false, ...o })

describe('nivel ambiental', () => {
  it('con la ventana a la vista y en uso, todo se mueve', () => {
    expect(ambientLevelFor(state(), false, 0)).toBe('run')
    expect(ambientLevelFor(state(), false, CALM_AFTER_MS - 1)).toBe('run')
  })

  it('a la vista pero sin tocarla un rato, calma (antes con batería y antes aún sin foco)', () => {
    expect(ambientLevelFor(state(), false, CALM_AFTER_MS)).toBe('calm')
    expect(ambientLevelFor(state({ battery: true }), false, CALM_AFTER_BATTERY_MS)).toBe('calm')
    expect(ambientLevelFor(state({ battery: true }), false, CALM_AFTER_BATTERY_MS - 1)).toBe('run')
    expect(ambientLevelFor(state({ window: 'inactive' }), false, CALM_AFTER_UNFOCUSED_MS)).toBe('calm')
    expect(CALM_AFTER_UNFOCUSED_MS).toBeLessThan(CALM_AFTER_BATTERY_MS)
    expect(CALM_AFTER_BATTERY_MS).toBeLessThan(CALM_AFTER_MS)
  })

  it('minimizada, oculta, con la pantalla bloqueada o la página oculta: nada se mueve, aunque se acabe de usar', () => {
    expect(ambientLevelFor(state({ window: 'minimized' }), false, 0)).toBe('off')
    expect(ambientLevelFor(state({ window: 'hidden' }), false, 0)).toBe('off')
    expect(ambientLevelFor(state({ locked: true }), false, 0)).toBe('off')
    expect(ambientLevelFor(state(), true, 0)).toBe('off')
  })

  it('en capturas (pinned) siempre se mueve', () => {
    expect(ambientLevelFor(state({ window: 'hidden', pinned: true }), true, 1e9)).toBe('run')
  })

  it('lo decorativo solo en run; lo que muestra que algo pasa, también en calma; nada sin ver la ventana', () => {
    expect(ambientAllows('run', 'decor')).toBe(true)
    expect(ambientAllows('calm', 'decor')).toBe(false)
    expect(ambientAllows('calm', 'activity')).toBe(true)
    expect(ambientAllows('off', 'activity')).toBe(false)
  })

  it('avisa a los suscriptores solo cuando cambia', () => {
    const seen: string[] = []
    const off = onAmbientChange((l) => seen.push(l))
    setAmbientLevel('calm')
    setAmbientLevel('calm')
    setAmbientLevel('off')
    setAmbientLevel('run')
    off()
    setAmbientLevel('calm')
    expect(seen).toEqual(['calm', 'off', 'run'])
    setAmbientLevel('run')
    expect(ambientLevel()).toBe('run')
  })
})
