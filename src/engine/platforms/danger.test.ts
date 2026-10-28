import { describe, expect, it } from 'vitest'
import { classifyAction, classifyLabel, classifyURL, containsCardNumber, isSearchLabel, isSensitiveFieldLabel } from './danger'
import { normalizeLabel } from './text-norm'

const cat = (label: string, isLink = false): string | null => classifyLabel(label, isLink)?.category ?? null

describe('normalización de etiquetas', () => {
  it('quita acentos, mayúsculas, signos y apóstrofos', () => {
    expect(normalizeLabel('¿Cerrar sesión?')).toBe('cerrar sesion')
    expect(normalizeLabel('Submit (opens in new window)')).toBe('submit opens in new window')
    expect(normalizeLabel('I’m done')).toBe('im done')
    expect(normalizeLabel('  Añadir   comentario ')).toBe('anadir comentario')
  })
})

describe('clasificador de peligro: etiquetas (es + en)', () => {
  it('entregar', () => {
    for (const l of ['Submit', 'Submit Assignment', 'Turn in', 'Entregar', 'Enviar tarea', 'Enviar todo y terminar', 'Finalizar intento', 'Save and Submit']) {
      expect(cat(l), l).toBe('submit')
    }
  })

  it('empezar o repetir exámenes', () => {
    for (const l of ['Take the Quiz', 'Start Quiz!', 'Attempt quiz now', 'Resume Quiz', 'Comenzar examen', 'Realizar el cuestionario', 'Reanudar intento', 'Begin', 'Start practice quiz', 'Nuevo intento']) {
      expect(cat(l), l).toBe('assessment')
    }
  })

  it('borrar, enviar mensajes, cerrar sesión, pagar, bajas', () => {
    expect(cat('Delete file')).toBe('delete')
    expect(cat('Eliminar')).toBe('delete')
    expect(cat('Clear filters')).toBeNull()
    expect(cat('Send message')).toBe('message')
    expect(cat('Responder')).toBe('message')
    expect(cat('Publicar comentario')).toBe('message')
    expect(cat('Cerrar sesión')).toBe('logout')
    expect(cat('Log out')).toBe('logout')
    expect(cat('Pagar ahora')).toBe('payment')
    expect(cat('Darse de baja del curso')).toBe('unenroll')
    expect(cat('Iniciar sesión')).toBe('credentials')
    expect(cat('Mark as done')).toBe('modify')
    expect(cat('Subir archivo')).toBe('upload')
    expect(cat('Aceptar todas las cookies')).toBe('consent')
  })

  it('lo de lectura no pide nada', () => {
    for (const l of ['Módulos', 'Announcements', 'Calendario', 'Tema 3: Derivadas.pdf', 'Next page', 'Ver más', 'Syllabus', 'Download']) {
      expect(cat(l), l).toBeNull()
    }
  })

  it('«borrar» en un enlace solo cuenta al principio', () => {
    expect(cat('How to delete a page', true)).toBeNull()
    expect(cat('How to delete a page', false)).toBe('delete')
  })
})

describe('clasificador de peligro: direcciones', () => {
  it('rutas de exámenes y entregas de cada plataforma', () => {
    expect(classifyURL('https://uni.instructure.com/courses/1/quizzes/2/take')?.category).toBe('assessment')
    expect(classifyURL('https://campus.uni.edu/mod/quiz/startattempt.php?cmid=3')?.category).toBe('assessment')
    expect(classifyURL('https://campus.uni.edu/mod/quiz/processattempt.php')?.category).toBe('submit')
    expect(classifyURL('https://campus.uni.edu/mod/assign/view.php?id=4&action=editsubmission')?.category).toBe('submit')
    expect(classifyURL('https://campus.uni.edu/mod/forum/post.php?reply=9')?.category).toBe('message')
    expect(classifyURL('https://lms.uni.edu/d2l/lms/quizzing/user/attempt/quiz_start_frame_auto.d2l')?.category).toBe('assessment')
    expect(classifyURL('https://docs.google.com/forms/d/e/x/formResponse')?.category).toBe('submit')
    expect(classifyURL('https://x.proctorio.com/start')?.category).toBe('assessment')
  })

  it('la página de presentación de un cuestionario solo se lee', () => {
    expect(classifyURL('https://campus.uni.edu/mod/quiz/view.php?id=3')).toBeNull()
    expect(classifyURL('https://uni.instructure.com/courses/1/quizzes/2')).toBeNull()
  })

  it('cerrar sesión, borrar, pagar, bajas, otras apps', () => {
    expect(classifyURL('https://campus.uni.edu/login/logout.php?sesskey=x')?.category).toBe('logout')
    expect(classifyURL('https://uni.instructure.com/logout')?.category).toBe('logout')
    expect(classifyURL('https://x.edu/items/3/delete')?.category).toBe('delete')
    expect(classifyURL('https://x.edu/a?_method=delete')?.category).toBe('delete')
    expect(classifyURL('https://x.edu/checkout')?.category).toBe('payment')
    expect(classifyURL('https://x.edu/enrol/unenroll')?.category).toBe('unenroll')
    expect(classifyURL('mailto:profe@uni.edu')?.category).toBe('message')
    expect(classifyURL('msteams://x')?.category).toBe('externalApp')
    expect(classifyURL('javascript:void(0)')).toBeNull()
    expect(classifyURL('https://uni.instructure.com/courses/1/modules')).toBeNull()
  })
})

describe('clasificador de peligro: acciones', () => {
  it('la dirección peligrosa gana a una etiqueta inocente', () => {
    expect(classifyAction({ action: 'click', role: 'link', label: 'Cancelar', url: 'https://x.edu/logout' })?.category).toBe('logout')
    expect(classifyAction({ action: 'click', role: 'button', label: 'Cancelar' })).toBeNull()
  })

  it('las confirmaciones heredan el peligro del diálogo', () => {
    expect(classifyAction({ action: 'click', role: 'button', label: 'Sí', dialogText: '¿Seguro que quieres eliminar este archivo?' })?.category).toBe('delete')
    expect(classifyAction({ action: 'click', role: 'button', label: 'OK', dialogText: 'Your changes were saved.' })).toBeNull()
  })

  it('un botón en un formulario con contraseña es de credenciales', () => {
    expect(classifyAction({ action: 'click', role: 'button', label: 'Continuar', inPasswordForm: true })?.category).toBe('credentials')
    expect(classifyAction({ action: 'click', role: 'button', label: 'Next', passwordOnPage: true })?.category).toBe('credentials')
  })

  it('un enlace que lanza una herramienta externa con nombre de examen', () => {
    const a = classifyAction({ action: 'click', role: 'link', label: 'Midterm Exam (Honorlock)', url: 'https://uni.instructure.com/courses/1/external_tools/9' })
    expect(a?.category).toBe('assessment')
    expect(classifyAction({ action: 'click', role: 'link', label: 'Midterm study guide', url: 'https://uni.instructure.com/courses/1/modules/items/3' })).toBeNull()
  })

  it('escribir en campos de contraseña, códigos o tarjetas está prohibido', () => {
    expect(classifyAction({ action: 'typeText', role: 'passwordfield', label: 'Password', text: 'x' })?.forbidden).toBe(true)
    expect(classifyAction({ action: 'setText', role: 'textfield', label: 'Código de verificación', text: '123' })?.forbidden).toBe(true)
    expect(classifyAction({ action: 'setText', role: 'textfield', label: 'Buscar', text: '4111 1111 1111 1111' })?.category).toBe('payment')
    expect(classifyAction({ action: 'setText', role: 'textfield', label: 'Buscar', text: 'derivadas' })).toBeNull()
  })

  it('desplazarse, enfocar o descargar no piden nada', () => {
    expect(classifyAction({ action: 'scroll', label: 'Delete' })).toBeNull()
    expect(classifyAction({ action: 'download', label: 'Submit' })).toBeNull()
  })
})

describe('campos sensibles y tarjetas', () => {
  it('etiquetas sensibles', () => {
    expect(isSensitiveFieldLabel('Contraseña')).toBe(true)
    expect(isSensitiveFieldLabel('PIN')).toBe(true)
    expect(isSensitiveFieldLabel('Palabras clave')).toBe(false)
    expect(isSensitiveFieldLabel('Nombre')).toBe(false)
    expect(isSearchLabel('Buscar cursos')).toBe(true)
  })

  it('números de tarjeta (Luhn)', () => {
    expect(containsCardNumber('mi tarjeta 4111-1111-1111-1111')).toBe(true)
    expect(containsCardNumber('4111 1111 1111 1112')).toBe(false)
    expect(containsCardNumber('0000 0000 0000 0000')).toBe(false)
    expect(containsCardNumber('pedido 12345')).toBe(false)
  })
})

// J3-12: frases de examen que se permitían
describe('frases de examen que faltaban', () => {
  it('se bloquean como examen', () => {
    for (const l of ['Volver a intentar el cuestionario', 'Hacer la prueba', 'Tomar el examen', 'Resolver examen', 'Intentar el cuestionario',
      'Abrir examen', 'Open exam', 'Go to quiz', 'Iniciar tarea', 'Launch', 'Lancer', 'Hacer prueba', 'Jetzt beginnen']) {
      expect(cat(l), l).toBe('assessment')
    }
  })
  it('lo de leer sigue permitido', () => {
    for (const l of ['Ver examen', 'Next', 'Abrir archivo', 'Go to course', 'Open syllabus', 'Tareas', 'Resolver dudas en el foro']) {
      expect(cat(l), l).not.toBe('assessment')
    }
  })
})

