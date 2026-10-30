// Port de `Tests/AgentKitTests/ErrorClassificationTests.swift` (errores de las CLIs, ayudantes del protocolo MCP y la carpeta
// temporal de cada ejecución).
import { existsSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { setAILocale } from '@shared/ai/i18n'
import { functionName, negotiateVersion, normalizedInputSchema, parseArguments, sanitizeName, toolOutputFromResult, toolResult } from '../../mcp/protocol'
import { AgentError, CLIErrorClassifier, clip, humanDuration, isAuthFailure, isNetworkFailure, isRateLimit, parseRateLimit, rateLimitPhrase, unsupportedFlag } from './errors'
import { AgentSandbox, SHARED_WORK_NAME, sharedEmptyWorkDirectory } from './sandbox'
import { cleanupTempDirs, makeTempDir } from './__fixtures__/support'

// un «ahora» fijo para que las horas de reinicio sean deterministas: miércoles 7 de octubre de 2026, 10:00 UTC
const NOW = 1_791_367_200_000
const clock = { now: NOW, timeZone: 'UTC' }
const parse = (text: string) => parseRateLimit(text, clock)
const near = (a: number | undefined, b: number, tolerance = 1): void => {
  expect(a).toBeDefined()
  expect(Math.abs((a ?? 0) - b)).toBeLessThanOrEqual(tolerance)
}

describe('Horas de reinicio de los límites de uso', () => {
  it('duraciones relativas', () => {
    expect(parse('or try again in 4 days 2 hours 9 minutes.').retryAfter).toBe(4 * 86_400 + 2 * 3_600 + 9 * 60)
    expect(parse('Please try again in 3 minutes').retryAfter).toBe(180)
    expect(parse('try again in 1h 20m 5s').retryAfter).toBe(3_600 + 1_200 + 5)
    expect(parse('resets in 2 hours').retryAfter).toBe(7_200)
    expect(parse('available again in 45 seconds').retryAfter).toBe(45)
    expect(parse('try again in 1.5 hours').retryAfter).toBe(5_400)
    expect(parse('try again later').retryAfter).toBeUndefined()
  })

  it('al estilo de la cabecera Retry-After', () => {
    expect(parse('Rate limited. retry-after: 120').retryAfter).toBe(120)
    expect(parse('Retry after 30 seconds, please').retryAfter).toBe(30)
  })

  it('época de Claude tras la barra (formato antiguo)', () => {
    const reset = NOW / 1000 + 5_400
    const info = parse(`Claude AI usage limit reached|${Math.trunc(reset)}`)
    near(info.retryAfter, 5_400)
    expect(info.resetDate).toBe(reset * 1000)
    expect(parse(`limit reached|${Math.trunc(NOW / 1000) - 100}`).retryAfter).toBe(0) // si ya pasó, 0 (no negativo)
  })

  it('resetsAt en JSON (segundos o milisegundos)', () => {
    const reset = Math.trunc(NOW / 1000 + 3_600)
    near(parse(`{"status":"rejected","resetsAt":${reset}}`).retryAfter, 3_600)
    near(parse(`{"resets_at": ${reset * 1000}}`).retryAfter, 3_600)
  })

  it('horas de reloj con zona horaria', () => {
    near(parse("You've hit your limit · resets 3pm (America/New_York)").retryAfter, 9 * 3_600) // 15:00 EDT = 19:00 UTC
    near(parse("You've hit your session limit · resets 5:30pm (Europe/Madrid)").retryAfter, 5.5 * 3_600) // 17:30 CEST
    near(parse('limit reached ∙ resets 3pm').retryAfter, 5 * 3_600) // sin zona: la dada (UTC)
    near(parse('resets 9am (UTC)').retryAfter, 23 * 3_600) // ya pasó hoy → mañana
    near(parse('The limit will reset at 15:30 (UTC)').retryAfter, 5.5 * 3_600)
    near(parse('resets 12am (UTC)').retryAfter, 14 * 3_600) // 12am = medianoche
    near(parse('resets 12pm (UTC)').retryAfter, 2 * 3_600) // 12pm = mediodía
  })

  it('fechas con mes y día', () => {
    near(parse('Weekly limit reached ∙ resets Oct 9, 9am (UTC)').retryAfter, 47 * 3_600)
    near(parse('resets Oct 9 at 9:30am (UTC)').retryAfter, 47.5 * 3_600)
    const nextYear = parse('resets Jan 2, 8am (UTC)').retryAfter ?? 0 // pasada este año → el que viene
    expect(nextYear).toBeGreaterThan(80 * 86_400)
    expect(nextYear).toBeLessThan(100 * 86_400)
  })

  it('las horas sin sentido se ignoran', () => {
    expect(parse('resets 99pm').retryAfter).toBeUndefined()
    expect(parse('resets 25:99').retryAfter).toBeUndefined()
    expect(parse('nothing to see here').retryAfter).toBeUndefined()
    expect(parse('').retryAfter).toBeUndefined()
    expect(() => parse('resets 3pm (Not/AZone)')).not.toThrow() // zona desconocida: no falla
  })

  it('duraciones legibles', () => {
    expect(humanDuration(0)).toBe('menos de 1 min')
    expect(humanDuration(59)).toBe('menos de 1 min')
    expect(humanDuration(60)).toBe('1 min')
    expect(humanDuration(3_600)).toBe('1 h')
    expect(humanDuration(7_500)).toBe('2 h 5 min')
    expect(humanDuration(86_400)).toBe('1 día')
    expect(humanDuration(2 * 86_400 + 3 * 3_600)).toBe('2 días 3 h')
  })

  it('la frase incluye la hora de reloj', () => {
    expect(rateLimitPhrase({ retryAfter: 7_500, resetDate: NOW + 7_500_000 }, clock)).toBe('Se restablece en 2 h 5 min (hacia las 12:05).')
    expect(rateLimitPhrase({})).toBe('')
    const far = rateLimitPhrase({ retryAfter: 3 * 86_400, resetDate: NOW + 3 * 86_400_000 }, clock)
    expect(far).toContain('3 días')
    expect(far).toContain('oct')
  })
})

describe('Reconocimiento de mensajes', () => {
  it('fallos de autenticación', () => {
    for (const t of ['Not logged in · Please run /login', 'Invalid API key · Please run /login', 'OAuth token has expired. Please run /login', 'Failed to authenticate. API Error: 401 {"error":"x"}',
      'unexpected status 401 Unauthorized: Missing bearer', 'Error: You are not authenticated', 'authentication_error: invalid x-api-key', 'Please log in again',
      'Your refresh token has already been used', 'ProviderAuthError: no credentials', 'invalid_api_key', 'Run `codex login` first']) {
      expect(isAuthFailure(t), t).toBe(true)
    }
    for (const t of ['Se generó la lección 401 de trigonometría', 'tokens: 4010', 'todo bien', '']) expect(isAuthFailure(t), t).toBe(false)
  })

  it('límites de uso', () => {
    for (const t of ["You've hit your limit · resets 3pm", 'Claude AI usage limit reached|1760000000', '429 Too Many Requests', 'API Error: 429 rate_limit_error', '5-hour limit reached ∙ resets 3pm',
      'You exceeded your current quota', 'Weekly limit reached', 'HTTP error 429', 'usage_limit_reached', 'Rate limit exceeded']) {
      expect(isRateLimit(t), t).toBe(true)
    }
    for (const t of ['Lección 429 creada', 'hola', 'límite de pasos']) expect(isRateLimit(t), t).toBe(false)
  })

  it('opción no reconocida', () => {
    expect(unsupportedFlag("error: unknown option '--permission-prompts'")).toBe('--permission-prompts')
    expect(unsupportedFlag("error: unexpected argument '--ignore-user-config' found\n\n  tip: ...")).toBe('--ignore-user-config')
    expect(unsupportedFlag('Unknown arguments: pure')).toBe('--pure')
    expect(unsupportedFlag('Unknown argument: variant')).toBe('--variant')
    expect(unsupportedFlag("error: unrecognized option '-z'")).toBe('-z')
    expect(unsupportedFlag('todo normal')).toBeUndefined()
  })

  it('fallos de red', () => {
    for (const t of ['getaddrinfo ENOTFOUND api.anthropic.com', 'fetch failed', 'connect ECONNREFUSED 127.0.0.1:443', 'could not resolve host', 'Unable to connect to API']) expect(isNetworkFailure(t), t).toBe(true)
    expect(isNetworkFailure('el modelo respondió')).toBe(false)
  })
})

describe('CLIErrorClassifier', () => {
  it('precedencia y mensajes', () => {
    const claude = CLIErrorClassifier.claude
    expect(claude.classify('Not logged in · Please run /login').kind).toBe('notLoggedIn')
    expect(claude.classify('anything', 'notLoggedIn').kind).toBe('notLoggedIn')
    const limited = claude.classify("You've hit your limit · try again in 2 hours", undefined, undefined, clock)
    expect(limited.kind).toBe('rateLimited')
    expect(limited.retryAfter).toBe(7_200)
    expect(limited.message).toContain('Detalle de Claude Code')
    expect(claude.classify('limit', 'rateLimited', 99, clock).retryAfter).toBe(99) // el dato estructurado manda
    expect(claude.classify("error: unknown option '--foo'").kind).toBe('unsupported')
    expect(claude.classify('getaddrinfo ENOTFOUND x').kind).toBe('network')
    expect(claude.classify('algo raro').kind).toBe('other')
    expect(claude.classify('').message).toContain('sin detalles')
    expect(claude.classify('boom', 'badResponse').kind).toBe('badResponse')
    expect(CLIErrorClassifier.codex.classify('Not logged in').message).toBe(CLIErrorClassifier.codex.notLoggedIn.message)
    expect(CLIErrorClassifier.openCode.notLoggedIn.message).toContain('opencode auth login')
  })

  it('los mensajes largos conservan el principio y el final', () => {
    const message = CLIErrorClassifier.claude.classify('A'.repeat(3000) + 'MOTIVO-FINAL').message
    expect(Array.from(message).length).toBeLessThan(1700)
    expect(message).toContain('MOTIVO-FINAL')
    expect(message).toContain(' … ')
    expect(clip('corto')).toBe('corto')
  })

  it('las instrucciones de instalación son las oficiales', () => {
    expect(CLIErrorClassifier.claude.notInstalled.message).toContain('curl -fsSL https://claude.ai/install.sh | bash')
    expect(CLIErrorClassifier.codex.notInstalled.message).toContain('npm install -g @openai/codex')
    expect(CLIErrorClassifier.openCode.notInstalled.message).toContain('curl -fsSL https://opencode.ai/install | bash')
    expect(CLIErrorClassifier.claude.notInstalled.kind).toBe('notInstalled')
  })

  it('cada tipo lleva su código estable para la interfaz', () => {
    expect(new AgentError('notLoggedIn', 'x').code).toBe('ai_auth')
    expect(new AgentError('rateLimited', 'x', 60).code).toBe('ai_rate_limit')
    expect(new AgentError('notInstalled', 'x').code).toBe('ai_not_installed')
    expect(new AgentError('cancelled', 'x').code).toBe('cancelled')
  })
})

describe('Ayudantes del protocolo MCP', () => {
  it('nombres normalizados y de función', () => {
    expect(sanitizeName('mi servidor.v2')).toBe('mi_servidor_v2')
    expect(sanitizeName('ok_name-1')).toBe('ok_name-1')
    expect(sanitizeName('')).toBe('_')
    expect(sanitizeName('ñandú')).toBe('_and_')
    const long = 'x'.repeat(100)
    expect(functionName(long)).toHaveLength(64)
    expect(functionName(long + 'a')).not.toBe(functionName(long + 'b'))
    expect(functionName('corto')).toBe('corto')
  })

  it('negociación de versión', () => {
    expect(negotiateVersion('2025-06-18')).toBe('2025-06-18')
    expect(negotiateVersion('2099-01-01')).toBe('2025-06-18')
    expect(negotiateVersion('2024-11-05')).toBe('2024-11-05')
    expect(negotiateVersion('2024-11-06')).toBe('2024-11-05')
    expect(negotiateVersion('')).toBe('2025-06-18')
    expect(negotiateVersion('basura')).toBe('2025-06-18')
  })

  it('ida y vuelta de un resultado', () => {
    const back = toolOutputFromResult(toolResult({ text: 'hola', images: [{ mediaType: 'image/jpeg', base64: 'QUJD' }], isError: true }))
    expect(back.text).toBe('hola')
    expect(back.images).toEqual([{ mediaType: 'image/jpeg', base64: 'QUJD' }])
    expect(back.isError).toBe(true)
    expect((toolResult({ text: '' }).content as unknown[]).length).toBe(1) // siempre al menos un bloque de texto
    expect(toolOutputFromResult({}).text).toBe('')
    expect(toolOutputFromResult(null).text).toBe('')
  })

  it('esquemas normalizados', () => {
    expect(normalizedInputSchema(null)).toEqual({ type: 'object', properties: {} })
    expect(normalizedInputSchema({}).type).toBe('object')
    expect(normalizedInputSchema({ type: 'string' })).toEqual({ type: 'string' }) // no toca esquemas que no son objeto
    expect(normalizedInputSchema({ type: 'object' }).properties).toBeDefined()
  })

  it('argumentos de tools/call', () => {
    expect(parseArguments(undefined)).toEqual({})
    expect(parseArguments(null)).toEqual({})
    expect(parseArguments('  ')).toEqual({})
    expect(parseArguments('{"a": 1,}')).toEqual({ a: 1 })
    expect(parseArguments('[1]')).toBeUndefined()
    expect(parseArguments('no json')).toBeUndefined()
    expect(parseArguments(3)).toBeUndefined()
    expect(parseArguments([])).toBeUndefined()
    expect(parseArguments({ t: '\u000Crac' })).toEqual({ t: '\\frac' })
  })
})

describe('AgentSandbox', () => {
  afterAll(() => cleanupTempDirs())
  // permisos POSIX (en Windows protege la ACL de la carpeta del usuario)
  const expectMode = (path: string, mode: number): void => {
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(mode)
  }

  it('crea carpetas privadas y limpia', () => {
    const sandbox = new AgentSandbox(undefined, false)
    expect(basename(sandbox.root).startsWith('aula-agent-')).toBe(true)
    expectMode(sandbox.root, 0o700)
    expect(dirname(sandbox.workingDirectory)).toBe(sandbox.root)
    expect(readdirSync(sandbox.workingDirectory)).toEqual([])
    const file = sandbox.write('secreto', 'mcp.json')
    expectMode(file, 0o600)
    sandbox.cleanup()
    expect(existsSync(sandbox.root)).toBe(false)
    sandbox.cleanup() // idempotente
  })

  it('las imágenes llevan la extensión correcta', () => {
    const sandbox = new AgentSandbox()
    try {
      const paths = sandbox.writeImages([{ mediaType: 'image/png', base64: 'AQ==' }, { mediaType: 'image/jpeg', base64: 'Ag==' }, { mediaType: 'image/webp', base64: 'AQ==' }])
      expect(paths.map((p) => basename(p))).toEqual(['imagen-1.png', 'imagen-2.jpg', 'imagen-3.webp'])
      expect([...readFileSync(paths[0])]).toEqual([1])
      expect(() => sandbox.writeImages([{ mediaType: 'image/png', base64: '###no es base64###' }])).toThrow(AgentError)
    } finally {
      sandbox.cleanup()
    }
  })

  it('la carpeta de trabajo compartida es estable, vacía y privada', () => {
    const base = makeTempDir()
    const a = sharedEmptyWorkDirectory(base)
    expect(a).toBeDefined()
    expect(sharedEmptyWorkDirectory(base)).toBe(a)
    expect(basename(a!)).toBe(SHARED_WORK_NAME)
    expectMode(a!, 0o700)
    writeFileSync(join(a!, 'resto'), 'x')
    expect(sharedEmptyWorkDirectory(base)).toBeUndefined() // con algo dentro ya no vale
    const other = makeTempDir()
    symlinkSync(base, join(other, SHARED_WORK_NAME))
    expect(sharedEmptyWorkDirectory(other)).toBeUndefined() // un enlace en su lugar tampoco
    const s1 = new AgentSandbox()
    const s2 = new AgentSandbox()
    if (basename(s1.workingDirectory) === SHARED_WORK_NAME) {
      expect(s1.workingDirectory).toBe(s2.workingDirectory)
      expect(s1.root).not.toBe(s2.root) // la configuración de cada ejecución sigue aparte
      s1.cleanup()
      expect(existsSync(s2.workingDirectory)).toBe(true)
    }
    s1.cleanup()
    s2.cleanup()
  })

  it('una carpeta pedida debe existir y nunca se borra', () => {
    const dir = makeTempDir()
    const sandbox = new AgentSandbox(dir)
    expect(sandbox.workingDirectory).toBe(dir)
    sandbox.cleanup()
    expect(existsSync(dir)).toBe(true)
    expect(() => new AgentSandbox(join(dir, 'no-existe'))).toThrow()
    writeFileSync(join(dir, 'archivo'), 'x')
    expect(() => new AgentSandbox(join(dir, 'archivo'))).toThrow() // un archivo no es una carpeta de trabajo
  })
})

describe('idioma de la interfaz', () => {
  it('con la interfaz en inglés, «no instalado» sale en inglés (y vuelve al español)', () => {
    setAILocale('en')
    try {
      const claude = CLIErrorClassifier.claude.notInstalled
      expect(claude.code).toBe('ai_not_installed')
      expect(claude.message).toMatch(/^I can’t find the Claude Code CLI \(`claude`\) on this computer\. Install it with/)
      expect(CLIErrorClassifier.codex.notInstalled.message).toContain('Click “Connect with ChatGPT” in Settings → Your AI')
      expect(humanDuration(2 * 86_400 + 3 * 3_600)).toBe('2 days 3 h')
    } finally {
      setAILocale('es')
    }
    expect(CLIErrorClassifier.claude.notInstalled.message).toMatch(/^No encuentro la CLI de Claude Code/)
    expect(CLIErrorClassifier.codex.notInstalled.message).toContain('Ajustes → Tu IA')
  })
})
