import { describe, expect, it } from 'vitest'
import { ICON_ANIMS } from '../../../src/renderer/src/design/pixel/iconAnims.ts'
import { parseFrame, storyEvents } from './sfx.ts'

describe('sonidos de las historias pixel art', () => {
  it('lee parches y pasos de un fotograma', () => {
    expect(parseFrame('kh bolt@-3,4 boltL@16,4 %RY @1,0')).toEqual({ cels: ['kh', 'bolt', 'boltL'], ticks: 1 })
    expect(parseFrame('padL padR *2')).toEqual({ cels: ['padL', 'padR'], ticks: 2 })
    expect(parseFrame('*3')).toEqual({ cels: [], ticks: 3 })
  })
  it('el corazón de medicina late, recibe la descarga y se ríe, en orden', () => {
    const ev = storyEvents(ICON_ANIMS.medicine, 'hover', 10)
    const kinds = ev.map((e) => e.kind)
    expect(kinds.filter((k) => k === 'heartbeat').length).toBeGreaterThanOrEqual(5)
    const zap = kinds.indexOf('zap')
    expect(zap).toBeGreaterThan(kinds.indexOf('heartbeat'))
    expect(kinds.lastIndexOf('heart')).toBeGreaterThan(zap)
    expect(ev[0].t).toBeGreaterThanOrEqual(10)
  })
  it('la química vierte, gotea y burbujea', () => {
    const kinds = new Set(storyEvents(ICON_ANIMS.chemistry, 'hover', 0).map((e) => e.kind))
    for (const k of ['slosh', 'plip', 'bubble', 'puff'] as const) expect(kinds.has(k)).toBe(true)
  })
  it('anatomía: pitido plano con duración', () => {
    const flat = storyEvents(ICON_ANIMS.anatomy, 'hover', 0).find((e) => e.kind === 'flatline')
    expect(flat?.dur).toBeGreaterThan(0.2)
  })
})
