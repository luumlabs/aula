// Lámina de revisión de la banda sonora (PNG): espectrograma de la mezcla final con la rejilla de compases y las
// secciones, y debajo una fila por tipo de efecto con su tiempo en la hoja (raya), lo que ocupa su sonido (barra) y el
// golpe medido en el bus de efectos (punto). Demuestra que cada efecto cae donde lo pide la imagen y en el pulso.
import { magnitudes, hannWindow } from '../audio/fft.ts'
import { checkEvents, envelopeMs, type EventCheck } from './analysis.ts'
import { SR } from './dsp.ts'
import { hex, Raster, type Rgb } from './raster.ts'
import type { Soundtrack } from './score.ts'
import { barTime, EVENT_TYPES } from './sheet.ts'

const C = {
  surface: hex('#fcfcfb'),
  ink: hex('#0b0b0b'),
  ink2: hex('#52514e'),
  muted: hex('#8a8984'),
  grid: hex('#e4e2dc'),
  mark: hex('#eb6834'),
  day: hex('#efe7d4'),
  night: hex('#34322f'),
  nightText: hex('#f0efec'),
  other: hex('#d9d3c4')
}
// rampa secuencial de un solo tono (claro → oscuro) para la energía
const RAMP = ['#fcfcfb', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'].map(hex)

function ramp(v: number): Rgb {
  const x = Math.max(0, Math.min(1, v)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(x))
  const f = x - i
  return [0, 1, 2].map((k) => RAMP[i][k] + (RAMP[i + 1][k] - RAMP[i][k]) * f) as Rgb
}

export interface SheetPng {
  png: Buffer
  checks: EventCheck[]
}

export function soundSheetPng(st: Soundtrack, opts: { pxPerSec?: number; title?: string } = {}): SheetPng {
  const sh = st.sheet
  // ~2400 px de ancho para cualquier duración (entre 16 y 60 px por segundo)
  const pps = opts.pxPerSec ?? Math.max(16, Math.min(60, 2400 / sh.duration))
  const left = 170
  const right = 30
  const W = left + Math.ceil(sh.duration * pps) + right
  const checks = checkEvents(st)
  const types = EVENT_TYPES.filter((t) => checks.some((c) => c.type === t))
  const top = 24
  const yHead = top
  const ySec = top + 96
  const ySpec = ySec + 44
  const specH = 420
  const yLanes = ySpec + specH + 26
  const laneH = 30
  const yEnv = yLanes + types.length * laneH + 24
  const envH = 90
  const yFoot = yEnv + envH + 34
  const H = yFoot + 150
  const r = new Raster(W, H, C.surface)
  const X = (t: number) => left + t * pps

  // cabecera
  const m = st.report.mix.master
  // golpes con ataque (clic, palabra, campana…) por un lado y crestas suaves (aire, subida) por otro
  const soft = (c: EventCheck) => c.type === 'whoosh' || c.type === 'rise'
  const timed = checks.filter((c) => c.errorMs !== null)
  const maxErr = timed.filter((c) => !soft(c)).reduce((a, c) => Math.max(a, Math.abs(c.errorMs!)), 0)
  const maxSoft = timed.filter(soft).reduce((a, c) => Math.max(a, Math.abs(c.errorMs!)), 0)
  const minSnr = checks.reduce((a, c) => Math.min(a, c.snrDb), Infinity)
  r.text(left, yHead, opts.title ?? `Aula · original soundtrack · ${sh.name}`, C.ink, 3)
  wrap(r, left, yHead + 32, `${sh.mode} · ${sh.bpm} bpm · ${sh.duration.toFixed(1)} s · ${m.lufs.toFixed(1)} LUFS · ${m.truePeak.toFixed(1)} dBTP (wav) · ${checks.length} effects · attack error max ${maxErr.toFixed(0)} ms · whoosh/rise crest error max ${maxSoft.toFixed(0)} ms · effect/music min ${minSnr.toFixed(0)} dB`, C.ink2, W - left - right)

  // secciones y compases
  const bars = st.harmony.filter((h) => h.t < sh.duration)
  for (const h of bars) {
    const x0 = X(h.t)
    const x1 = X(Math.min(sh.duration, h.t + sh.bar))
    const fill = h.kind === 'night' ? C.night : h.kind === 'day' || h.kind === 'drop' ? C.day : C.other
    r.rect(x0, ySec, x1 - x0 - 1, 30, fill)
    const txt = h.kind === 'night' ? C.nightText : C.ink
    if (h.pos === 0) r.text(x0 + 6, ySec + 5, h.kind, txt, 2)
    r.text(x0 + 6, ySec + 20, `${h.bar} ${h.symbol}`, txt, 1)
  }

  // espectrograma de la mezcla (frecuencia logarítmica 30 Hz – 16 kHz, 70 dB de rango)
  const n = 2048
  const hann = hannWindow(n)
  const mono = new Float32Array(st.channels[0].length)
  for (let i = 0; i < mono.length; i++) mono[i] = (st.channels[0][i] + st.channels[1][i]) * 0.5
  const cols = Math.ceil(sh.duration * pps)
  const f0 = 30
  const f1 = 16000
  const rowBin = Array.from({ length: specH }, (_, y) => (f0 * Math.pow(f1 / f0, 1 - y / (specH - 1)) * n) / SR)
  const spec: Float64Array[] = []
  let maxDb = -Infinity
  for (let c = 0; c < cols; c++) {
    const start = Math.round((c / pps) * SR) - n / 2
    const mags = magnitudes(mono, Math.max(0, start), n, hann)
    const col = new Float64Array(specH)
    for (let y = 0; y < specH; y++) {
      const b = rowBin[y]
      const i = Math.floor(b)
      const f = b - i
      const v = (mags[i] ?? 0) * (1 - f) + (mags[i + 1] ?? 0) * f
      col[y] = 20 * Math.log10(v + 1e-9)
      if (col[y] > maxDb) maxDb = col[y]
    }
    spec.push(col)
  }
  for (let c = 0; c < cols; c++) for (let y = 0; y < specH; y++) r.px(left + c, ySpec + y, ramp((spec[c][y] - (maxDb - 70)) / 70))
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const y = ySpec + (1 - Math.log(f / f0) / Math.log(f1 / f0)) * (specH - 1)
    r.hline(left - 8, left, y, C.ink2)
    r.text(left - 14 - (f >= 1000 ? 4 : 3) * 12, y - 7, f >= 1000 ? `${f / 1000}k` : `${f}`, C.ink2, 2)
  }
  r.text(8, ySpec + specH / 2 - 7, 'Hz', C.ink2, 2)
  // golpes grandes: línea fina sobre el espectrograma
  for (const c of checks) {
    if (c.type === 'impact' || c.type === 'logo' || c.type === 'card') r.vline(X(c.hit), ySpec, ySpec + specH, C.ink, 0.35)
    r.vline(X(c.hit), ySpec - 8, ySpec, C.mark, 1, 2)
  }

  // filas de efectos
  const gridTop = yLanes - 4
  const gridBot = yLanes + types.length * laneH
  for (let b = 1; barTime(sh, b) <= sh.duration; b++) {
    for (let k = 0; k < sh.beatsPerBar; k++) {
      const t = barTime(sh, b, k + 1)
      if (t > sh.duration) break
      r.vline(X(t), gridTop, gridBot, k === 0 ? C.muted : C.grid, k === 0 ? 0.8 : 1)
    }
  }
  types.forEach((ty, row) => {
    const y = yLanes + row * laneH + laneH / 2
    const mine = checks.filter((c) => c.type === ty)
    r.text(12, y - 7, `${ty} (${mine.length})`, C.ink, 2)
    r.hline(left, W - right, y, C.grid)
    const ps = st.report.placements.filter((p) => p.type === ty)
    ps.forEach((p, k) => {
      const c = mine[k]
      r.rect(X(p.span[0]), y - 4, Math.max(2, (p.span[1] - p.span[0]) * pps), 8, C.mark, 0.22)
      r.vline(X(p.t), y - 12, y + 12, C.ink, 0.9, 2)
      r.dot(X(c.measured ?? p.hit), y, 4, C.mark, C.surface)
    })
  })

  // envolvente del bus de efectos
  const env = envelopeMs(st.fx)
  let emax = 0
  for (const v of env) emax = Math.max(emax, v)
  r.text(12, yEnv + envH / 2 - 7, 'effects bus', C.ink, 2)
  r.hline(left, W - right, yEnv + envH, C.grid)
  for (let c = 0; c < cols; c++) {
    let v = 0
    for (let k = Math.floor((c / pps) * 1000); k < Math.floor(((c + 1) / pps) * 1000); k++) v = Math.max(v, env[k] ?? 0)
    const dbv = Math.max(0, 1 + (20 * Math.log10(v / emax + 1e-9)) / 48)
    r.rect(left + c, yEnv + envH * (1 - dbv), 1, envH * dbv, C.ink2, 0.8)
  }
  for (const c of checks) r.vline(X(c.hit), yEnv - 6, yEnv + envH, C.mark, 0.55)

  // pie: leyenda
  const legend = 'Black tick = time in the cue sheet · orange dot = hit measured on the effect re-synthesized alone · light bar = how long the sound lasts · grid = bars (dark) and beats (light) · effects snap to the 16th note when within -30/+60 ms of the picture · spectrogram of the final mix (30 Hz - 16 kHz, log); thin lines: cards, impacts, logo'
  wrap(r, left, yFoot, legend, C.ink2, W - left - right)
  return { png: r.png(), checks }
}

/** Texto partido por « · » en líneas que caben en `maxW` (escala 2, 24 px por línea). */
function wrap(r: Raster, x: number, y: number, text: string, c: Rgb, maxW: number): number {
  const parts = text.split(' · ')
  let line = ''
  let yy = y
  for (const p of parts) {
    const next = line ? `${line} · ${p}` : p
    if (Raster.textWidth(next, 2) > maxW && line) {
      r.text(x, yy, line, c, 2)
      yy += 24
      line = p
    } else line = next
  }
  if (line) r.text(x, yy, line, c, 2)
  return yy + 24
}
