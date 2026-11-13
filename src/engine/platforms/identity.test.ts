import { describe, expect, it } from 'vitest'
import { entraErrorKind, isIdentityHost } from './identity'
import { isIdentityHost as fromLogin } from './login'

describe('proveedores de identidad', () => {
  it('se sigue exportando desde login (mismo comportamiento)', () => {
    expect(fromLogin).toBe(isIdentityHost)
    expect(isIdentityHost('login.microsoftonline.com')).toBe(true)
    expect(isIdentityHost('campus.uni.edu')).toBe(false)
  })
})

describe('errores de Microsoft Entra', () => {
  it('política de dispositivo (acceso condicional)', () => {
    for (const code of ['53000', '53001', '53002', '53003', '50097', '50155', '530032']) {
      expect(entraErrorKind(`Error AADSTS${code}: Device is not in required device state`), code).toBe('devicePolicy')
    }
  })

  it('bucle de peticiones', () => {
    expect(entraErrorKind('AADSTS50196: The server terminated an operation because it encountered a client request loop.')).toBe('requestLoop')
  })

  it('el código entero: ni prefijos ni otros errores', () => {
    expect(entraErrorKind('AADSTS5300321')).toBeNull()
    expect(entraErrorKind('AADSTS5300')).toBeNull()
    expect(entraErrorKind('AADSTS50126: Error validating credentials due to invalid username or password.')).toBeNull()
    expect(entraErrorKind('53003 sin el prefijo')).toBeNull()
    expect(entraErrorKind('')).toBeNull()
  })

  it('el primer código conocido decide', () => {
    expect(entraErrorKind('AADSTS50126 … luego AADSTS50196 … y AADSTS53003')).toBe('requestLoop')
    expect(entraErrorKind('Request Id: x · aadsts53003')).toBe('devicePolicy')
  })
})
