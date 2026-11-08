import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChildProcessHandle } from './child-process'
import { AgentsService } from './service'
import { ManagedCodex } from './codex-installer'
import { LocalAIService } from '../local-ai/service'

const originalMas = Object.getOwnPropertyDescriptor(process, 'mas')
const dirs: string[] = []
afterEach(() => {
  if (originalMas) Object.defineProperty(process, 'mas', originalMas)
  else Reflect.deleteProperty(process, 'mas')
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('App Store executable boundary', () => {
  it('rejects external processes and managed tool downloads before accessing the network', async () => {
    Object.defineProperty(process, 'mas', { value: true, configurable: true })
    const root = mkdtempSync(join(tmpdir(), 'aula-mas-boundary-'))
    dirs.push(root)
    const fetch = vi.fn(async () => { throw new Error('unexpected network') })
    const local = new LocalAIService({ root: join(root, 'models'), fetch })
    const codex = new ManagedCodex({ root, fetch })
    const agents = new AgentsService({ local, codex })
    await expect(ChildProcessHandle.spawn('/bin/anything', [], { env: {} })).rejects.toThrow('App Store')
    await expect(agents.connectChatGPT()).rejects.toThrow('App Store')
    await expect(local.download('anything')).rejects.toThrow('App Store')
    await expect(local.engine.install()).rejects.toThrow('App Store')
    await expect(local.engine.start({} as never)).rejects.toThrow('App Store')
    expect(fetch).not.toHaveBeenCalled()
    expect(readdirSync(root)).toEqual([])
  })
})
