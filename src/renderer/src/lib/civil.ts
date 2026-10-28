// Fechas civiles en la zona local, sin sumar horas: con el cambio de hora un día no siempre dura 24 h.
// (Puro: sin i18n ni DOM, para poder probarlo en cualquier zona horaria.)

/** Medianoche local del mismo día. */
export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** El mismo reloj `n` días naturales después (o antes): el 1 de noviembre sigue al 31 de octubre aunque cambie la hora. */
export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** `count` días seguidos desde el de `from`, cada uno a su medianoche local. */
export function daysFrom(from: Date, count: number): Date[] {
  const first = startOfDay(from)
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(first, i))
}

/** Días naturales de `from` a `to` (0 = el mismo día). Redondea: un día de 23 o 25 h cuenta como uno. */
export function civilDaysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000)
}
