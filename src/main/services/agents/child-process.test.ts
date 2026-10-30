// Port de `Tests/AgentKitTests/ChildProcessTests.swift`: procesos hijo (grupo propio, plazos, muerte del árbol), captura corta
// y troceo de la salida en líneas. Los hijos son scripts de Node (corren igual en macOS, Linux y Windows); lo propio de
// los grupos de procesos y las señales POSIX va con `posixIt`.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { captureCommand, ChildProcessHandle, exitSucceeded, type ChildExit } from './child-process'
import { LineBuffer, TailBuffer } from './line-buffer'
import { cleanupTempDirs, isWindows, makeTempDir, posixIt, processExists, waitUntil } from './__fixtures__/support'

const env: Record<string, string> = isWindows
  ? { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', LANG: 'en_US.UTF-8' }
  : { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME ?? '/tmp', LANG: 'en_US.UTF-8' }

/** Un hijo que ejecuta este JavaScript con el Node de las pruebas. */
const node = (script: string, o: { env?: Record<string, string>; cwd?: string } = {}): Promise<ChildProcessHandle> =>
  ChildProcessHandle.spawn(process.execPath, ['-e', script], { env: o.env ?? env, cwd: o.cwd })
/** Un nieto que vive 5 min y deja su PID en `pidFile`. */
const grandchild = (pidFile: string, o = ''): string =>
  `const c = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300000)'], { stdio: 'ignore'${o} }); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid))`
const cat = "process.stdin.pipe(process.stdout)"

async function collectProcess(p: ChildProcessHandle): Promise<{ stdout: Buffer; stderr: Buffer; exit: ChildExit }> {
  const read = (s: NodeJS.ReadableStream): Promise<Buffer> =>
    new Promise((resolve) => {
      const parts: Buffer[] = []
      s.on('data', (c: Buffer) => parts.push(c))
      s.on('close', () => resolve(Buffer.concat(parts)))
      s.on('error', () => resolve(Buffer.concat(parts)))
    })
  const [stdout, stderr, exit] = await Promise.all([read(p.stdout), read(p.stderr), p.waitForExit()])
  return { stdout, stderr, exit }
}

const readPid = (path: string): number => Number(readFileSync(path, 'utf8').trim())
const pidWritten = (path: string): Promise<boolean> => waitUntil(() => existsSync(path) && readFileSync(path, 'utf8').trim() !== '', 10_000)

afterAll(() => cleanupTempDirs())

describe('ChildProcessHandle', () => {
  it('captura stdout, stderr y el código de salida', async () => {
    const p = await node("process.stdout.write('hola\\n'); process.stderr.write('problema\\n'); process.exitCode = 3")
    p.closeStdin()
    const out = await collectProcess(p)
    expect(out.stdout.toString()).toBe('hola\n')
    expect(out.stderr.toString()).toBe('problema\n')
    expect(out.exit.code).toBe(3)
    expect(out.exit.signal).toBeUndefined()
    expect(exitSucceeded(out.exit)).toBe(false)
  })

  it('entrega stdin y lo cierra', async () => {
    const p = await node(cat)
    p.writeStdin('línea con acentos: ñ é 日本\n', true)
    const out = await collectProcess(p)
    expect(out.stdout.toString()).toBe('línea con acentos: ñ é 日本\n')
    expect(exitSucceeded(out.exit)).toBe(true)
  })

  it('mucha salida llega entera', async () => {
    const p = await node('process.stdout.write(Buffer.alloc(6000000))')
    p.closeStdin()
    const out = await collectProcess(p)
    expect(out.stdout.length).toBe(6_000_000)
    expect(exitSucceeded(out.exit)).toBe(true)
  })

  it('mucha entrada y salida no se bloquean', async () => {
    const p = await node(cat)
    p.writeStdin(Buffer.alloc(4_000_000, 0x41), true)
    expect((await collectProcess(p)).stdout.length).toBe(4_000_000)
  })

  it('un fallo al lanzar da un error en español', async () => {
    await expect(ChildProcessHandle.spawn(join(makeTempDir(), 'no-existe'), [], { env })).rejects.toThrow('No se puede ejecutar')
  })

  it('el entorno es exactamente el que se pasa', async () => {
    process.env.AULA_PRUEBA_PADRE = '1'
    try {
      const p = await node("process.stdout.write(Object.keys(process.env).map((k) => k + '=' + process.env[k]).join('\\n'))", { env: { ...env, SOLO_ESTA: 'valor' } })
      p.closeStdin()
      const lines = new Set((await collectProcess(p)).stdout.toString().split('\n'))
      expect(lines.has('SOLO_ESTA=valor')).toBe(true)
      expect([...lines].some((l) => l.startsWith('AULA_PRUEBA_PADRE='))).toBe(false) // no hereda el entorno del padre
    } finally {
      delete process.env.AULA_PRUEBA_PADRE
    }
  })

  it('se aplica la carpeta de trabajo', async () => {
    const dir = makeTempDir()
    const p = await node("process.stdout.write(require('fs').realpathSync(process.cwd()))", { cwd: dir })
    p.closeStdin()
    expect((await collectProcess(p)).stdout.toString().trim().toLowerCase()).toBe(dir.toLowerCase())
  })

  posixIt('la muerte por señal se decodifica', async () => {
    const p = await node("process.kill(process.pid, 'SIGKILL')")
    p.closeStdin()
    const out = await collectProcess(p)
    expect(out.exit.signal).toBe(9)
    expect(exitSucceeded(out.exit)).toBe(false)
  })

  posixIt('el hijo es líder de su propio grupo de procesos', async () => {
    const p = await ChildProcessHandle.spawn('/bin/sh', ['-c', 'ps -o pid=,pgid= -p $$'], { env })
    p.closeStdin()
    const numbers = (await collectProcess(p)).stdout.toString().split(/\s+/).filter(Boolean).map(Number)
    expect(numbers).toHaveLength(2)
    expect(numbers[0]).toBe(numbers[1])
    expect(numbers[0]).toBe(p.pid)
  })

  // macOS y Linux: SIGTERM al grupo; Windows: `taskkill /T` (el árbol), con /F pasado el margen
  it('terminar mata al árbol entero', async () => {
    const pidFile = join(makeTempDir(), 'nieto.pid')
    const p = await node(`${grandchild(pidFile)}; setTimeout(() => {}, 300000)`)
    p.closeStdin()
    expect(await pidWritten(pidFile)).toBe(true)
    const pid = readPid(pidFile)
    expect(processExists(pid)).toBe(true)
    p.terminate(500)
    const out = await collectProcess(p)
    expect(exitSucceeded(out.exit)).toBe(false)
    expect(await waitUntil(() => !processExists(pid))).toBe(true)
  })

  posixIt('los descendientes que deja el líder al salir mueren', async () => {
    const pidFile = join(makeTempDir(), 'huerfano.pid')
    const p = await node(`${grandchild(pidFile)}; setTimeout(() => process.exit(0), 300)`)
    p.closeStdin()
    expect(exitSucceeded((await collectProcess(p)).exit)).toBe(true)
    const pid = readPid(pidFile)
    expect(await waitUntil(() => !processExists(pid))).toBe(true)
  })

  posixIt('si ignora SIGTERM se escala a SIGKILL', async () => {
    const ready = join(makeTempDir(), 'listo')
    const p = await node(`process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(ready)}, ''); setInterval(() => {}, 1000)`)
    p.closeStdin()
    expect(await waitUntil(() => existsSync(ready))).toBe(true)
    p.terminate(400)
    expect((await collectProcess(p)).exit.signal).toBe(9)
  })

  it('la salida se cierra aunque un descendiente escapado mantenga la tubería', async () => {
    const pidFile = join(makeTempDir(), 'escapado.pid')
    const script = `const c = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); c.unref()`
    const previous = ChildProcessHandle.pipeDrainGraceMs
    ChildProcessHandle.pipeDrainGraceMs = 400
    try {
      const started = Date.now()
      const p = await node(script, { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })
      p.closeStdin()
      expect(exitSucceeded((await collectProcess(p)).exit)).toBe(true)
      expect(Date.now() - started).toBeLessThan(10_000)
    } finally {
      ChildProcessHandle.pipeDrainGraceMs = previous
      if (existsSync(pidFile)) {
        try {
          process.kill(readPid(pidFile), 'SIGKILL')
        } catch {
          /* ya murió */
        }
      }
    }
  })

  it('escribir a un proceso muerto no rompe nada', async () => {
    const p = await node('')
    await collectProcess(p)
    p.writeStdin(Buffer.alloc(1_000_000, 0x42), true) // EPIPE, sin SIGPIPE
    await new Promise((r) => setTimeout(r, 100))
    expect(p.isRunning).toBe(false)
  })

  it('muchos procesos a la vez no se estorban', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, async (_, i) => {
        const p = await node(`process.stdin.pipe(process.stdout, { end: false }); process.stdin.on('end', () => process.stdout.write('fin-${i}\\n'))`)
        p.writeStdin(`entrada-${i}\n`, true)
        return (await collectProcess(p)).stdout.toString()
      })
    )
    expect(new Set(results).size).toBe(25)
    for (let i = 0; i < 25; i++) expect(results).toContain(`entrada-${i}\nfin-${i}\n`)
  })

  it('onExit se llama una vez (y al momento si ya terminó)', async () => {
    const p = await node('')
    p.closeStdin()
    let count = 0
    p.onExit(() => count++)
    await collectProcess(p)
    expect(await waitUntil(() => count === 1)).toBe(true)
    p.onExit(() => count++)
    expect(count).toBe(2)
  })
})

describe('captureCommand', () => {
  const run = (script: string, o: { stdin?: string; timeoutMs?: number; maxOutputBytes?: number } = {}) =>
    captureCommand(process.execPath, ['-e', script], { env, timeoutMs: 5000, ...o })

  it('captura la salida y el código', async () => {
    const out = await run("process.stdout.write('uno\\n'); process.stderr.write('dos\\n'); process.exitCode = 2")
    expect(out?.stdout.toString()).toBe('uno\n')
    expect(out?.stderr.toString()).toBe('dos\n')
    expect(out?.exit?.code).toBe(2)
    expect(out?.timedOut).toBe(false)
  })

  it('el plazo mata al árbol', async () => {
    const pidFile = join(makeTempDir(), 'nieto.pid')
    const started = Date.now()
    const out = await run(`${grandchild(pidFile)}; setTimeout(() => {}, 60000)`, { timeoutMs: 1500 })
    expect(out?.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(8000)
    expect(await waitUntil(() => existsSync(pidFile) && !processExists(readPid(pidFile)))).toBe(true)
  })

  it('sin ejecutable devuelve null', async () => {
    expect(await captureCommand(join(makeTempDir(), 'no-existe'), [], { env, timeoutMs: 1000 })).toBeNull()
  })

  it('la salida tiene tope', async () => {
    const out = await run('process.stdout.write(Buffer.alloc(3000000))', { maxOutputBytes: 100_000 })
    expect(out).not.toBeNull()
    expect(out!.stdout.length).toBeLessThan(200_000)
  })

  it('stdin llega al proceso', async () => {
    expect((await run(cat, { stdin: 'hola' }))?.stdout.toString()).toBe('hola')
  })
})

describe('LineBuffer y TailBuffer', () => {
  const b = (s: string): Buffer => Buffer.from(s)

  it('parte líneas entre trozos', () => {
    const buffer = new LineBuffer()
    expect(buffer.append(b('uno\ndo'))).toEqual(['uno'])
    expect(buffer.append(b('s\ntres'))).toEqual(['dos'])
    expect(buffer.append(b('\n'))).toEqual(['tres'])
    expect(buffer.finish()).toBeUndefined()
  })

  it('finish devuelve la línea sin terminar', () => {
    const buffer = new LineBuffer()
    expect(buffer.append(b('completa\nincompleta'))).toEqual(['completa'])
    expect(buffer.finish()).toBe('incompleta')
    expect(buffer.finish()).toBeUndefined()
  })

  it('un carácter multibyte partido entre trozos', () => {
    const buffer = new LineBuffer()
    const lines: string[] = []
    for (const byte of b('ñandú 日本語 🙂\n')) lines.push(...buffer.append(Buffer.from([byte])))
    expect(lines).toEqual(['ñandú 日本語 🙂'])
  })

  it('CRLF y líneas vacías', () => {
    expect(new LineBuffer().append(b('a\r\n\r\nb\n'))).toEqual(['a', '', 'b'])
  })

  it('una línea demasiado larga se descarta y se cuenta', () => {
    const buffer = new LineBuffer(10)
    const lines = [...buffer.append(b('corta\n')), ...buffer.append(b('x'.repeat(25))), ...buffer.append(b('y'.repeat(25))), ...buffer.append(b('\nsiguiente\n'))]
    expect(lines).toEqual(['corta', 'siguiente'])
    expect(buffer.droppedLines).toBe(1)
  })

  it('una línea larga dentro de un solo trozo también', () => {
    const buffer = new LineBuffer(5)
    expect(buffer.append(b('demasiado larga\nok\n'))).toEqual(['ok'])
    expect(buffer.droppedLines).toBe(1)
  })

  it('UTF-8 no válido se sustituye sin romper', () => {
    const lines = new LineBuffer().append(Buffer.from([0x68, 0xff, 0xfe, 0x69, 0x0a]))
    expect(lines).toHaveLength(1)
    expect(lines[0].startsWith('h') && lines[0].endsWith('i')).toBe(true)
  })

  it('muchísimos trozos pequeños', () => {
    const buffer = new LineBuffer()
    let total = 0
    for (let i = 0; i < 20_000; i++) total += buffer.append(b(`{"n":${i}}\n`)).length
    expect(total).toBe(20_000)
  })

  it('TailBuffer guarda solo el final', () => {
    const tail = new TailBuffer(10)
    tail.append(b('0123456789'))
    tail.append(b('abcdef'))
    expect(tail.truncated).toBe(true)
    expect(tail.text.endsWith('6789abcdef')).toBe(true)
    expect(tail.text.startsWith('…')).toBe(true)
  })
})
