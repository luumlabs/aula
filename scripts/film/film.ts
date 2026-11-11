// El corto, de principio a fin: qué escena pinta cada instante y el acabado común (formato panorámico, viñeta, grano).
import { col, ease, H, P, seg, W, bell } from './engine/core.ts'
import { finish, sheet, temp, type Ctx, type Sheet } from './engine/paint.ts'
import { drawNight, initNight } from './scenes/night.ts'
import { bloomMask, drawFar, drawGate, initArch } from './scenes/arch.ts'
import { drawExam, drawStairs, initDawn } from './scenes/dawn.ts'
import { drawAula, initAula } from './scenes/aula.ts'

export { DURATION } from './timing.ts'
/** Altura de las franjas del formato panorámico (2,39:1). */
export const BARS = Math.round((H - W / 2.39) / 2)
let alt: Sheet
/** Ajustes del render: `grain` escala el grano de película (el corte web lleva menos, para pesar poco). */
export const look = { grain: 1 }

export async function initFilm(): Promise<void> {
  initNight()
  initArch()
  initDawn()
  await initAula()
  alt = sheet()
}

export function drawFilm(ctx: Ctx, t: number, frame: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.filter = 'none'
  ctx.clearRect(0, 0, W, H)
  let vignette = 0.55
  if (t < 18) drawNight(ctx, t, frame)
  else if (t < 27) drawFar(ctx, t, frame)
  else if (t < 31.6) {
    drawGate(ctx, t, frame)
    // al cruzar, el color se derrama desde el arco: el amanecer asoma por una mancha que crece
    const mask = bloomMask(t)
    if (mask) {
      alt.ctx.setTransform(1, 0, 0, 1, 0, 0)
      alt.ctx.globalAlpha = 1
      alt.ctx.clearRect(0, 0, W, H)
      drawStairs(alt.ctx, 31.6, frame)
      // la mancha tiene el borde corrido, como acuarela sobre papel mojado, y un cerco de pigmento dorado
      const m = temp(5)
      m.ctx.filter = 'blur(54px)'
      m.ctx.fillStyle = '#fff'
      m.ctx.fill(mask)
      m.ctx.filter = 'none'
      m.ctx.globalCompositeOperation = 'source-in'
      m.ctx.drawImage(alt.canvas, 0, 0)
      ctx.drawImage(m.canvas, 0, 0)
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      ctx.filter = 'blur(26px)'
      ctx.strokeStyle = col(P.glow, 0.55 * (1 - seg(t, 31.2, 31.75)))
      ctx.lineWidth = 46
      ctx.stroke(mask)
      ctx.restore()
    }
    const flash = bell(t, 30.0, 30.45, 30.5, 31.3)
    if (flash > 0) {
      ctx.fillStyle = col(P.sunCore, flash * 0.85)
      ctx.fillRect(0, 0, W, H)
    }
    vignette = 0.55 - seg(t, 30.4, 31.6) * 0.3
  } else if (t < 41.6) {
    drawStairs(ctx, t, frame)
    vignette = 0.25
  } else if (t < 49.6) {
    drawExam(ctx, t, frame)
    vignette = 0.22
  } else {
    drawAula(ctx, t, frame)
    vignette = 0.16
  }
  // las franjas se abren con la floración: el cuadro pasa de panorámico a pantalla completa
  const bars = BARS * (1 - ease.io(seg(t, 30.4, 31.9)))
  finish(ctx, { frame, bars, vignette, grain: (t < 31 ? 0.085 : 0.06) * look.grain })
}
