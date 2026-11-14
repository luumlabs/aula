// Arregla lo que la IA suele escribir distinto en un bloque `structure`: la SMILES con otro nombre (SMILES,
// canonicalSmiles…), los grupos como `highlights`, la fórmula como `molecularFormula`, `name` por `title` y un átomo
// suelto en lugar de una lista. Los grupos escritos solo con su nombre («éster») pasan a `autoGroups`.
import { isJSONObject, type JSONObject, type JSONValue } from '@engine/base/json'
import { SMILES_KEYS } from '@shared/schema'

function move(o: JSONObject, from: readonly string[], to: string): void {
  if (o[to] !== undefined) return
  for (const f of from) {
    if (o[f] !== undefined) {
      o[to] = o[f]
      delete o[f]
      return
    }
  }
}

export function normalizeStructureFields(o: JSONObject): void {
  move(o, SMILES_KEYS.filter((k) => k !== 'smiles'), 'smiles')
  move(o, ['highlight', 'highlights', 'functionalGroups', 'functional_groups', 'regions'], 'groups')
  move(o, ['molecularFormula', 'molecular_formula', 'formulaText'], 'formula')
  move(o, ['name', 'molecule', 'compound'], 'title')
  move(o, ['description', 'alt_text'], 'alt')
  move(o, ['annotations', 'labels'], 'notes')
  const groups = o.groups
  if (Array.isArray(groups)) {
    // «groups»: ["éster", "amina"] sin átomos: que los busque Aula
    if (groups.some((g) => typeof g === 'string')) o.autoGroups = true
    o.groups = groups.filter((g) => isJSONObject(g)).map((g) => {
      const go: JSONObject = { ...(g as JSONObject) }
      move(go, ['name', 'title'], 'label')
      move(go, ['atom', 'indices', 'atomIndices'], 'atoms')
      move(go, ['detail', 'description', 'explanation'], 'md')
      if (typeof go.atoms === 'number' || typeof go.atoms === 'string') go.atoms = [go.atoms as JSONValue]
      return go
    })
  }
}
