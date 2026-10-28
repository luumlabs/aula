// Revisión del guion contra los principios de la segunda versión (puro): zoom moderado, movimientos y cortes en el pulso,
// rótulos que no se pisan y duran ≥ 2 compases. Devuelve avisos legibles (no detiene el render).
import type { CameraKey, Montage } from './types.ts'
import { filmGrid } from './grid.ts'

const fitZoom = (m: Montage, vw: number, vh: number) => (m.captionBand ? Math.min((m.size[0] * 0.84) / vw, (m.captionBand - 60) / vh) : Math.min((m.size[0] * 0.84) / vw, (m.size[1] * 0.84) / vh))

const same = (a: CameraKey, b: CameraKey) => a.zoom === b.zoom && JSON.stringify(a.focus ?? null) === JSON.stringify(b.focus ?? null) && JSON.stringify(a.screen ?? null) === JSON.stringify(b.screen ?? null)

export interface LintOptions {
  maxZoom?: number
  /** Puntos del cursor en px del vídeo en el instante t (los da render.ts con las tomas capturadas). */
  cursorAt?: (t: number) => [number, number][]
}

export function lintMontage(m: Montage, opts: LintOptions = {}): string[] {
  const out: string[] = []
  const maxRel = opts.maxZoom ?? 1.5
  const frame = 1 / m.fps
  const grid = m.music?.track ? filmGrid(m.music.track.grid, m.music.track.cuts ?? [], m.music.track.start ?? 0) : null
  const offBeat = (t: number) => (grid ? Math.abs(t - grid.snap(t)) > frame + 1e-6 : false)
  const fmt = (t: number) => `${t.toFixed(2)} s${grid ? ` (compás ${Math.floor((t - grid.V(1)) / grid.barDur) + 1})` : ''}`

  const fades = m.clips.filter((c) => c.enter && ['content', 'theme', 'match'].includes(c.enter.kind)).map((c) => c.start)
  const checkKeys = (keys: CameraKey[] | undefined, offset: number, take: string, where: string) => {
    const vp = m.takes[take]?.viewport ?? [1440, 900]
    const fit = fitZoom(m, vp[0], vp[1])
    const ks = keys ?? []
    for (let i = 1; i < ks.length; i++) {
      if (ks[i].t <= ks[i - 1].t) out.push(`${where}: claves de cámara desordenadas o repetidas en ${fmt(offset + ks[i].t)}`)
      const moving = !same(ks[i - 1], ks[i])
      if (moving && i >= 2 && !same(ks[i - 2], ks[i - 1])) out.push(`${where}: dos movimientos de cámara seguidos sin respiro en ${fmt(offset + ks[i - 1].t)}`)
      if (moving && grid && fades.some((f) => Math.abs(f - (offset + ks[i - 1].t)) < grid.beat / 2)) out.push(`${where}: un movimiento de cámara empieza en el mismo pulso que un fundido (${fmt(offset + ks[i - 1].t)})`)
    }
    for (const k of ks) {
      if (typeof k.zoom === 'number' && k.zoom / fit > maxRel + 1e-6) out.push(`${where}: zoom ${(k.zoom / fit).toFixed(2)}× de la ventana entera en ${fmt(offset + k.t)} (máximo ${maxRel}×)`)
      if (k.t > 0 && offBeat(offset + k.t)) out.push(`${where}: clave de cámara fuera del pulso en ${fmt(offset + k.t)}`)
    }
  }
  for (const c of m.clips) {
    checkKeys(c.camera, c.start, c.take, `plano ${c.take}@${c.start.toFixed(2)}`)
    if (c.start > 0 && offBeat(c.start)) out.push(`plano ${c.take}: el cambio cae fuera del pulso en ${fmt(c.start)}`)
    if (c.enter?.kind === 'theme' && grid) {
      const beatIdx = Math.round((c.start - grid.V(1)) / grid.beat)
      if (offBeat(c.start) || ((beatIdx % 4) + 4) % 4 % 2 !== 0) out.push(`plano ${c.take}: el cambio de tema debe arrancar en un pulso fuerte (1 o 3), no en ${fmt(c.start)}`)
      if (Math.abs(c.enter.dur - 2 * grid.beat) > 0.05) out.push(`plano ${c.take}: el cambio de tema dura ${c.enter.dur.toFixed(2)} s (2 pulsos = ${(2 * grid.beat).toFixed(2)} s)`)
      if (c.enter.window !== undefined && c.enter.window > 6 / m.fps + 1e-6) out.push(`plano ${c.take}: la ventana cambia de tema en ${c.enter.window.toFixed(2)} s (máximo 6 fotogramas: dos contenidos a medias se ven como un velo gris)`)
    }
    // un fundido de contenido largo mezcla dos contenidos a medias (el «fotograma gris»): para claro↔oscuro, «theme»
    if (c.enter?.kind === 'content' && c.enter.dur > 0.25 + 1e-6) out.push(`plano ${c.take}: fundido de contenido de ${c.enter.dur} s (máximo 0,25 s; para claro↔oscuro usa enter {kind:'theme'})`)
    if (c.enter && ['sunrise', 'door', 'iris', 'rise'].includes(c.enter.kind) && !(m.prologue?.morph && c.start <= m.prologue.end)) out.push(`plano ${c.take}: transición «${c.enter.kind}» (la v2 pide content, match o corte causado por la app)`)
  }
  if (m.camera?.length) checkKeys(m.camera, 0, m.clips[0]?.take ?? '', 'cámara global')

  const titles = [...(m.titles ?? [])].sort((a, b) => a.start - b.start)
  for (let i = 0; i < titles.length; i++) {
    const t = titles[i]
    if (i > 0 && t.start < titles[i - 1].start + titles[i - 1].dur - 1e-6) out.push(`rótulo «${t.text}» se pisa con «${titles[i - 1].text}» en ${fmt(t.start)}`)
    if (grid && t.dur < 2 * grid.barDur - 1e-6) out.push(`rótulo «${t.text}» dura ${t.dur.toFixed(2)} s (< 2 compases)`)
    if (offBeat(t.start)) out.push(`rótulo «${t.text}» entra fuera del pulso en ${fmt(t.start)}`)
  }
  // rótulos que tapan la acción: el cursor (lo que se pulsa o se escribe) dentro de la caja del pie
  if (opts.cursorAt) {
    const [W, H] = m.size
    for (const t of titles.filter((x) => x.style === 'caption')) {
      const ay = (t.at?.[1] ?? (m.captionBand ? (m.captionBand + H) / 2 / H : 0.86)) * H
      const ax = (t.at?.[0] ?? 0.5) * W
      for (let x = t.start; x < t.start + t.dur; x += 0.1) {
        const hit = opts.cursorAt(x).find(([cx, cy]) => Math.abs(cx - ax) < W * 0.32 && Math.abs(cy - ay) < 70)
        if (hit) {
          out.push(`rótulo «${t.text}» tapa la acción (el cursor pasa por debajo en ${fmt(x)})`)
          break
        }
      }
    }
  }
  const stamps = [...(m.stamps ?? [])].sort((a, b) => a.t - b.t)
  for (let i = 1; i < stamps.length; i++) if (stamps[i].t - stamps[i - 1].t < 0.6) out.push(`sellos de hora demasiado seguidos en ${fmt(stamps[i].t)}`)
  if (grid && Math.abs(grid.duration - m.duration) > 0.05) out.push(`la película dura ${m.duration.toFixed(2)} s y la pista montada ${grid.duration.toFixed(2)} s`)
  return out
}
