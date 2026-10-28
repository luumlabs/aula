// JavaScript que el montaje «aula-film» ejecuta dentro de la app (acciones `eval`). Todo usa setTimeout, que en la captura va en
// tiempo virtual: escribir «letra a letra» sale igual en cada render.

/** Respuestas del tema «Exact values of the six trig functions» del curso de ejemplo: [TeX del enunciado, error típico, correcta]. */
const ETV: [string, string, string][] = [
  ['\\sin 150^\\circ', '-1/2', '1/2'],
  ['\\tan 225^\\circ', '-1', '1'],
  ['\\sin\\dfrac{4\\pi}{3}', '√3/2', '-√3/2'],
  ['\\cos 210^\\circ', '√3/2', '-√3/2'],
  ['\\csc 180^\\circ', '0', 'undefined'],
  ['\\sec\\dfrac{3\\pi}{4}', '√2', '-√2'],
  ['\\cot 330^\\circ', '-√3/3', '-√3'],
  ['\\sin120^\\circ\\cos330^\\circ-\\cos120^\\circ\\sin330^\\circ', '1', '1/2']
]

/** Escribe `text` en el campo `selector` (o el enfocado) a `cps` caracteres por segundo, como un React controlado. */
const TYPE_FN = `function __vtType(el, text, cps, then) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const set = Object.getOwnPropertyDescriptor(proto, 'value').set
  el.focus(); set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true }))
  let i = 0
  const step = () => { i++; set.call(el, text.slice(0, i)); el.dispatchEvent(new Event('input', { bubbles: true })); if (i < text.length) setTimeout(step, 1000 / cps); else if (then) setTimeout(then, 180) }
  setTimeout(step, 1000 / cps)
}`

/** Contesta el ejercicio de práctica visible con su error típico (`wrong`) o la respuesta buena (`right`) y pulsa Comprobar. */
export function answerPractice(which: 'wrong' | 'right', cps = 9): string {
  return `(() => { ${TYPE_FN}
  const table = ${JSON.stringify(ETV)}
  const tex = [...document.querySelectorAll('annotation[encoding="application/x-tex"]')].map((a) => a.textContent.replace(/\\s+/g, ''))
  const row = table.find(([k]) => tex.some((t) => t.includes(k.replace(/\\s+/g, ''))))
  const input = document.querySelector('input[placeholder="Your answer"]')
  if (!row || !input) return 'sin ejercicio conocido: ' + tex.slice(0, 3).join(' | ')
  __vtType(input, row[${which === 'wrong' ? 1 : 2}], ${cps}, () => { const b = [...document.querySelectorAll('button')].find((x) => /^Check/.test(x.textContent.trim())); b && b.click() })
  return row[0]
})()`
}

/** Escribe en el primer campo que case con `selector` (y, si `enter`, pulsa Enter al acabar). */
export function typeInto(selector: string, text: string, cps = 16, enter = false): string {
  return `(() => { ${TYPE_FN}
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return 'no está ' + ${JSON.stringify(selector)}
  __vtType(el, ${JSON.stringify(text)}, ${cps}, ${enter ? `() => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))` : 'null'})
  return 'ok'
})()`
}

/** Sin el reposo «de vez en cuando» de los pixel art (PIXEL): solo se mueven cuando el cursor los despierta. */
export const PIXEL_IDLE_OFF = `document.documentElement.setAttribute('data-pixel-idle', 'off')`

/** Partes de la célula del curso de visuales (fracciones de la figura, como en world/worlds.ts). */
const CELL_PARTS: Record<string, [number, number]> = {
  'Cell membrane': [0.06, 0.62], Nucleus: [0.43, 0.38], Nucleolus: [0.53, 0.445], Mitochondrion: [0.233, 0.4],
  'Golgi apparatus': [0.75, 0.36], Lysosome: [0.3, 0.73], 'Endoplasmic reticulum': [0.4, 0.79], Cytoplasm: [0.66, 0.66]
}

/** Modo «Find it»: lee qué parte pide la figura y pone un marcador invisible (#vt-find) encima de esa parte, para que el
 *  cursor vaya y pulse ahí (el clic de verdad lo hace el capturador en esas coordenadas). */
export const MARK_FIND_TARGET = `(() => {
  const parts = ${JSON.stringify(CELL_PARTS)}
  let n = 0
  const place = () => {
    const label = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Point to:')
    const name = label?.parentElement?.textContent.replace('Point to:', '').replace(/\\d+\\/\\d+.*$/, '').trim()
    const p = parts[name]
    const sec = document.querySelector('section[aria-label="The animal cell"]')
    const svg = sec && [...sec.querySelectorAll('svg')].sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0]
    // se recoloca cada 50 ms durante 1,5 s: si la figura cambia de pregunta al montarse, gana la última
    if (n++ < 30) setTimeout(place, 50)
    if (!p || !svg) return
    const r = svg.getBoundingClientRect()
    let m = document.getElementById('vt-find')
    if (!m) { m = document.createElement('div'); m.id = 'vt-find'; m.style.cssText = 'position:fixed;width:2px;height:2px;pointer-events:none;opacity:0;z-index:2147483647'; document.body.appendChild(m) }
    m.style.left = (r.left + p[0] * r.width - 1) + 'px'
    m.style.top = (r.top + p[1] * r.height - 1) + 'px'
  }
  place()
  return true
})()`

/** Pone un marcador invisible (#id) en el centro del último elemento visible cuyo texto (sin espacios) acaba en `text`
 *  dentro de `scope` (selector), para que el cursor vaya y pulse ahí. Se recoloca cada 50 ms durante 1,5 s. */
export function markText(id: string, text: string, scope = 'button, [role="button"], [role="radio"], [role="tab"], [role="option"]'): string {
  return `(() => {
  let n = 0
  const place = () => {
    if (n++ < 30) setTimeout(place, 50)
    const el = [...document.querySelectorAll(${JSON.stringify(scope)})].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && e.textContent.replace(/\\s+/g, ' ').trim().endsWith(${JSON.stringify(text)}) }).pop()
    if (!el) return
    const r = el.getBoundingClientRect()
    let m = document.getElementById(${JSON.stringify(id)})
    if (!m) { m = document.createElement('div'); m.id = ${JSON.stringify(id)}; m.style.cssText = 'position:fixed;width:2px;height:2px;pointer-events:none;opacity:0;z-index:2147483647'; document.body.appendChild(m) }
    m.style.left = (r.left + r.width / 2 - 1) + 'px'
    m.style.top = (r.top + r.height / 2 - 1) + 'px'
  }
  place()
  return true
})()`
}

/** Desplaza la vista hasta el encabezado (h2/h3) que contiene `text`, de golpe (la cámara hace el movimiento). */
export function scrollToHeading(text: string, block: 'start' | 'center' = 'start'): string {
  return `(() => { const h = [...document.querySelectorAll('h1,h2,h3')].find((x) => x.textContent.includes(${JSON.stringify(text)})); h && h.scrollIntoView({ block: ${JSON.stringify(block)} }); return !!h })()`
}

/** Pone el marcador #id en el botón `button` (texto exacto) de la tarjeta que contiene el texto `card`. */
export function markInCard(id: string, card: string, button: string): string {
  return `(() => {
  let n = 0
  const place = () => {
    if (n++ < 30) setTimeout(place, 50)
    const title = [...document.querySelectorAll('h2,h3,h4,div,span,p')].find((e) => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(card)})
    let box = title, b = null
    for (let i = 0; box && i < 8 && !b; i++) { box = box.parentElement; b = box && [...box.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(button)}) }
    if (!b) return
    const r = b.getBoundingClientRect()
    let m = document.getElementById(${JSON.stringify(id)})
    if (!m) { m = document.createElement('div'); m.id = ${JSON.stringify(id)}; m.style.cssText = 'position:fixed;width:2px;height:2px;pointer-events:none;opacity:0;z-index:2147483647'; document.body.appendChild(m) }
    m.style.left = (r.left + r.width / 2 - 1) + 'px'
    m.style.top = (r.top + r.height / 2 - 1) + 'px'
  }
  place()
  return true
})()`
}

/** Marcador #id en el centro del último elemento de `selector` cuyo texto contiene `includes` (se recoloca 1,5 s). */
export function markWhere(id: string, selector: string, includes: string): string {
  return `(() => {
  let n = 0
  const place = () => {
    if (n++ < 30) setTimeout(place, 50)
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.getBoundingClientRect().width > 0 && e.textContent.includes(${JSON.stringify(includes)})).pop()
    if (!el) return
    const r = el.getBoundingClientRect()
    let m = document.getElementById(${JSON.stringify(id)})
    if (!m) { m = document.createElement('div'); m.id = ${JSON.stringify(id)}; m.style.cssText = 'position:fixed;width:2px;height:2px;pointer-events:none;opacity:0;z-index:2147483647'; document.body.appendChild(m) }
    m.style.left = (r.left + r.width / 2 - 1) + 'px'
    m.style.top = (r.top + r.height / 2 - 1) + 'px'
  }
  place()
  return true
})()`
}
