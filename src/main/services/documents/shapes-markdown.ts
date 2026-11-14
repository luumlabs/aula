// Las formas ya hechas de los diagramas y los matices de «comparar», en Markdown: una pirámide o un embudo como lista
// numerada de arriba abajo, un Venn región por región («Solo Mitosis: …», «Mitosis y Meiosis: …»), un mapa mental como lista
// anidada y las filas clave de una comparación en negrita.
import { mindmapTree, vennModel, vennRegions, type MindNode } from '@engine/content/diagram-forms'
import type { CompareRow, DiagramBlock } from '@shared/schema'
import { listText, type DocLang } from './words'

const one = (s: string): string => s.replace(/\s*\n\s*/g, ' ').trim()

/** La forma del diagrama en Markdown; undefined si no tiene forma (o no se puede leer como tal). */
export function diagramFormMarkdown(b: DiagramBlock, lang: DocLang): string | undefined {
  switch (b.form) {
    case 'pyramid': case 'funnel':
      return b.nodes.map((n, i) => `${i + 1}. **${one(n.label)}**` + (n.detail?.trim() ? ` — ${one(n.detail)}` : '')).join('\n')
    case 'venn': {
      const m = vennModel(b)
      if (m.sets.length < 2) return undefined
      const name = new Map(m.sets.map((s) => [s.id, one(s.label)]))
      return vennRegions(m).map((r) => {
        const sets = r.sets.map((id) => name.get(id) ?? id)
        const head = !sets.length ? (lang === 'en' ? 'In none of the sets' : 'Fuera de los conjuntos')
          : sets.length === 1 ? (lang === 'en' ? `Only ${sets[0]}` : `Solo ${sets[0]}`)
            : listText(sets, lang)
        return `- **${head}:** ${r.items.map((i) => one(i.node.label)).join('; ')}`
      }).join('\n')
    }
    case 'mindmap': {
      const t = mindmapTree(b)
      if (!t) return undefined
      const lines = [`**${one(t.root.node.label)}**`, '']
      const walk = (m: MindNode): void => {
        for (const c of m.children) {
          lines.push(`${'  '.repeat(c.depth - 1)}- ${one(c.node.label)}` + (c.node.detail?.trim() ? ` — ${one(c.node.detail)}` : ''))
          walk(c)
        }
      }
      walk(t.root)
      return lines.join('\n')
    }
    default:
      return undefined
  }
}

/** Las celdas de una fila de «comparar» tal cual (sin la negrita de la fila clave). */
export function compareRawCells(r: CompareRow): string[] {
  return [r.label ?? '', r.left, r.right]
}

/** Las celdas de una fila de «comparar»: la diferencia clave en negrita (sin anidar la negrita que ya traiga la celda). */
export function compareCells(r: CompareRow): string[] {
  const cells = compareRawCells(r)
  return r.tone === 'key' ? cells.map((c) => (c.trim() ? `**${c.trim().replace(/\*\*/g, '')}**` : c)) : cells
}
