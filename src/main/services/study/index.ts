// Servicio de estudio (sin `electron`): vistas de curso, Inicio y Estadísticas, registro de intentos, tarjetas, tiempo,
// simulacros, corrección de respuestas abiertas con IA y peticiones de más ejercicios. Lo usa el IPC (handlers/study.ts).
export * from './service'
export { loadCourse, loadAllCourses, requireStore, setStudyLibrary, studyLibrary, updateProgress, replaceProgress, type CourseData } from './courses'
export { gradeOpenAnswer, reviewToGrade, setOpenGraderModel, type OpenGrade } from './open-grader'
export { assetLookup, boundValidator, loadAssetMeta, saveAssetMeta } from './assets'
