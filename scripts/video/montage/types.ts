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
  /** V6 · fotogramas por segundo de la captura (por defecto los del montaje). Para la cámara lenta, 250: pasos de 4 ms
   *  exactos del reloj virtual, y a 0,24× sale un fotograma nuevo por cada uno del vídeo a 60. */
  fps?: number
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

export type TransitionKind = 'cut' | 'fade' | 'sunrise' | 'rise' | 'iris' | 'door' | 'content' | 'match' | 'theme' | 'icon' | 'brush' | 'focus' | 'light' | 'shape' | 'whip'

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
    /** `brush`: hacia dónde va la primera pasada de la pincelada; `whip`: hacia dónde se va el plano viejo. */
    dir?: 'right' | 'left' | 'down' | 'up'
    /** `brush`: semilla de la pincelada (por defecto, el plano). */
    seed?: string | number
    /** `light`: la forma con la que entra el plano nuevo (con su tema y su papel): anochecer de arriba abajo, amanecer
     *  desde el sol (`at`), portal con la forma del arco, horizonte que sube o barrido diagonal. */
    style?: 'dusk' | 'dawn' | 'arch' | 'horizon' | 'diagonal'
    /** `shape`: la forma que viaja de `from` a `to` (círculo → sol → arco). */
    shape?: 'circle' | 'sun' | 'arch'
    /** `theme`: segundos que tarda la VENTANA en cambiar de tema (fundido corto de la ventana entera; por defecto 5
     *  fotogramas). `dur` es lo que tarda el papel del fondo y los rótulos (2 pulsos). */
    window?: number
  }
  /** Deriva viva de la cámara: fracción de zoom que gana por compás (p. ej. 0.01). Por defecto montage.drift. */
  drift?: number
  /** V5 · empujón de cámara a lo largo del plano: cuánto acerca de principio a fin (0.15 = un 15 %), con curva suave. */
  push?: number
  /** V5 · paneo a lo largo del plano: cuánto recorre el foco [dx, dy] (pt de la app), con curva suave. */
  pan?: [number, number]
  /** V6 · velocidad de la toma (0,25 = cámara lenta a un cuarto; 2 = el doble de rápido). Para cámara lenta sin
   *  fotogramas repetidos, captura la toma a más fps (`take.fps`, p. ej. 250). */
  speed?: number
  /** V6 · rampas de velocidad sobre el tiempo de la toma (segundos del plano): rápido, muy lento en el momento clave,
   *  rápido otra vez; el tiempo total se conserva. */
  ramps?: Ramp[]
  /** Composición V5. `keynote`: la interfaz en un panel grande a un lado (el titular va al otro), flotando con sombra y
   *  una leve inclinación 3D que se mueve; la cámara (zoom/focus) elige qué parte de la ventana se ve dentro del panel.
   *  `detail`: el panel llena el cuadro (primer plano muy cerrado). */
  layout?: Layout
}

export interface Title {
  start: number
  dur: number
  /** Las palabras entre *asteriscos* salen en cursiva y en ladrillo. */
  text: string
  sub?: string
  /** `hero` (grande, centrado, con la marca de Aula), `side` (a la izquierda, junto a la ventana), `caption` (abajo),
   *  `paint` (grande, en el papel, sin píldora: para la versión corta; con `band` va centrado en esa banda). */
  style: 'hero' | 'side' | 'caption' | 'paint' | 'keynote' | 'type'
  /** `keynote`: lado del titular (el contrario del panel de la interfaz). */
  side?: 'left' | 'right'
  /** V5: el titular empieza a su hora aunque el plano esté entrando con rack focus o luz (por defecto espera a que la
   *  transición deje de enseñar el plano viejo). */
  overlap?: boolean
  /** `paint`: en qué banda del cuadro va (montage.bands); sin ella, en `at`. */
  band?: 'top' | 'bottom'
  /** `paint`: cuerpo de la letra (px del vídeo; por defecto 6,5 % del lado corto). */
  size?: number
  /** `brush`: cada palabra se revela con una pincelada (de izquierda a derecha), una tras otra cada `stagger` s. */
  stagger?: number
  /** Subrayado a pincel bajo la palabra `word` (índice desde 0; por defecto la primera en *cursiva*), que cae en `t` (s
   *  del vídeo; por defecto al acabar de revelarse el rótulo). */
  underline?: { word?: number; t?: number; color?: string } | false
  /** Rodeo a pincel alrededor de la palabra `word` (por defecto, la primera en cursiva). */
  ring?: { word?: number; t?: number; color?: string }
  /** `over` (por defecto) encima de la ventana; `under`, detrás (la ventana lo tapa). */
  layer?: 'over' | 'under'
  /** `calm` (por defecto): entra y sale con el mismo gesto (350 ms, fundido y 8 px). `words`: palabra a palabra.
   *  `brush`: cada palabra se revela con una pincelada (sale con el fundido de `calm`). */
  gesture?: 'calm' | 'words' | 'brush'
  /** Ya entero desde su primer fotograma (sin la entrada palabra a palabra): para el fotograma 0 de una parte. */
  instant?: boolean
  /** Posición (fracción del cuadro) del ancla del texto, si no vale la de su estilo. */
  at?: [number, number]
}

/** Un adorno de pintura. `at`: fracción del cuadro, o `mark:x` (la caja de una marca del plano activo, para rodear o
 *  subrayar algo de la app). Se pinta en `draw` s (por defecto 0,35), se queda y se apaga en 0,25 s al acabar `dur`. */
export interface PaintMark {
  t: number
  kind: 'splash' | 'underline' | 'ring' | 'stroke'
  at: [number, number] | `mark:${string}`
  /** `stroke`: dónde acaba (fracción del cuadro). */
  to?: [number, number]
  /** Tamaño (px): radio de la salpicadura, grosor del trazo; en `underline`/`ring` con `at` fracción, ancho de la caja. */
  size?: number
  dur?: number
  draw?: number
  color?: string
  seed?: string | number
}

export type Layout =
  | {
      kind: 'keynote'
      /** Lado de la interfaz. */
      side: 'left' | 'right'
      /** Ancho del panel (fracción del ancho del cuadro; por defecto 0,64). */
      size?: number
      /** Alto del panel (fracción del alto; por defecto 0,8). */
      height?: number
      /** Inclinación 3D máxima (grados; por defecto 6). 0 = plano. */
      tilt?: number
      /** Flota (sube y baja muy despacio). Por defecto sí. */
      float?: boolean
    }
  | { kind: 'detail'; tilt?: number }
  /** V6: la ventana entera de la app dentro de la pantalla de un portátil en 3D (la cámara es `montage.laptop`). Varios
   *  planos seguidos comparten el mismo gesto de cámara aunque cambie la toma. */
  | { kind: 'laptop' }

/** V6 · una clave de la cámara alrededor del portátil (cm y grados). Cada canal (giro, altura, distancia, punto, encuadre,
 *  tapa) se interpola SOLO entre las claves que lo dan (curva cúbica monótona: sin rebote, con velocidad continua y nula
 *  en su primera y su última clave; repetir un valor = quieto). Así una órbita sigue mientras otra clave mueve la tapa.
 *  - `yaw`: giro alrededor del portátil (0 = de frente; negativo = la cámara se va a su izquierda y el portátil queda
 *    «girado a la derecha», mirando al hueco de la derecha del cuadro).
 *  - `pitch`: altura (grados sobre la horizontal). Para mirar la pantalla de frente: `pitch = lid − 90`.
 *  - Distancia, una de tres: `fill` (la pantalla ocupa esa fracción del cuadro en su lado más justo: 1 = lo llena),
 *    `frame` (el portátil abierto ocupa esa fracción del ancho del cuadro) o `dist` (cm). Se resuelven con la pose de
 *    la clave y se interpolan en logaritmo.
 *  - `at`: punto de la pantalla al que mira (fracciones de la ventana [u, v]); `null` = el centro del portátil abierto.
 *  - `screen`: dónde cae ese punto en el cuadro (fracción; por defecto el centro): desplazamiento de objetivo, sin
 *    girar la cámara (deja el portátil a un lado y el hueco para el titular al otro).
 *  - `lid`: apertura de la tapa (grados; 0 = cerrada, `LID_OPEN` = abierta). */
export interface LaptopKey {
  t: number
  yaw?: number
  pitch?: number
  fill?: number
  frame?: number
  dist?: number
  at?: [number, number] | null
  screen?: [number, number]
  lid?: number
}

/** V6 · un personaje de la app que se dibuja a pincel, trazo a trazo (los compañeros y los iconos de curso, con el motor
 *  de la app): primero el contorno, luego las aguadas y al final los detalles; cada trazo avanza con su presión y se
 *  seca al final. Al acabar, la línea hierve un poco (o el personaje cobra vida con su historia). Va en el aire, sobre
 *  el papel y bajo los titulares. */
export interface Drawing {
  /** `companion:<id>` (luna, gato, zorro, buho, fantasma, seta, taza, cohete…) o `icon:<id>` (study, math, calculus…). */
  who: string
  /** Cuándo empieza a dibujarse (s del vídeo) y lo que tarda (s; por defecto 1,8). */
  t: number
  dur?: number
  /** Hasta cuándo se ve (s del vídeo; por defecto el final). Se va con un fundido de 0,3 s. */
  until?: number
  /** Centro en el cuadro (fracción) o `gap`: en el hueco libre que deja el portátil (bajo el titular de ese lado; en
   *  vertical, en la banda de arriba), en fila con `slot` [i, n]. `size`: lado (px del vídeo; en el hueco, como mucho). */
  at: [number, number] | 'gap'
  size: number
  /** `gap`: de qué lado del portátil (por defecto, el que tenga más hueco) y su sitio en la fila [i, n]. */
  side?: 'left' | 'right'
  slot?: [number, number]
  /** Tono del curso (índice de TONES) para un icono. */
  tone?: number
  /** Al acabar: `boil` (por defecto: la línea hierve, 8 dibujos por segundo), `alive` (además su historia «hover» en
   *  bucle, como al pasar el ratón en la app) o `still`. */
  after?: 'boil' | 'alive' | 'still'
  /** Rampas de velocidad del propio dibujo (s del vídeo). */
  ramps?: Ramp[]
}

/** V6 · una rampa de velocidad (cámara lenta con rampa): entre `from` y `to` el tiempo corre rápido, muy lento alrededor
 *  de `at` (a `slow`, p. ej. 0,2) y rápido otra vez; en `from`, `at` y `to` va a su hora (lo de fuera no se mueve), y
 *  en los extremos la velocidad es 1 (sin tirón). `width`: semiancho (s) del tramo lento (por defecto 18 % del total). */
export interface Ramp {
  from: number
  to: number
  at?: number
  slow: number
  width?: number
}

/** V6 · el portátil: la cámara por claves (en segundos del vídeo, por encima de los cortes) y el cuarto. */
export interface Laptop {
  keys: LaptopKey[]
  /** Rampas de velocidad de la cámara (segundos del vídeo): las claves van en el tiempo de la cámara. */
  ramps?: Ramp[]
  /** Revelación: el icono del prólogo ES la pantalla. De `t` a `t + dur` la pantalla enseña el icono sobre el papel (al
   *  tamaño y en el sitio del final del prólogo) y, en su último 45 %, funde a la app; mientras, la pantalla puede llenar
   *  más que el cuadro (la cámara empieza dentro de ella y se aleja). */
  reveal?: { t: number; dur: number }
  /** Cierre: el gesto inverso. De `t` a `t + dur` la pantalla funde de la app al icono sobre el papel (en su primer
   *  45 %) mientras la cámara entra en ella; desde `t + dur`, el final (`finale`) sigue con el icono ya en su sitio. */
  close?: { t: number; dur: number }
  /** Campo de visión vertical (grados; por defecto 26 en apaisado y 30 en vertical o cuadrado). */
  fov?: number
  /** Supermuestreo del render 3D (por defecto 2: el texto de la pantalla sale nítido). */
  supersample?: number
}

/** Cartelas de capítulo: número, título, subtítulo y la fila de capítulos con el actual en ladrillo. */
export interface Chapters {
  names: string[]
  cards: { t: number; dur: number; n: number; sub?: string }[]
}

/** Gancho: materiales dibujados (hojas, diapositivas, PDF, fotos de pizarra, iconos pintados) que flotan en profundidad y
 *  convergen hacia el centro en `converge`. */
export interface Hook {
  start: number
  end: number
  converge: [number, number]
  seed?: number
  /** Cuántos materiales (por defecto 26). */
  count?: number
  /** Zona que los materiales dejan libre [x, y, ancho, alto] (fracciones). Por defecto, la caja del rótulo `type` activo
   *  con un margen del 8 %. */
  clear?: [number, number, number, number]
}

/** La ola de iconos: rejilla de los iconos pintados que entran en diagonal en `dur` s y se quedan hasta `end`. */
export interface IconWave {
  t: number
  end: number
  /** Cuánto tarda la ola en cruzar (por defecto 1,2 s). */
  dur?: number
  /** Compañeros mezclados con los iconos (por defecto sí). */
  companions?: boolean
  /** Zona del cuadro que ocupa la rejilla [x, y, ancho, alto] en fracciones (por defecto, centrada en el 90 × 80 %). */
  area?: [number, number, number, number]
}

/** Un efecto que el motor no ve por sí solo (un número que cuenta, un impacto, una ola de iconos…), para la hoja. */
export interface SfxCue {
  t: number
  type: CueType
  intensity?: number
  pan?: number
  note?: string
}

export type CueType = 'click' | 'whoosh' | 'word' | 'underline' | 'card' | 'light' | 'impact' | 'icon' | 'type' | 'count' | 'flash' | 'logo' | 'rise' | 'brush'

/** Sección de la banda sonora (la marca el montaje). */
export interface Section {
  t: number
  name: string
  mood: 'intro' | 'drop' | 'day' | 'night' | 'build' | 'outro'
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
  /** V5: el WAV de la banda sonora generada (SOUND, scripts/video/sound/): suena tal cual (música y efectos), con la
   *  misma sonoridad y el mismo pico del máster. Ruta absoluta o relativa a scripts/video. */
  wav?: string
  /** V5: segundo del vídeo del primer tiempo fuerte (rejilla sintética de `bpm`). */
  offset?: number
  /** V6: el WAV suena tal cual, sin renormalizar ni limitar (la banda del v3 ya sale a su nivel); la sonoridad y el pico
   *  verdadero solo se miden tras el AAC. */
  asIs?: boolean
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
  /** El icono entra con muelle (escala de 0,6 a 1 con rebote) desde `start`. */
  spring?: boolean
  /** [desde, hasta] (s): el arco se PINTA de un trazo sobre la losa de papel (y luego el horizonte), como gancho desde el
   *  primer fotograma; el sol sale después, con `rise`. */
  draw?: [number, number]
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
  /** V5: cuándo entra el título letra a letra (por defecto, el golpe del logo: rise[0]). */
  titleAt?: number
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
  /** V6 · el portátil en 3D (los planos con `layout: { kind: 'laptop' }` se ven en su pantalla). */
  laptop?: Laptop
  /** V5 · titulares keynote en apaisado: cuerpo mínimo (fracción del alto; por defecto 0,08) y líneas máximas al partir
   *  (por defecto 3). Los cortos 16:9, con palabras enormes: { min: 0.11, maxLines: 4 }. */
  keynote?: { min?: number; maxLines?: number }
  /** Duración mínima de un rótulo para el lint (s; por defecto 2 compases). La versión corta: 1,2. */
  minTitle?: number
  /** Tamaño máximo del máster (MB): sin `bitrate`, se calcula para caber (redes: 30). */
  maxMB?: number
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
  /** Bandas de rótulos arriba y abajo (px; para el vertical y el cuadrado): la ventana vive entre ellas y los rótulos
   *  `paint` con `band` van centrados en ellas. `fill`: «ventana entera» = la altura del hueco (la ventana puede salirse
   *  por los lados; la cámara la mueve sin dejar papel a los lados). */
  bands?: { top: number; bottom: number; fill?: boolean }
  /** Zonas seguras (px desde cada borde) que tapa la interfaz de la red (TikTok/Reels/Shorts: arriba ~220, abajo ~25 %,
   *  derecha ~140): los rótulos `paint` con `band` van en la parte visible de su banda y dentro del ancho seguro, y el
   *  centro por defecto de la cámara se aparta de la derecha. */
  safe?: { top?: number; bottom?: number; left?: number; right?: number }
  /** Con captionBand: si la ventana no cabe sobre la banda (primer plano), su borde de abajo se apoya en la banda. */
  captionPin?: boolean
  /** V5: cartelas de capítulo. */
  chapters?: Chapters
  /** V5: el gancho de materiales que flotan. */
  hook?: Hook
  /** V5: la ola de los iconos de curso pintados (los 58 de la app) que aparecen en diagonal, con muelle. */
  iconWave?: IconWave
  /** V6 · personajes que se dibujan a pincel (en el aire, junto a un titular, a pantalla completa o en grupo). */
  drawings?: Drawing[]
  /** V6 · cámara lenta con rampa de los efectos del compositor (gancho, sol del prólogo, ola de iconos y dibujos). */
  slowmo?: Ramp[]
  /** V5: destellos (instantes). */
  flashes?: number[]
  /** V5: secciones de la banda sonora (las lee SOUND en la hoja de efectos). */
  sections?: Section[]
  /** V5: efectos que el motor no ve solo (contar, impactos, olas de iconos…). */
  sfx?: SfxCue[]
  /** Adornos de pintura que caen en el ritmo (con mesura): salpicaduras, subrayados, rodeos y trazos sueltos. */
  paint?: PaintMark[]
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
