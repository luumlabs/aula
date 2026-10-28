// Las variables de desarrollo (rutas de scripts que Aula ejecuta) no cuentan en la app instalada.
import { afterEach, describe, expect, it } from 'vitest'
import { devOverride, isPackagedApp, setPackaged } from './runtime'

afterEach(() => {
  setPackaged(true)
  delete process.env.AULA_PRUEBA_RUTA
})

describe('atajos de desarrollo', () => {
  it('por defecto, como la app instalada: no cuentan', () => {
    process.env.AULA_PRUEBA_RUTA = '/tmp/otro-programa.js'
    expect(isPackagedApp()).toBe(true)
    expect(devOverride('AULA_PRUEBA_RUTA')).toBeUndefined()
  })
  it('sin empaquetar (desarrollo, pruebas), sí', () => {
    process.env.AULA_PRUEBA_RUTA = '/tmp/otro-programa.js'
    setPackaged(false)
    expect(devOverride('AULA_PRUEBA_RUTA')).toBe('/tmp/otro-programa.js')
    process.env.AULA_PRUEBA_RUTA = ''
    expect(devOverride('AULA_PRUEBA_RUTA')).toBeUndefined()
  })
})
