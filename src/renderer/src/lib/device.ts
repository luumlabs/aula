// Desde dónde se usa Aula (su ventana, un dispositivo de una Aula en un Mac o de un servidor) y qué se arregla desde aquí.
// Lógica pura, sin `window`: api.ts la aplica a lo que dice la página (window.aula). Probada en device.test.ts.

/** Lo que la página sabe de sí misma (lo pone el puente de un dispositivo; en la ventana, todo falso). */
export interface DeviceFlags {
  remote: boolean
  owner: boolean
  server: boolean
}

/**
 * - 'window': la ventana de Aula en el ordenador: lo lleva todo.
 * - 'owner': un dispositivo propietario de Aula como servidor: hace de ventana (la IA y sus claves, el presupuesto,
 *   la privacidad, las plataformas), salvo los datos y las actualizaciones, que se llevan en el servidor.
 * - 'macDevice': un dispositivo de una Aula en un Mac: solo lo de uso diario; lo demás se hace en el Mac.
 * - 'serverDevice': un dispositivo NO propietario de un servidor: solo lo de uso diario; lo demás lo hace el propietario.
 */
export type DeviceRole = 'window' | 'owner' | 'macDevice' | 'serverDevice'

export function deviceRole(f: DeviceFlags): DeviceRole {
  if (!f.remote) return 'window'
  // solo hay propietarios en un servidor; si la página dijera «propietario» sin «servidor», manda lo que puede hacer
  if (f.owner) return 'owner'
  return f.server ? 'serverDevice' : 'macDevice'
}

/**
 * Dónde se cambian la IA (y sus claves), el presupuesto y la privacidad cuando no es aquí: en el Mac ('mac') o desde
 * el dispositivo propietario ('owner'). `null`: aquí mismo (la ventana o el propietario).
 */
export function settingsElsewhere(role: DeviceRole): 'mac' | 'owner' | null {
  if (role === 'macDevice') return 'mac'
  if (role === 'serverDevice') return 'owner'
  return null
}

/** Las notas posibles bajo las claves de IA (claves de `settings:ai.*`). */
export type KeySafeNote = 'keySafe' | 'keySafeBasic' | 'keySafeServer' | 'keySafeServerBasic'

/**
 * La nota bajo las claves de IA: dónde queda una clave pegada desde aquí y si va cifrada. Las claves se guardan donde
 * corre Aula: en este ordenador (la ventana) o en el servidor (el propietario, que las pega desde su móvil). Con
 * `protection` 'basic' (Linux sin llavero; un servidor arranca con `--password-store=basic`) se guardan sin cifrar.
 * `undefined` mientras no se sabe cómo se protegen: `null`, sin nota, para no prometer un cifrado que quizá no hay.
 * Solo guardan claves la ventana y el propietario: los demás dispositivos eligen entre lo ya listo (`null`).
 */
export function keySafeNote(role: DeviceRole, protection: 'os' | 'basic' | undefined): KeySafeNote | null {
  if (!protection || settingsElsewhere(role)) return null
  const basic = protection === 'basic'
  if (role === 'owner') return basic ? 'keySafeServerBasic' : 'keySafeServer'
  return basic ? 'keySafeBasic' : 'keySafe'
}
