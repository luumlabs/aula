// Ficha del ordenador para mover un modelo local: chip, núcleos, GPU, memoria y disco (port de
// `LocalAIKit/Hardware/{MacHardware,ChipSpecs}.swift`, ampliado a Windows y Linux con node:os y pistas de la GPU).
// Solo lectura: no cambia nada del sistema. Las consultas externas (sysctl, ioreg, nvidia-smi) tienen plazos cortos.
import { existsSync, readdirSync, readFileSync, statfsSync } from 'node:fs'
import { arch, cpus, homedir, release, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import type { GPUInfo, HardwareProfile } from '@shared/agents'
import { captureCommand } from '../agents/child-process'

// MARK: Chips de Apple

export type ChipTier = 'base' | 'pro' | 'max' | 'ultra'

export interface ChipSpec {
  family: string
  tier: ChipTier
  /** Ancho de banda de la memoria unificada (GB/s). */
  bandwidthGBs: number
  maxMemoryGB: number
  /** Potencia por núcleo de GPU relativa a M1 (lectura del texto de entrada). */
  gpuCoreFactor: number
  /** Extrapolada (chip más nuevo que la tabla). */
  estimated?: boolean
}

export function chipName(spec: ChipSpec): string {
  return spec.tier === 'base' ? spec.family : `${spec.family} ${spec.tier[0].toUpperCase()}${spec.tier.slice(1)}`
}

const CHIPS: ChipSpec[] = [
  { family: 'M1', tier: 'base', bandwidthGBs: 68.25, maxMemoryGB: 16, gpuCoreFactor: 1.0 },
  { family: 'M1', tier: 'pro', bandwidthGBs: 200, maxMemoryGB: 32, gpuCoreFactor: 1.0 },
  { family: 'M1', tier: 'max', bandwidthGBs: 400, maxMemoryGB: 64, gpuCoreFactor: 1.05 },
  { family: 'M1', tier: 'ultra', bandwidthGBs: 800, maxMemoryGB: 128, gpuCoreFactor: 1.0 },
  { family: 'M2', tier: 'base', bandwidthGBs: 100, maxMemoryGB: 24, gpuCoreFactor: 1.13 },
  { family: 'M2', tier: 'pro', bandwidthGBs: 200, maxMemoryGB: 32, gpuCoreFactor: 1.13 },
  { family: 'M2', tier: 'max', bandwidthGBs: 400, maxMemoryGB: 96, gpuCoreFactor: 1.1 },
  { family: 'M2', tier: 'ultra', bandwidthGBs: 800, maxMemoryGB: 192, gpuCoreFactor: 1.02 },
  { family: 'M3', tier: 'base', bandwidthGBs: 100, maxMemoryGB: 24, gpuCoreFactor: 1.17 },
  { family: 'M3', tier: 'pro', bandwidthGBs: 150, maxMemoryGB: 36, gpuCoreFactor: 1.19 },
  { family: 'M3', tier: 'max', bandwidthGBs: 400, maxMemoryGB: 128, gpuCoreFactor: 1.19 },
  { family: 'M3', tier: 'ultra', bandwidthGBs: 819, maxMemoryGB: 512, gpuCoreFactor: 1.15 },
  { family: 'M4', tier: 'base', bandwidthGBs: 120, maxMemoryGB: 32, gpuCoreFactor: 1.38 },
  { family: 'M4', tier: 'pro', bandwidthGBs: 273, maxMemoryGB: 64, gpuCoreFactor: 1.38 },
  { family: 'M4', tier: 'max', bandwidthGBs: 546, maxMemoryGB: 128, gpuCoreFactor: 1.38 },
  // M5 en adelante: aceleradores neuronales en la GPU (llama.cpp los usa)
  { family: 'M5', tier: 'base', bandwidthGBs: 153.6, maxMemoryGB: 32, gpuCoreFactor: 4.5 },
  { family: 'M5', tier: 'pro', bandwidthGBs: 307, maxMemoryGB: 64, gpuCoreFactor: 5.2 },
  { family: 'M5', tier: 'max', bandwidthGBs: 614, maxMemoryGB: 128, gpuCoreFactor: 5.0 },
  { family: 'M5', tier: 'ultra', bandwidthGBs: 1228.8, maxMemoryGB: 512, gpuCoreFactor: 3.9 },
  { family: 'M6', tier: 'base', bandwidthGBs: 153.6, maxMemoryGB: 32, gpuCoreFactor: 5.1 },
  // MacBook Neo (A18 Pro)
  { family: 'A18', tier: 'pro', bandwidthGBs: 60, maxMemoryGB: 8, gpuCoreFactor: 1.6 }
]

/** Variantes «Max» recortadas (menos núcleos de GPU → menos ancho de banda). */
const CUT_MAX = [
  { family: 'M3', maxGPU: 30, bandwidth: 300 },
  { family: 'M4', maxGPU: 32, bandwidth: 410 },
  { family: 'M5', maxGPU: 32, bandwidth: 460 }
]

/** Ficha del chip a partir de su nombre («Apple M4 Pro»); un chip más nuevo se extrapola (`estimated`). `undefined` si no es Apple Silicon. */
export function lookupChip(chip: string, gpuCores: number | undefined, appleSilicon = true, memoryGB?: number): ChipSpec | undefined {
  if (!appleSilicon) return undefined
  const words = chip.replace(/Apple/g, '').split(/[ -]+/).filter(Boolean)
  const familyWord = words.find((w) => w.length >= 2 && (w[0] === 'M' || w[0] === 'A') && /^\d+$/.test(w.slice(1)))
  if (!familyWord) return undefined
  const gen = Number(familyWord.slice(1))
  const lower = words.map((w) => w.toLowerCase())
  const tier: ChipTier = lower.includes('ultra') ? 'ultra' : lower.includes('max') ? 'max' : lower.includes('pro') ? 'pro' : 'base'
  const exact = CHIPS.find((c) => c.family === familyWord && c.tier === tier)
  if (exact) {
    const spec = { ...exact }
    const cut = CUT_MAX.find((c) => c.family === familyWord)
    if (tier === 'max' && gpuCores !== undefined && cut && gpuCores <= cut.maxGPU) spec.bandwidthGBs = cut.bandwidth
    if (familyWord === 'M6' && tier === 'base' && memoryGB !== undefined && memoryGB > 16) spec.bandwidthGBs = 170
    return spec
  }
  const sameTier = CHIPS.filter((c) => c.tier === tier && c.family[0] === familyWord[0])
  if (sameTier.length === 0) return undefined
  const last = sameTier.reduce((a, b) => (Number(b.family.slice(1)) > Number(a.family.slice(1)) ? b : a))
  const steps = Math.max(0, gen - Number(last.family.slice(1)))
  return {
    family: familyWord,
    tier,
    bandwidthGBs: last.bandwidthGBs * Math.pow(1.15, steps),
    maxMemoryGB: last.maxMemoryGB,
    gpuCoreFactor: last.gpuCoreFactor * Math.pow(1.15, steps),
    estimated: true
  }
}

export function chipSpecOf(hw: HardwareProfile): ChipSpec | undefined {
  return lookupChip(hw.chip, hw.gpuCores, hw.isAppleSilicon, Math.round(hw.memoryBytes / 1_073_741_824))
}

/** «Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz» → «Intel Core i7-9750H». */
export function cleanChipName(raw: string): string {
  let s = raw.replace(/\(R\)/g, '').replace(/\(TM\)/g, '')
  const at = s.indexOf(' @ ')
  if (at >= 0) s = s.slice(0, at)
  s = s.replace(/ CPU/g, '')
  return s.split(' ').filter(Boolean).join(' ')
}

// MARK: Sondeo

/** Espacio libre del volumen que contiene `path` (o su carpeta existente más cercana). */
export function freeSpace(path: string): number | undefined {
  let probe = path
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  try {
    const st = statfsSync(probe)
    return Number(st.bavail) * Number(st.bsize)
  } catch {
    return undefined
  }
}

async function run(exe: string, args: string[], timeoutMs = 4000): Promise<string | undefined> {
  if (!existsSync(exe)) return undefined
  const out = await captureCommand(exe, args, { env: { PATH: process.env.PATH ?? '', LANG: 'C' }, timeoutMs, maxOutputBytes: 512 * 1024 })
  if (!out || out.timedOut) return undefined
  return out.stdout.toString('utf8')
}

/** Pares «nombre: valor» de `sysctl`. */
export function parseSysctl(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) map.set(line.slice(0, i).trim(), line.slice(i + 1).trim())
  }
  return map
}

/** `"gpu-core-count" = 10` y `"model" = "Apple M4 Pro"` de `ioreg -rc AGXAccelerator`. */
export function parseIoreg(text: string): { gpuCores?: number; model?: string } {
  const cores = /"gpu-core-count"\s*=\s*(\d+)/.exec(text)
  const model = /"model"\s*=\s*"([^"]+)"/.exec(text)
  return { gpuCores: cores ? Number(cores[1]) : undefined, model: model?.[1] }
}

/** Líneas de `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` (MiB) → la GPU con más memoria. */
export function parseNvidiaSmi(text: string): GPUInfo | undefined {
  let best: GPUInfo | undefined
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(',').map((p) => p.trim())
    if (parts.length < 2 || !parts[0]) continue
    const mib = Number(parts[1])
    if (!Number.isFinite(mib) || mib <= 0) continue
    const gpu: GPUInfo = { vendor: 'nvidia', name: parts[0], vramBytes: mib * 1_048_576 }
    if (!best || (gpu.vramBytes ?? 0) > (best.vramBytes ?? 0)) best = gpu
  }
  return best
}

function nvidiaSmiPath(): string | undefined {
  const candidates =
    process.platform === 'win32'
      ? [join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'), join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')]
      : ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi', '/opt/bin/nvidia-smi']
  return candidates.find((c) => existsSync(c))
}

/** GPU AMD con amdgpu (Linux): memoria propia en `/sys/class/drm/card*\/device/mem_info_vram_total`. */
function amdLinuxGPU(): GPUInfo | undefined {
  try {
    let best: GPUInfo | undefined
    for (const card of readdirSync('/sys/class/drm')) {
      if (!/^card\d+$/.test(card)) continue
      const device = `/sys/class/drm/${card}/device`
      const vendor = readFileSync(`${device}/vendor`, 'utf8').trim()
      if (vendor !== '0x1002') continue
      const vram = Number(readFileSync(`${device}/mem_info_vram_total`, 'utf8').trim())
      if (!Number.isFinite(vram) || vram <= 512 * 1_048_576) continue // las integradas reservan poca
      const gpu: GPUInfo = { vendor: 'amd', name: 'AMD Radeon', vramBytes: vram }
      if (!best || vram > (best.vramBytes ?? 0)) best = gpu
    }
    return best
  } catch {
    return undefined
  }
}

/** Núcleos físicos en Linux (pares «physical id / core id» distintos de /proc/cpuinfo). */
function linuxPhysicalCores(): number | undefined {
  try {
    const text = readFileSync('/proc/cpuinfo', 'utf8')
    const seen = new Set<string>()
    for (const block of text.split(/\n\n+/)) {
      const phys = /physical id\s*:\s*(\d+)/.exec(block)?.[1] ?? '0'
      const core = /core id\s*:\s*(\d+)/.exec(block)?.[1]
      if (core !== undefined) seen.add(`${phys}:${core}`)
    }
    return seen.size > 0 ? seen.size : undefined
  } catch {
    return undefined
  }
}

let cachedStatic: Omit<HardwareProfile, 'freeDiskBytes'> | undefined

/** La ficha de este ordenador. `folder` es donde se guardan los modelos (para medir su disco libre). */
export async function probeHardware(folder: string = homedir()): Promise<HardwareProfile> {
  if (!cachedStatic) cachedStatic = await probeStatic()
  return { ...cachedStatic, freeDiskBytes: freeSpace(folder) }
}

/** Olvida la ficha en caché (pruebas). */
export function resetHardwareCache(): void {
  cachedStatic = undefined
}

async function probeStatic(): Promise<Omit<HardwareProfile, 'freeDiskBytes'>> {
  const list = cpus()
  const logical = list.length || 1
  const base = {
    platform: process.platform,
    arch: arch(),
    memoryBytes: totalmem(),
    logicalCores: logical,
    osVersion: release()
  }
  if (process.platform === 'darwin') {
    const names = ['hw.optional.arm64', 'machdep.cpu.brand_string', 'hw.physicalcpu', 'hw.nperflevels', 'hw.model']
    for (let i = 0; i < 4; i++) names.push(`hw.perflevel${i}.physicalcpu`, `hw.perflevel${i}.name`)
    const sys = parseSysctl((await run('/usr/sbin/sysctl', names)) ?? '')
    const appleSilicon = sys.get('hw.optional.arm64') === '1' // 1 también con Rosetta
    let chip = sys.get('machdep.cpu.brand_string') ?? list[0]?.model ?? ''
    const ioreg = appleSilicon ? parseIoreg((await run('/usr/sbin/ioreg', ['-rc', 'AGXAccelerator', '-d', '1'])) ?? '') : {}
    if (appleSilicon && (!chip || chip.toLowerCase().includes('virtualapple')) && ioreg.model) chip = ioreg.model
    if (!chip) chip = appleSilicon ? 'Apple Silicon' : 'Intel'
    let perf = 0
    let eff = 0
    const levels = Number(sys.get('hw.nperflevels') ?? 0)
    for (let i = 0; i < levels; i++) {
      const n = Number(sys.get(`hw.perflevel${i}.physicalcpu`) ?? 0)
      if ((sys.get(`hw.perflevel${i}.name`) ?? '').toLowerCase().includes('efficien')) eff += n
      else perf += n
    }
    if (perf + eff === 0) perf = Number(sys.get('hw.physicalcpu') ?? logical)
    const version = (await run('/usr/bin/sw_vers', ['-productVersion']))?.trim()
    return {
      ...base,
      chip: cleanChipName(chip),
      isAppleSilicon: appleSilicon,
      performanceCores: perf,
      efficiencyCores: eff,
      gpuCores: appleSilicon ? ioreg.gpuCores : undefined,
      gpu: appleSilicon ? { vendor: 'apple', name: cleanChipName(chip) } : undefined,
      osVersion: version || base.osVersion
    }
  }
  // Windows y Linux
  const smi = nvidiaSmiPath()
  let gpu: GPUInfo | undefined
  if (smi) gpu = parseNvidiaSmi((await run(smi, ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'])) ?? '')
  if (!gpu && process.platform === 'linux') gpu = amdLinuxGPU()
  const physical = process.platform === 'linux' ? linuxPhysicalCores() : undefined
  return {
    ...base,
    chip: cleanChipName(list[0]?.model ?? arch()),
    isAppleSilicon: false,
    performanceCores: physical ?? Math.max(1, logical > 4 ? Math.round(logical / 2) : logical),
    efficiencyCores: 0,
    gpu
  }
}
