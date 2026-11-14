// El rodeado de un paso: se traza una vez al entrar en el paso; si lo rodeado gira o cambia de tamaño, sale al instante.
import { describe, expect, it } from 'vitest'
import { loopDrawKey, loopInk } from './loopInk'

describe('rodeado de un paso', () => {
  it('la misma clave mientras dura el paso (aunque cambie el tamaño); otra al volver a entrar', () => {
    const step = new Set([2])
    const k = loopDrawKey('canvas', 2, step)
    // el elemento gira: el rodeado cambia de tamaño, la clave no (Ink lo enseña ya dibujado en lugar de esconderlo)
    expect(loopInk(40, 120, 'd:loop:2')).not.toBe(loopInk(120, 40, 'd:loop:2'))
    expect(loopDrawKey('canvas', 2, step)).toBe(k)
    // otro paso (otro conjunto, aunque rodee lo mismo), otro elemento u otro lienzo: otra clave, se traza de nuevo
    expect(loopDrawKey('canvas', 2, new Set([2]))).not.toBe(k)
    expect(loopDrawKey('canvas', 3, step)).not.toBe(k)
    expect(loopDrawKey('otro', 2, step)).not.toBe(k)
  })
})
