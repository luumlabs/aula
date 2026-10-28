// El calendario de Aula, lo puro (isomorfo): lectura de .ics de las plataformas, modelo y formato de `calendar.json`,
// repeticiones propias (RRULE), series («esta vez / esta y las siguientes / todas»), tareas y avisos, «Añadir rápido»,
// exportar a .ics, cursos en preparación y las herramientas para la IA. El servicio está en src/main/services/calendar.
export * from './time'
export * as ics from './ics'
export { parseICS, MAX_OCCURRENCES_PER_EVENT, ICSLimitError, ICS_LIMITS, type StudyEvent, type StudyEventKind } from './ics'
export * from './model'
export * from './rrule'
export * from './expander'
export * from './codec'
export * from './series'
export * from './core'
export * from './quickAdd'
export * from './icsWriter'
export * from './preparation'
export * from './view'
export * from './tools'
export * from './importICS'
export * from './editor'
