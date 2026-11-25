// El texto que llega mientras Aula escribe, para que fluya sin saltos: se revela a un ritmo que se adapta a lo que falta (los
// trozos del proveedor llegan a golpes), se parte en párrafos (los cerrados no se vuelven a dibujar) y la cola a medio escribir
// se limpia (una fórmula sin cerrar no se ve como «$x_v = -\dfrac», un bloque visual a medias no se ve como JSON, un bloque de
// código no aparece hasta que su primera línea dice el lenguaje). El código nunca se toca: sus «$», «**» y «`» son suyos.
import { fenceOpening, fenceCloses, fenceState, maskCode, stripFenceContainer, type Fence } from '@engine/content/codeFences'

/** Párrafos separados por líneas en blanco, sin partir bloques de código, fórmulas $$…$$ ni lo sangrado (sigue al anterior). */
export function splitParagraphs(text: string): string[] {
  const chunks: string[] = []
  let cur: string[] = []
  let fence: Fence | undefined
  let math = false
  const flush = (): void => {
    if (cur.length) chunks.push(cur.join('\n'))
    cur = []
  }
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (fence) {
      if (fenceCloses(line, fence)) fence = undefined
    } else if (!math && fenceOpening(line)) fence = fenceOpening(line)
    else if ((t.match(/\$\$/g)?.length ?? 0) % 2 === 1) math = !math
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
  // un bloque de código: su primera línea (con el lenguaje) no sale hasta que termina (la cabecera no cambia de nombre a cada
  // letra) y dentro de uno abierto no se toca nada, salvo un cierre a medio escribir («``»)
  const lineStart = out.lastIndexOf('\n') + 1
  const lastLine = out.slice(lineStart)
  const fences = fenceState(out)
  const bareLast = stripFenceContainer(lastLine)
  if (fences.open) {
    const opening = fences.open.line === fences.lines - 1
    const closing = (fences.open.char === '`' ? /^\s*`{1,2}$/ : /^\s*~{1,2}$/).test(bareLast)
    if (opening || closing) out = out.slice(0, lineStart)
    return { text: out, pendingBlock }
  }
  // una línea que empieza con uno o dos «`» o «~» (también tras «> » o «- ») puede ser una valla que empieza
  if (/^\s*(`{1,2}|~{1,2})$/.test(stripFenceContainer(lastLine, true))) out = out.slice(0, lineStart)
  // lo demás solo mira la prosa: las posiciones son las mismas en el texto con el código tapado
  let masked = maskCode(out)
  // una fórmula grande sin cerrar: fuera hasta que se cierre
  const big = masked.match(/\$\$/g)?.length ?? 0
  if (big % 2 === 1) {
    const at = masked.lastIndexOf('$$')
    out = out.slice(0, at)
    masked = masked.slice(0, at)
  }
  // en el último párrafo (y después del último bloque de código): fórmula pequeña sin cerrar fuera; negrita y código en
  // línea cerrados
  const cut = Math.min(out.length, Math.max(masked.lastIndexOf('\n\n') + 1, fences.closedEnd))
  let tail = out.slice(cut)
  let prose = masked.slice(cut)
  const singles = [...prose.matchAll(/(?<![\\$])\$(?!\$)/g)]
  if (singles.length % 2 === 1) {
    const at = singles[singles.length - 1].index
    tail = tail.slice(0, at)
    prose = prose.slice(0, at)
  }
  if ((prose.match(/\*\*/g)?.length ?? 0) % 2 === 1) {
    const closing = /\*\*$/.test(prose)
    tail = closing ? tail.slice(0, -2) : tail.trimEnd() + '**'
    prose = closing ? prose.slice(0, -2) : prose.trimEnd() + '**'
  }
  if ((prose.match(/`/g)?.length ?? 0) % 2 === 1) tail = prose.endsWith('`') ? tail.slice(0, -1) : tail + '`'
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
