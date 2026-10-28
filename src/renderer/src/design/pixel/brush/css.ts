// Colores de la interfaz (variables CSS, color-mix, rgba…) a #rrggbb o #rrggbbaa, para que el pintor los pueda usar.
// Se resuelven en el documento (cambian con el tema): con un elemento de muestra y un lienzo de 1×1 que normaliza
// cualquier forma de color que devuelva el navegador.

let probe: HTMLSpanElement | null = null
let ctx: CanvasRenderingContext2D | null = null
const cache = new Map<string, string>()

const hex2 = (n: number) => n.toString(16).padStart(2, '0')

/** El color CSS `value` resuelto ahora mismo (con el tema actual). */
export function cssColor(value: string): string {
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) return value.toLowerCase()
  const root = typeof document !== 'undefined' ? document.documentElement : null
  if (!root) return '#000000'
  const key = `${root.className}|${root.dataset.theme ?? ''}|${value}`
  const hit = cache.get(key)
  if (hit) return hit
  if (!probe) {
    probe = document.createElement('span')
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
    probe.setAttribute('aria-hidden', 'true')
    document.body.appendChild(probe)
  }
  probe.style.color = ''
  probe.style.color = value
  const computed = getComputedStyle(probe).color
  if (!ctx) {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    ctx = c.getContext('2d', { willReadFrequently: true })
  }
  let out = '#000000'
  if (ctx) {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = computed
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    out = '#' + hex2(r) + hex2(g) + hex2(b) + (a < 255 ? hex2(a) : '')
  }
  cache.set(key, out)
  if (cache.size > 400) cache.delete(cache.keys().next().value as string)
  return out
}
