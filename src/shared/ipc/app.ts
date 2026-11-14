// Lo que la interfaz le cuenta al proceso principal para el menú del clic derecho (src/main/electron/context-menu.ts): si el
// simulacro está abierto (solo copiar) y si el clic es en un campo de respuesta de un ejercicio (sin ortografía).

declare module './contract' {
  interface RpcMethods {
    /** Se abre (`true`) o se cierra (`false`) el simulacro: mientras, el menú del clic derecho solo copia y edita. */
    'app.setExamMode': { args: { exam: boolean }; result: void }
    /** El clic derecho que abre el menú es (o no) en un campo de respuesta de un ejercicio: se avisa justo antes del menú. */
    'app.contextTarget': { args: { exerciseField: boolean }; result: void }
  }
}

export {}
