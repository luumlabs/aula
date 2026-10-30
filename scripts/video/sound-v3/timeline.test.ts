import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readWav } from '../audio/track.ts'
import { demoCues } from './demo.ts'
import { toV3Timeline, type MontageCues } from './timeline.ts'

const hasSwift = (() => {
  try {
    execFileSync('swiftc', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
})()

describe('hoja del montaje → línea de tiempo del v3', () => {
  const tl = toV3Timeline(demoCues())

  it('compases como en el v3: intro, «Meet Aula», cartelas, día y noche, anochecer y cierre', () => {
    expect(tl.bpm).toBe(100)
    expect(tl.meetBar).toBe(3)
    expect(tl.meet).toBeCloseTo(7.2)
    expect(tl.kinds.slice(0, 5)).toEqual(['intro', 'intro', 'intro', 'meet', 'card'])
    expect(tl.kinds[8]).toBe('card') // 02 · Learn
    expect(tl.kinds.slice(9, 11)).toEqual(['night', 'night'])
    expect(tl.logo).toBeCloseTo(14 * 2.4)
    expect(tl.musicBars).toBe(14)
    expect(tl.kinds.slice(14, 16)).toEqual(['outro', 'outro'])
    expect(tl.kinds.length).toBeGreaterThanOrEqual(tl.bars)
  })

  it('cartelas, luces y efectos', () => {
    expect(tl.chapters.map((c) => [c.n, c.bar, c.dark])).toEqual([
      [1, 4, false],
      [2, 8, true],
      [3, 11, false]
    ])
    expect(tl.chapters[0].textAt).toBeCloseTo(0.3)
    expect(tl.changes.map((c) => c.toDark)).toEqual([true, false])
    expect(tl.hookWords.map(([, n]) => n)).toEqual([76, 78, 81, 85, 73, 78])
    expect(tl.iconWaves).toHaveLength(1)
    expect(tl.clicks).toHaveLength(5)
    expect(tl.accents.length).toBe(4) // tres subrayados y un conteo
    expect(tl.cuts.length).toBe(7)
    expect(tl.outroMallets[0][0]).toBeCloseTo(tl.logo + 1.2)
    expect(tl.fadeOut[1]).toBeCloseTo(tl.duration - 0.2)
    expect(tl.levelWindow[1] - tl.levelWindow[0]).toBeGreaterThanOrEqual(4)
  })

  it('dice qué está mal: sin drop, o con la intro más larga que la del v3', () => {
    const base = demoCues()
    expect(() => toV3Timeline({ ...base, sections: base.sections.filter((s) => s.mood !== 'drop') })).toThrow(/drop/)
    const late: MontageCues = { ...base, sections: base.sections.map((s) => (s.mood === 'drop' ? { ...s, t: 4 * 2.4 } : s)) }
    expect(() => toV3Timeline(late)).toThrow(/compás 5/)
    expect(() => toV3Timeline({ ...base, offset: 0.3 })).toThrow(/t = 0/)
  })

  it.skipIf(!hasSwift)('el sintetizador original suena con ella (WAV estéreo de 48 kHz, la duración del vídeo)', async () => {
    const { renderV3 } = await import('./render.ts')
    const out = join(mkdtempSync(join(tmpdir(), 'sound-v3-')), 'demo.wav')
    const r = renderV3(demoCues(), out)
    const w = readWav(readFileSync(out))
    expect(w.rate).toBe(48000)
    expect(w.channels).toHaveLength(2)
    expect(w.channels[0].length / 48000).toBeCloseTo(tl.duration, 1)
    expect(r.stats.peakDb).toBeLessThanOrEqual(-1.5)
  }, 120000)
})

describe('fidelidad con el v3', () => {
  it.skipIf(!hasSwift)('con la línea de tiempo del v3, el adaptador da los mismos bytes que el Audio.swift original de dfcb4e1', async () => {
    const { createHash } = await import('node:crypto')
    const { renderV3 } = await import('./render.ts')
    const dir = mkdtempSync(join(tmpdir(), 'sound-v3-fid-'))
    const here = new URL('.', import.meta.url).pathname
    // el original tal cual: Audio.swift + Beat/Timeline de Story.swift
    const bin = join(dir, 'original')
    execFileSync('swiftc', ['-O', '-swift-version', '5', '-o', bin, join(here, 'original/Audio.swift'), join(here, 'original/StoryTimeline.swift'), join(here, 'original/main.swift')], { stdio: 'pipe' })
    execFileSync(bin, [join(dir, 'original.wav')], { stdio: 'pipe' })
    renderV3(JSON.parse(readFileSync(join(here, 'v3.timeline.json'), 'utf8')), join(dir, 'adapted.wav'))
    const h = (f: string) => createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')
    expect(h('adapted.wav')).toBe(h('original.wav'))
  }, 180000)
})
