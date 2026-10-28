// Corrección de ejercicios (port de StudyEngine/Grading y StudyEngine/Math/ExerciseGrader): API pública.
//
//   grade(exercise, input, opts?) → GradeResult        corrige los 16 tipos (open → needsReview/needsAI)
//   correctAnswerMarkdown(exercise) → string           «la respuesta correcta» con matemáticas
//   canonicalInput(answer) → AnswerInput | undefined   la respuesta correcta como la escribiría el estudiante
//   instantiateTemplate(template, seed) → Exercise     plantillas paramétricas
//   previewExpression(text)                            «así lo leo» mientras escribe
//   setMathCheckers({...})                             instala los verificadores del motor matemático
//   courseGradeOptions(pack, lang?) → GradeOptions     corrección del curso (exacta en los cursos de idiomas)
export * from './types'
export { grade, gradeAnswer, gradeChem, chemNumber, convert, matchWrong, numericSpecOf, expressionSpecOf } from './grader'
export { correctAnswerMarkdown, describeAnswer, canonicalInput, numericRoundedInput, texInterval, texOf } from './describe'
export { instantiateTemplate, instantiateTemplateOrThrow, substituteTemplateValues, templateVarKind, TemplateFailure, MAX_TEMPLATE_BYTES } from './template'
export { previewExpression, type ExpressionPreview } from './preview'
export { MathKitChecker, NoMathChecker, relationSides, type MathChecking } from './self-check'
export { AnswerChecker, setMathCheckers, resetMathCheckers, type MathCheckers } from './math-bridge'
export { textMatchOptions as defaultTextOptions } from '@engine/math'
export { basicGrade, basicNorm } from './basic'
export * from './open-answer'
export { courseGradeOptions, isLanguageCourse, type CourseForGrading } from './course'
export { EXACT_TEXT_OPTIONS, nearMiss, nearMissMessage, type NearMiss, type NearMissKind } from './exact-text'
