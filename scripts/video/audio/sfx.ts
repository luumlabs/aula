// Sonidos de los personajes pixel art, sincronizados con su historia: se lee el guion de la historia (fotogramas, pasos
// de `ms`, `*n`) y cada parche que APARECE en un fotograma suena en ese instante (latido, pitido plano, descarga, risa,
// burbujas, gota, vaivén, humo, destellos, notas, moneda…). Puro: devuelve eventos; music.ts los sintetiza.
import type { AnimSpec, ClipName } from '../../../src/renderer/src/design/pixel/anim.ts'

export type SfxKind = 'heartbeat' | 'flatline' | 'zap' | 'giggle' | 'heart' | 'bubble' | 'plip' | 'splash' | 'slosh' | 'puff' | 'sparkle' | 'note' | 'coin' | 'pop'

export interface SfxEvent {
  t: number
  kind: SfxKind
  /** Duración (solo `flatline`). */
  dur?: number
  /** Contador por tipo dentro de la historia (para variar el tono de risas y notas). */
  n: number
  right?: boolean
}

/** Parche → sonido. Primero los nombres exactos, luego por prefijo. */
const EXACT: Record<string, SfxKind> = {
  small: 'heartbeat',
  khS: 'heartbeat',
  beat: 'heartbeat',
  flat: 'flatline',
  bolt: 'zap',
  boltL: 'zap',
  zap: 'zap',
  laugh: 'giggle',
  grin: 'giggle',
  heart: 'heart',
  heart3: 'heart',
  bub: 'bubble',
  bub1: 'bubble',
  bub2: 'bubble',
  drop: 'plip',
  drop3: 'plip',
  dp: 'plip',
  spl: 'splash',
  slL: 'slosh',
  slR: 'slosh',
  puff: 'puff',
  puff5: 'puff',
  dust: 'puff',
  tw1: 'sparkle',
  tw2: 'sparkle',
  tw3: 'sparkle',
  tw5: 'sparkle',
  twx: 'sparkle',
  star: 'sparkle',
  note: 'note',
  note2: 'note',
  coin: 'coin',
  bang: 'pop'
}

/** Nombres de los parches de un fotograma («kh bolt@-3,4 %RY @1,0 *2» → kh, bolt) y sus pasos. */
export function parseFrame(spec: string): { cels: string[]; ticks: number } {
  const cels: string[] = []
  let ticks = 1
  for (const tok of spec.trim().split(/\s+/).filter(Boolean)) {
    const hold = /^\*(\d+)$/.exec(tok)
    if (hold) ticks = Math.max(1, Number(hold[1]))
    else if (/^[A-Za-z_][\w]*(@-?\d+,-?\d+)?$/.test(tok)) cels.push(tok.split('@')[0])
  }
  return { cels, ticks }
}

/** Eventos de sonido de la pista `clip` de una historia que empieza en `t0` (segundos del vídeo). */
export function storyEvents(spec: AnimSpec, clip: ClipName, t0: number): SfxEvent[] {
  const c = spec[clip]
  if (!c) return []
  const ms = (c.ms ?? 100) / 1000
  const out: SfxEvent[] = []
  const counts: Partial<Record<SfxKind, number>> = {}
  let prev = new Set<string>()
  let t = t0
  const frames = c.frames.map(parseFrame)
  frames.forEach((f, i) => {
    const now = new Set(f.cels)
    const seen = new Set<SfxKind>()
    for (const cel of f.cels) {
      const kind = EXACT[cel]
      if (!kind || prev.has(cel) || seen.has(kind)) continue
      seen.add(kind)
      const n = (counts[kind] = (counts[kind] ?? 0) + 1)
      const ev: SfxEvent = { t, kind, n }
      if (kind === 'flatline') {
        // dura mientras el parche siga en los fotogramas siguientes
        let d = f.ticks * ms
        for (let k = i + 1; k < frames.length && frames[k].cels.includes(cel); k++) d += frames[k].ticks * ms
        ev.dur = d
      }
      if (kind === 'slosh') ev.right = cel.endsWith('R')
      out.push(ev)
    }
    prev = now
    t += f.ticks * ms
  })
  return out
}
