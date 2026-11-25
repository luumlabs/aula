// Página del compositor (scripts/video/compose) para la música de la vista previa: sintetiza la pieza con renderMusic
// (OfflineAudioContext, que solo existe en la página) y devuelve las muestras en crudo. El máster y el WAV se hacen en
// Node (preview-music.mjs), con audio/loudness.ts.
import { vt } from '../../video/compose/bridge.ts'
import { renderMusic } from '../../video/audio/music.ts'
import type { Music } from '../../video/montage/types.ts'

interface Job {
  music: Music
  duration: number
  sampleRate: number
}

export async function run(): Promise<void> {
  try {
    const job = (await vt.job()) as Job
    const score = await renderMusic(job.music, job.duration, [], [], job.sampleRate)
    const [l, r] = score.channels
    // canal izquierdo y luego el derecho, en flotante de 32 bits
    const raw = new Uint8Array(l.byteLength + r.byteLength)
    raw.set(new Uint8Array(l.buffer, l.byteOffset, l.byteLength), 0)
    raw.set(new Uint8Array(r.buffer, r.byteOffset, r.byteLength), l.byteLength)
    await vt.write('music.f32', raw)
    vt.done({ frames: l.length, sampleRate: score.sampleRate })
  } catch (e) {
    vt.done({ error: e instanceof Error ? e.stack ?? e.message : String(e) })
  }
}
