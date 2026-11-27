// Lo que las apps de iPhone, iPad y Android ponen en la página de Aula (la misma para las dos: Android la copia de aquí al
// compilar). Dos cosas:
//  1. Que se sienta una app y no una página: sin zoom, sin el destello gris al tocar, sin arrastrar imágenes ni enlaces y
//     sin seleccionar el texto de los controles. Se lee y se copia lo que la interfaz marca (`.selectable`) y lo que se
//     escribe. Va en una hoja construida (adoptedStyleSheets): la CSP de la página de vincular no la bloquea.
//  2. Decirle a la app cómo se ve la página (window.aulaApp.page): si está en oscuro y el color de cada borde (con el
//     grano del papel y lo que lo tape, como el velo de un diálogo), para pintar igual lo que queda fuera de la vista web:
//     la hora y la batería, la franja de la demostración y, en Android, las barras del sistema.
// Se puede ejecutar más de una vez (Android la pone al empezar a verse la página y al terminar de cargar).
(() => {
  if (window.__aulaShell) return window.__aulaShell()

  const CSS = `
    html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; touch-action: manipulation; overscroll-behavior: none; }
    body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    * { -webkit-tap-highlight-color: transparent; }
    a, img, svg { -webkit-user-drag: none; }
    input, textarea, [contenteditable]:not([contenteditable='false']), .selectable { -webkit-user-select: text; user-select: text; }
  `

  function solid() {
    const head = document.head || document.documentElement
    const meta = document.querySelector('meta[name="viewport"]') || head.appendChild(Object.assign(document.createElement('meta'), { name: 'viewport' }))
    meta.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(CSS)
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    } catch (err) {
      // sin hojas construidas (un WebView muy viejo): una <style>, que la CSP de la página de vincular puede bloquear
      const style = document.createElement('style')
      style.textContent = CSS
      head.appendChild(style)
    }
  }

  // ── los colores de la página ──
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const known = new Map()
  /** Un color CSS cualquiera (rgb, color(srgb …), oklab…) → [r, g, b, a] en sRGB 0–255 (a 0–1). */
  function rgba(css) {
    if (!css || css === 'transparent') return null
    if (known.has(css)) return known.get(css)
    let out = null
    const m = /^rgba?\(([^)]*)\)$/.exec(css)
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      if (p.length >= 3) out = [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
    } else if (probe) {
      probe.clearRect(0, 0, 1, 1)
      probe.fillStyle = '#000'
      probe.fillStyle = css
      probe.fillRect(0, 0, 1, 1)
      const d = probe.getImageData(0, 0, 1, 1).data
      out = [d[0], d[1], d[2], d[3] / 255]
    }
    if (known.size > 200) known.clear()
    known.set(css, out)
    return out
  }
  const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t)
  /** El papel con grano se ve, en promedio, un poco más oscuro (o más claro, de noche): lo mismo que DrawingCanvas. */
  const grain = (rgb, dark) => (dark ? mix(rgb, [255, 240, 219], 0.03) : mix(rgb, [84, 64, 43], 0.05))
  function opacity(el) {
    let o = 1
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(getComputedStyle(e).opacity || 1)
    return o
  }
  const hex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

  /** El color que se ve en (x, y): el primer fondo opaco y, encima, los translúcidos (un velo, una hoja a medio aparecer). */
  function colorAt(x, y, dark) {
    const layers = []
    let base = null
    for (const el of document.elementsFromPoint(x, y)) {
      const c = rgba(getComputedStyle(el).backgroundColor)
      if (!c || c[3] === 0) continue
      const a = c[3] * opacity(el)
      const rgb = el.classList && el.classList.contains('paper-grain') ? grain(c.slice(0, 3), dark) : c.slice(0, 3)
      if (a >= 0.99) {
        base = { rgb, el }
        break
      }
      layers.push([rgb, a])
    }
    if (!base) {
      const body = document.body && rgba(getComputedStyle(document.body).backgroundColor)
      const html = rgba(getComputedStyle(document.documentElement).backgroundColor)
      const c = body && body[3] > 0 ? body : html && html[3] > 0 ? html : dark ? [18, 17, 16, 1] : [250, 248, 243, 1]
      base = { rgb: c.slice(0, 3), el: null }
    }
    let rgb = base.rgb
    for (let i = layers.length - 1; i >= 0; i--) rgb = mix(rgb, layers[i][0], layers[i][1])
    return { color: hex(rgb), el: base.el }
  }

  /**
   * Un borde de arriba o de abajo: su color y, si a la izquierda hay otro (la barra lateral sobre el lienzo, al lado de
   * la hoja en el iPad o en una tableta), ese otro y dónde cambia (fracción del ancho).
   */
  function edge(y, dark) {
    const w = window.innerWidth
    const main = colorAt(w / 2, y, dark)
    const left = colorAt(1, y, dark)
    let split = 0
    if (left.color !== main.color && main.el) split = Math.max(0, Math.min(1, main.el.getBoundingClientRect().left / w))
    return [left.color, main.color, Math.round(split * 1000) / 1000]
  }

  function isDark() {
    const root = document.documentElement
    // la app pone «dark» en <html> según Ajustes → Apariencia; la página de vincular sigue al sistema
    if (root.classList.contains('dark')) return true
    if (root.classList.contains('remote')) return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  let last = ''
  function report() {
    if (!document.body || !window.aulaApp || typeof window.aulaApp.page !== 'function') return
    const w = window.innerWidth
    const h = window.innerHeight
    if (!w || !h) return
    const dark = isDark()
    const look = {
      // la interfaz de Aula (no la página de vincular, que es un documento normal y puede desplazarse)
      app: document.documentElement.classList.contains('remote'),
      dark,
      top: edge(0, dark),
      bottom: edge(h - 1, dark),
      left: colorAt(0, h / 2, dark).color,
      right: colorAt(w - 1, h / 2, dark).color
    }
    const text = JSON.stringify(look)
    if (text === last) return
    last = text
    try {
      window.aulaApp.page(text)
    } catch (err) {
      /* la app ya no escucha */
    }
  }

  // se mira otra vez cuando algo puede cambiar: el tema, la pantalla (la interfaz la apunta con history.replaceState),
  // un diálogo que se abre (las capas van en <body>), un toque, el tamaño. Las transiciones duran: varias miradas.
  let timers = []
  function soon() {
    timers.forEach(clearTimeout)
    timers = [0, 120, 320, 700].map((ms) => setTimeout(report, ms))
  }
  window.__aulaShell = () => {
    last = ''
    soon()
  }

  solid()
  new MutationObserver(soon).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
  const watchBody = () => document.body && new MutationObserver(soon).observe(document.body, { childList: true })
  if (document.body) watchBody()
  else document.addEventListener('DOMContentLoaded', watchBody, { once: true })
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name]
    history[name] = function (...args) {
      const out = original.apply(this, args)
      soon()
      return out
    }
  }
  for (const name of ['resize', 'orientationchange', 'popstate', 'pageshow', 'load']) window.addEventListener(name, soon)
  document.addEventListener('click', soon, true)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && window.__aulaShell())
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', soon)
  soon()
})()
