// Utilidades de las pruebas del calendario (como TestSupport de CanvasKitTests).
import { pad, wallTime } from '@engine/calendar/time'

/** Fecha UTC a partir de «2024-10-15T12:00:00Z». */
export function utcDate(iso: string): Date {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha de prueba inválida: ${iso}`)
  return d
}

/** «2024-10-20 23:59» en la zona indicada. */
export function localText(date: Date | null | undefined, zone = 'America/New_York'): string {
  if (!date) return 'nil'
  const w = wallTime(date, zone)
  return `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)} ${pad(w.hour, 2)}:${pad(w.minute, 2)}`
}

/** Generador congruencial lineal con semilla (reproducible), como el de RobustnessTests. */
export class LCG {
  private state: bigint
  constructor(seed: number) {
    this.state = BigInt(seed)
  }
  next(): bigint {
    const mask = (1n << 64n) - 1n
    this.state = (this.state * 6364136223846793005n + 1442695040888963407n) & mask
    return (this.state ^ (this.state >> 29n)) & mask
  }
  /** Entero en [0, n). */
  below(n: number): number {
    return Number(this.next() % BigInt(n))
  }
  byte(): number {
    return Number(this.next() & 0xffn)
  }
}
