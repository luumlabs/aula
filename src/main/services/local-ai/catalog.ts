// Catálogo integrado de modelos locales (funciona sin red): modelos abiertos con herramientas, de 1 GB a 63 GB, con el archivo
// GGUF exacto (tamaño y SHA-256 del árbol del repo en Hugging Face y el commit fijado), la forma de su caché KV, su etiqueta de
// Ollama y su equivalente MLX (port de `LocalAIKit/Catalog/BuiltinCatalog.swift`; datos comprobados en octubre de 2026).
// `rank` ordena la preferencia para Aula (herramientas fiables + español + calidad).
import type { GGUFFile, ModelCapability, ModelCard } from '@shared/agents'

const tt: ModelCapability[] = ['tools', 'thinking']
const ttv: ModelCapability[] = ['tools', 'thinking', 'vision']

function f(repo: string, path: string, bytes: number, sha256: string, quantization: string, revision: string, mmproj?: [string, number, string]): GGUFFile {
  return {
    repo,
    path,
    bytes,
    sha256: sha256.toLowerCase(),
    quantization,
    revision,
    ...(mmproj ? { visionProjector: { path: mmproj[0], bytes: mmproj[1], sha256: mmproj[2].toLowerCase() } } : {})
  }
}

export const BUILTIN_CATALOG: ModelCard[] = [
  // ── Grandes (32 GB o más) ──
  {
    id: 'qwen3.8-27b', name: 'Qwen3.8 27B', publisher: 'Qwen (Alibaba)', license: 'Apache-2.0', released: '2026-08-13', parametersB: 27.8,
    contextLength: 262_144, capabilities: ttv, multilingual: true,
    blurb: 'El más capaz que cabe en 32 GB: muy fiable con herramientas y en español; razona y ve imágenes.',
    blurbEn: 'The most capable model that fits in 32 GB: very reliable with tools and in Spanish; reasons and sees images.',
    kv: { layers: 16, kvHeads: 4, headDim: 256 },
    gguf: f('unsloth/Qwen3.8-27B-GGUF', 'Qwen3.8-27B-UD-Q4_K_M.gguf', 16_464_440_224, '322e194ff79741c7baa497c240f677f54b201b0efab44ca8e50f122b39123482', 'UD-Q4_K_M', '4ca720788d1e01f1bff70c033e0d0028fd02e502',
      ['mmproj-F16.gguf', 927_607_488, 'cbb841a9ee0636b2ec172f5bb8df2ea8dfeb01e90fe7c6126581d662a0b4e43e']),
    ollamaTag: 'qwen3.8:27b', mlxRepo: 'mlx-community/Qwen3.8-27B-4bit', downloads: 6_600_000, rank: 1
  },
  {
    id: 'qwen3.6-35b-a3b', name: 'Qwen3.6 35B A3B', publisher: 'Qwen (Alibaba)', license: 'Apache-2.0', released: '2026-04-16', parametersB: 35.95, activeParametersB: 3,
    contextLength: 262_144, capabilities: tt, multilingual: true,
    blurb: 'MoE: calidad de modelo grande a la velocidad de uno pequeño. Muy bueno con herramientas.',
    blurbEn: 'MoE: big-model quality at small-model speed. Very good with tools.',
    kv: { layers: 10, kvHeads: 2, headDim: 256 },
    gguf: f('ggml-org/Qwen3.6-35B-A3B-GGUF', 'Qwen3.6-35B-A3B-Q4_K_M.gguf', 20_419_565_568, '671e47e0ec53c665d048b98c3ecbfd5236b5ca9c3e02ed19fc8f81f7b85140c7', 'Q4_K_M', 'baec3ebee244827cda0f4557eafa8b28f7545fa6'),
    ollamaTag: 'qwen3.6:35b', mlxRepo: 'mlx-community/Qwen3.6-35B-A3B-4bit', downloads: 1_200_000, rank: 2
  },
  {
    id: 'gemma-4-31b', name: 'Gemma 4 31B', publisher: 'Google', license: 'Apache-2.0', released: '2026-04-01', parametersB: 30.7,
    contextLength: 262_144, capabilities: ttv, multilingual: true,
    blurb: 'El Gemma más capaz: escribe muy bien, usa bien las herramientas y ve imágenes.',
    blurbEn: 'The most capable Gemma: writes very well, handles tools well and sees images.',
    kv: { layers: 60, kvHeads: 8, headDim: 256, slidingLayers: 50, slidingWindow: 2048 },
    gguf: f('unsloth/gemma-4-31B-it-GGUF', 'gemma-4-31B-it-Q4_K_M.gguf', 18_323_733_440, '38bd64c852c4b460434cc7162fa9bdcf242faf86502581a754cb72956bb17f84', 'Q4_K_M', 'c1ac76e99d5513b141e8adde7288b85c3f9c32ec',
      ['mmproj-F16.gguf', 1_198_957_024, '6edcca228213c28d3567a35d22f849eea52d8360875093851959adf5d2f270eb']),
    ollamaTag: 'gemma4:31b', mlxRepo: 'mlx-community/gemma-4-31b-it-4bit', rank: 3
  },
  {
    id: 'gemma-4-26b-a4b', name: 'Gemma 4 26B A4B', publisher: 'Google', license: 'Apache-2.0', released: '2026-04-01', parametersB: 25.2, activeParametersB: 3.8,
    contextLength: 262_144, capabilities: ttv, multilingual: true,
    blurb: 'MoE de Google: rápido para su tamaño, con razonamiento y visión.',
    blurbEn: "Google's MoE: fast for its size, with reasoning and vision.",
    gguf: f('unsloth/gemma-4-26B-A4B-it-GGUF', 'gemma-4-26B-A4B-it-UD-Q4_K_M.gguf', 16_947_541_728, 'f2c28b3dc4776931ac6f879e11f203dec637ea0f14267a86ec8f6165f63f293f', 'UD-Q4_K_M', 'c099eb48e663fd284577b04978a94ffccb261841',
      ['mmproj-F16.gguf', 1_193_058_784, '418a6d8723067cd712235facbbc5cba6c8fbbd413fc1292d2aace5a027d5a42f']),
    ollamaTag: 'gemma4:26b', mlxRepo: 'mlx-community/gemma-4-26b-a4b-it-4bit', rank: 4
  },
  {
    id: 'gpt-oss-120b', name: 'gpt-oss 120B', publisher: 'OpenAI', license: 'Apache-2.0', released: '2025-08-05', parametersB: 116.8, activeParametersB: 5.1,
    contextLength: 131_072, capabilities: tt, multilingual: false,
    blurb: 'El modelo abierto grande de OpenAI, para ordenadores con 96 GB o más.',
    blurbEn: "OpenAI's large open model, for computers with 96 GB or more.",
    kv: { layers: 36, kvHeads: 8, headDim: 64, slidingLayers: 18, slidingWindow: 128 },
    gguf: f('ggml-org/gpt-oss-120b-GGUF', 'gpt-oss-120b-MXFP4.gguf', 63_387_346_208, '582bd40f6886200101f4c4ed9f25f3fe80cc14c86e9e2b37746cd8904a0c622d', 'MXFP4', '238abdd290bb874b90a5da1b4549881b7d05c091'),
    ollamaTag: 'gpt-oss:120b', mlxRepo: 'mlx-community/gpt-oss-120b-MXFP4-Q8', rank: 5
  },
  {
    id: 'granite-4.2-30b', name: 'Granite 4.2 30B', publisher: 'IBM', license: 'Apache-2.0', released: '2026-08-25', parametersB: 29.3,
    contextLength: 131_072, capabilities: tt, multilingual: true,
    blurb: 'De IBM: preciso y sobrio con las herramientas; probado en español.',
    blurbEn: 'From IBM: precise and sober with tools; tested in Spanish.',
    kv: { layers: 64, kvHeads: 8, headDim: 128 },
    gguf: f('ibm-granite/granite-4.2-30b-GGUF', 'granite-4.2-30b-Q4_K_M.gguf', 17_721_455_328, 'f299dace85d77ee0e24ca0b6720bd211b1f4cd1f65b9c0a2111e79692e29c9be', 'Q4_K_M', '27b350a791e81d9a4d1ddca1c49282e9ec533768'),
    ollamaTag: 'granite4.2:30b', mlxRepo: 'lmstudio-community/granite-4.2-30b-MLX-4bit', rank: 8
  },
  {
    id: 'nemotron-3.5-lightning-30b-a3b', name: 'Nemotron 3.5 Lightning 30B A3B', publisher: 'NVIDIA', license: 'OpenMDW-1.1', released: '2026-08-01', parametersB: 31.6, activeParametersB: 3,
    contextLength: 1_048_576, capabilities: tt, multilingual: true,
    blurb: 'De NVIDIA: MoE híbrido y rápido, con un contexto enorme.',
    blurbEn: 'From NVIDIA: a fast hybrid MoE with a huge context.',
    gguf: f('ggml-org/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF', 'NVIDIA-Nemotron-3.5-Lightning-30B-A3B-Q4_0.gguf', 18_898_091_584, '61f87e75974e4b535dcdf9aad056541a9514f1dfa4538b463b081d19b7a00e3c', 'Q4_0', '8a08a1c81dadcc75d35dbb96016cfd344b632e67'),
    ollamaTag: 'nemotron-3.5-lightning:30b', mlxRepo: 'mlx-community/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-4bit', rank: 11
  },
  {
    id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', publisher: 'Z.ai', license: 'MIT', released: '2026-01-19', parametersB: 31.2, activeParametersB: 3,
    contextLength: 202_752, capabilities: tt, multilingual: false,
    blurb: 'MoE de Z.ai, excelente con herramientas (oficialmente solo inglés y chino).',
    blurbEn: "Z.ai's MoE, excellent with tools (officially English and Chinese only).",
    kv: { layers: 47, kvHeads: 1, headDim: 288 },
    gguf: f('unsloth/GLM-4.7-Flash-GGUF', 'GLM-4.7-Flash-Q4_K_M.gguf', 18_312_339_808, '29837ed2c0fc5f51981adf8ac8083fcf80743c598381f13e9f06cbad0498b174', 'Q4_K_M', '0d32489ecb9db6d2a4fc93bd27ef01519f95474d'),
    ollamaTag: 'glm-4.7-flash:latest', mlxRepo: 'mlx-community/GLM-4.7-Flash-4bit', rank: 12
  },

  // ── Medianos (16–24 GB) ──
  {
    id: 'qwen3.5-9b', name: 'Qwen3.5 9B', publisher: 'Qwen (Alibaba)', license: 'Apache-2.0', released: '2026-02-27', parametersB: 9.65,
    contextLength: 262_144, capabilities: ttv, multilingual: true,
    blurb: 'El mejor equilibrio para 16 GB: herramientas muy fiables, razona y ve imágenes.',
    blurbEn: 'The best balance for 16 GB: very reliable tools, reasons and sees images.',
    kv: { layers: 8, kvHeads: 4, headDim: 256 },
    gguf: f('unsloth/Qwen3.5-9B-GGUF', 'Qwen3.5-9B-Q4_K_M.gguf', 5_680_522_464, '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8', 'Q4_K_M', '3885219b6810b007914f3a7950a8d1b469d598a5',
      ['mmproj-F16.gguf', 918_166_080, 'f70dc3509053962b0d0d3ee8a7eacebf5d60aa560cad78254ae8698516ae029f']),
    ollamaTag: 'qwen3.5:9b', mlxRepo: 'mlx-community/Qwen3.5-9B-MLX-4bit', downloads: 1_220_000, rank: 6
  },
  {
    id: 'gemma-4-12b', name: 'Gemma 4 12B', publisher: 'Google', license: 'Apache-2.0', released: '2026-06-01', parametersB: 11.96,
    contextLength: 262_144, capabilities: ttv, multilingual: true,
    blurb: 'Escribe muy bien en español, usa bien las herramientas y ve imágenes.',
    blurbEn: 'Writes very well in Spanish, handles tools well and sees images.',
    kv: { layers: 48, kvHeads: 4, headDim: 128, slidingLayers: 40, slidingWindow: 4096 },
    gguf: f('unsloth/gemma-4-12b-it-GGUF', 'gemma-4-12b-it-Q4_K_M.gguf', 7_121_861_440, '0a270ec9fe6b34f4a0d33992b6135117b484ebc4766ab76b51d4ae8c457e4c42', 'Q4_K_M', 'fc034cfff751157913579611efad8462ac1be606',
      ['mmproj-F16.gguf', 175_115_840, '91f086971e56d7a7d8d39e271873fccdb49541bd259d6e02c401a4f1cb7a219e']),
    ollamaTag: 'gemma4:12b', mlxRepo: 'mlx-community/gemma-4-12B-it-4bit', downloads: 1_700_000, rank: 7
  },
  {
    id: 'gpt-oss-20b', name: 'gpt-oss 20B', publisher: 'OpenAI', license: 'Apache-2.0', released: '2025-08-05', parametersB: 20.9, activeParametersB: 3.6,
    contextLength: 131_072, capabilities: tt, multilingual: false,
    blurb: 'MoE de OpenAI: muy rápido y pensado para agentes; en español, correcto.',
    blurbEn: "OpenAI's MoE: very fast and built for agents; decent in Spanish.",
    kv: { layers: 24, kvHeads: 8, headDim: 64, slidingLayers: 12, slidingWindow: 128 },
    gguf: f('ggml-org/gpt-oss-20b-GGUF', 'gpt-oss-20b-MXFP4.gguf', 12_109_566_624, '27cd6c432c7672cb812a92f611cf3ba7bbc35928262bb1e1253ff4ee6ae35901', 'MXFP4', 'ef9b12f2ff56c69cf32153a02784e7a3c88bf524'),
    ollamaTag: 'gpt-oss:20b', mlxRepo: 'mlx-community/gpt-oss-20b-MXFP4-Q8', downloads: 165_903, rank: 9
  },
  {
    id: 'ministral-3-14b', name: 'Ministral 3 14B', publisher: 'Mistral AI', license: 'Apache-2.0', released: '2025-12-02', parametersB: 14,
    contextLength: 262_144, capabilities: ['tools'], multilingual: true,
    blurb: 'De Mistral: rápido, multilingüe y directo.',
    blurbEn: 'From Mistral: fast, multilingual and to the point.',
    kv: { layers: 40, kvHeads: 8, headDim: 128 },
    gguf: f('mistralai/Ministral-3-14B-Instruct-2512-GGUF', 'Ministral-3-14B-Instruct-2512-Q4_K_M.gguf', 8_239_593_024, '824e0f3373e69b84f2cae46fdcb9bd1ebc6ab3bfc7acc125d818b7b8178cc613', 'Q4_K_M', '74fac473c43357d7fb2671713608183cc72496d0'),
    ollamaTag: 'ministral-3:14b', mlxRepo: 'mlx-community/Ministral-3-14B-Instruct-2512-4bit', rank: 10
  },
  {
    id: 'granite-4.2-8b', name: 'Granite 4.2 8B', publisher: 'IBM', license: 'Apache-2.0', released: '2026-08-25', parametersB: 8.79,
    contextLength: 131_072, capabilities: tt, multilingual: true,
    blurb: 'De IBM: fiable con las herramientas y sin sorpresas.',
    blurbEn: 'From IBM: reliable with tools, no surprises.',
    kv: { layers: 40, kvHeads: 8, headDim: 128 },
    gguf: f('ibm-granite/granite-4.2-8b-GGUF', 'granite-4.2-8b-Q4_K_M.gguf', 5_347_917_952, '16a9369d0805f80b7377d25d87f937a90c05dc04ad79173a52001e42c9aab311', 'Q4_K_M', '93f3f6a8938ee922b784cf4e5b4203cd3428df8f'),
    ollamaTag: 'granite4.2:8b', mlxRepo: 'lmstudio-community/granite-4.2-8b-MLX-4bit', rank: 15
  },
  {
    id: 'ministral-3-8b', name: 'Ministral 3 8B', publisher: 'Mistral AI', license: 'Apache-2.0', released: '2025-12-02', parametersB: 8,
    contextLength: 262_144, capabilities: ['tools'], multilingual: true,
    blurb: 'De Mistral: ligero y multilingüe.',
    blurbEn: 'From Mistral: light and multilingual.',
    kv: { layers: 34, kvHeads: 8, headDim: 128 },
    gguf: f('mistralai/Ministral-3-8B-Instruct-2512-GGUF', 'Ministral-3-8B-Instruct-2512-Q4_K_M.gguf', 5_198_911_904, '33e7a72cf5e6e2cfc2f2847075acc013d68bba023e35310cef86b5cf8fdca761', 'Q4_K_M', '0102285ad796bd99af90f58de616092e5630e970'),
    ollamaTag: 'ministral-3:8b', mlxRepo: 'mlx-community/Ministral-3-8B-Instruct-2512-4bit', rank: 16
  },

  // ── Pequeños (8–16 GB) ──
  {
    id: 'qwen3.5-4b', name: 'Qwen3.5 4B', publisher: 'Qwen (Alibaba)', license: 'Apache-2.0', released: '2026-02-27', parametersB: 4.66,
    contextLength: 262_144, capabilities: tt, multilingual: true,
    blurb: 'Pequeño pero muy capaz con herramientas: el mejor para 8–16 GB.',
    blurbEn: 'Small but very capable with tools: the best for 8–16 GB.',
    kv: { layers: 8, kvHeads: 4, headDim: 256 },
    gguf: f('unsloth/Qwen3.5-4B-GGUF', 'Qwen3.5-4B-Q4_K_M.gguf', 2_740_937_888, '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4', 'Q4_K_M', 'e87f176479d0855a907a41277aca2f8ee7a09523'),
    ollamaTag: 'qwen3.5:4b', mlxRepo: 'mlx-community/Qwen3.5-4B-MLX-4bit', downloads: 1_200_000, rank: 13
  },
  {
    id: 'gemma-4-e4b', name: 'Gemma 4 E4B', publisher: 'Google', license: 'Apache-2.0', released: '2026-04-01', parametersB: 8, activeParametersB: 4.5,
    contextLength: 131_072, capabilities: tt, multilingual: true,
    blurb: 'Pequeño de Google: multilingüe y con razonamiento.',
    blurbEn: "Google's small one: multilingual, with reasoning.",
    gguf: f('unsloth/gemma-4-E4B-it-GGUF', 'gemma-4-E4B-it-Q4_K_M.gguf', 4_977_171_584, '85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87', 'Q4_K_M', 'bfc15c382204943c3a8fff0c750b94ae2364d7a3'),
    ollamaTag: 'gemma4:e4b', mlxRepo: 'mlx-community/gemma-4-e4b-it-4bit', rank: 14
  },
  {
    id: 'granite-4.2-3b', name: 'Granite 4.2 3B', publisher: 'IBM', license: 'Apache-2.0', released: '2026-08-25', parametersB: 3.66,
    contextLength: 131_072, capabilities: tt, multilingual: true,
    blurb: 'Muy ligero y probado en español: para ordenadores con 8 GB.',
    blurbEn: 'Very light and tested in Spanish: for computers with 8 GB.',
    kv: { layers: 40, kvHeads: 8, headDim: 64 },
    gguf: f('ibm-granite/granite-4.2-3b-GGUF', 'granite-4.2-3b-Q4_K_M.gguf', 2_244_011_552, 'e0406663965846ae22a403456eb826ccce5f450840491f71952f18a7cb78e7d5', 'Q4_K_M', 'c40945d71cd90f249a56985e8155551a9188dc30'),
    ollamaTag: 'granite4.2:3b', mlxRepo: 'lmstudio-community/granite-4.2-3b-MLX-4bit', rank: 17
  },
  {
    id: 'qwen3.5-2b', name: 'Qwen3.5 2B', publisher: 'Qwen (Alibaba)', license: 'Apache-2.0', released: '2026-02-28', parametersB: 2.27,
    contextLength: 262_144, capabilities: tt, multilingual: true,
    blurb: 'El más pequeño con herramientas: para el tutor en ordenadores con poca memoria.',
    blurbEn: 'The smallest with tools: for the tutor on computers with little memory.',
    kv: { layers: 6, kvHeads: 2, headDim: 256 },
    gguf: f('unsloth/Qwen3.5-2B-GGUF', 'Qwen3.5-2B-Q4_K_M.gguf', 1_280_835_840, 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223', 'Q4_K_M', 'f6d5376be1edb4d416d56da11e5397a961aca8ae'),
    ollamaTag: 'qwen3.5:2b', mlxRepo: 'mlx-community/Qwen3.5-2B-MLX-4bit', rank: 18
  },
  {
    id: 'lfm2.5-2.6b', name: 'LFM2.5 2.6B', publisher: 'Liquid AI', license: 'LFM Open License 1.0', released: '2026-07-28', parametersB: 2.7,
    contextLength: 131_072, capabilities: ['tools'], multilingual: true,
    blurb: 'De Liquid AI: diminuto y muy rápido con herramientas (licencia propia).',
    blurbEn: 'From Liquid AI: tiny and very fast with tools (own license).',
    kv: { layers: 8, kvHeads: 8, headDim: 64 },
    gguf: f('LiquidAI/LFM2.5-2.6B-GGUF', 'LFM2.5-2.6B-Q4_K_M.gguf', 1_674_455_040, '02a8b7e17487d326e46d68ce0ba24211e1b80a14c4cd0597fa73c1cd697f52ed', 'Q4_K_M', 'e7caca5d835a3901a8e0d63e94009429bafafdfc'),
    mlxRepo: 'mlx-community/LFM2.5-2.6B-4bit', rank: 19
  },
  {
    id: 'ministral-3-3b', name: 'Ministral 3 3B', publisher: 'Mistral AI', license: 'Apache-2.0', released: '2025-12-02', parametersB: 3,
    contextLength: 262_144, capabilities: ['tools'], multilingual: true,
    blurb: 'De Mistral: diminuto y multilingüe.',
    blurbEn: 'From Mistral: tiny and multilingual.',
    kv: { layers: 26, kvHeads: 8, headDim: 128 },
    gguf: f('mistralai/Ministral-3-3B-Instruct-2512-GGUF', 'Ministral-3-3B-Instruct-2512-Q4_K_M.gguf', 2_147_023_008, '9ed150d4367e68df0ac8e1540f6ddc65b42d0ee26378329d1ecbca60f93fc5f8', 'Q4_K_M', 'eb599d408350ea2bb60452cb86be7c7b2fc28227'),
    ollamaTag: 'ministral-3:3b', mlxRepo: 'mlx-community/Ministral-3-3B-Instruct-2512-4bit', rank: 20
  },
  {
    id: 'gemma-4-e2b', name: 'Gemma 4 E2B', publisher: 'Google', license: 'Apache-2.0', released: '2026-04-01', parametersB: 5.1, activeParametersB: 2.3,
    contextLength: 131_072, capabilities: tt, multilingual: true,
    blurb: 'El Gemma más pequeño: para repasar en ordenadores con poca memoria.',
    blurbEn: 'The smallest Gemma: for reviewing on computers with little memory.',
    gguf: f('unsloth/gemma-4-E2B-it-GGUF', 'gemma-4-E2B-it-Q4_K_M.gguf', 3_106_738_272, '740185b21d22ceb83a11c3aa62ad5842ef32c70f6096d756bbee85a1e4ec34b8', 'Q4_K_M', '0314792d7f1f7e229411f620751375812bb9faf2'),
    ollamaTag: 'gemma4:e2b', mlxRepo: 'mlx-community/gemma-4-e2b-it-4bit', rank: 21
  }
]

/** Un modelo del catálogo por su `id`. */
export function catalogCard(id: string, cards: ModelCard[] = BUILTIN_CATALOG): ModelCard | undefined {
  return cards.find((c) => c.id === id)
}

/** Nombre del archivo de una ruta del repo. */
export function ggufFileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

/** Lo que se baja en total (modelo + proyector de visión). */
export function downloadBytes(card: ModelCard): number | undefined {
  return card.gguf ? card.gguf.bytes + (card.gguf.visionProjector?.bytes ?? 0) : undefined
}

export function isMoE(card: ModelCard): boolean {
  return (card.activeParametersB ?? card.parametersB) < card.parametersB * 0.8
}

/** «unsloth/Qwen3-8B-GGUF» → «qwen3-8b-gguf» (válido como carpeta y `--alias`). */
export function modelAlias(card: Pick<ModelCard, 'id'>): string {
  const base = card.id.startsWith('hf:') ? card.id.slice(3).split('/').pop() ?? '' : card.id
  const s = Array.from(base.toLowerCase()).map((c) => (/[a-z0-9._-]/.test(c) ? c : '-')).join('')
  return s || 'modelo'
}

/** Dirección de descarga de Hugging Face (fijada a la revisión). */
export function hubDownloadURL(repo: string, path: string, revision = 'main', hub = 'https://huggingface.co'): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `${hub}/${repo}/resolve/${encodeURIComponent(revision)}/${encodedPath}`
}
