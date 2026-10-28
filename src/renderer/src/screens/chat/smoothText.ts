// El texto que llega mientras Aula escribe, para que fluya sin saltos: se revela a un ritmo que se adapta a lo que falta (los
// trozos del proveedor llegan a golpes), se parte en párrafos (los cerrados no se vuelven a dibujar) y la cola a medio escribir
// se limpia (una fórmula sin cerrar no se ve como «$x_v = -\dfrac», un bloque visual a medias no se ve como JSON).

/** Párrafos separados por líneas en blanco, sin partir bloques de código, fórmulas $$…$$ ni lo sangrado (sigue al anterior). */
export function splitParagraphs(text: string): string[] {
  const chunks: string[] = []
  let cur: string[] = []
  let fence = false
  let math = false
  const flush = (): void => {
    if (cur.length) chunks.push(cur.join('\n'))
    cur = []
  }
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!math && /^(```|~~~)/.test(t)) fence = !fence
    else if (!fence && (t.match(/\$\$/g)?.length ?? 0) % 2 === 1) math = !math
    if (!fence && !math && t === '') {
      flush()
      continue
    }
    cur.push(line)
  }
  flush()
  // lo sangrado (continuación de una lista, código con sangría) va con el párrafo anterior
  const out: string[] = []
  for (const c of chunks) {
    if (out.length && /^[ \t]/.test(c)) out[out.length - 1] += '\n\n' + c
    else out.push(c)
  }
  return out
}

const AULA_FENCE = /```(aula|estudio)-(block|slides)/g

/** La cola de un texto a medio escribir, presentable: `pendingBlock` = hay un bloque visual empezado (se enseña su hueco). */
export function tidyStreamingTail(text: string): { text: string; pendingBlock: boolean } {
  let out = text
  let pendingBlock = false
  // un bloque visual sin cerrar: fuera, con su hueco
  let last = -1
  for (const m of out.matchAll(AULA_FENCE)) last = m.index ?? -1
  if (last >= 0 && !out.slice(last + 3).includes('```')) {
    out = out.slice(0, last)
    pendingBlock = true
  }
  // dentro de un bloque de código abierto no se toca nada más
  const fences = out.match(/^\s*(```|~~~)/gm)?.length ?? 0
  if (fences % 2 === 1) return { text: out, pendingBlock }
  // una fórmula grande sin cerrar: fuera hasta que se cierre
  const big = out.match(/\$\$/g)?.length ?? 0
  if (big % 2 === 1) out = out.slice(0, out.lastIndexOf('$$'))
  // en el último párrafo: fórmula pequeña sin cerrar fuera; negrita y código cerrados
  const cut = out.lastIndexOf('\n\n') + 1
  let tail = out.slice(cut)
  const singles = [...tail.matchAll(/(?<![\\$])\$(?!\$)/g)]
  if (singles.length % 2 === 1) tail = tail.slice(0, singles[singles.length - 1].index)
  if (/\*\*$/.test(tail) && (tail.match(/\*\*/g)?.length ?? 0) % 2 === 1) tail = tail.slice(0, -2)
  else if ((tail.match(/\*\*/g)?.length ?? 0) % 2 === 1) tail = tail.trimEnd() + '**'
  if ((tail.match(/`/g)?.length ?? 0) % 2 === 1) tail = tail.endsWith('`') ? tail.slice(0, -1) : tail + '`'
  return { text: out.slice(0, cut) + tail, pendingBlock }
}

/** Cuántos caracteres enseñar tras `dtMs`: deprisa si falta mucho (nunca se queda atrás), suave si falta poco. */
export function nextReveal(shown: number, target: number, dtMs: number): number {
  const backlog = target - shown
  if (backlog <= 0) return target
  const perSecond = Math.max(70, backlog * 6)
  return Math.min(target, shown + Math.max(1, Math.round((perSecond * dtMs) / 1000)))
}

/** No corta un carácter compuesto (emoji, letras fuera del plano básico) por la mitad. */
export function safeCut(text: string, at: number): number {
  if (at <= 0 || at >= text.length) return Math.max(0, Math.min(at, text.length))
  const c = text.charCodeAt(at)
  return c >= 0xdc00 && c <= 0xdfff ? at + 1 : at
}
