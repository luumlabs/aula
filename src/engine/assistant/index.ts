// Piezas puras del chat con Aula, del tutor y de la memoria (isomorfas: sin `node:*` ni `electron`). Las usan el proceso
// principal (src/main/services/assistant, tutor, memory) y, si quiere, la interfaz (partes de un mensaje, citas, vista previa).
export * from './fold'
export * from './text'
export * from './dates'
export * from './parser'
export * from './citations'
export * from './refs'
export * from './catalog'
export * from './trust'
export * from './turns'
export * from './graph'
export * from './privacy'
export * from './memoryText'
