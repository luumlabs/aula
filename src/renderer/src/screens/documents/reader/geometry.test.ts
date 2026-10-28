// Marcas en un PDF: los trozos de una selección se juntan por línea y van y vuelven a coordenadas del PDF.
import { describe, expect, it } from 'vitest'
import { boxToPdfRect, mergeLineBoxes, pageNoteRect, pdfRectToBox, simpleViewport } from './geometry'

describe('geometría de las marcas', () => {
  it('junta los trozos de una misma línea y separa las líneas', () => {
    const lines = mergeLineBoxes([
      { x: 10, y: 100, w: 40, h: 12 }, { x: 52, y: 101, w: 30, h: 11 },     // línea 1 (dos trozos)
      { x: 10, y: 116, w: 80, h: 12 },                                      // línea 2
      { x: 0, y: 0, w: 600, h: 800 },                                       // el final del contenido (absurdo)
      { x: 5, y: 5, w: 0, h: 10 }                                           // vacío
    ])
    expect(lines).toEqual([{ x: 10, y: 100, w: 72, h: 12 }, { x: 10, y: 116, w: 80, h: 12 }])
  })

  it('va y vuelve a puntos del PDF (origen abajo a la izquierda)', () => {
    const vp = simpleViewport(792, 1.5)
    const box = { x: 150, y: 300, w: 90, h: 15 }
    const r = boxToPdfRect(box, vp)
    expect(r).toEqual([100, 582, 60, 10])
    expect(pdfRectToBox(r, vp)).toEqual(box)
  })

  it('las notas sueltas van arriba a la derecha', () => {
    expect(pageNoteRect(612, 792)).toEqual([568, 748, 20, 20])
  })
})
