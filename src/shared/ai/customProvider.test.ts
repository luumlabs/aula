import { describe, expect, it } from 'vitest'
import { checkCustomBaseURL, isCustomProviderID, isLoopbackHost } from './customProvider'

describe('URL base del proveedor personalizado', () => {
  it('acepta https y la deja limpia', () => {
    expect(checkCustomBaseURL('  https://api.together.xyz/v1/ ')).toEqual({ ok: true, url: 'https://api.together.xyz/v1' })
    expect(checkCustomBaseURL('https://gw.example.com:8443/openai/v1?api-version=2')).toEqual({ ok: true, url: 'https://gw.example.com:8443/openai/v1?api-version=2' })
  })
  it('sin esquema supone https (o http en este ordenador)', () => {
    expect(checkCustomBaseURL('api.example.com/v1')).toEqual({ ok: true, url: 'https://api.example.com/v1' })
    expect(checkCustomBaseURL('localhost:8000/v1')).toEqual({ ok: true, url: 'http://localhost:8000/v1' })
  })
  it('http solo para localhost', () => {
    expect(checkCustomBaseURL('http://localhost:8080/v1')).toMatchObject({ ok: true })
    expect(checkCustomBaseURL('http://127.0.0.1:1234/v1')).toMatchObject({ ok: true })
    expect(checkCustomBaseURL('http://[::1]:8000/v1')).toMatchObject({ ok: true })
    expect(checkCustomBaseURL('http://vllm.localhost/v1')).toMatchObject({ ok: true })
    expect(checkCustomBaseURL('http://api.example.com/v1')).toEqual({ ok: false, problem: 'insecure' })
    expect(checkCustomBaseURL('http://192.168.1.20:8000/v1')).toEqual({ ok: false, problem: 'insecure' })
  })
  it('rechaza lo que no es una URL web', () => {
    expect(checkCustomBaseURL('')).toEqual({ ok: false, problem: 'empty' })
    expect(checkCustomBaseURL('   ')).toEqual({ ok: false, problem: 'empty' })
    expect(checkCustomBaseURL('ftp://example.com')).toEqual({ ok: false, problem: 'invalid' })
    expect(checkCustomBaseURL('javascript:alert(1)')).toEqual({ ok: false, problem: 'invalid' })
    expect(checkCustomBaseURL('https://user:pass@example.com/v1')).toEqual({ ok: false, problem: 'invalid' })
    expect(checkCustomBaseURL('https://exa mple.com')).toEqual({ ok: false, problem: 'invalid' })
  })
  it('reconoce los hosts de este ordenador y los ids personalizados', () => {
    expect(isLoopbackHost('LOCALHOST')).toBe(true)
    expect(isLoopbackHost('127.10.0.1')).toBe(true)
    expect(isLoopbackHost('10.0.0.1')).toBe(false)
    expect(isLoopbackHost('localhost.evil.com')).toBe(false)
    expect(isCustomProviderID('custom')).toBe(true)
    expect(isCustomProviderID('custom-vllm')).toBe(true)
    expect(isCustomProviderID('openai')).toBe(false)
  })
})
