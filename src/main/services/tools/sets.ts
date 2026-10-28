// Conjuntos de herramientas por tipo de tarea (port de StudyEngine/Tools/ToolSets.swift). El mismo conjunto se ofrece a los
// proveedores de API (en proceso) y a los agentes CLI (por el relevo MCP: las herramientas siguen corriendo en la app).
//
// Diferencia con Swift: no hay `run_code` (ejecutar JavaScript o SQL del modelo exige un aislamiento del sistema que Aula aún no
// tiene; los autores trazan el código a mano y el verificador lo resuelve sin ver la clave) ni uso del ordenador (`computer_*`,
// `files_*`, `shell`): el navegador de Aula (`browser_*`) cubre las plataformas.
import type { AgentTool } from '../ai'
import {
  addCards, addDeck, addExercises, addTemplates, askUser, deleteItems, finish, getCourse, getSkill, noteProgress, setCommonMistakes, setCoursePlan, setExamBlueprint,
  setFormulaSheet, setGlossary, validateSkill, writeLesson
} from './authoring'
import type { ToolContext } from './context'
import { mediaTools } from './media'
import { blockReferenceTool, browserTools, campusTools, platformGuideTool, recordFindings } from './platform'
import { saveSourceDigest } from './reader'
import { calculate, chemistry, fetchURL, listSources, readSource, saveWebSource, searchSources, searchWikipedia, viewSourcePage, webSearch } from './research'
import { listDisagreements, listExercisesToSolve, resolveDisagreement, submitSolution } from './verification'

export type ToolSet =
  | { kind: 'planner' }
  | { kind: 'skillAuthor'; skill: string }
  /** Equipo: solo la lección (con tarjetas, errores comunes y presentación) de una habilidad. */
  | { kind: 'lessonAuthor'; skill: string }
  /** Equipo: solo los ejercicios y plantillas de una habilidad. */
  | { kind: 'practiceAuthor'; skill: string }
  /** Equipo: un lector que hace la ficha de unos materiales concretos. */
  | { kind: 'reader'; sources: string[] }
  | { kind: 'crossCutting' }
  /** Solucionador independiente: resuelve los ejercicios sin ver la clave. */
  | { kind: 'solver'; skill: string }
  /** Árbitro: decide quién tiene razón cuando el solucionador y la clave discrepan. */
  | { kind: 'adjudicator'; skill: string }
  /** Reunir materiales: la plataforma de estudio en el navegador de Aula. */
  | { kind: 'gatherer' }
  | { kind: 'all' }

/** Nombre del conjunto (el mismo que en Swift: «skill:suma», «read:a,b»…). */
export function toolSetName(s: ToolSet): string {
  switch (s.kind) {
    case 'planner': return 'planner'
    case 'skillAuthor': return `skill:${s.skill}`
    case 'lessonAuthor': return `lesson:${s.skill}`
    case 'practiceAuthor': return `practice:${s.skill}`
    case 'reader': return `read:${s.sources.join(',')}`
    case 'crossCutting': return 'cross'
    case 'solver': return `solve:${s.skill}`
    case 'adjudicator': return `adjudicate:${s.skill}`
    case 'gatherer': return 'gather'
    case 'all': return 'all'
  }
}

export function parseToolSet(s: string): ToolSet | undefined {
  switch (s) {
    case 'planner': return { kind: 'planner' }
    case 'cross': return { kind: 'crossCutting' }
    case 'gather': return { kind: 'gatherer' }
    case 'all': return { kind: 'all' }
  }
  const after = (p: string): string | undefined => (s.startsWith(p) ? s.slice(p.length) : undefined)
  const v = (p: string): string | undefined => after(p)
  let x: string | undefined
  if ((x = v('skill:')) !== undefined) return { kind: 'skillAuthor', skill: x }
  if ((x = v('lesson:')) !== undefined) return { kind: 'lessonAuthor', skill: x }
  if ((x = v('practice:')) !== undefined) return { kind: 'practiceAuthor', skill: x }
  if ((x = v('read:')) !== undefined) return { kind: 'reader', sources: x.split(',').filter(Boolean) }
  if ((x = v('solve:')) !== undefined) return { kind: 'solver', skill: x }
  if ((x = v('adjudicate:')) !== undefined) return { kind: 'adjudicator', skill: x }
  return undefined
}

/** Leer: materiales del estudiante, calculadora, química y (si se permite) la web. */
export function researchTools(ctx: ToolContext, includeWeb: boolean): AgentTool[] {
  const t = [listSources(ctx), searchSources(ctx), readSource(ctx), viewSourcePage(ctx), calculate(ctx), chemistry(ctx)]
  if (includeWeb && ctx.web) t.push(webSearch(ctx), fetchURL(ctx), searchWikipedia(ctx))
  return t
}

/** Las herramientas de un tipo de tarea. Los conjuntos de una habilidad solo pueden escribir en ella. */
export function makeTools(set: ToolSet, base: ToolContext, includeWeb = true): AgentTool[] {
  const research = researchTools(base, includeWeb)
  const canvas = campusTools(base)
  // imágenes y modelos (si hay web) + la referencia de los bloques visuales (siempre)
  const media = (c: ToolContext): AgentTool[] => [...mediaTools(c), blockReferenceTool(c)]
  // investigar sin materiales: guardar las páginas clave como materiales (si hay web)
  const saveWeb = includeWeb && base.web && base.importer ? [saveWebSource(base)] : []
  const on = (skill: string): ToolContext => ({ ...base, assignedSkill: skill })
  switch (set.kind) {
    case 'planner':
      return [...research, ...saveWeb, ...canvas, getCourse(base), setCoursePlan(base), setExamBlueprint(base), askUser(base), noteProgress(base), finish(base)]
    case 'skillAuthor': {
      const c = on(set.skill)
      return [...research, ...saveWeb, ...canvas, ...media(c), getCourse(c), getSkill(c), writeLesson(c), addExercises(c), addTemplates(c), addCards(c), addDeck(c), setCommonMistakes(c),
        validateSkill(c), deleteItems(c), noteProgress(c), finish(c)]
    }
    case 'lessonAuthor': {
      const c = on(set.skill)
      return [...research, ...saveWeb, ...canvas, ...media(c), getCourse(c), getSkill(c), writeLesson(c), addCards(c), addDeck(c), setCommonMistakes(c), validateSkill(c), deleteItems(c), noteProgress(c), finish(c)]
    }
    case 'practiceAuthor': {
      const c = on(set.skill)
      return [...research, ...saveWeb, ...canvas, ...media(c), getCourse(c), getSkill(c), addExercises(c), addTemplates(c), validateSkill(c), deleteItems(c), noteProgress(c), finish(c)]
    }
    case 'reader':
      return [...researchTools(base, false), saveSourceDigest(base, set.sources.length ? new Set(set.sources) : undefined), noteProgress(base), finish(base)]
    case 'crossCutting':
      return [...research, ...canvas, getCourse(base), getSkill(base), setGlossary(base), setFormulaSheet(base), setExamBlueprint(base), noteProgress(base), finish(base)]
    case 'solver': {
      const c = on(set.skill)
      return [...research, listExercisesToSolve(c), submitSolution(c), noteProgress(c), finish(c)]
    }
    case 'adjudicator': {
      const c = on(set.skill)
      return [...research, getSkill(c), listDisagreements(c), resolveDisagreement(c), addExercises(c), deleteItems(c), noteProgress(c), finish(c)]
    }
    case 'gatherer':
      return [...research, ...canvas, ...browserTools(base), platformGuideTool(base), recordFindings(base), getCourse(base), askUser(base), noteProgress(base), finish(base)]
    case 'all':
      return [...research, ...saveWeb, ...canvas, ...media(base), ...browserTools(base), getCourse(base), setCoursePlan(base), getSkill(base), writeLesson(base), addExercises(base),
        addTemplates(base), addCards(base), addDeck(base), setCommonMistakes(base), validateSkill(base), deleteItems(base), setGlossary(base), setFormulaSheet(base),
        setExamBlueprint(base), askUser(base), noteProgress(base), finish(base)]
  }
}
