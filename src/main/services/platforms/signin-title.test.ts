import { describe, expect, it } from 'vitest'
import { signInTitle } from './signin-title'

describe('signInTitle', () => {
  it('dice el dominio donde se escribe', () => {
    expect(signInTitle('Canvas', 'https://login.microsoftonline.com/common/oauth2')).toMatch(/Canvas — login\.microsoftonline\.com$/)
  })
  it('avisa si la página no va cifrada', () => {
    expect(signInTitle('Moodle', 'http://campus.uni.edu/login')).toMatch(/campus\.uni\.edu \((SIN CIFRAR|NOT ENCRYPTED)/)
  })
  it('sin dirección válida, solo el nombre', () => {
    expect(signInTitle('Canvas', null)).toMatch(/Canvas$/)
    expect(signInTitle('Canvas', 'about:blank')).toMatch(/Canvas$/)
  })
})
