// Toques de pincel: los cuadraditos de color de la interfaz (los días de la racha, el dominio de cada tema, el mapa de
// constancia) van cortados a mano, como losetas pintadas, en vez de ser cuadrados de imprenta. Se pintan cuatro máscaras
// una sola vez (receta `tile`) y quedan en variables CSS; la clase `dab` (paint.css) las reparte. Sin ellas, el cuadrado
// se ve como antes.
import { requestPaint } from './cache'
import { seedOf } from './random'

const VARIANTS = 4
let installed = false

export function installDabs(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  for (let i = 1; i <= VARIANTS; i++) {
    requestPaint({ kind: 'tile', seed: seedOf(`toque:${i}`), w: 28, h: 28, scale: 3 }).then(
      (url) => document.documentElement.style.setProperty(`--dab-${i}`, `url(${url})`),
      () => {}
    )
  }
}
