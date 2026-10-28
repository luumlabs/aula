import { describe, expect, it } from 'vitest'
import type { SourceHit } from '@shared/ingest'
import { fuseRankings, hybridSearch, reciprocalRankFusion, type VectorHit } from './hybrid'

const hit = (id: string, score = 0.5): VectorHit => ({ id, sourceID: 's', score })

describe('Fusión híbrida (HybridRanker)', () => {
  it('premia el acuerdo entre las dos listas', () => {
    const fused = fuseRankings(['a', 'b', 'c'], [hit('b'), hit('d'), hit('a')], { limit: 10 })
    expect(fused.map((r) => r.id)).toEqual(['b', 'a', 'd', 'c'])
    expect(fused[0].score).toBeCloseTo(1 / 62 + 1 / 61, 12)
    expect(fused[0].lexicalRank).toBe(2)
    expect(fused[0].semanticRank).toBe(1)
    expect(fused.find((r) => r.id === 'd')?.lexicalRank).toBeUndefined()
    expect(fused.find((r) => r.id === 'c')?.semanticScore).toBeUndefined()
  })

  it('una sola lista también cuenta', () => {
    expect(fuseRankings([], [hit('mitochondria', 0.61), hit('photosynthesis', 0.3)]).map((r) => r.id)).toEqual(['mitochondria', 'photosynthesis'])
    expect(fuseRankings(['x', 'y'], []).map((r) => r.id)).toEqual(['x', 'y'])
    expect(fuseRankings([], [])).toEqual([])
  })

  it('pesos, límite, duplicados y umbral', () => {
    expect(fuseRankings(['a'], [hit('b')], { lexicalWeight: 2, semanticWeight: 1 }).map((r) => r.id)).toEqual(['a', 'b'])
    expect(fuseRankings(['a'], [hit('b')], { lexicalWeight: 1, semanticWeight: 2 }).map((r) => r.id)).toEqual(['b', 'a'])
    expect(fuseRankings(['a'], [hit('b')]).map((r) => r.id)).toEqual(['a', 'b'])
    expect(fuseRankings(['a', 'a', 'b'], []).map((r) => r.lexicalRank)).toEqual([1, 2])
    expect(fuseRankings(['a', 'b', 'c'], [], { limit: 2 })).toHaveLength(2)
    expect(fuseRankings(['a'], [hit('a', 0.1), hit('b', 0.6), hit('c', 0.2)], { minSemanticOnlyScore: 0.4 }).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('RRF general', () => {
    expect(reciprocalRankFusion([['a', 'b'], ['b', 'c'], ['c', 'b']], [1, 1, 1], 60).map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('hybridSearch conserva los fragmentos de BM25 y completa los de vectores', () => {
    const bm25: SourceHit[] = [{ chunkID: 'a', sourceID: 's', snippet: 'el **seno**', score: 3 }]
    const out = hybridSearch(bm25, [hit('b', 0.7), hit('a', 0.6)], (id) => (id === 'b' ? { id: 'b', sourceID: 's', ordinal: 1, page: 4, text: 'x'.repeat(400), sourceTitle: 'Apuntes' } : null))
    expect(out.map((h) => h.chunkID)).toEqual(['a', 'b'])
    expect(out[0].snippet).toBe('el **seno**')
    expect(out[1]).toMatchObject({ page: 4, sourceTitle: 'Apuntes' })
    expect(out[1].snippet).toHaveLength(260)
    expect(hybridSearch(bm25, [], () => null)).toEqual(bm25)
  })
})
