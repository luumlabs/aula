// El guion de un vídeo («montaje»): tomas de la app real que se capturan fotograma a fotograma y la composición que las
// coloca en escena (cámara, titulares, el sol de Aula, transiciones y música). Solo datos: lo leen el capturador (Node) y
// el compositor (la página de Electron). Tiempos en segundos.

/** Ruta de la app (la misma forma que window.__aula.navigate). */
export type Route = { name: string; [k: string]: unknown }

/** Dónde actuar: selector CSS, o texto visible exacto de un botón/enlace (`text:Empezar el plan`), o un punto en pt. */
export type Target = string | [number, number]

/** `soft`: si el objetivo no aparece, se apunta un aviso y la toma sigue (para borradores). */
export type Action = (
  | { do: 'navigate'; route: Route }
  | { do: 'theme'; value: 'light' | 'dark' }
  /** Mueve el cursor al objetivo en `dur` s (curva suave), dispara el hover de verdad. */
  | { do: 'move'; to: Target; dur?: number }
  /** Mueve (si hace falta) y pulsa. */
  | { do: 'click'; to: Target; dur?: number }
  | { do: 'type'; text: string; /** caracteres por segundo */ cps?: number }
  | { do: 'key'; key: string }
  /** Arrastra de un objetivo a otro en `dur` s (botón pulsado durante el camino). */
  | { do: 'drag'; from: Target; to: Target; dur?: number }
  /** Desplaza la rueda sobre el objetivo `dy` pt en `dur` s. */
  | { do: 'scroll'; to: Target; dy: number; dur?: number }
  /** JavaScript en la página (para casos sueltos). */
  | { do: 'eval'; js: string }
) & { soft?: boolean }

export type TimedAction = Action & { at: number }

export interface Take {
  /** Segundos que se graban (tiempo virtual). */
  duration: number
  lang?: 'es' | 'en'
  theme?: 'light' | 'dark'
  /** Tamaño de la ventana en pt (por defecto 1440×900). Se captura a 2 px/pt. */
  viewport?: [number, number]
  /** Preparación antes de grabar (cada paso se asienta ~1 s virtual, no sale en el vídeo). */
  setup?: Action[]
  /** Lo que pasa durante la grabación, en segundos desde el inicio de la toma. */
  actions?: TimedAction[]
  /** Elementos cuya caja se apunta en cada fotograma (para enfocar la cámara o colocar el sol): nombre → selector. */
  marks?: Record<string, string>
  /** Carpeta plantilla de AULA_HOME (se copia a una temporal). Por defecto: el curso de ejemplo + seis semanas simuladas. */
  home?: string
  /** Variables extra para la app (p. ej. AULA_FAKE_AI: '1'). */
  env?: Record<string, string>
  /** Gestos de reposo del pixel art (por defecto apagados en las capturas: dependen de cuándo se montó cada icono). */
  pixelIdle?: boolean
  /** Temporizadores del proceso principal en tiempo virtual (IA simulada que escribe al ritmo del vídeo). */
  mainClock?: boolean
  /** Hora de la app al empezar (ISO local). Por defecto, hoy a las 10:00. */
  clock?: string
}

export type Ease = 'linear' | 'inOut' | 'out' | 'in' | 'spring' | 'smooth'

/** Un punto en la toma: pt de la ventana, o el centro de una marca (`mark:nombre`). */
export type Focus = [number, number] | `mark:${string}`

export interface CameraKey {
  /** Segundos desde el inicio del plano (o del vídeo, en montage.camera). */
  t: number
  /** Zoom en px de vídeo por pt de la app. `fit` = ventana entera con aire. Máximo 2 (la resolución de la captura). */
  zoom: number | 'fit'
  /** Punto de la ventana que queda en el centro (por defecto, el centro de la ventana). */
  focus?: Focus
  /** Dónde cae ese punto en el vídeo, en fracción del cuadro (por defecto [0.5, 0.5], el centro). */
  screen?: [number, number]
  /** Curva para llegar a esta clave desde la anterior (por defecto, la curva única de la cámara: montage.cameraEase). */
  ease?: Ease
  /** Seguir una marca: retraso del seguimiento (s; por defecto 0,2), para que la cámara no tiemble con el elemento. */
  lag?: number
}

export type TransitionKind = 'cut' | 'fade' | 'sunrise' | 'rise' | 'iris' | 'door' | 'content' | 'match' | 'theme' | 'icon'

/** Marco dibujado de la ventana: semáforos de macOS, botones de Windows o cabecera de GNOME. */
export type WindowFrame = 'mac' | 'windows' | 'linux'

export interface Clip {
  take: string
  /** Inicio en la línea de tiempo del vídeo. */
  start: number
  dur: number
  /** Desde qué segundo de la toma (por defecto 0). */
  from?: number
  camera?: CameraKey[]
  /** Entrada del plano (la transición se solapa con el anterior). `iris`: círculo que se abre desde `at`. `door`: la
   *  puerta del arco del icono se abre desde el icono del prólogo (o desde el centro) hasta llenar el cuadro. `icon`: la
   *  losa del icono del prólogo crece y se convierte en la ventana (el gesto del final al revés); `theme`: claro↔oscuro,
   *  el papel del fondo cambia en `dur` (2 pulsos) y la ventana entera en `window` (5 fotogramas) en el pulso fuerte. */
  enter?: {
    kind: TransitionKind
    dur: number
    at?: Focus
    /** `match`: el elemento del plano que sale (`mark:` de su toma) … */
    from?: Focus
    /** … y el mismo elemento en el plano que entra: este arranca con él en el mismo sitio (y escala, hasta ×/÷1,6 de
     *  su cámara) y vuelve a su cámara en `dur` con la curva única. */
    to?: Focus
    /** `theme`: segundos que tarda la VENTANA en cambiar de tema (fundido corto de la ventana entera; por defecto 5
     *  fotogramas). `dur` es lo que tarda el papel del fondo y los rótulos (2 pulsos). */
    window?: number
  }
  /** Deriva viva de la cámara: fracción de zoom que gana por compás (p. ej. 0.01). Por defecto montage.drift. */
  drift?: number
}

export interface Title {
  start: number
  dur: number
  /** Las palabras entre *asteriscos* salen en cursiva y en ladrillo. */
  text: string
  sub?: string
  /** `hero` (grande, centrado, con la marca de Aula), `side` (a la izquierda, junto a la ventana), `caption` (abajo). */
  style: 'hero' | 'side' | 'caption'
  /** `over` (por defecto) encima de la ventana; `under`, detrás (la ventana lo tapa). */
  layer?: 'over' | 'under'
  /** `calm` (por defecto): entra y sale con el mismo gesto (350 ms, fundido y 8 px). `words`: palabra a palabra. */
  gesture?: 'calm' | 'words'
  /** Ya entero desde su primer fotograma (sin la entrada palabra a palabra): para el fotograma 0 de una parte. */
  instant?: boolean
  /** Posición (fracción del cuadro) del ancla del texto, si no vale la de su estilo. */
  at?: [number, number]
}

/** Sello de hora («MONDAY · 8:10 AM») arriba a la izquierda; los caracteres que cambian ruedan. */
export interface Stamp {
  t: number
  text: string
}

/** Color del papel del fondo en el instante t (se interpola en OKLab). */
export interface PaperKey {
  t: number
  color: string
}

export interface SunKey {
  t: number
  /** Posición en px del vídeo, o `clip:mark:nombre` para seguir una marca del plano activo. */
  at: [number, number] | `mark:${string}`
  /** Radio del disco en px. 0 = escondido. */
  r: number
  /** `disc`: el sol con su halo (por defecto); `halo`: solo la luz, para iluminar un botón sin taparlo. */
  style?: 'disc' | 'halo'
  ease?: Ease
}

export type Voice = 'marimba' | 'pluck' | 'bell' | 'piano'

export interface MusicCue {
  t: number
  kind: 'motif' | 'swell' | 'hit' | 'end'
  /** Para `motif`: instrumento, octava (+1/−1) y si suena en menor (notas de montage.music.minorMotif). */
  voice?: Voice
  octave?: number
  minor?: boolean
}

/** Estilo de los compases desde `bar` (1 = el primero). `light` (0…1) abre o cierra el filtro del colchón. */
export interface MusicSection {
  bar: number
  style: 'piano' | 'dawn' | 'day' | 'night' | 'end'
  light?: number
  /** Palmas en 2 y 4 (solo `day`). */
  claps?: boolean
}

/** Pista real externa (nunca en el repo): su rejilla, los compases que se quitan y dónde empieza el vídeo. */
export interface TrackMusic {
  grid: import('./grid.ts').GridJson
  /** Compases de la pista que se quitan [desde, hasta). */
  cuts?: [number, number][]
  /** Segundo de la pista en el que empieza el vídeo. */
  start?: number
  /** Ruta del archivo (por defecto AULA_FILM_MUSIC o DEFAULT_TRACK de audio/track.ts). */
  file?: string
}

export interface Music {
  /** La pista real: si está, suena ella (con los clics y los personajes por debajo) y lo sintetizado queda de reserva. */
  track?: TrackMusic
  bpm: number
  /** Nota MIDI de la tónica (60 = do central). */
  root: number
  /** Progresión en grados (0 = I, 4 = V, 5 = vi, 3 = IV…), un acorde por compás (si no hay `chords`). */
  progression?: number[]
  /** Un acorde por compás en cifrado («D», «A/C#», «Bm», «Dadd9»…); el último se repite. */
  chords?: string[]
  sections?: MusicSection[]
  /** Motivo: [semitonos sobre la tónica una octava arriba, duración en negras]. La primera nota es anacrusa: suena
   *  antes del cue. Por defecto 5-1-2-3 (A4–D5–E5–F♯5 en re). */
  motif?: [number, number][]
  minorMotif?: [number, number][]
  cues: MusicCue[]
  /** Un «tic» de madera en cada clic de las tomas (dB respecto a la música; por defecto −18; null = sin tics). */
  clicks?: number | null
  /** Sonidos de los personajes pixel art (dB; por defecto −12; null = sin ellos). Salen de las historias que la toma
   *  registró (evento `aula:pixel`) y de `montage.pixelSfx`. */
  sfx?: number | null
  seed?: number
}

/** El icono de Aula dibujado por capas (prólogo): la losa, el arco y el medio sol pintado que sale por el horizonte. */
export interface IconLayer {
  start: number
  end: number
  /** Lado del icono en px del vídeo (por defecto 360). */
  size?: number
  /** Centro del icono, en fracción del cuadro (por defecto [0.5, 0.42]). */
  at?: [number, number]
  /** Cuándo sale el sol [desde, hasta] (segundos del vídeo). */
  rise: [number, number]
  /** Los últimos `morph` s del prólogo, la losa del icono se convierte en la ventana del primer plano (que debe empezar
   *  a más tardar en end − morph; su `enter` se ignora durante el gesto). El mismo gesto que finale.morph, al revés. */
  morph?: number
  /** Escala inicial del icono, que crece hasta 1 mientras sale el sol (p. ej. 0.94). */
  grow?: number
  /** Fundido de entrada de la losa (s). Por defecto 0: el icono ya está en el primer fotograma. */
  fadeIn?: number
  title?: string
  sub?: string
  /** Desde cuándo entra el titular (por defecto, al acabar de salir el sol). */
  titleAt?: number
}

export interface Finale {
  start: number
  /** Duración de la transformación (después el icono se queda). */
  dur: number
  /** Duración de la reducción ventana → icono (s; por defecto el 55 % de `dur`). Para un gesto legible, ~1 compás. */
  morph?: number
  /** Cuándo sale el sol en el arco [desde, hasta] (segundos del vídeo). Por defecto, el último 45 % de `dur`. */
  rise?: [number, number]
  /** El sol vuela hasta la puerta desde aquí (px del vídeo) o desde el cursor del último plano. */
  sunFrom?: [number, number] | 'cursor'
  /** Lado del icono en px del vídeo (por defecto 360). */
  size?: number
  /** Centro del icono, en fracción del cuadro (por defecto [0.5, 0.42]). */
  at?: [number, number]
  /** Palabra bajo el icono (serif) y línea de apoyo. */
  title?: string
  sub?: string
}

export interface Notice {
  start: number
  dur: number
  title: string
  body: string
  /** Texto de la hora («now», «ahora»…). */
  time?: string
  theme?: 'light' | 'dark'
}

/** Una salida del render: el máster o una parte (README, avance…). */
export interface Output {
  name: string
  /** Tramo del vídeo en segundos (por defecto entero). */
  range?: [number, number]
  size?: [number, number]
  fps?: number
  /** bits/s del vídeo. */
  bitrate?: number
  /** bits/s del AAC (por defecto 192 kb/s). */
  audioBitrate?: number
  /** Fundidos de sonido al entrar y al salir (s). */
  fadeIn?: number
  fadeOut?: number
  /** Tamaño máximo del archivo (MB): el control de calidad avisa si se pasa. */
  maxMB?: number
  /** Instantes (s, del vídeo) que se guardan como PNG a tamaño de la salida (póster, miniaturas). */
  stills?: number[]
}

export interface Montage {
  name: string
  fps: number
  size: [number, number]
  /** bits/s del H.264. */
  bitrate?: number
  theme: 'light' | 'dark'
  duration: number
  takes: Record<string, Take>
  clips: Clip[]
  titles?: Title[]
  /** Cámara continua en tiempo global (para los planos que no traen la suya): pasa por encima de los cortes. */
  camera?: CameraKey[]
  sun?: SunKey[]
  music?: Music
  /** Papel del fondo por claves de hora (si no hay, sale del tema de los planos). */
  paper?: PaperKey[]
  stamps?: Stamp[]
  /** Marco de la ventana por claves de tiempo (fundido de 6 fotogramas al cambiar). Por defecto `mac`. */
  frames?: { t: number; frame: WindowFrame }[]
  /** `arrow` (cursor de macOS, por defecto) o `sun` (el cursor-sol de Aula). */
  cursor?: 'arrow' | 'sun'
  /** Deriva viva por defecto de los planos (fracción de zoom por compás). */
  drift?: number
  /** Banda de rótulos en el papel, bajo la ventana (px desde arriba donde empieza, p. ej. 950): la ventana descansa entre
   *  40 px y la banda, nunca baja de ella aunque se acerque la cámara, y los pies van centrados en la banda. */
  captionBand?: number
  /** La curva única de la cámara (por defecto `smooth`: suave y amortiguada, sin rebote). */
  cameraEase?: Ease
  /** Historias pixel art colocadas a mano (si la toma no las registró): instante, id de la historia y pista. */
  pixelSfx?: { t: number; story: string; clip?: 'hover' | 'celebrate' | 'idle' }[]
  /** Prólogo: el icono de Aula por capas, con el sol que amanece (y un plano que entre con `enter: { kind: 'door' }`). */
  prologue?: IconLayer
  /** Final: la ventana se encoge hasta ser el icono de Aula y su sol sale por la puerta. */
  finale?: Finale
  /** Avisos del sistema dibujados (banner de notificación de macOS). */
  notices?: Notice[]
  /** Salidas además del máster (partes, avance). */
  outputs?: Output[]
}

/** Datos que el capturador deja junto a los fotogramas de una toma. */
export interface TakeMeta {
  take: string
  hash: string
  fps: number
  frames: number
  viewport: [number, number]
  scale: number
  /** Posición del cursor por fotograma (pt) y si está pulsado; null = fuera. */
  cursor: ([number, number, 0 | 1] | null)[]
  marks: Record<string, ([number, number, number, number] | null)[]>
  /** Historias pixel art que arrancaron durante la toma (si la app emite `aula:pixel`). */
  pixel?: { frame: number; story: string; clip: string }[]
  frameHashes: string[]
  timing: { bootMs: number; setupMs: number; recordMs: number; perFrameMs: number }
}

export function defineMontage(m: Montage): Montage {
  return m
}
