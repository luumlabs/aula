// Herramientas de la IA para crear y ampliar cursos (port de StudyEngine/Tools): API pública.
//
//     const tools = makeTools({ kind: 'skillAuthor', skill: 'suma' }, ctx, allowWeb)
//
// Cada herramienta valida lo que recibe y devuelve los problemas exactos para que la IA los corrija. Nada de `electron`: la
// plataforma de estudio, la web y las fechas llegan inyectadas en `ToolContext`.
export * from './context'
export * from './authoring'
export * from './verification'
export * from './research'
export * from './reader'
export * from './media'
export * from './platform'
export * from './sets'
export * from './web'
export * from './webGate'
