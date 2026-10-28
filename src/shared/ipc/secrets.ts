// El almacén de secretos (claves de API, sesiones de las plataformas) visto por la interfaz: solo su ESTADO, nunca valores.
// Si el llavero del sistema no deja leer secrets.enc, el almacén queda bloqueado (nada se escribe ni se pierde) y la
// interfaz ofrece «Reintentar» o «Empezar de cero» (aparta el archivo, no lo borra).

declare module './contract' {
  interface RpcMethods {
    'secrets.status': { args: void; result: SecretsState }
    /** Vuelve a intentar abrir el llavero ahora. */
    'secrets.retry': { args: void; result: SecretsState }
    /** Aparta el archivo que no se puede leer (secrets.unreadable-<fecha>.enc) y empieza con el almacén vacío. */
    'secrets.reset': { args: void; result: SecretsState }
  }
  interface RpcEvents {
    'secrets.changed': SecretsState
  }
}

export interface SecretsState {
  locked: boolean
  /** decrypt = el llavero no lo descifra (denegado, bloqueado o clave distinta); corrupt = archivo dañado; io = no se lee. */
  reason?: 'decrypt' | 'corrupt' | 'io'
  checkedAt?: string
  /** Tras «Empezar de cero»: nombre del archivo apartado. */
  movedTo?: string
}
