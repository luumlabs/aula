// Validación de las formas ya hechas de los diagramas (pirámide, embudo, Venn, mapa mental), de lo que pasa del tope de lo
// que se dibuja, de los pasos que construyen la figura y de los matices de «comparar». Mensajes en español y con la ruta exacta: los lee la IA que escribe el contenido.
// Reglas de las plantillas adaptadas de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/scene/builder.ts.
import type { CompareBlock, ContentIssue, DiagramBlock, IssueSeverity } from '@shared/schema'
import { DIAGRAM_MAX_EDGES, DIAGRAM_MAX_NODES, mindmapTree, revealedAt, vennModel, vennRegions } from './diagram-forms'

const issue = (severity: IssueSeverity, path: string, message: string): ContentIssue => ({ severity, path, message })

/** Una explicación (`detail`) más larga se lee mal junto a la figura (y la estira): mejor en el texto de la lección. */
const FORM_DETAIL_CHARS = 200

export function checkDiagramForm(b: DiagramBlock, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  // lo que pasa del tope no se dibuja: que no se pierda sin avisar (vale para todos los diagramas). Aviso y no error: el chat
  // y las diapositivas descartan los bloques con errores, y estos se dibujaban (con el tope) en los chats ya guardados
  if (b.nodes.length > DIAGRAM_MAX_NODES) out.push(issue('warning', path + '.nodes', `${b.nodes.length} nodos: solo se dibujan los ${DIAGRAM_MAX_NODES} primeros; divide el diagrama.`))
  if (b.edges.length > DIAGRAM_MAX_EDGES) out.push(issue('warning', path + '.edges', `${b.edges.length} flechas: solo se dibujan las ${DIAGRAM_MAX_EDGES} primeras; divide el diagrama.`))
  if (b.form === 'pyramid' || b.form === 'funnel' || b.form === 'mindmap') {
    b.nodes.forEach((n, i) => {
      const len = n.detail?.trim().length ?? 0
      if (len > FORM_DETAIL_CHARS) out.push(issue('warning', `${path}.nodes[${i}].detail`, `La explicación de «${n.label}» tiene ${len} caracteres: junto a la figura va una nota breve (≤ ${FORM_DETAIL_CHARS}); pasa el resto al texto de la lección.`))
    })
  }
  switch (b.form) {
    case 'pyramid': case 'funnel':
      if (b.edges.length) out.push(issue('info', path + '.edges', `Las flechas no se dibujan en una ${b.form === 'pyramid' ? 'pirámide' : 'embudo'}: el orden de \`nodes\` (de arriba abajo) ya da los niveles.`))
      if (b.nodes.length > 9) out.push(issue('warning', path + '.nodes', `${b.nodes.length} niveles: como mucho 9 (agrupa los parecidos).`))
      break
    case 'venn': {
      const circles = b.nodes.filter((n) => n.shape === 'circle').length
      if (circles < 2 || circles > 3) out.push(issue('error', path + '.nodes', `Un diagrama de Venn necesita 2 o 3 conjuntos (nodos con \`"shape": "circle"\`); hay ${circles}.`))
      const m = vennModel(b)
      const sets = new Set(m.sets.map((s) => s.id))
      const items = new Set(m.items.map((i) => i.node.id))
      b.edges.forEach((e, i) => {
        if (!items.has(e.from) || !sets.has(e.to)) {
          if (sets.has(e.from) && items.has(e.to)) return
          out.push(issue('warning', `${path}.edges[${i}]`, `En un Venn cada flecha va de un elemento a su conjunto (${e.from}→${e.to} no lo hace): se ignora.`))
        }
      })
      for (const r of vennRegions(m)) {
        if (r.items.length > 6) out.push(issue('warning', path + '.nodes', `${r.items.length} elementos en la misma región${r.sets.length ? '' : ' (fuera de los conjuntos)'}: como mucho 6, con etiquetas cortas.`))
      }
      const outside = m.items.filter((i) => !i.sets.length).length
      if (outside && circles >= 2) out.push(issue('info', path, `${outside} elemento(s) sin conjunto (sin flecha a un círculo): se ven debajo, «fuera de los conjuntos».`))
      if (!m.items.length && circles >= 2) out.push(issue('warning', path, 'El Venn no tiene elementos: añade nodos (no círculo) con una flecha a cada conjunto al que pertenecen.'))
      break
    }
    case 'mindmap': {
      const t = mindmapTree(b)
      if (!t) break
      if (t.roots > 1) out.push(issue('warning', path + '.edges', `El mapa mental tiene ${t.roots} nodos sin flecha de entrada: debe haber una sola idea central (el primer nodo) y flechas de cada rama a sus subramas.`))
      if (t.cyclic) out.push(issue('warning', path + '.edges', 'Hay flechas que vuelven atrás (ciclo): un mapa mental es un árbol, cada rama cuelga de una sola.'))
      else if (t.extra.length) out.push(issue('warning', path + '.edges', `${t.extra.length} flecha(s) dan un segundo padre a una rama: no se dibujan.`))
      if (t.depth > 3) out.push(issue('info', path, `${t.depth} niveles: con 3 se lee mejor (pasa el detalle a \`detail\`).`))
      if (b.nodes.length > 24) out.push(issue('warning', path, `${b.nodes.length} nodos: como mucho 24 en un mapa mental; divide el tema.`))
      break
    }
    default:
      break
  }
  if (b.build) out.push(...checkBuild(b, path))
  return out
}

/** Pasos que construyen la figura: el primero tiene que enseñar algo y cada nodo debería aparecer alguna vez. */
function checkBuild(b: DiagramBlock, path: string): ContentIssue[] {
  if (!b.steps.length) return [issue('warning', path + '.build', '`build` necesita `steps`: cada paso añade a la figura los nodos que nombra.')]
  const out: ContentIssue[] = []
  const firstStep = revealedAt(b, 0)
  if (firstStep && firstStep.size === 0) out.push(issue('warning', path + '.steps[0]', 'Con `build`, el primer paso no enseña nada: nombra en `nodes` lo que aparece primero.'))
  const all = revealedAt(b, b.steps.length - 1)
  if (all) {
    const never = b.nodes.filter((n) => !all.has(n.id)).map((n) => n.id)
    if (never.length) out.push(issue('info', path + '.steps', `Con \`build\`, ${never.length === 1 ? 'el nodo' : 'los nodos'} ${never.slice(0, 6).join(', ')} no aparece${never.length === 1 ? '' : 'n'} en ningún paso (solo se ve${never.length === 1 ? '' : 'n'} al pulsar «Ver todo»).`))
  }
  return out
}

export function checkCompare(b: CompareBlock, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  const key = b.rows.filter((r) => r.tone === 'key').length
  if (b.rows.length >= 3 && key > b.rows.length / 2) out.push(issue('warning', path + '.rows', `${key} de ${b.rows.length} filas son \`"tone": "key"\`: marca solo la diferencia decisiva (1–2 filas).`))
  if (b.mode === 'analogy' && b.rows.length < 2) out.push(issue('warning', path + '.rows', 'Una analogía necesita al menos 2 correspondencias (una fila por pareja «parte real ↔ parte cotidiana»).'))
  return out
}
