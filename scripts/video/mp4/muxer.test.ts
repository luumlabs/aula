import { describe, expect, it } from 'vitest'
import { muxMp4 } from './muxer.ts'
import { inspectMp4, trackSamples } from './inspect.ts'

const avcC = new Uint8Array([1, 0x64, 0x00, 0x2a, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x2a, 0x01, 0x00, 0x02, 0x68, 0xee])
const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff)

function sample() {
  const video = { width: 1920, height: 1080, timescale: 60000, avcC, samples: Array.from({ length: 150 }, (_, i) => ({ data: bytes(100 + (i % 7), i), duration: 1000, key: i % 120 === 0 })) }
  const audio = { sampleRate: 48000, channels: 2, asc: new Uint8Array([0x11, 0x90]), samples: Array.from({ length: 120 }, (_, i) => ({ data: bytes(20 + (i % 3), 1000 + i), duration: 1024 })), priming: 2112, presentation: 120000, bitrate: 192000 }
  return { video, audio }
}

describe('muxer MP4', () => {
  it('escribe ftyp · moov · mdat (faststart) con H.264 High 4.2 y AAC-LC', () => {
    const info = inspectMp4(muxMp4(sample()))
    expect(info.topLevel).toEqual(['ftyp', 'moov', 'mdat'])
    expect(info.faststart).toBe(true)
    expect(info.movieDuration).toBeCloseTo(2.5, 3)
    const v = info.tracks.find((t) => t.handler === 'vide')!
    expect([v.codec, v.profile, v.level, v.width, v.height]).toEqual(['avc1', 100, 42, 1920, 1080])
    expect(v.syncSamples).toEqual([1, 121])
    const a = info.tracks.find((t) => t.handler === 'soun')!
    expect([a.codec, a.aacObjectType, a.sampleRate, a.channels, a.editMediaTime, a.editDuration]).toEqual(['mp4a', 2, 48000, 2, 2112, 2500])
  })
  it('las muestras se leen de vuelta byte a byte (desplazamientos e intercalado correctos)', () => {
    const input = sample()
    const file = muxMp4(input)
    const info = inspectMp4(file)
    const v = trackSamples(file, info.tracks[0])
    const a = trackSamples(file, info.tracks[1])
    expect(v.map((x) => [...x])).toEqual(input.video.samples.map((s) => [...s.data]))
    expect(a.map((x) => [...x])).toEqual(input.audio.samples.map((s) => [...s.data]))
  })
  it('es determinista', () => {
    expect(Buffer.from(muxMp4(sample())).equals(Buffer.from(muxMp4(sample())))).toBe(true)
  })
})
