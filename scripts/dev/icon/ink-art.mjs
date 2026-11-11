// El icono de Aula «a tinta»: la misma mano que el de Faro (una línea con pulso, aguadas que se salen de ella, una luz
// ámbar) con el dibujo propio de Aula: su arco y su sol. Tres propuestas, en SVG generado con código. Cada una dibuja en
// un lienzo de 1024 con la squircle en (100,100) y se entrega desplazada a la caja de 824 de icon-art.mjs.
//   detail 'full' (≥ 128 px): tinta fina, aguadas y grano · 'mid' (48–64 px): tinta más gruesa, sin grano ·
//   'small' (≤ 32 px): formas llenas, sin filtros (a ese tamaño la línea temblorosa solo ensucia).

const C = {
  paper: '#f8f3ea', ink: '#231f1a', brick: '#bf5a36', sun: '#e3a23a', glow: '#efbf6f', sand: '#dcc6a6', rose: '#dba892'
}

const filters = (id) => `
  <filter id="${id}-wash" x="-30%" y="-30%" width="160%" height="160%">
    <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="3" seed="13" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="46" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="15" result="b"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="2" seed="7" result="p"/>
    <feColorMatrix in="p" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -0.45 1.12" result="pa"/>
    <feComposite in="b" in2="pa" operator="in"/>
  </filter>
  <filter id="${id}-fill" x="-25%" y="-25%" width="150%" height="150%">
    <feTurbulence type="fractalNoise" baseFrequency="0.02 0.03" numOctaves="2" seed="5" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="24" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="3.4" result="b"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.009 0.014" numOctaves="2" seed="10" result="p"/>
    <feColorMatrix in="p" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -0.5 1.22" result="pa"/>
    <feComposite in="b" in2="pa" operator="in"/>
  </filter>
  <filter id="${id}-hand" x="-15%" y="-15%" width="130%" height="130%">
    <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="2" seed="11" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="13" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="${id}-grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4"/>
    <feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.24  0 0 0 0.3 0"/>
  </filter>`

const arch = (cx, top, w, bottom) => {
  const r = w / 2
  return `M${cx - r} ${bottom} L${cx - r} ${top + r} A${r} ${r} 0 0 1 ${cx + r} ${top + r} L${cx + r} ${bottom}`
}
const band = (cx, top, w, t, bottom) => {
  const r = w / 2
  return `${arch(cx, top, w, bottom)} L${cx + r - t} ${bottom} L${cx + r - t} ${top + r} A${r - t} ${r - t} 0 0 0 ${cx - r + t} ${top + r} L${cx - r + t} ${bottom} Z`
}

/** El marco común: papel, el dibujo y el grano; todo corrido a la caja de 824. */
function frame(id, detail, body) {
  return `<g transform="translate(-100 -100)"><defs>${detail === 'small' ? '' : filters(id)}</defs>
    <rect x="60" y="60" width="904" height="904" fill="${C.paper}"/>
    ${body}
    ${detail === 'full' ? `<rect x="60" y="60" width="904" height="904" filter="url(#${id}-grain)" opacity="0.55"/>` : ''}</g>`
}
const ink = (id, detail, body) =>
  `<g ${detail === 'small' ? '' : `filter="url(#${id}-hand)"`} fill="none" stroke="${C.ink}" stroke-width="${detail === 'full' ? 13 : detail === 'mid' ? 19 : 30}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">${body}</g>`
const f = (id, detail, kind) => (detail === 'small' ? '' : `filter="url(#${id}-${kind})"`)

/** A · «Arco a tinta»: el arco y su sol, dibujados a tinta y lavados con ladrillo. */
function inkArch(detail) {
  const id = 'inkA', cx = 512, g = 772
  const small = detail === 'small'
  return frame(id, detail, `
    <defs><radialGradient id="${id}-glow" cx="${cx}" cy="${g - 20}" r="250" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.sun}" stop-opacity="0.95"/><stop offset="0.45" stop-color="${C.glow}" stop-opacity="0.5"/><stop offset="1" stop-color="${C.glow}" stop-opacity="0"/></radialGradient></defs>
    ${small ? '' : `<g style="mix-blend-mode:multiply"><g filter="url(#${id}-wash)">
      <ellipse cx="${cx + 30}" cy="420" rx="370" ry="210" fill="${C.glow}" opacity="0.24"/>
      <ellipse cx="${cx - 230}" cy="300" rx="200" ry="92" fill="${C.rose}" opacity="0.2"/>
      <path d="M-80 880 Q220 846 ${cx} 866 T1104 852 L1104 1104 L-80 1104 Z" fill="${C.sand}" opacity="0.6"/>
    </g></g>
    <circle cx="${cx}" cy="${g - 30}" r="230" fill="url(#${id}-glow)" opacity="0.55"/>`}
    <g ${f(id, detail, 'fill')}>
      <path d="${band(cx, 268, 420, small ? 118 : 96, g)}" fill="${C.brick}" opacity="${small ? 1 : 0.86}"/>
      <path d="M${cx - (small ? 96 : 84)} ${g} A${small ? 96 : 84} ${small ? 96 : 84} 0 0 1 ${cx + (small ? 96 : 84)} ${g} Z" fill="${C.sun}" opacity="0.95"/>
      ${small ? '' : `<ellipse cx="${cx}" cy="${g + 24}" rx="340" ry="26" fill="${C.rose}" opacity="0.55"/>`}
    </g>
    ${ink(id, detail, `${small ? '' : `
      <path d="${arch(cx, 262, 432, g)}"/>
      <path d="${arch(cx, 366, 224, g)}"/>
      <path d="M${cx - 80} ${g - 2} A80 80 0 0 1 ${cx + 80} ${g - 2}"/>`}
      <path d="M170 ${g + 6} Q340 ${g - 8} ${cx} ${g + 3} T858 ${g}" opacity="${small ? 1 : 0.8}"/>`)}`)
}

/** B · «El aula encendida»: una puerta en arco con la luz dentro, que sale al suelo. */
function inkDoor(detail) {
  const id = 'inkB', cx = 512, g = 748
  const small = detail === 'small'
  return frame(id, detail, `
    <defs><radialGradient id="${id}-glow" cx="${cx}" cy="${g - 150}" r="330" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.sun}" stop-opacity="1"/><stop offset="0.5" stop-color="${C.glow}" stop-opacity="0.6"/><stop offset="1" stop-color="${C.glow}" stop-opacity="0"/></radialGradient>
      <linearGradient id="${id}-floor" x1="0" y1="${g}" x2="0" y2="${g + 190}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.glow}" stop-opacity="0.9"/><stop offset="1" stop-color="${C.glow}" stop-opacity="0"/></linearGradient></defs>
    <g style="mix-blend-mode:multiply"><g ${f(id, detail, 'wash')}>
      <ellipse cx="${cx}" cy="470" rx="350" ry="250" fill="${C.brick}" opacity="${small ? 0.75 : 0.5}"/>
      ${small ? '' : `<ellipse cx="290" cy="350" rx="190" ry="130" fill="${C.rose}" opacity="0.4"/>
      <ellipse cx="760" cy="600" rx="150" ry="120" fill="${C.brick}" opacity="0.25"/>
      <path d="M-80 ${g + 120} Q220 ${g + 96} ${cx} ${g + 112} T1104 ${g + 100} L1104 1104 L-80 1104 Z" fill="${C.sand}" opacity="0.8"/>`}
    </g></g>
    <g ${f(id, detail, 'fill')}>
      <path d="${arch(cx, 300, 300, g)} Z" fill="${C.paper}"/>
      <path d="${arch(cx, 300, 300, g)} Z" fill="url(#${id}-glow)"/>
      <path d="M${cx - 150} ${g} L${cx + 150} ${g} L${cx + 300} ${g + 190} L${cx - 300} ${g + 190} Z" fill="url(#${id}-floor)" style="mix-blend-mode:multiply"/>
    </g>
    ${ink(id, detail, `
      <path d="${arch(cx, 296, 308, g)}"/>
      <path d="M160 ${g + 4} Q250 ${g - 6} ${cx - 154} ${g + 2}" opacity="0.8"/>
      <path d="M${cx + 154} ${g + 2} Q760 ${g - 6} 866 ${g + 4}" opacity="0.8"/>
      ${small ? '' : `<path d="M${cx - 150} ${g + 4} L${cx - 250} ${g + 130}" opacity="0.45"/>
      <path d="M${cx + 150} ${g + 4} L${cx + 250} ${g + 130}" opacity="0.45"/>`}`)}`)
}

/** C · «Una pincelada»: el arco de siempre, pasado a acuarela; la tinta solo en el suelo y el sol. */
function inkBrush(detail) {
  const id = 'inkC', cx = 512, g = 760
  const small = detail === 'small'
  return frame(id, detail, `
    <defs><radialGradient id="${id}-glow" cx="${cx}" cy="${g - 10}" r="210" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.sun}" stop-opacity="0.9"/><stop offset="0.5" stop-color="${C.glow}" stop-opacity="0.45"/><stop offset="1" stop-color="${C.glow}" stop-opacity="0"/></radialGradient></defs>
    ${small ? '' : `<g style="mix-blend-mode:multiply"><g filter="url(#${id}-wash)">
      <ellipse cx="${cx}" cy="470" rx="330" ry="230" fill="${C.glow}" opacity="0.16"/>
      <path d="M-80 884 Q220 856 ${cx} 872 T1104 860 L1104 1104 L-80 1104 Z" fill="${C.rose}" opacity="0.4"/>
    </g></g>
    <circle cx="${cx}" cy="${g - 10}" r="210" fill="url(#${id}-glow)"/>`}
    <g ${f(id, detail, 'fill')}>
      <path d="${band(cx, 290, 396, small ? 118 : 104, g)}" fill="${C.brick}" opacity="${small ? 1 : 0.92}"/>
      ${small ? '' : `<path d="${band(cx, 300, 376, 30, g)}" fill="${C.brick}" opacity="0.4"/>`}
      <path d="M${cx - (small ? 90 : 76)} ${g} A${small ? 90 : 76} ${small ? 90 : 76} 0 0 1 ${cx + (small ? 90 : 76)} ${g} Z" fill="${C.sun}"/>
    </g>
    ${ink(id, detail, `${small ? '' : `<path d="M${cx - 72} ${g - 2} A72 72 0 0 1 ${cx + 72} ${g - 2}"/>`}
      <path d="M190 ${g + 6} Q340 ${g - 8} ${cx} ${g + 3} T838 ${g}" opacity="${small ? 1 : 0.85}"/>`)}`)
}

export const INK_PROPOSALS = {
  inkA: { name: 'Tinta A · Arco a tinta', art: inkArch, tray: { horizon: true } },
  inkB: { name: 'Tinta B · El aula encendida', art: inkDoor },
  inkC: { name: 'Tinta C · Una pincelada', art: inkBrush, tray: { horizon: true } }
}
