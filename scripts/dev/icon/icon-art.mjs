// El icono de Aula en SVG, generado con código (sin dependencias). Cada propuesta dibuja su arte en una caja local de
// 824×824 (la «squircle» de macOS) y `iconSvg()` la coloca en el lienzo de cada plataforma:
//   · mac   → lienzo 1024 con la squircle de 824 en (100,100) y sombra propia (rejilla de Apple desde Big Sur; macOS 26
//             reconoce esa forma y no mete el icono en la «cárcel» gris).
//   · plain → la squircle ocupando casi todo el lienzo (Windows .ico, Linux, README, notificaciones).
// `detail` simplifica el dibujo para tamaños pequeños: 'full' (≥128 px), 'mid' (48–64 px), 'small' (≤32 px).

const rad = (deg) => (deg * Math.PI) / 180
const f = (n) => Number(n.toFixed(2))

/** Rectángulo con esquinas continuas (el «suavizado de esquinas» de Figma, 0.6 ≈ el de Apple). */
export function squirclePath(x, y, w, h, r, s = 0.6) {
  const p = (1 + s) * r
  const arcMeasure = 90 * (1 - s)
  const arc = Math.sin(rad(arcMeasure / 2)) * r * Math.SQRT2
  const alpha = (90 - arcMeasure) / 2
  const p34 = r * Math.tan(rad(alpha / 2))
  const beta = 45 * s
  const c = p34 * Math.cos(rad(beta))
  const d = c * Math.tan(rad(beta))
  const b = (p - arc - c - d) / 3
  const a = 2 * b
  const [A, AB, ABC, BC, C, D, R, L] = [a, a + b, a + b + c, b + c, c, d, r, arc].map(f)
  return [
    `M${f(x + p)} ${f(y)}H${f(x + w - p)}`,
    `c${A} 0 ${AB} 0 ${ABC} ${D}a${R} ${R} 0 0 1 ${L} ${L}c${D} ${C} ${D} ${BC} ${D} ${ABC}`,
    `V${f(y + h - p)}`,
    `c0 ${A} 0 ${AB} ${-D} ${ABC}a${R} ${R} 0 0 1 ${-L} ${L}c${-C} ${D} ${-BC} ${D} ${-ABC} ${D}`,
    `H${f(x + p)}`,
    `c${-A} 0 ${-AB} 0 ${-ABC} ${-D}a${R} ${R} 0 0 1 ${-L} ${-L}c${-D} ${-C} ${-D} ${-BC} ${-D} ${-ABC}`,
    `V${f(y + p)}`,
    `c0 ${-A} 0 ${-AB} ${D} ${-ABC}a${R} ${R} 0 0 1 ${L} ${-L}c${C} ${-D} ${BC} ${-D} ${ABC} ${-D}Z`
  ].join('')
}

/** Arco de medio punto: base en `bottom`, ancho `w`, clave en `top`. */
export function archPath(cx, top, w, bottom) {
  const r = w / 2
  return `M${f(cx - r)} ${f(bottom)}V${f(top + r)}A${f(r)} ${f(r)} 0 0 1 ${f(cx + r)} ${f(top + r)}V${f(bottom)}Z`
}

/** Medio sol (semicírculo apoyado en y). */
function halfSun(cx, y, r) {
  return `M${f(cx - r)} ${f(y)}A${f(r)} ${f(r)} 0 0 1 ${f(cx + r)} ${f(y)}Z`
}

const BOX = 824
const CX = BOX / 2
const MASK = squirclePath(0, 0, BOX, BOX, 185.4)

// Paleta «Papel y luz» (styles.css): papel, ladrillo (#B4502F / #EA9A6C) y sol (#B97A12 / #F2C275).
const P = {
  paper: '#FBF7EF', paper2: '#F1E8D9', paperEdge: '#E2D3BC', paperShade: '#D6C4A8',
  brick: '#B4502F', brickDeep: '#8A3A20', brickNight: '#5E2715', brickLight: '#EA9A6C',
  sun: '#F2C275', sunCore: '#FFF0CF', sunDeep: '#E7A24E',
  ink: '#201E1A', inkWarm: '#2A211B', inkDeep: '#15110D'
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A · «Papel y luz»: una pared de papel con una ventana en arco (el aula); dentro, el sol sale por detrás de un horizonte
// de papel recortado (tres capas que se hacen sombra) con el canto encendido a contraluz, y unos píxeles de estrellas.
function dawn(detail) {
  const full = detail === 'full'
  const small = detail === 'small'
  const win = small ? { w: 572, top: 84, bottom: 690 } : { w: 516, top: 100, bottom: 672 }
  // el arco sin la base: la sombra del muro solo cae desde arriba y los lados
  const archLine = (y) => `M${CX - win.w / 2} ${y}V${win.top + win.w / 2}A${win.w / 2} ${win.w / 2} 0 0 1 ${CX + win.w / 2} ${win.top + win.w / 2}V${y}`
  const archTop = archLine(win.bottom + 40)
  const archEdge = archLine(win.bottom)
  const sill = { x: CX - win.w / 2 - 34, y: win.bottom - 4, w: win.w + 68, h: small ? 34 : 30 }
  const hole = archPath(CX, win.top, win.w, win.bottom)
  const sun = small ? { y: 548, r: 172 } : { y: 540, r: 146 }
  const L = 120 // por fuera de la ventana, para que el recorte haga los bordes
  const R = BOX - 120
  const B = win.bottom + 20
  const hills = small
    ? [
        { d: `M${L} 590C260 560 330 556 400 578C470 600 560 560 ${R} 574V${B}H${L}Z`, fill: '#F4D3B6' },
        { d: `M${L} 650C250 636 330 628 412 640C500 652 600 636 ${R} 640V${B}H${L}Z`, fill: '#FDF6EC' }
      ]
    : [
        { d: `M${L} 540C230 504 300 499 360 524C420 549 470 559 540 529C600 504 640 499 ${R} 516V${B}H${L}Z`, fill: '#F0C6A2' },
        { d: `M${L} 588C220 567 280 562 330 582C390 607 450 586 520 574C580 564 640 580 ${R} 592V${B}H${L}Z`, fill: '#F7DFC6' },
        { d: `M${L} 632C230 622 300 610 380 621C460 632 540 630 600 619C630 614 660 615 ${R} 621V${B}H${L}Z`, fill: '#FDF6EC' }
      ]
  const stars = full
    ? [[248, 250, 16, 0.95], [560, 214, 12, 0.8], [586, 316, 18, 0.9], [300, 172, 10, 0.6], [474, 154, 8, 0.5]]
        .map(([x, y, s, o]) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${P.sunCore}" opacity="${o}"/>`)
        .join('')
    : ''
  let land = ''
  hills.forEach((h, i) => {
    if (!small && i > 0) land += `<path d="${h.d}" fill="#5A2412" opacity="0.30" filter="url(#hillShadow)" transform="translate(0 -8)"/>`
    land += `<path d="${h.d}" fill="${h.fill}"/>`
    // la capa de delante es una hoja de cuaderno: dos renglones que siguen su borde
    if (!small && i === hills.length - 1)
      land += `<g clip-path="url(#front)">${[24, 46].map((o) => `<path d="${h.d}" fill="none" stroke="#E8CDB4" stroke-width="3" transform="translate(0 ${o})"/>`).join('')}</g>`
    // canto a contraluz: el sol enciende el borde del papel
    if (!small) land += `<path d="${h.d}" fill="none" stroke="${P.sunCore}" stroke-width="${i === 0 ? 5 : 4}" opacity="${i === 0 ? 0.95 : 0.7}"/>`
  })
  return `
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FCF8F1"/><stop offset="1" stop-color="#F0E6D6"/>
    </linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7A3018"/><stop offset="0.48" stop-color="${P.brick}"/><stop offset="0.82" stop-color="#E58B5C"/><stop offset="1" stop-color="#F2AE7A"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FFE3AE" stop-opacity="0.85"/><stop offset="0.5" stop-color="${P.sun}" stop-opacity="0.28"/><stop offset="1" stop-color="${P.sun}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sunFill" cx="0.5" cy="0.7" r="0.7">
      <stop offset="0" stop-color="#FFF6E0"/><stop offset="0.55" stop-color="#FCE1A6"/><stop offset="1" stop-color="${P.sun}"/>
    </radialGradient>
    <linearGradient id="sill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFDF8"/><stop offset="1" stop-color="#E9DCC8"/>
    </linearGradient>
    <radialGradient id="roomLight" cx="0.5" cy="0.62" r="0.75">
      <stop offset="0" stop-color="#FFF8EC" stop-opacity="0"/><stop offset="0.6" stop-color="#E9DAC3" stop-opacity="0.15"/><stop offset="1" stop-color="#D9C4A6" stop-opacity="0.75"/>
    </radialGradient>
    <filter id="sillShadow" x="-20%" y="-100%" width="140%" height="400%"><feGaussianBlur stdDeviation="10"/></filter>
    <clipPath id="hole"><path d="${hole}"/></clipPath>
    <clipPath id="front"><path d="${hills[hills.length - 1].d}"/></clipPath>
    <filter id="hillShadow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
    <filter id="jamb" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="28"/></filter>
    ${full ? `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11"/><feColorMatrix values="0 0 0 0 0.42  0 0 0 0 0.32  0 0 0 0 0.22  0 0 0 0.06 0"/></filter>` : ''}
  </defs>
  <rect width="${BOX}" height="${BOX}" fill="url(#wall)"/>
  <rect width="${BOX}" height="${BOX}" fill="url(#roomLight)"/>
  ${full ? `<rect width="${BOX}" height="${BOX}" filter="url(#grain)"/>` : ''}
  ${small ? '' : `<path d="${hole}" fill="${P.sun}" opacity="0.28" filter="url(#soft)" transform="translate(0 10)"/>`}
  <path d="${hole}" fill="url(#sky)"/>
  <g clip-path="url(#hole)">
    ${stars}
    <circle cx="${CX}" cy="${sun.y}" r="${sun.r * 2.4}" fill="url(#halo)"/>
    <circle cx="${CX}" cy="${sun.y}" r="${sun.r}" fill="url(#sunFill)"/>
    ${land}
    ${small ? '' : `<path d="${archTop}" fill="none" stroke="#2E0F05" stroke-width="40" opacity="0.38" filter="url(#jamb)" transform="translate(0 12)"/>`}
  </g>
  ${small ? '' : `<path d="${archEdge}" fill="none" stroke="#C8B193" stroke-width="2.5" opacity="0.6"/>`}
  <!-- el alféizar: una tira de papel que sobresale y hace sombra en la pared -->
  ${small ? '' : `<rect x="${sill.x}" y="${sill.y + 8}" width="${sill.w}" height="${sill.h}" rx="10" fill="#4A2412" opacity="0.30" filter="url(#sillShadow)"/>`}
  <rect x="${sill.x}" y="${sill.y}" width="${sill.w}" height="${sill.h}" rx="${small ? 8 : 10}" fill="url(#sill)"/>
  ${small ? '' : `<rect x="${sill.x + 6}" y="${sill.y + 1.5}" width="${sill.w - 12}" height="3" rx="1.5" fill="${P.sunCore}"/>`}
  `
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// B · «Una sola luz»: de noche, en una sala oscura, la única luz es la puerta en arco; el sol dentro y la luz que se
// derrama por el suelo hacia ti. Unos píxeles de estrellas.
function oneLight(detail) {
  const full = detail === 'full'
  const small = detail === 'small'
  const door = small ? { w: 380, top: 132, bottom: 560 } : { w: 330, top: 150, bottom: 556 }
  const hole = archPath(CX, door.top, door.w, door.bottom)
  const dl = CX - door.w / 2
  const dr = CX + door.w / 2
  const spill = `M${dl} ${door.bottom}L${dr} ${door.bottom}L${dr + 230} ${BOX}L${dl - 230} ${BOX}Z`
  const stars = full
    ? [[160, 180, 16, 0.9], [640, 140, 12, 0.7], [690, 300, 18, 0.85], [118, 360, 10, 0.55], [230, 96, 10, 0.6]]
        .map(([x, y, s, o]) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${P.sun}" opacity="${o}"/>`)
        .join('')
    : ''
  return `
  <defs>
    <linearGradient id="room" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2E241D"/><stop offset="1" stop-color="${P.inkDeep}"/>
    </linearGradient>
    <linearGradient id="doorFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.brickLight}"/><stop offset="1" stop-color="#F6CB95"/>
    </linearGradient>
    <linearGradient id="spill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.brickLight}" stop-opacity="0.75"/><stop offset="1" stop-color="${P.brickLight}" stop-opacity="0.05"/>
    </linearGradient>
    <radialGradient id="sunFill" cx="0.5" cy="0.8" r="0.8">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="${P.sunCore}"/><stop offset="1" stop-color="${P.sun}"/>
    </radialGradient>
    <clipPath id="hole"><path d="${hole}"/></clipPath>
    <filter id="bloom" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="${small ? 20 : 40}"/></filter>
    <filter id="blur8" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>
  </defs>
  <rect width="${BOX}" height="${BOX}" fill="url(#room)"/>
  ${stars}
  <path d="${hole}" fill="${P.brickLight}" opacity="0.55" filter="url(#bloom)"/>
  <path d="${spill}" fill="url(#spill)"/>
  ${small ? '' : `<path d="M0 ${door.bottom}H${BOX}" stroke="${P.brickLight}" stroke-width="3" opacity="0.18"/>`}
  <path d="${hole}" fill="url(#doorFill)"/>
  <g clip-path="url(#hole)">
    <circle cx="${CX}" cy="${door.bottom}" r="${door.w * 0.62}" fill="${P.sunCore}" opacity="0.35" filter="url(#blur8)"/>
    <path d="${halfSun(CX, door.bottom, door.w * 0.34)}" fill="url(#sunFill)"/>
  </g>
  `
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// C · «Sol de píxeles»: el icono de siempre, más rotundo. Arco de papel con grosor sobre ladrillo y un sol hecho de
// píxeles que sale por la puerta (el pixel-art de los cursos).
function pixelSun(detail) {
  const full = detail === 'full'
  const small = detail === 'small'
  const outer = small ? { w: 560, top: 120, bottom: 712 } : { w: 520, top: 128, bottom: 700 }
  const t = small ? 128 : 112
  const inner = { w: outer.w - 2 * t, top: outer.top + t, bottom: outer.bottom }
  const ring = archPath(CX, outer.top, outer.w, outer.bottom) + archPath(CX, inner.top, inner.w, inner.bottom)
  const door = archPath(CX, inner.top, inner.w, inner.bottom)
  // sol de píxeles: semicírculo rasterizado en celdas
  const cell = 28
  const sr = 5.6 // radio en celdas
  let px = ''
  if (small) {
    px = `<path d="${halfSun(CX, inner.bottom, inner.w * 0.42)}" fill="${P.sun}"/>`
  } else {
    for (let j = 0; j < 6; j++) {
      for (let i = -6; i < 6; i++) {
        const cx = i + 0.5
        const cy = j + 0.5
        const d = Math.hypot(cx, cy)
        if (d > sr) continue
        const col = d < 2.6 ? P.sunCore : d < 4.4 ? '#FAD99A' : P.sun
        px += `<rect x="${CX + i * cell}" y="${inner.bottom - (j + 1) * cell}" width="${cell + 0.5}" height="${cell + 0.5}" fill="${col}"/>`
      }
    }
    if (full) {
      // estrellas de píxel en el cielo de la puerta
      px += [[-3.5, 11], [2.5, 12.5], [3.2, 9.4]]
        .map(([i, j], k) => `<rect x="${CX + i * cell}" y="${inner.bottom - j * cell}" width="${cell * (k === 1 ? 0.6 : 0.8)}" height="${cell * (k === 1 ? 0.6 : 0.8)}" fill="${P.sunCore}" opacity="${0.9 - k * 0.2}"/>`)
        .join('')
    }
  }
  return `
  <defs>
    <linearGradient id="brick" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#C9653F"/><stop offset="1" stop-color="#A2452A"/>
    </linearGradient>
    <linearGradient id="doorIn" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5A2412"/><stop offset="0.7" stop-color="#9A4226"/><stop offset="1" stop-color="#D9784C"/>
    </linearGradient>
    <linearGradient id="arch" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFDF8"/><stop offset="1" stop-color="${P.paper2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="1" r="0.9">
      <stop offset="0" stop-color="${P.sun}" stop-opacity="0.65"/><stop offset="1" stop-color="${P.sun}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="door"><path d="${door}"/></clipPath>
    <filter id="blur14" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>
  <rect width="${BOX}" height="${BOX}" fill="url(#brick)"/>
  <path d="${door}" fill="url(#doorIn)"/>
  <g clip-path="url(#door)">
    ${px}
  </g>
  ${small ? '' : `<path d="${ring}" fill-rule="evenodd" fill="#4A1C0C" opacity="0.35" filter="url(#blur14)" transform="translate(0 18)"/>`}
  <path d="${ring}" fill-rule="evenodd" fill="${P.paperEdge}" transform="translate(0 ${small ? 8 : 12})"/>
  <path d="${ring}" fill-rule="evenodd" fill="url(#arch)"/>
  `
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// D · «Claustro de papel»: arcos de papel recortado, uno dentro de otro, que se hunden hacia el sol (las aulas de un
// claustro). Cada capa proyecta su sombra sobre la siguiente.
function cloister(detail) {
  const small = detail === 'small'
  const layers = small
    ? [
        { w: 600, top: 96, fill: '#F3E6D4' },
        { w: 420, top: 236, fill: '#DEC5A6' },
        { w: 260, top: 372, fill: P.brick }
      ]
    : [
        { w: 610, top: 96, fill: '#F3E6D4' },
        { w: 490, top: 196, fill: '#EAD8C1' },
        { w: 378, top: 288, fill: '#DEC5A6' },
        { w: 274, top: 372, fill: '#CFAE88' },
        { w: 180, top: 448, fill: P.brick }
      ]
  const bottom = BOX + 10
  let s = ''
  layers.forEach((l, i) => {
    const d = archPath(CX, l.top, l.w, bottom)
    if (!small && i > 0) s += `<path d="${d}" fill="#3A1608" opacity="0.30" filter="url(#sh)" transform="translate(0 -6)"/>`
    s += `<path d="${d}" fill="${l.fill}"/>`
    if (!small) s += `<path d="${d}" fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="3"/>`
  })
  const last = layers[layers.length - 1]
  const sunR = last.w * (small ? 0.42 : 0.4)
  return `
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.paper}"/><stop offset="1" stop-color="${P.paper2}"/>
    </linearGradient>
    <radialGradient id="sunFill" cx="0.5" cy="0.9" r="0.9">
      <stop offset="0" stop-color="${P.sunCore}"/><stop offset="1" stop-color="${P.sun}"/>
    </radialGradient>
    <filter id="sh" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="16"/></filter>
    <filter id="bloom" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="30"/></filter>
  </defs>
  <rect width="${BOX}" height="${BOX}" fill="url(#wall)"/>
  ${s}
  <circle cx="${CX}" cy="${BOX - 60}" r="${sunR * 1.6}" fill="${P.sun}" opacity="0.5" filter="url(#bloom)"/>
  <circle cx="${CX}" cy="${BOX - 60}" r="${sunR}" fill="url(#sunFill)"/>
  `
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Segunda ronda (el dueño dudaba entre C y D): C2, D2 y la mezcla E. Para que el sol no parezca una fogata, ya no se
// apoya en el suelo de la puerta: sale sobre un horizonte a media altura, con el mar debajo y su reflejo a rayas.

/** Marco: todo el cuadro menos un hueco (evenodd). */
const ring = (hole) => `M-40 -40H${BOX + 40}V${BOX + 40}H-40Z${hole}`

/**
 * Medio sol de píxel-art sobre el horizonte (filas de abajo arriba; por defecto un círculo de 12 celdas de diámetro),
 * con brillo arriba a la izquierda y rayos de un píxel separados del disco.
 */
function pixelDome(cx, baseY, cell, { rows = [12, 12, 10, 10, 8, 4], color, light, rays = true }) {
  let s = ''
  rows.forEach((w, j) => {
    s += `<rect x="${f(cx - (w * cell) / 2)}" y="${f(baseY - (j + 1) * cell)}" width="${f(w * cell + 0.6)}" height="${f(cell + 0.6)}" fill="${color}"/>`
  })
  const top = rows.length - 1
  const tx = cx - (rows[top] * cell) / 2
  const sx = cx - (rows[top - 1] * cell) / 2
  s += `<rect x="${f(tx)}" y="${f(baseY - (top + 1) * cell)}" width="${f(cell * 2)}" height="${f(cell)}" fill="${light}"/>`
  s += `<rect x="${f(sx + cell)}" y="${f(baseY - top * cell)}" width="${f(cell)}" height="${f(cell)}" fill="${light}"/>`
  if (rays) {
    const R = (rows[0] / 2 + 1.7) * cell
    for (const deg of [166, 130, 90, 50, 14]) {
      const a = rad(deg)
      const x = Math.floor((Math.cos(a) * R) / cell) * cell + cx
      const y = baseY - (Math.floor((Math.sin(a) * R) / cell) + 1) * cell
      s += `<rect x="${f(x)}" y="${f(y)}" width="${f(cell)}" height="${f(cell)}" fill="${light}"/>`
    }
  }
  return s
}

const PALETTES = {
  // atardecer de ladrillo (C2, E)
  dusk: { sky: ['#E2885A', '#C55F39', '#9E4427', '#76301A'], sea: '#5A2413', sun: '#FFD27A', light: '#FFF3D6', glint: '#FFD27A', stars: true },
  // la puerta de luz (D2): cielo claro y un sol más hondo para que se distinga
  dawn: { sky: ['#FFF3DA', '#FFE7BC', '#FCD9A0', '#F6C788'], sea: '#EDB27C', sun: '#E9953F', light: '#FFE2A6', glint: '#E9953F', stars: false }
}

/**
 * La escena de la ventana: cielo (a franjas planas en 'full'), medio sol en el horizonte (a 64 % de la altura), mar
 * con el reflejo a rayas. Quien llama la recorta con su arco.
 */
function sunsetScene({ x0, x1, top, bottom, detail, palette, sunR, horizonAt = 0.64, pixel = true }) {
  const p = PALETTES[palette]
  const cx = (x0 + x1) / 2
  const cell = sunR / 6
  const horizon = f(top + (bottom - top) * horizonAt)
  const W = x1 - x0
  let s = ''
  if (detail === 'full' && !pixel) {
    // cielo liso (un solo tono que se aclara hacia el horizonte) y sol redondo con halo
    s += `<linearGradient id="skyS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[3]}"/><stop offset="1" stop-color="${p.sky[0]}"/></linearGradient>`
    s += `<rect x="${x0}" y="${top - 20}" width="${W}" height="${horizon - top + 20}" fill="url(#skyS)"/>`
    s += `<circle cx="${cx}" cy="${horizon}" r="${f(sunR * 1.7)}" fill="${p.light}" opacity="0.55"/>`
    s += `<path d="${halfSun(cx, horizon, sunR)}" fill="${p.sun}"/>`
  } else if (detail === 'full') {
    let y = horizon
    const heights = [3, 4, 5]
    // franjas planas de altura en celdas (sin trama: tramada parecía una almena)
    p.sky.forEach((color, i) => {
      const h = i < heights.length ? heights[i] * cell : y - top + 40
      s += `<rect x="${x0}" y="${f(y - h)}" width="${W}" height="${f(h + 0.6)}" fill="${color}"/>`
      y -= h
    })
    if (p.stars)
      // tres estrellas arriba, lejos del sol (cerca parecían chispas)
      s += [[-5, 14], [4, 16], [1, 12.5]]
        .map(([i, j], k) => `<rect x="${f(cx + i * cell)}" y="${f(horizon - Math.round(j) * cell)}" width="${f(cell)}" height="${f(cell)}" fill="${p.light}" opacity="${0.95 - k * 0.2}"/>`)
        .join('')
    s += pixelDome(cx, horizon, cell, { color: p.sun, light: p.light })
  } else {
    s += `<rect x="${x0}" y="${top - 20}" width="${W}" height="${horizon - top + 20}" fill="${p.sky[detail === 'small' ? 0 : 2]}"/>`
    if (detail === 'mid') s += `<rect x="${x0}" y="${horizon - sunR * 0.9}" width="${W}" height="${sunR * 0.9}" fill="${p.sky[0]}"/>`
    s += `<path d="${halfSun(cx, horizon, sunR)}" fill="${p.sun}"/>`
  }
  // el mar y el reflejo
  s += `<rect x="${x0}" y="${horizon}" width="${W}" height="${f(bottom - horizon + 20)}" fill="${p.sea}"/>`
  const stripes = detail === 'full' ? [10, 7, 5, 3] : detail === 'mid' ? [9, 5] : [9]
  const sh = detail === 'small' ? cell * 1.6 : cell * 0.8
  stripes.forEach((w, k) => {
    s += `<rect x="${f(cx - (w * cell) / 2)}" y="${f(horizon + cell * (0.8 + 2 * k))}" width="${f(w * cell)}" height="${f(sh)}" fill="${p.glint}" opacity="${f(1 - k * 0.2)}"/>`
  })
  if (detail !== 'small') s += `<rect x="${x0}" y="${horizon}" width="${W}" height="${f(cell * 0.3)}" fill="${p.light}" opacity="0.6"/>`
  return s
}

const grainFilter = `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11"/><feColorMatrix values="0 0 0 0 0.42  0 0 0 0 0.32  0 0 0 0 0.22  0 0 0 0.06 0"/></filter>`

/** El arco blanco grueso de la C (con su canto y su sombra) y lo que se ve por la puerta. */
function whiteArch({ detail, outer, t, inside }) {
  const small = detail === 'small'
  const full = detail === 'full'
  const inner = { w: outer.w - 2 * t, top: outer.top + t, bottom: outer.bottom }
  const archRing = archPath(CX, outer.top, outer.w, outer.bottom) + archPath(CX, inner.top, inner.w, inner.bottom)
  const door = archPath(CX, inner.top, inner.w, inner.bottom)
  const x0 = CX - inner.w / 2
  const x1 = CX + inner.w / 2
  return `
  <defs>
    <linearGradient id="brick" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#C55F39"/><stop offset="1" stop-color="#A9482A"/>
    </linearGradient>
    <linearGradient id="arch" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFDF8"/><stop offset="1" stop-color="#F3EADC"/>
    </linearGradient>
    <clipPath id="door"><path d="${door}"/></clipPath>
    <filter id="blur14" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="jamb" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>
    <filter id="sh" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
    ${full ? grainFilter : ''}
  </defs>
  <rect width="${BOX}" height="${BOX}" fill="url(#brick)"/>
  ${full ? `<rect width="${BOX}" height="${BOX}" filter="url(#grain)"/>` : ''}
  <g clip-path="url(#door)">
    ${inside({ x0, x1, top: inner.top, bottom: inner.bottom, w: inner.w })}
    ${small ? '' : `<path d="M${x0} ${inner.bottom + 40}V${inner.top + inner.w / 2}A${inner.w / 2} ${inner.w / 2} 0 0 1 ${x1} ${inner.top + inner.w / 2}V${inner.bottom + 40}" fill="none" stroke="#2E0F05" stroke-width="30" opacity="0.4" filter="url(#jamb)" transform="translate(0 8)"/>`}
  </g>
  ${small ? '' : `<path d="${archRing}" fill-rule="evenodd" fill="#4A1C0C" opacity="0.38" filter="url(#blur14)" transform="translate(0 20)"/>`}
  <path d="${archRing}" fill-rule="evenodd" fill="#E0CCB2" transform="translate(0 ${small ? 10 : 14})"/>
  <path d="${archRing}" fill-rule="evenodd" fill="url(#arch)"/>
  `
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// C2 · «Sol de píxeles»: el arco blanco grueso sobre ladrillo; por la puerta, un atardecer en píxel-art: cielo a franjas planas
// con estrellas, medio sol redondo de píxeles grandes con brillo y rayos sueltos, y su reflejo en el mar.
function pixelSun2(detail) {
  const small = detail === 'small'
  return whiteArch({
    detail,
    outer: small ? { w: 620, top: 96, bottom: 728 } : { w: 560, top: 108, bottom: 716 },
    t: small ? 150 : 118,
    inside: ({ x0, x1, top, bottom, w }) =>
      sunsetScene({ x0, x1, top, bottom, detail, palette: 'dusk', sunR: small ? w * 0.4 : w * 0.31, horizonAt: small ? 0.6 : 0.62 })
  })
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// D2 · «Claustro de papel»: marcos de papel en perspectiva (cada arco más estrecho y su umbral más alto, como un pasillo),
// que se oscurecen hacia dentro hasta una puerta de luz donde sale el sol. 5 marcos a tamaño grande, 3 a 64 px, 2 a 32.
function cloister2(detail) {
  const small = detail === 'small'
  const fills = {
    full: ['#F7EEE1', '#EBD3B6', '#D9A27C', '#BF6440', '#8A3A20'],
    mid: ['#F7EEE1', '#D99A72', '#9A4024'],
    small: ['#F7EEE1', '#A9472A']
  }[detail]
  const outer = { w: 690, top: 60, bottom: 900 }
  const light = small ? { w: 330, top: 300, bottom: 690 } : detail === 'mid' ? { w: 260, top: 360, bottom: 664 } : { w: 214, top: 392, bottom: 646 }
  const n = fills.length
  const ratio = Math.pow(light.w / outer.w, 1 / n)
  const lerp = (a, b, k) => a + (b - a) * k
  const frames = fills.map((fill, i) => {
    const w = outer.w * Math.pow(ratio, i)
    const k = (outer.w - w) / (outer.w - light.w)
    return { w, top: lerp(outer.top, light.top, k), bottom: lerp(outer.bottom, light.bottom, k), fill }
  })
  const lightPath = archPath(CX, light.top, light.w, light.bottom)
  const holes = [...frames.map((l) => archPath(CX, l.top, l.w, l.bottom)).slice(0, 1), ...frames.slice(1).map((l) => archPath(CX, l.top, l.w, l.bottom))]
  // hueco de cada marco: el del siguiente (el último deja ver la luz)
  const holeOf = (i) => (i + 1 < n ? archPath(CX, frames[i + 1].top, frames[i + 1].w, frames[i + 1].bottom) : lightPath)
  let s = `<g clip-path="url(#light)">${sunsetScene({ x0: CX - light.w / 2, x1: CX + light.w / 2, top: light.top, bottom: light.bottom, detail, palette: 'dawn', sunR: light.w * (small ? 0.4 : 0.34), horizonAt: 0.66, pixel: false })}</g>`
  for (let i = n - 1; i >= 0; i--) {
    const hole = i === 0 ? holes[0] : holeOf(i)
    if (i === 0) {
      // la pared: el squircle entero con el primer hueco
      if (!small) s += `<path d="${ring(hole)}" fill-rule="evenodd" fill="#3A1608" opacity="0.2" filter="url(#sh)" transform="translate(0 10)"/>`
      s += `<path d="${ring(hole)}" fill-rule="evenodd" fill="${fills[0]}"/>`
      continue
    }
    if (!small) s += `<path d="${ring(holeOf(i))}" fill-rule="evenodd" fill="#3A1608" opacity="${0.24 + i * 0.03}" filter="url(#sh)" transform="translate(0 10)" clip-path="url(#h${i})"/>`
    s += `<path d="${ring(holeOf(i))}" fill-rule="evenodd" fill="${fills[i]}" clip-path="url(#h${i})"/>`
    if (!small) s += `<path d="${holeOf(i)}" fill="none" stroke="#FFE6BC" stroke-width="${3 + i * 0.8}" opacity="${0.4 + i * 0.08}"/>`
  }
  const clips = frames.map((l, i) => `<clipPath id="h${i}"><path d="${archPath(CX, l.top, l.w, l.bottom)}"/></clipPath>`).join('')
  return `
  <defs>
    <clipPath id="light"><path d="${lightPath}"/></clipPath>
    ${clips}
    <filter id="sh" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="bloom" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${detail === 'mid' ? 22 : 30}"/></filter>
    ${detail === 'full' ? grainFilter : ''}
  </defs>
  <rect width="${BOX}" height="${BOX}" fill="${fills[0]}"/>
  ${s}
  ${small ? '' : `<path d="${lightPath}" fill="#FFD48A" opacity="0.4" filter="url(#bloom)"/>`}
  ${detail === 'full' ? `<rect width="${BOX}" height="${BOX}" filter="url(#grain)"/>` : ''}
  `
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// E · «Arco y claustro» (C×D): el arco blanco grueso de la C sobre ladrillo; dentro, dos marcos de papel en perspectiva
// (la D) que llevan a una ventana con el atardecer de píxeles.
function blend(detail) {
  const small = detail === 'small'
  return whiteArch({
    detail,
    outer: small ? { w: 620, top: 96, bottom: 728 } : { w: 572, top: 104, bottom: 720 },
    t: small ? 140 : 108,
    inside: ({ x0, x1, top, bottom, w }) => {
      // a 32 px o menos, sin marcos: queda como la C2
      const fills = small ? [] : ['#EBCDAE', '#D3855E']
      const n = fills.length
      const win = small ? { w, top, bottom } : { w: w * 0.5, top: top + 120, bottom: bottom - 64 }
      const lerp = (a, b, k) => a + (b - a) * k
      const frames = fills.map((fill, i) => {
        const k = i / n
        return { w: lerp(w, win.w, k), top: lerp(top, win.top, k), bottom: lerp(bottom, win.bottom, k), fill }
      })
      const winPath = archPath(CX, win.top, win.w, win.bottom)
      let s = `<clipPath id="win"><path d="${winPath}"/></clipPath>`
      s += `<g clip-path="url(#win)">${sunsetScene({ x0: CX - win.w / 2, x1: CX + win.w / 2, top: win.top, bottom: win.bottom, detail, palette: 'dusk', sunR: win.w * (small ? 0.42 : 0.34), horizonAt: 0.62 })}</g>`
      for (let i = n - 1; i >= 0; i--) {
        const hole = i + 1 < n ? archPath(CX, frames[i + 1].top, frames[i + 1].w, frames[i + 1].bottom) : winPath
        if (!small) s += `<path d="${ring(hole)}" fill-rule="evenodd" fill="#3A1608" opacity="0.3" filter="url(#sh)" transform="translate(0 8)"/>`
        s += `<path d="${ring(hole)}" fill-rule="evenodd" fill="${frames[i].fill}"/>`
        if (!small) s += `<path d="${hole}" fill="none" stroke="#FFE6BC" stroke-width="3" opacity="0.6"/>`
      }
      return s
    }
  })
}

export const PROPOSALS = {
  dawn: { name: 'A · Papel y luz', art: dawn },
  oneLight: { name: 'B · Una sola luz', art: oneLight },
  pixelSun: { name: 'C · Sol de píxeles', art: pixelSun },
  cloister: { name: 'D · Claustro de papel', art: cloister },
  c2: { name: 'C2 · Sol de píxeles', art: pixelSun2 },
  d2: { name: 'D2 · Claustro de papel', art: cloister2 },
  e: { name: 'E · Arco y claustro (C×D)', art: blend }
}

export function detailFor(size) {
  return size <= 32 ? 'small' : size <= 64 ? 'mid' : 'full'
}

/**
 * SVG completo de una propuesta a un tamaño dado.
 * @param {keyof typeof PROPOSALS} id
 * @param {{ size: number, platform?: 'mac' | 'plain', detail?: 'full' | 'mid' | 'small' }} o
 */
export function iconSvg(id, { size, platform = 'mac', detail = detailFor(size) }) {
  const art = PROPOSALS[id].art(detail)
  // mac: squircle de 824 en (100,100) del lienzo 1024. plain: casi a sangre (margen de 1/32).
  const box = platform === 'mac' ? { x: 100, y: 100, s: 824 } : { x: 32, y: 32, s: 960 }
  const k = box.s / BOX
  const shadow =
    platform === 'mac'
      ? `<path d="${MASK}" transform="translate(${box.x} ${box.y + 12}) scale(${k})" fill="#000" opacity="0.28" filter="url(#dropA)"/>
         <path d="${MASK}" transform="translate(${box.x} ${box.y + 3}) scale(${k})" fill="#000" opacity="0.14" filter="url(#dropB)"/>`
      : ''
  // un filo de luz por dentro del borde (el papel tiene canto) y otro de sombra abajo
  const rim =
    detail === 'small'
      ? ''
      : `<path d="${MASK}" fill="none" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="5" clip-path="url(#mask)"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="mask"><path d="${MASK}"/></clipPath>
    <filter id="dropA" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="dropB" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  ${shadow}
  <g transform="translate(${box.x} ${box.y}) scale(${k})">
    <g clip-path="url(#mask)">${art}</g>
    ${rim}
    ${platform === 'plain' ? `<path d="${MASK}" fill="none" stroke="#5A3A1E" stroke-opacity="0.22" stroke-width="${detail === 'small' ? 22 : 8}" clip-path="url(#mask)"/>` : ''}
  </g>
</svg>`
}

/**
 * Plantilla monocroma de la barra de menús de macOS (16 pt): el arco y el sol, como AulaMark, dibujados en la rejilla de
 * píxeles de cada tamaño para que salgan nítidos (16 px @1x, 32 px @2x). macOS solo usa el canal alfa y la tiñe.
 * `horizon`: el arco y el medio sol se apoyan en una línea de horizonte que sobresale un poco por los lados (el icono
 * pintado «sumi-e B», paint-art.mjs); a 32 px la línea entra y sale más fina, como el pincelazo.
 */
export function traySvg(size, color = '#000000', { horizon = false } = {}) {
  const big = size >= 32
  const g = big
    ? { legL: 6.5, legR: 25.5, cy: 15.5, bottom: horizon ? 26 : 28, sw: 3, sunR: 5 }
    : { legL: 3, legR: 13, cy: 8, bottom: horizon ? 13 : 14, sw: 2, sunR: 2.5 }
  const r = (g.legR - g.legL) / 2
  const mid = (g.legL + g.legR) / 2
  // el horizonte, en píxeles enteros: grueso en el centro y de un píxel en las puntas (a 32 px)
  const line = !horizon
    ? ''
    : big
      ? `<rect x="1" y="26" width="2" height="1" fill="${color}"/><rect x="3" y="26" width="24" height="2" fill="${color}"/><rect x="27" y="26" width="4" height="1" fill="${color}"/>`
      : `<rect x="1" y="13" width="14" height="1" fill="${color}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="geometricPrecision">
  <path d="M${g.legL} ${g.bottom}V${g.cy}A${r} ${r} 0 0 1 ${g.legR} ${g.cy}V${g.bottom}" fill="none" stroke="${color}" stroke-width="${g.sw}"/>
  <path d="M${mid - g.sunR} ${g.bottom}A${g.sunR} ${g.sunR} 0 0 1 ${mid + g.sunR} ${g.bottom}Z" fill="${color}"/>
  ${line}
</svg>`
}
