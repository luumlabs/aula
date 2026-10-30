// JavaScript que los montajes V5 ejecutan dentro de la app (acciones `eval`). Como en aula-film-js.ts: todo con setTimeout,
// que en la captura va en tiempo virtual, así que sale igual en cada render.

/** Marcador invisible (#id) en el centro del elemento número `index` (desde 0; negativo = desde el final) de los visibles
 *  que casan con `selector`, para que el cursor vaya y pulse ahí. Se recoloca cada 50 ms durante 1,5 s. */
export function markSel(id: string, selector: string, index = 0, fx = 0.5, fy = 0.5): string {
  return `(() => {
  let n = 0
  const place = () => {
    if (n++ < 30) setTimeout(place, 50)
    const all = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight })
    const el = all.at(${index})
    if (!el) return
    const r = el.getBoundingClientRect()
    let m = document.getElementById(${JSON.stringify(id)})
    if (!m) { m = document.createElement('div'); m.id = ${JSON.stringify(id)}; m.style.cssText = 'position:fixed;width:2px;height:2px;pointer-events:none;opacity:0;z-index:2147483647'; document.body.appendChild(m) }
    m.style.left = (r.left + r.width * ${fx} - 1) + 'px'
    m.style.top = (r.top + r.height * ${fy} - 1) + 'px'
  }
  place()
  return true
})()`
}

/** Dos marcadores en el deslizador número `index`: #id-a en la fracción `a` de su ancho y #id-b en la `b` (para arrastrar
 *  el tirador de una a otra con una acción `drag`). */
export function markRange(id: string, index: number, a: number, b: number): string {
  return `${markSel(`${id}-a`, 'input[type="range"]', index, a)};${markSel(`${id}-b`, 'input[type="range"]', index, b)}`
}

/** Crea una conversación nueva vacía y la abre (en demo el chat reabre la primera si no). */
export const NEW_CHAT = `(async () => { const r = await window.aula.invoke('chat.newThread', undefined); window.__aula.navigate({ name: 'chat', conversation: r.value.id }) })()`

/** Cambia el idioma de la interfaz (como Ajustes → Aula's language). */
export const uiLanguage = (lang: 'es' | 'en'): string =>
  `(async () => { await window.aula.invoke('settings.update', { general: { language: ${JSON.stringify(lang)} } }) })()`

/** Desplaza el contenedor con scroll más cercano al elemento `selector` `dy` px en `dur` s (suave, en tiempo virtual). */
export function smoothScroll(selector: string, dy: number, dur: number): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  let box = el
  while (box && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement
  if (!box) return 'sin contenedor'
  const y0 = box.scrollTop, steps = Math.max(1, Math.round(${dur} * 60))
  let i = 0
  const ease = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
  const step = () => { i++; box.scrollTop = y0 + ${dy} * ease(i / steps); if (i < steps) setTimeout(step, 1000 / 60) }
  step()
  return 'ok'
})()`
}
