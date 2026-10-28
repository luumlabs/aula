// Topes de UNA lectura de un .ics entero (un calendario suscrito, el de una plataforma o un archivo importado). Un calendario
// hostil o roto (cientos de series «cada día, 20 000 veces» desde 1980) congelaba el proceso principal: cada serie se expandía
// entera antes de recortarla. Ahora se cuenta en toda la lectura y, si se pasa, se para con un error claro.
import { aiLocale, tr } from '@shared/ai/i18n'

export interface ICSLimits {
  /** Componentes `VEVENT`/`VTODO` del archivo. */
  maxEvents: number
  /** Fechas creadas en total (cada evento suelto y cada repetición que se calcula). */
  maxOccurrences: number
  /** Vueltas de las reglas de repetición (periodos recorridos, también los que solo se cuentan para `COUNT`). */
  maxSteps: number
}

/** Holgados para cualquier calendario real (un feed de Canvas de casi 10 MB, años de Google Calendar, cientos de series
 *  semanales) y, aun así, una lectura que se pasa para en menos de un segundo. */
export const ICS_LIMITS: ICSLimits = { maxEvents: 50_000, maxOccurrences: 100_000, maxSteps: 1_000_000 }

export type ICSLimitCode = 'calendar_too_large' | 'calendar_too_complex'

export class ICSLimitError extends Error {
  constructor(readonly code: ICSLimitCode, message: string) {
    super(message)
    this.name = 'ICSLimitError'
  }
}

export const ICSLimitErrors = {
  tooManyEvents: (max: number) => {
    // la cifra con el formato del idioma de la interfaz («50.000» / «50,000»)
    const n = max.toLocaleString(aiLocale())
    return new ICSLimitError('calendar_too_large', tr(`El calendario tiene demasiados eventos (más de ${n}).`, `The calendar has too many events (more than ${n}).`))
  },
  tooComplex: () => new ICSLimitError('calendar_too_complex', tr('El calendario tiene demasiadas repeticiones para leerlo.', 'The calendar has too many repetitions to read.'))
}

/** Lo gastado en una lectura (se comparte entre todos sus eventos). */
export class ICSBudget {
  readonly limits: ICSLimits
  private steps = 0
  private occurrences = 0

  constructor(limits: Partial<ICSLimits> = {}) {
    this.limits = { ...ICS_LIMITS, ...limits }
  }

  /** `n` vueltas más de una regla. */
  step(n = 1): void {
    this.steps += n
    if (this.steps > this.limits.maxSteps) throw ICSLimitErrors.tooComplex()
  }

  /** `n` fechas más. */
  occurrence(n = 1): void {
    this.occurrences += n
    if (this.occurrences > this.limits.maxOccurrences) throw ICSLimitErrors.tooComplex()
  }
}
