// Port de `Tests/LocalAIKitTests/{FitTests,HardwareTests}.swift`: el catálogo integrado, el estimador de encaje y velocidad con
// ordenadores de ejemplo (cifras reales de `recommendedMaxWorkingSetSize`) y la tabla de chips; más casos de Windows/Linux con GPU.
import { describe, expect, it } from 'vitest'
import type { FitLevel, HardwareProfile, ModelCard } from '@shared/agents'
import { BUILTIN_CATALOG, catalogCard, downloadBytes, ggufFileName, hubDownloadURL, modelAlias } from './catalog'
import { DEFAULT_FIT_POLICY, F16_FIT_POLICY, estimateFit, fitBudget, fitMemory, generationSpeed, kvShapeBytes, promptSpeed, recommendedModels } from './fit'
import { chipName, cleanChipName, lookupChip, parseIoreg, parseNvidiaSmi, parseSysctl, probeHardware } from './hardware'

const GB = 1_073_741_824

function mac(chip: string, gpuCores: number | undefined, ramGB: number, wsMB: number | undefined, apple = true, disk = 200 * GB): HardwareProfile {
  return {
    platform: 'darwin', arch: apple ? 'arm64' : 'x64', chip, isAppleSilicon: apple, performanceCores: 8, efficiencyCores: 4, logicalCores: 12,
    gpuCores, memoryBytes: ramGB * GB, gpuWorkingSetBytes: wsMB === undefined ? undefined : Math.trunc(wsMB * 1e6), freeDiskBytes: disk, osVersion: '27.0'
  }
}

const M1_8 = mac('Apple M1', 8, 8, 5726.63)
const M2_16 = mac('Apple M2', 10, 16, 11453.25)
const M4PRO_24 = mac('Apple M4 Pro', 16, 24, 19069.67)
const M3MAX_64 = mac('Apple M3 Max', 40, 64, 51539.61)
const M2ULTRA_192 = mac('Apple M2 Ultra', 76, 192, 173_000)
const INTEL_16 = mac('Intel Core i7-9750H', undefined, 16, undefined, false)

function pc(platform: NodeJS.Platform, ramGB: number, gpu?: { name: string; vramGB: number }): HardwareProfile {
  return {
    platform, arch: 'x64', chip: 'AMD Ryzen 7 7840U', isAppleSilicon: false, performanceCores: 8, efficiencyCores: 0, logicalCores: 16, memoryBytes: ramGB * GB,
    freeDiskBytes: 500 * GB, osVersion: '6.8', ...(gpu ? { gpu: { vendor: 'nvidia' as const, name: gpu.name, vramBytes: gpu.vramGB * GB } } : {})
  }
}

const card = (id: string): ModelCard => catalogCard(id)!
const level = (id: string, hw: HardwareProfile): FitLevel => estimateFit(card(id), hw).level
const ORDER: FitLevel[] = ['tooBig', 'tight', 'works', 'ideal']
const atLeast = (l: FitLevel, min: FitLevel): boolean => ORDER.indexOf(l) >= ORDER.indexOf(min)

describe('Catálogo integrado', () => {
  it('es coherente', () => {
    expect(BUILTIN_CATALOG.length).toBeGreaterThanOrEqual(15)
    expect(new Set(BUILTIN_CATALOG.map((c) => c.id)).size).toBe(BUILTIN_CATALOG.length)
    for (const c of BUILTIN_CATALOG) {
      const g = c.gguf!
      expect(g, c.id).toBeDefined()
      expect(/^[0-9a-f]{64}$/.test(g.sha256), c.id).toBe(true)
      expect(/^[0-9a-f]{40}$/.test(g.revision), c.id).toBe(true)
      expect(g.bytes, c.id).toBeGreaterThan(500_000_000)
      expect(c.capabilities, `${c.id}: Aula necesita herramientas`).toContain('tools')
      expect(c.capabilities.includes('vision'), `${c.id}: visión solo con proyector`).toBe(!!g.visionProjector)
      if (g.visionProjector) expect(/^[0-9a-f]{64}$/.test(g.visionProjector.sha256)).toBe(true)
      expect(c.released, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(c.rank, c.id).toBeDefined()
      expect(c.blurb && c.blurbEn, c.id).toBeTruthy()
      expect(ggufFileName(g.path).endsWith('.gguf')).toBe(true)
      const bits = (g.bytes * 8) / (c.parametersB * 1e9) // entre 3,5 y 6 bits por parámetro
      expect(bits, `${c.id}: ${bits}`).toBeGreaterThanOrEqual(3.5)
      expect(bits, `${c.id}: ${bits}`).toBeLessThanOrEqual(6)
      expect(modelAlias(c)).toMatch(/^[a-z0-9._-]+$/)
    }
  })

  it('alias, tamaño de descarga y dirección fijada a la revisión', () => {
    expect(modelAlias({ id: 'hf:unsloth/Qwen3-8B-GGUF' })).toBe('qwen3-8b-gguf')
    expect(modelAlias({ id: 'Mi Modelo/1' })).toBe('mi-modelo-1')
    expect(modelAlias({ id: '' })).toBe('modelo')
    const q = card('qwen3.5-9b')
    expect(downloadBytes(q)).toBe(5_680_522_464 + 918_166_080)
    expect(hubDownloadURL('unsloth/Qwen3.5-9B-GGUF', 'BF16/a b.gguf', 'abc')).toBe('https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/abc/BF16/a%20b.gguf')
  })
})

describe('Estimador de encaje', () => {
  it('presupuestos de memoria', () => {
    expect(fitBudget(M1_8) / GB).toBeCloseTo(4, 1) // ⅔ de 8 GB menos 1 GB, sin bajar de 4 GB libres
    expect(fitBudget(M2_16) / 1e9).toBeCloseTo(11.45 - 1.07, 0)
    expect(Math.abs(fitBudget(M4PRO_24) / GB - (17.76 - 1))).toBeLessThan(0.1)
    expect(fitBudget(INTEL_16) / GB).toBeCloseTo(8, 1)
    // con GPU dedicada: su memoria (o la mitad de la RAM, si es mayor)
    expect(fitBudget(pc('linux', 32, { name: 'NVIDIA GeForce RTX 4090', vramGB: 24 })) / GB).toBeCloseTo(24 * 0.92 - 0.5, 1)
    expect(fitBudget(pc('win32', 64, { name: 'RTX 3060', vramGB: 6 })) / GB).toBeCloseTo(32, 1)
  })

  it('los veredictos tienen sentido', () => {
    expect(atLeast(level('qwen3.5-2b', M1_8), 'works')).toBe(true)
    expect(level('qwen3.5-9b', M1_8)).toBe('tooBig')
    expect(level('gpt-oss-20b', M1_8)).toBe('tooBig')
    expect(atLeast(level('qwen3.5-9b', M2_16), 'works')).toBe(true)
    expect(level('qwen3.8-27b', M2_16)).toBe('tooBig')
    expect(level('qwen3.5-9b', M4PRO_24)).toBe('ideal')
    expect(atLeast(level('gpt-oss-20b', M4PRO_24), 'works')).toBe(true)
    expect(level('qwen3.6-35b-a3b', M4PRO_24)).toBe('tooBig')
    expect(level('qwen3.8-27b', M4PRO_24)).toBe('tooBig')
    expect(atLeast(level('qwen3.6-35b-a3b', M3MAX_64), 'works')).toBe(true)
    expect(atLeast(level('qwen3.8-27b', M3MAX_64), 'works')).toBe(true)
    expect(level('gpt-oss-120b', M3MAX_64)).toBe('tooBig')
    expect(atLeast(level('gpt-oss-120b', M2ULTRA_192), 'works')).toBe(true)
    // Intel: como mucho «Justo»
    expect(atLeast('tight', level('qwen3.5-2b', INTEL_16))).toBe(true)
    expect(estimateFit(card('qwen3.5-2b'), INTEL_16).reason).toBe('intelCPU')
  })

  it('Windows y Linux: con GPU dedicada va en la GPU; sin ella, solo CPU', () => {
    const rtx = pc('linux', 32, { name: 'NVIDIA GeForce RTX 4090', vramGB: 24 })
    const e = estimateFit(card('qwen3.5-9b'), rtx)
    expect(atLeast(e.level, 'works')).toBe(true)
    expect(e.tokensPerSecond).toBeGreaterThan(60)
    const cpu = estimateFit(card('qwen3.5-4b'), pc('win32', 16))
    expect(cpu.reason).toBe('cpuOnly')
    expect(atLeast('tight', cpu.level)).toBe(true)
    expect(recommendedModels(BUILTIN_CATALOG, pc('linux', 16))).toEqual([]) // sin acelerador no se recomienda nada
    expect(recommendedModels(BUILTIN_CATALOG, rtx).length).toBeGreaterThan(0)
  })

  it('velocidades en el orden de magnitud correcto', () => {
    // 7 B Q4_0 (3,82 GB) en M4 Pro: llama.cpp mide ~51 tok/s generando y ~440 t/s leyendo la entrada (20 núcleos)
    const llama7: ModelCard = { id: 'x', name: 'x', publisher: 'x', parametersB: 6.74, contextLength: 4096, capabilities: ['tools'], multilingual: false,
      gguf: { repo: 'r', path: 'x.gguf', bytes: 3_823_000_000, sha256: '0'.repeat(64), quantization: 'Q4_0', revision: 'main' } }
    const m4pro20 = mac('Apple M4 Pro', 20, 24, 19069.67)
    expect(Math.abs((generationSpeed(llama7, m4pro20) ?? 0) - 51)).toBeLessThanOrEqual(6)
    expect(Math.abs((promptSpeed(llama7, m4pro20) ?? 0) - 440)).toBeLessThanOrEqual(60)
    const m1 = mac('Apple M1', 8, 16, 11453)
    expect(Math.abs((generationSpeed(llama7, m1) ?? 0) - 14)).toBeLessThanOrEqual(2)
    expect(Math.abs((promptSpeed(llama7, m1) ?? 0) - 118)).toBeLessThanOrEqual(15)
    // un MoE va mucho más rápido que un denso del mismo tamaño
    expect(generationSpeed(card('gpt-oss-20b'), M4PRO_24)!).toBeGreaterThan(2 * generationSpeed(card('ministral-3-14b'), M4PRO_24)!)
  })

  it('elección del contexto y caché KV', () => {
    expect(estimateFit(card('qwen3.5-9b'), M4PRO_24).contextTokens).toBe(65_536) // con memoria de sobra, más contexto
    const small = estimateFit(card('qwen3.5-4b'), M1_8)
    expect(small.contextTokens).toBeGreaterThanOrEqual(16_384)
    expect(small.memoryBytes).toBeLessThanOrEqual(fitBudget(M1_8))
    // f16 (Ollama) ocupa más que q8_0 (Aula)
    expect(fitMemory(card('granite-4.2-8b'), 32_768, F16_FIT_POLICY) - fitMemory(card('granite-4.2-8b'), 32_768, DEFAULT_FIT_POLICY)).toBeGreaterThan(2 * GB)
    // las capas con ventana deslizante no crecen con el contexto
    expect(kvShapeBytes({ layers: 24, kvHeads: 8, headDim: 64, slidingLayers: 12, slidingWindow: 128 }, 1024, 2)).toBe(2 * 8 * 64 * 2 * (12 * 1024 + 12 * 128))
  })

  it('comprueba el disco', () => {
    const full = mac('Apple M4 Pro', 16, 24, 19069.67, true, 5 * GB)
    expect(estimateFit(card('qwen3.5-9b'), full).diskOK).toBe(false)
    expect(estimateFit(card('qwen3.5-2b'), full).diskOK).toBe(true)
  })

  it('recomendaciones', () => {
    const ids24 = recommendedModels(BUILTIN_CATALOG, M4PRO_24).map((c) => c.id)
    expect(ids24[0]).toBe('qwen3.5-9b')
    expect(ids24).toContain('gpt-oss-20b')
    expect(ids24).not.toContain('qwen3.6-35b-a3b')
    const ids8 = recommendedModels(BUILTIN_CATALOG, M1_8).map((c) => c.id)
    expect(ids8.length).toBeGreaterThan(0)
    expect(ids8.every((id) => (card(id).gguf?.bytes ?? 0) < 4 * GB)).toBe(true)
    const ids64 = recommendedModels(BUILTIN_CATALOG, M3MAX_64).map((c) => c.id)
    expect(ids64.slice(0, 2)).toEqual(['qwen3.6-35b-a3b', 'qwen3.8-27b']) // el MoE grande primero, después el denso de 27 B
    expect(ids64.filter((id) => id.startsWith('qwen')).length).toBeLessThanOrEqual(2) // como mucho dos por editor
    expect(recommendedModels(BUILTIN_CATALOG, INTEL_16)).toEqual([])
  })
})

describe('Ficha del ordenador', () => {
  it('lee este ordenador', async () => {
    const hw = await probeHardware()
    expect(hw.chip).not.toBe('')
    expect(hw.memoryBytes).toBeGreaterThan(1 * GB)
    expect(hw.performanceCores).toBeGreaterThan(0)
    expect(hw.logicalCores).toBeGreaterThan(0)
    expect(hw.freeDiskBytes).toBeDefined()
    expect(hw.platform).toBe(process.platform)
  })

  it('tabla de chips de Apple', () => {
    expect(lookupChip('Apple M4 Pro', 16)?.bandwidthGBs).toBe(273)
    expect(lookupChip('Apple M1', 8)?.bandwidthGBs).toBe(68.25)
    expect(lookupChip('Apple M2 Ultra', 76)?.bandwidthGBs).toBe(800)
    expect(lookupChip('Apple M3 Max', 30)?.bandwidthGBs).toBe(300) // los Max recortados tienen menos ancho de banda
    expect(lookupChip('Apple M3 Max', 40)?.bandwidthGBs).toBe(400)
    expect(lookupChip('Apple M4 Max', 32)?.bandwidthGBs).toBe(410)
    expect(lookupChip('Apple M4 Max', 40)?.bandwidthGBs).toBe(546)
    const future = lookupChip('Apple M9 Pro', 30) // un chip futuro se extrapola (y queda marcado)
    expect(future?.estimated).toBe(true)
    expect(lookupChip('Intel(R) Core(TM) i9', undefined, false)).toBeUndefined()
    expect(chipName(lookupChip('Apple M4 Pro', 16)!)).toBe('M4 Pro')
    expect(lookupChip('Apple M5 Max', 32)?.bandwidthGBs).toBe(460)
    expect(lookupChip('Apple M6', 12, true, 24)?.bandwidthGBs).toBe(170)
    expect(lookupChip('Apple A18 Pro', 5)?.bandwidthGBs).toBe(60)
    expect(cleanChipName('Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz')).toBe('Intel Core i7-9750H')
    expect(cleanChipName('Apple M4 Pro')).toBe('Apple M4 Pro')
  })

  it('lee la salida de sysctl, ioreg y nvidia-smi', () => {
    const sys = parseSysctl('hw.optional.arm64: 1\nmachdep.cpu.brand_string: Apple M4 Pro\nhw.perflevel0.physicalcpu: 10\n')
    expect(sys.get('hw.optional.arm64')).toBe('1')
    expect(sys.get('machdep.cpu.brand_string')).toBe('Apple M4 Pro')
    expect(parseIoreg('  "gpu-core-count" = 16\n  "model" = "Apple M4 Pro"\n')).toEqual({ gpuCores: 16, model: 'Apple M4 Pro' })
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 3060, 12288\nNVIDIA GeForce RTX 4090, 24564\n')).toEqual({ vendor: 'nvidia', name: 'NVIDIA GeForce RTX 4090', vramBytes: 24564 * 1_048_576 })
    expect(parseNvidiaSmi('basura')).toBeUndefined()
  })
})
