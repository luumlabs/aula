// A quién manda Aula los datos con cada proveedor: su empresa, el servidor que se escribió, o nadie si no sale del equipo.
import { describe, expect, it } from 'vitest'
import type { AIProviderKind } from '../settings/ai'
import { aiRecipientOf, mergeRecipients, recipientLabel } from './recipient'

const of = (id: string, kind: AIProviderKind, baseURL?: string, presetBaseURL?: string) => aiRecipientOf({ id, kind, label: id, baseURL, presetBaseURL }, 'answers')

describe('aiRecipientOf', () => {
  it('cada preset da su empresa', () => {
    expect(of('claude-cli', 'claude-cli')).toEqual({ id: 'anthropic', name: 'Anthropic', product: 'Claude', uses: ['answers'] })
    expect(of('anthropic', 'anthropic', 'https://api.anthropic.com', 'https://api.anthropic.com')).toMatchObject({ id: 'anthropic', product: 'Claude' })
    expect(of('codex-cli', 'codex-cli')).toMatchObject({ id: 'openai', name: 'OpenAI', product: 'ChatGPT' })
    expect(of('openai', 'openai-compatible', 'https://api.openai.com/v1', 'https://api.openai.com/v1')).toEqual({ id: 'openai', name: 'OpenAI', uses: ['answers'] })
    expect(of('gemini', 'openai-compatible', 'https://generativelanguage.googleapis.com/v1beta/openai', 'https://generativelanguage.googleapis.com/v1beta/openai')).toMatchObject({ id: 'google', product: 'Gemini' })
    const ids = ['deepseek', 'mistral', 'groq', 'xai', 'openrouter', 'mimo', 'opencode-zen'].map((id) => of(id, 'openai-compatible')?.id)
    expect(ids).toEqual(['deepseek', 'mistral', 'groq', 'xai', 'openrouter', 'xiaomi', 'opencode'])
    expect(of('opencode-cli', 'opencode-cli')).toMatchObject({ id: 'opencode-cli', name: 'OpenCode' })
  })

  it('OpenCode: la empresa del modelo («proveedor/modelo»), que es quien recibe los datos', () => {
    const oc = (model?: string) => aiRecipientOf({ id: 'opencode-cli', kind: 'opencode-cli', label: 'OpenCode', ...(model !== undefined ? { model } : {}) }, 'answers')
    expect(oc('anthropic/claude-sonnet-5-5')).toEqual({ id: 'anthropic', name: 'Anthropic', product: 'Claude', uses: ['answers'] })
    expect(oc('openai/gpt-6-sol')).toMatchObject({ id: 'openai', name: 'OpenAI' })
    expect(oc('Google/gemini-3-pro')).toMatchObject({ id: 'google', product: 'Gemini' })
    expect(oc('opencode/big-pickle')).toMatchObject({ id: 'opencode', name: 'OpenCode', product: 'Zen' })
    expect(oc('github-copilot/gpt-6')).toMatchObject({ id: 'github', name: 'GitHub' })
    // vacío (el de OpenCode por defecto) o un proveedor que no se conoce: OpenCode
    for (const m of [undefined, '', 'sonnet', '/x', 'proveedor-raro/modelo']) expect(oc(m), String(m)).toMatchObject({ id: 'opencode-cli', name: 'OpenCode' })
  })

  it('lo que no sale de este ordenador: nadie', () => {
    expect(of('aula-local', 'aula-local')).toBeNull()
    expect(of('fake', 'openai-compatible')).toBeNull()
    expect(of('ollama', 'ollama', 'http://localhost:11434/v1', 'http://localhost:11434/v1')).toBeNull()
    expect(of('lmstudio', 'lmstudio', 'http://127.0.0.1:1234/v1', 'http://localhost:1234/v1')).toBeNull()
    expect(of('ollama', 'ollama')).toBeNull()
    expect(of('custom-1', 'openai-compatible', 'http://localhost:8080/v1')).toBeNull()
  })

  it('otra dirección: el servidor al que se manda', () => {
    expect(of('custom-1', 'openai-compatible', 'https://ai.example.com/v1')).toEqual({ id: 'host:ai.example.com', name: 'ai.example.com', uses: ['answers'] })
    expect(of('openai', 'openai-compatible', 'https://proxy.example.org/v1', 'https://api.openai.com/v1')?.id).toBe('host:proxy.example.org')
    expect(of('ollama', 'ollama', 'http://192.168.1.20:11434/v1', 'http://localhost:11434/v1')?.id).toBe('host:192.168.1.20')
  })

  it('una dirección rota no lanza', () => {
    expect(() => of('custom-2', 'openai-compatible', 'http://')).not.toThrow()
    expect(of('custom-2', 'openai-compatible', '::nada::')).toEqual({ id: 'provider:custom-2', name: 'custom-2', uses: ['answers'] })
  })
})

describe('mergeRecipients y recipientLabel', () => {
  it('une los usos de la misma empresa y no repite', () => {
    const openai = aiRecipientOf({ id: 'openai', kind: 'openai-compatible', label: 'OpenAI' }, 'answers')
    const whisper = aiRecipientOf({ id: 'openai', kind: 'openai-compatible', label: 'OpenAI' }, 'recordings')
    const claude = aiRecipientOf({ id: 'claude-cli', kind: 'claude-cli', label: 'Claude' }, 'answers')
    expect(mergeRecipients([claude, openai, null, whisper, claude])).toEqual([
      { id: 'anthropic', name: 'Anthropic', product: 'Claude', uses: ['answers'] },
      { id: 'openai', name: 'OpenAI', uses: ['answers', 'recordings'] }
    ])
  })

  it('el nombre, con su producto si lo tiene', () => {
    expect(recipientLabel({ name: 'Anthropic', product: 'Claude' })).toBe('Anthropic (Claude)')
    expect(recipientLabel({ name: 'Groq' })).toBe('Groq')
  })
})
