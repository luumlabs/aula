// El tutor y las figuras: `get_lesson` da los ids de los bloques y, con `block_id`, una figura entera (también la del
// enunciado de un ejercicio), y `block_reference` da la referencia completa de los visuales de la guía (process, Venn, mapa…).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantTurnTrust } from '@engine/assistant/trust'
import { decodeBlock, decodeExercise, makePack, makeSkill, type Block } from '@shared/schema'
import { Library } from '../../store'
import type { ToolEnv } from '../host'
import { findLessonBlock, getLessonTool, namedParts } from './read'
import { blockReferenceFor, blockReferenceTool } from './study'

const roots: string[] = []
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })
const call = { signal: new AbortController().signal, callId: '1' } as never
const textOf = (out: unknown): string => (typeof out === 'string' ? out : (out as { text: string }).text)

const CELL = decodeBlock({
  id: 'fig-cell', type: 'labeled', title: 'Animal cell', alt: 'A cell', drawing: { width: 600, height: 400, items: [] },
  parts: [{ id: 'nuc', name: 'Nucleus', x: 0.5, y: 0.5 }, { id: 'mit', name: 'Mitochondrion', x: 0.2, y: 0.4 }]
}) as Block
const DIAGRAM = decodeBlock({ id: 'fig-q', type: 'diagram', kind: 'flow', title: 'Quadrants', nodes: [{ id: 'a', label: 'Angle' }, { id: 'b', label: 'Reference angle' }], edges: [{ from: 'a', to: 'b' }] }) as Block

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'aula-figures-'))
  roots.push(root)
  const lib = new Library(join(root, 'data'), { recordsHistory: false })
  const store = lib.createPack(makePack({ id: '', title: 'Biología' }))
  const ex = decodeExercise({ id: 'ex-1', skill: 'cells', prompt: [DIAGRAM, { type: 'text', md: '¿Cuál es el ángulo de referencia?' }], answer: { kind: 'short', accepted: ['b'] } })!
  store.saveSkill(makeSkill({ id: 'cells', title: 'Las células', lesson: [{ id: 't1', type: 'text', md: 'Intro' } as Block, CELL], exercises: [ex] }))
  const env = { library: lib, trust: new AssistantTurnTrust(['hola']) } as unknown as ToolEnv
  return { env, courseID: store.id }
}

describe('get_lesson y las figuras', () => {
  it('el índice de la lección lleva el id de cada bloque', async () => {
    const { env, courseID } = setup()
    const out = JSON.parse(textOf(await getLessonTool(env, 'get_lesson').run({ course_id: courseID, skill_id: 'cells' } as never, call)))
    expect(out.lesson_outline.map((b: { id: string; type: string }) => `${b.id}:${b.type}`)).toEqual(['t1:text', 'fig-cell:labeled'])
  })

  it('con block_id, la figura entera con sus partes; una del enunciado de un ejercicio dice de cuál', async () => {
    const { env, courseID } = setup()
    const tool = getLessonTool(env, 'get_lesson')
    const fig = JSON.parse(textOf(await tool.run({ course_id: courseID, skill_id: 'cells', block_id: 'fig-cell' } as never, call)))
    expect(fig.block.type).toBe('labeled')
    expect(fig.block.parts.map((p: { name: string }) => p.name)).toEqual(['Nucleus', 'Mitochondrion'])
    const inEx = JSON.parse(textOf(await tool.run({ course_id: courseID, skill_id: 'cells', block_id: 'fig-q' } as never, call)))
    expect(inEx.in_exercise_statement).toBe('ex-1')
    expect(inEx.block.nodes).toHaveLength(2)
    expect(textOf(await tool.run({ course_id: courseID, skill_id: 'cells', block_id: 'nope' } as never, call))).toContain('No block')
  })

  it('las partes con nombre de un bloque grande', () => {
    expect(namedParts({ type: 'labeled', parts: [{ id: 'a', name: 'A' }, { id: 'b', label: 'B' }, { id: 'c' }], drawing: { items: [{ id: 'd', kind: 'circle', name: 'D' }] } })).toEqual([
      { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'd', name: 'D' }
    ])
    expect(findLessonBlock(makeSkill({ id: 's', title: 'S', lesson: [CELL] }), 'fig-cell')?.block).toBe(CELL)
  })
})

describe('block_reference del chat y del tutor', () => {
  it('process y sus formas (venn, pirámide, embudo, mapa mental) dan la referencia de la guía', async () => {
    for (const type of ['process', 'venn', 'pyramid', 'funnel', 'mindmap']) {
      const ref = blockReferenceFor(type)
      expect(ref?.reference, type).toContain('"form":"venn"')
    }
    const out = JSON.parse(textOf(await blockReferenceTool().run({ type: 'Process' } as never, call)))
    expect(out.ok).toBe(true)
    expect(out.reference).toContain('"form":"mindmap"')
  })

  it('diagram: la línea del catálogo primero (con la pista de las formas) y la referencia de process', () => {
    const ref = blockReferenceFor('diagram')!
    expect(ref.schema[0]).toContain('"type":"diagram"')
    expect(ref.schema[0]).toContain('"form"')
    expect(ref.reference).toContain('"form":"pyramid"')
  })

  it('drawing y map traen lo que el catálogo corto no cuenta (moverse, pasos; países)', () => {
    expect(blockReferenceFor('drawing')!.reference).toContain('"params"')
    expect(blockReferenceFor('map')!.reference).toMatch(/countries/i)
  })

  it('el catálogo del chat cuenta los campos nuevos: formas y construcción del diagrama, tono de compare, gráfica horizontal y resaltada', () => {
    expect(blockReferenceFor('diagram')!.schema[0]).toContain('"build"')
    expect(blockReferenceFor('compare')!.schema[0]).toContain('"tone":"key|same"')
    expect(blockReferenceFor('compare')!.schema[0]).toContain('"mode":"analogy"')
    expect(blockReferenceFor('chart')!.schema[0]).toContain('"horizontal":true')
    expect(blockReferenceFor('chart')!.schema[0]).toContain('"highlight":true')
  })

  it('un bloque básico sigue saliendo del catálogo; uno que no existe, error', async () => {
    expect(blockReferenceFor('table')!.schema[0]).toContain('"type":"table"')
    expect(blockReferenceFor('table')!.reference).toBeUndefined()
    expect(blockReferenceFor('nada')).toBeUndefined()
    expect(textOf(await blockReferenceTool().run({ type: 'nada' } as never, call))).toContain('Unknown block type')
  })
})
