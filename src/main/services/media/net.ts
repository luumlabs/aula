// Opciones de red comunes de las subidas de audio. Aparte para que la rama de la App Store (que añade el permiso antes de
// enviar datos a una IA) pueda enchufar aquí su política sin tocar el resto.
export function consentFetchInitSafe(): Pick<RequestInit, 'redirect'> {
  // nunca se sigue una redirección con la clave y el audio del estudiante
  return { redirect: 'error' }
}
