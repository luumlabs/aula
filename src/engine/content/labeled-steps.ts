// Validación del recorrido guiado de una figura etiquetada (`labeled.steps`): cada paso rodea partes que existen, con
// texto, y pocas a la vez (rodear muchas es no rodear ninguna).
import type { ContentIssue, IssueSeverity, LabeledBlock } from '@shared/schema'
import { latexIssues } from './tex'

const issue = (severity: IssueSeverity, path: string, message: string): ContentIssue => ({ severity, path, message })

export function checkLabeledSteps(l: LabeledBlock, path: string): ContentIssue[] {
  const steps = l.steps ?? []
  if (!steps.length) return []
  const out: ContentIssue[] = []
  const ids = new Set(l.parts.map((p) => p.id))
  steps.forEach((s, i) => {
    const p = `${path}.steps[${i}]`
    if (!s.md.trim() && !s.title) out.push(issue('error', p, 'El paso no explica nada (`md`).'))
    for (const id of s.parts) if (!ids.has(id)) out.push(issue('error', p, `El paso rodea la parte «${id}», que no existe (usa los \`id\` de \`parts\`).`))
    if (s.parts.length > 4) out.push(issue('info', p, `El paso rodea ${s.parts.length} partes: se pierde el foco; rodea de 1 a 3 (lo que cambia en ese paso).`))
    out.push(...latexIssues(s.md, p))
  })
  if (steps.length < 2) out.push(issue('warning', path + '.steps', 'Un recorrido guiado necesita al menos 2 pasos (mejor de 3 a 7); si no, quítalo.'))
  if (steps.length > 10) out.push(issue('info', path + '.steps', `${steps.length} pasos es un recorrido largo: deja de 3 a 7 (una idea por paso).`))
  return out
}
