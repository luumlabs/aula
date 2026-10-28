// A2-P1-3: el PDF hostil del juez (un flujo «q Q» enorme compartido por todas las páginas) ya no congela a quien lo lee: cada
// página cede el hilo (la cancelación y el resto del proceso siguen vivos) y la capa de texto tiene un tope de tiempo total.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDocument } from '../pipeline'
import { tempDir, type TempDir } from '../testing/files'
import { qqBombPDF } from '../testing/hostilePdf'
import { setPdfTextBudgetForTests } from './pdf'

let tmp: TempDir
let before = 0
beforeEach(() => { tmp = tempDir(); before = setPdfTextBudgetForTests(1500) })
afterEach(() => { tmp.cleanup(); setPdfTextBudgetForTests(before) })

describe('A2-P1-3 · PDF hostil', () => {
  it('se para al pasar el tope de tiempo, con aviso, y el hilo no se queda bloqueado entre páginas', async () => {
    const file = tmp.write('bomb.pdf', qqBombPDF(60, 6))
    let ticks = 0
    const heartbeat = setInterval(() => { ticks++ }, 20)
    const t0 = performance.now()
    const doc = await readDocument(file, { ocr: false })
    const secs = (performance.now() - t0) / 1000
    clearInterval(heartbeat)
    expect(doc.pages.length).toBeLessThan(60)
    expect(doc.warnings.join(' ')).toContain('tarda demasiado')
    // con el tope de 1,5 s acaba enseguida (sin él: 60 × ~1 s por página; con margen para una máquina cargada)
    expect(secs).toBeLessThan(20)
    // el temporizador corrió entre página y página (antes: 0 veces en toda la lectura)
    expect(ticks).toBeGreaterThanOrEqual(Math.min(doc.pages.length - 1, 3))
  })

  it('se puede cancelar a mitad (antes la señal solo se miraba cada 4 páginas)', async () => {
    const file = tmp.write('bomb.pdf', qqBombPDF(60, 6))
    setPdfTextBudgetForTests(600_000)
    const ctl = new AbortController()
    setTimeout(() => ctl.abort(), 300)
    const t0 = performance.now()
    await expect(readDocument(file, { ocr: false, signal: ctl.signal })).rejects.toBeTruthy()
    expect((performance.now() - t0) / 1000).toBeLessThan(20)
  })
})
