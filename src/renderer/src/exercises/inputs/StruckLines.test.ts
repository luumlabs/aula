import { describe, expect, it } from 'vitest'
import { rowsOf } from './StruckLines'

const r = (left: number, top: number, width: number, height = 20) => ({ left, top, width, height })

describe('el tachado de varias líneas, renglón a renglón', () => {
  it('un renglón por línea, medido desde la copia del texto y en px enteros', () => {
    expect(rowsOf([r(117.4, 213.2, 80.6), r(117, 237.2, 52.3)], { left: 100, top: 200 })).toEqual([
      { x: 17, y: 13, w: 81, h: 20 },
      { x: 17, y: 37, w: 52, h: 20 }
    ])
  })

  it('las líneas vacías (dos saltos seguidos) no se tachan', () => {
    expect(rowsOf([r(16, 12, 60), r(16, 36, 0), r(16, 60, 40)], { left: 0, top: 0 }).map((x) => x.y)).toEqual([12, 60])
  })

  it('los trozos de un mismo renglón (texto de los dos sentidos, otra letra) van juntos en un solo trazo', () => {
    expect(rowsOf([r(16, 12, 30), r(80, 13, 40), r(46, 12, 20)], { left: 0, top: 0 })).toEqual([{ x: 16, y: 12, w: 104, h: 20 }])
  })

  it('de arriba abajo, aunque lleguen desordenados', () => {
    expect(rowsOf([r(16, 60, 40), r(16, 12, 60), r(16, 36, 50)], { left: 0, top: 0 }).map((x) => x.y)).toEqual([12, 36, 60])
  })
})
