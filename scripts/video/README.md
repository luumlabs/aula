# Vídeo de Aula: cadena de render

> *Developer notes for the pipeline that renders Aula's film from the real app. Like the code comments, they're in
> Spanish; the film itself and everything user-facing are in English.*

Hace el vídeo con la **interfaz real** de Aula, capturada fotograma a fotograma con tiempo virtual. Luego la compone
(cámara, titulares serif, el sol de Aula, transiciones, cursor), le pone **música sintetizada** y la codifica en un
**MP4 H.264 High + AAC con faststart**, que se reproduce en el iPad, en Safari y en el README de GitHub.

No usa Swift ni ffmpeg, y no añade dependencias: solo Playwright, esbuild (viene con vite) y Electron, que ya están.

```sh
npm run build                                                   # o usa --app tree / --app HEAD
node scripts/video/render.ts scripts/video/montage/demo.ts      # demo de ~13 s → scripts/video/work/demo/demo.mp4
node scripts/video/render.ts scripts/video/montage/demo.ts --app HEAD --verify   # + determinismo
npx vitest run --config scripts/video/vitest.config.ts          # pruebas (muxer, sonoridad)
npx tsc -p scripts/video/tsconfig.json                          # tipos
node scripts/video/render.ts --probe                            # qué admite este equipo (H.264/AAC, cebado del AAC)
```

**Opciones**

| Opción | Qué hace |
|---|---|
| `--app out\|tree\|HEAD\|<commit>` | Qué compilación se captura. `out` es la de `out/`. `tree` compila el árbol actual en una carpeta propia. Con un commit, extrae esa versión de git y la compila aparte; vale aunque el árbol esté a medias. |
| `--only capture\|compose` | Hace solo ese paso. Las tomas quedan en caché por huella (guion de la toma + compilación). |
| `--outputs master,tour-1` | Qué salidas componer. Por defecto, el máster y todas las de `montage.outputs`. |
| `--draft` | Borrador rápido: solo el máster, a 1280×720 y 30 fps. |
| `--range 3:8` | Compone solo ese tramo del máster, en segundos. |
| `--stills 2.5,7` | Guarda esos instantes del máster como PNG en `work/<montaje>/stills/` (póster, miniaturas). |
| `--jobs 3` | Captura varias tomas a la vez. |
| `--soft` | Si el objetivo de una acción no aparece, apunta un aviso y sigue (borradores). También `soft: true` por acción. |
| `--out carpeta` | Copia los MP4 ahí. |
| `--verify` | Captura cada toma dos veces y compone dos veces. Lo compara todo. |

**Salidas** (en `scripts/video/work/<montaje>/`, que git ignora)

- `<montaje>.mp4` (el máster) y un MP4 por cada salida de `montage.outputs`;
- `<salida>-contactos.png`: una miniatura cada 0,5 s (cada 2 s si el vídeo pasa de 40 s);
- `qc.json`: el informe de calidad;
- `cues.json`: la cinta de cues (cortes, clics, titulares y cues de música, en segundos);
- `takes/<toma>/`: los PNG de cada toma con su `meta.json` (cursor y cajas de las marcas por fotograma).

La app congelada y las versiones de git extraídas van a `$TMPDIR/aula-video-cache`, fuera del repo.

## Película v2: pista real, rejilla y transiciones

**La pista real.** «South Waves» (Mixkit) nunca entra en el repo, por su licencia.

- Se lee de `AULA_FILM_MUSIC` (la ruta del MP3 de la pista; sin ella, de la carpeta local del mantenedor, fuera del repo:
  `DEFAULT_TRACK` en `audio/track.ts`).
- CoreAudio la decodifica (`afconvert`) a WAV de 48 kHz en `$TMPDIR/aula-video-cache/music/`. El análisis y el render
  usan **el mismo** decodificador, así que la rejilla cae donde suena.
- `node scripts/video/render.ts --analyze [pista.mp3]` escribe `music/<pista>.grid.json`, que solo contiene números:
  - BPM afinado a la milésima (114,996);
  - primer tiempo fuerte;
  - energía, graves y novedad por compás;
  - secciones propuestas.
- En el montaje:
  - `import grid from '../music/south-waves.grid.json' with { type: 'json' }`;
  - `const G = filmGrid(grid, [[57, 73]], grid.downbeat - grid.beat)`, que quita compases enteros de la pista
    [desde, hasta) y arranca un pulso antes del compás 1, sin el silencio inicial;
  - `G.V(compás, pulso, fracción)` da los segundos del vídeo, y además hay `G.snap(t)`, `G.duration`, `G.bars` y
    `G.cuts`;
  - `music.track = { grid, cuts, start }`.
  - La película acaba 0,8 s después de la última nota (no en el silencio del archivo).
  - `G.sections` da los compases del vídeo donde cambia la música (respiro, vuelta, cierre), compás a compás.
- Al componer, la pista se monta por tramos con fundidos cruzados de 30 ms en el pulso y acaba en su final real.
  Clics y personajes van por debajo (`clicks` y `sfx`, en dB; para la v2, −20). El conjunto se normaliza a −14 LUFS y
  ≤ −1,5 dBTP MEDIDO TRAS EL AAC (cada salida se codifica, se decodifica y, si pasa de −1,65, se vuelve a limitar desde
  la mezcla con el techo más bajo; el QC lo comprueba en el archivo). Las salidas de menos de 1 s (póster) van sin
  sonido. El limitador baja en rampa (8 ms de anticipación) y vuelve
  en 250 ms, sin escalones ni bombeo.
- Si falta la pista, se avisa y suena la música sintetizada.

**Transiciones** (`clip.enter`).

- `content` (≤ 0,25 s): la ventana se queda quieta y solo funde su contenido. El plano anterior sigue debajo aunque ya
  haya acabado. Si la cámara del plano nuevo es otra, llega a ella con la curva única.
- `match` (`from: 'mark:a'`, `to: 'mark:b'`): corte por coincidencia. El elemento del plano nuevo arranca en el sitio
  del elemento del anterior, con su escala dentro de ×/÷1,6, y vuelve a su cámara en `dur`. Si los tamaños son muy
  distintos, conviene acercar antes la cámara del primer plano al elemento.
- Zoom que sigue a un elemento: claves con `focus: 'mark:x'`. La marca se suaviza (`lag`, 0,2 s por defecto) para que la
  cámara no tiemble.
- Día y noche: `paper` cambia el fondo de forma continua (OKLab). Los rótulos, el sello y la marca mezclan su color con
  él.
- `theme` (en un pulso fuerte): de claro a oscuro sin «fotograma gris».
  - La VENTANA entera cambia de tema en `window` s (por defecto 5 fotogramas) justo en el pulso; nunca se ven dos
    contenidos a medias más de 4 fotogramas.
  - El papel del fondo y los rótulos cambian en `dur` (2 pulsos).
  - El plano A acaba en el último fotograma claro y el B (misma toma, con `from` pasado el cambio) entra con
    `{ kind: 'theme', dur: 2 * G.beat }`.
  - El papel y los rótulos siguen esos 2 pulsos si no hay claves de `paper`.
  - Un `content` de más de 0,25 s se marca en el lint: para claro↔oscuro, `theme`.
- `icon`: el primer plano nace del icono del prólogo.
  - La losa crece y se convierte en la ventana, que es el gesto del final al revés.
  - La app entra solo al final, ya dentro del marco.
  - `prologue.grow` (p. ej. 0,94) hace crecer el icono mientras sale el sol, y el icono ya está en el primer fotograma.
- En `content` y `theme`, el plano anterior queda quieto en su último fotograma: sirve para tapar una transición de la
  app cortando la toma en el clic.
- Final: `finale.morph` es la duración de la reducción ventana → icono (~1 compás). El final parte de la ventana del
  último plano aunque ese plano ya haya acabado.
- `captionBand` (p. ej. 950): banda de rótulos en el papel, bajo la ventana.
  - La ventana descansa entre 40 px y la banda, y no baja de ella ni cuando la cámara se acerca.
  - Los pies se centran en la banda: nunca tapan la app.
- Las transiciones `sunrise`, `door`, `iris` y `rise` siguen existiendo, pero el revisor del guion avisa si se usan.

**Cámara.**

- Hay una única curva, `smooth` (smootherstep: sin rebote, velocidad nula en los extremos). Es la de todas las claves
  salvo que una pida otra.
- `montage.cameraEase` la cambia para todo el montaje.

**Rótulos.** Gesto `calm` por defecto: entran y salen igual (350 ms, fundido y 8 px). Con `gesture: 'words'` vuelven a
entrar palabra a palabra.

**Revisión.**

- Cada render pasa `lintMontage`, que avisa de:
  - zoom de más de 1,5× la ventana entera;
  - claves, cortes y rótulos fuera del pulso;
  - rótulos que se pisan o que duran menos de 2 compases;
  - transiciones viejas;
  - una duración que no cuadra con la pista;
  - claves de cámara desordenadas, dos movimientos sin respiro o un movimiento en el mismo pulso que un fundido;
  - un cambio de tema que no dura 2 pulsos o no empieza en un pulso fuerte;
  - un rótulo que tapa la acción (el cursor pasa bajo el pie).
- `--strips` (o `--strips 12.5,30`) hace tiras de 31 fotogramas (±1 s a 15 fps) alrededor de cada transición, en
  `work/<montaje>/strips/`, junto a `strips.json`. Indica el salto máximo entre fotogramas y si hay fotogramas
  planos. Reutiliza las tomas ya capturadas; `--reuse` hace lo mismo en un render normal.
- El control de calidad del render marca como problema cualquier fotograma plano (gris, blanco o a medio cargar).

Ejemplo de todo: `montage/demo3.ts`.

## V5: composición keynote, transiciones de luz y hoja de efectos

Ejemplo de todo sobre las tomas de la película (sin recapturar): `work/v5-demo.ts` (con `V5_FMT=v`, en vertical).

- **Ritmo sin mp3:**
  - `music: { bpm, offset, wav?, root, cues: [] }` con `bpmGrid(bpm, duración, offset)` (en `montage/grid.ts`), que
    tiene el mismo interfaz que `filmGrid`: `V`, `snap`, `beat` y `barDur`.
  - `music.wav` es la banda sonora de SOUND: suena tal cual, con el mismo máster (−14 LUFS y ≤ −1,5 dBTP tras el AAC).
- **Plano keynote:** `clip.layout = { kind: 'keynote', side: 'left' | 'right', size?, height?, tilt?, float? }`.
  - La interfaz va en un panel (64 % del ancho por defecto), con sombra suave, una inclinación 3D de verdad (perspectiva
    en franjas) que se mueve despacio, y flota.
  - La cámara de siempre (zoom y focus) elige qué parte de la ventana se ve dentro del panel, y `screen` va en
    fracciones del panel.
  - `{ kind: 'detail' }` hace que el panel llene el cuadro (primer plano muy cerrado). En el lint, estos planos pueden
    acercar hasta 2,6× la ventana entera.
  - En vertical, el panel va abajo y el titular arriba.
- **Rótulos:**
  - `style: 'keynote'` (con `side`): titular serif grande al lado contrario del panel.
  - `style: 'type'`: tipografía a pantalla completa.
  - Las palabras suben una a una desde detrás de una máscara (`WORD_STAGGER`, `WORD_DUR`). La de *cursiva* va en
    ladrillo y lleva un subrayado a pincel discreto al acabar; luego entra el subtítulo.
- **Transiciones** (`clip.enter.kind`):
  - `'whip'`: barrido con desenfoque de movimiento de obturador de 180° (`whipBlur`: lo que se mueve el plano en medio
    fotograma, según los fps del montaje).
  - `'focus'`: rack focus; el plano que sale se desenfoca y se apaga mientras el nuevo se enfoca.
  - `'light'` con `style`: `dusk` (de arriba abajo), `dawn` (círculo desde `at`), `arch` (portal con el arco), `horizon`
    (sube) o `diagonal`. El plano nuevo entra con su papel dentro de la forma, y la tinta de los rótulos sigue al papel.
  - `'shape'` con `from`, `to` y `shape` (`circle`, `sun` o `arch`): un corte por coincidencia de forma; la forma viaja
    y cambia de tamaño, y el corte cae a mitad, bajo ella.
- **Cartelas:** `montage.chapters = { names, cards: [{ t, dur, n, sub }] }`, con número, título, subtítulo y la fila de
  capítulos (el actual en ladrillo).
- **Gancho:**
  - `montage.hook = { start, end, converge: [t0, t1], seed, count }`: hojas, diapositivas, PDF, fotos de pizarra,
    notas y fichas de color en profundidad, con paralaje y desenfoque de los lejanos, que convergen.
  - `montage.flashes: [t]`: un destello.
  - `prologue.spring: true`: el icono entra con muelle.
- **Hoja de efectos:**
  - `render.ts <montaje> --only cues` (y cada render) escribe `work/<montaje>/cuesheet.json` con `bpm`, `offset`,
    `beat`, `bar`, `sections` (de `montage.sections`) y `events: [{ t, type, intensity, pan, note }]`.
  - Lleva los clics (con el paneo del cursor), un tic por carácter escrito, la entrada de cada plano (whoosh según la
    transición) y los movimientos de cámara.
  - También cada palabra de cada rótulo, las cartelas, las luces, los destellos (con su subida) y el icono y el logo.
  - Se le suma `montage.sfx` (count, impact, icon…).
- **El reparto de verdad:** `compose/cast.ts` pinta en el compositor los 58 iconos de curso y los compañeros con el motor
  de la app (`design/pixel/brush`: rigs, painter y `paintFrame`), sin capturar la galería.
  - El gancho mezcla iconos y compañeros con los papeles.
  - `montage.iconWave = { t, end, dur?, companions?, area? }` es la ola en diagonal con muelle; en la hoja de efectos
    da 10 golpes de «icon».
- **Papel y luz (V5):** detrás de todo, una luz crema que se mueve despacio y un resplandor ladrillo que respira; de
  noche, una lámpara cálida y una brasa. Solo crema y ladrillo.
- **Titulares V5:** peso 600; en keynote, ~0,105 del alto (casi un tercio en dos o tres líneas); en vertical, el 11,5 %
  del ancho.
  - Cuerpo mínimo keynote: `KEYNOTE_MIN` (8 % del alto). El cuerpo baja desde el de su estilo solo lo justo para que el
    titular parta limpio (tres líneas como mucho, sin una palabra corta sola: nunca «Filled / in.»); si a cuerpo mínimo
    no cabe, se estrecha el panel de ese plano (`clipPanelRect`, hasta `PANEL_MIN` = 0,52), no el texto. Si ni así
    parte limpio, el panel se estrecha lo justo para tres líneas (o para la palabra más larga). En el compositor se mide
    con la serif real (`setWordMeasure`); en Node, con `estimateWidth`.
  - Por montaje: `montage.keynote = { min?, maxLines? }` (por defecto 0,08 y 3). Los cortos 16:9, con palabras enormes:
    `{ min: 0.11, maxLines: 4 }`. Solo en apaisado: la película no lo lleva y el 9:16 y el 1:1 no lo usan.
  - Un titular que sigue en pantalla en el plano siguiente: los paneles de los dos le dejan sitio y su columna es la que
    cabe en todos.
  - Líneas equilibradas (`balanceBreaks`): la más larga lo más corta posible y castigo a la palabra corta suelta.
  - El titular pertenece al plano que empieza con él (`titleHost`), no al anterior que acaba en ese instante.
  - Espera a que la transición deje de enseñar el plano viejo (`transitionClear`): `focus` 85 %, `whip` 60 %,
    `shape` 55 %, y cualquier otra entrada (`content`, `light`, fundidos…) entera; solo `cut`/`match` no esperan.
    `title.overlap: true` lo desactiva.
- **Comprobaciones sin pisar a nadie:** para componer sobre las tomas de otro montaje, clónalas (`cp -Rc` en APFS) en
  `work/<tu-montaje>/takes` cuando su captura haya terminado (nunca un enlace a sus tomas) y lanza el render con
  `AULA_VIDEO_NO_WORLDS=1`: importar el montaje no reescribe `work/worlds*` y ninguna toma se regraba ni se borra (si
  falta una, el render falla en vez de capturar).
- **Cartelas con vida (V5):** el número y el título derivan en paralaje (sentidos opuestos), la luz del papel respira,
  la fila de capítulos avanza despacio y el capítulo actual se enciende al entrar.
- **QC:** escaneo de saltos entre fotogramas (salto medio de luma). Los destellos no cuentan como fotogramas planos.
- **Determinismo:** componer dos veces el muestrario da los mismos fotogramas byte a byte.

## V6: el portátil

La app vive dentro de un portátil genérico en 3D (sin marca), al estilo de los vídeos de producto: la cámara gira a su
alrededor y se acerca a la pantalla, y la ventana de Aula se ve siempre entera. Ejemplo: `montage/v6-laptop.ts` (12 s;
con `V6_FMT=v`, en 9:16).

- **Geometría pura** (`montage/laptop.ts`, con sus pruebas): medidas, tapa, pantalla, cámara, proyección y huecos.
- **Render** (`compose/laptop.ts`): three, solo en la página del compositor.
  - Aluminio cálido, teclado sugerido, trackpad y cristal negro, con sombra de contacto y la de la luz principal.
  - La pantalla es emisiva y sin tono: muestra la captura a 2 px/pt, con sus colores tal cual y un reflejo leve.
  - Se supermuestrea (`laptop.supersample`, 2 por defecto) para que el texto salga nítido.
- **Planos:** `layout: { kind: 'laptop' }`. Todos comparten la cámara de `montage.laptop`, en tiempo del vídeo, así que
  un gesto sigue aunque cambie la toma. `content` funde dentro de la pantalla y el marco (`frames`) va en ella.
- **Cámara:** `montage.laptop.keys`, con `{ t, yaw, pitch, fill | frame | dist, at, screen, lid }`.
  - Cada canal se interpola solo entre las claves que lo dan, con una cúbica monótona (sin rebote).
  - `fill`: lo que ocupa la pantalla del cuadro. `frame`: lo que ocupa el portátil del ancho. Las dos se resuelven con
    la pose de su clave.
  - `screen`: dónde cae en el cuadro el punto mirado (desplazamiento de objetivo).
  - `lid`: apertura de la tapa (0 = cerrada; `LID_OPEN` = 108). La pantalla se enciende entre 70° y 100°.
  - Una clave con `t` < 0 hace que el plano ya se mueva en el fotograma 0.
  - **Guarda:** si una clave cortara la pantalla, la cámara se aleja lo justo. El lint avisa, y las pruebas exigen que
    no haga falta.
- **Vistas del guion:** `laptopView(m, '3/4-right' | '3/4-left' | 'front' | 'screen', over?)` da la clave.
  - 3/4: el portátil a un lado, girado hacia el hueco del titular.
  - `screen`: de frente a la pantalla, que llena el cuadro (0,962 del alto en 16:9; 0,975 del ancho en 9:16).
  - En vertical y en cuadrado, el portátil va abajo y a lo ancho, y el titular arriba.
- **Titulares:** un `keynote` en un plano del portátil va en el hueco que este deja libre durante todo el titular
  (`laptopTitleRect`), nunca encima.
- **Hoja de efectos:** la tapa (`lid open`) y cada empujón o vuelta (`whoosh` con `note: 'camera'`, `style: 'push' |
  'pull'` y `dur`). Una órbita lenta no suena.
- **Música tal cual:** con `music.asIs`, el WAV no se renormaliza ni se limita. La sonoridad y el pico solo se miden
  tras el AAC, y el QC pide ≤ −1,5 dBTP (lo que pidió SOUND).
- **La prueba** (sobre clones de las tomas de la película, sin recapturar):

```sh
AULA_VIDEO_NO_WORLDS=1 node scripts/video/render.ts scripts/video/montage/v6-laptop.ts --reuse --only cues
node scripts/video/sound-v3/excerpt.ts scripts/video/work/v6-laptop-h/cuesheet.json scripts/video/work/v6-laptop-h/soundtrack.wav
AULA_VIDEO_NO_WORLDS=1 node scripts/video/render.ts scripts/video/montage/v6-laptop.ts --reuse --outputs laptop-test-16x9
```

- **De noche** (papel oscuro): lámpara de mesa cálida y baja a la izquierda, el cuarto apagado y la pantalla que alumbra
  el teclado. Sale sola del papel del plano: un plano con toma oscura es de noche.
- **Luces de capítulo** (`enter: { kind: 'light', style }`) en un plano del portátil: dentro de la forma entra el cuarto
  nuevo entero (papel, luz del portátil y la app con su tema); fuera sigue el viejo.
- **Dentro de la pantalla:** el aviso de macOS (`notices`, a la escala de la captura) y el marco (`frames`: macOS,
  Windows o GNOME, uno por pulso si se quiere). Con un portátil en cuadro, el aviso ya no sale en el cuadro.
- **El icono ↔ la pantalla:**
  - `laptop.reveal = { t, dur }`: el icono del final del prólogo ES la pantalla. Pon en `t` una clave
    `{ ...laptopView(m, 'screen'), fill: 2.1 }`: la pantalla, mayor que el cuadro, enseña el papel con el icono en su
    sitio, y la cámara se aleja. La app entra en el último 45 %.
  - `laptop.close = { t, dur }`: el gesto inverso. Pon en `t + dur` la misma clave de `fill: 2.1`; el `finale` empieza
    en `t + dur` con el icono ya en su sitio (sin la reducción ventana → icono).
  - En esos tramos la guarda no actúa (la pantalla puede llenar más que el cuadro).
  - Sin `close`, si el último plano es del portátil, la ventana del `finale` que se encoge parte de donde está la
    pantalla 3D, y el portátil se apaga debajo en 0,35 s (sin salto a una ventana 2D).
- Ejemplo de todo esto: `montage/v6-s3.ts` (14,4 s).

## V6: personajes que se dibujan a pincel

Los compañeros y los iconos de curso de la app aparecen trazándose a pincel, trazo a trazo, con el pintor de la app
(`design/pixel/brush`). El pintor admite un dibujo a medio hacer: `PaintTarget.reveal`, más `scenePieces` y
`boardPieces` (piezas en el orden en que se pintan). Sin `reveal`, pinta igual que siempre (prueba bit a bit en
`brush.test.ts`).

- **Campo:** `montage.drawings: [{ who, t, dur?, until?, at, size, tone?, after?, ramps? }]`.
  - `who`: `companion:<id>` (luna, gato, zorro, buho…) o `icon:<id>` (study, math, calculus…).
  - `at`: centro (fracción del cuadro). `size`: lado (px).
  - `at: 'gap'`: en el hueco libre que deja el portátil durante todo el dibujo (bajo el titular de su lado; en
    vertical, en la banda de arriba), en fila con `slot: [i, n]`. Con `side` eliges el lado; si no, el de más hueco.
  - `after`: `boil` (por defecto, la línea hierve 8 dibujos por segundo), `alive` (además su historia «hover» en
    bucle) o `still`.
  - `until`: se va con un fundido de 0,3 s.
- **Orden** (`montage/draw.ts`, puro y probado):
  1. el contorno, empezando por la línea más larga;
  2. las aguadas, de mayor a menor;
  3. los detalles: ojos, boca, brillos y líneas de dentro.
  - Cada trazo dura según su largo; el pincel acelera y frena, avanza con su presión y se seca al final.
  - Las aguadas barren su mancha con el borde mojado.
- **Usos:** en el aire junto al portátil, junto a un titular, a pantalla completa (uno grande) o en grupo
  (`drawGroup({ t, who: [...], at: [...] | 'gap', side?, size, stagger })`).
- **Capa propia:** van sobre el papel, las cartelas y el final, y bajo los titulares.
  - No pisan el texto que se ve mientras tanto: el de las cartelas (número, título, subtítulo y fila de capítulos), el
    del final (icono, «Aula» y lema) y los titulares keynote/type.
  - Si su caja lo toca, van al sitio libre más cercano dentro del cuadro (`clearOfText`), fijo durante todo el dibujo,
    sin saltos.
  - Comprobación: `montage/v6-draw-over.ts`.
- **Hoja de efectos:** un evento `brush` por trazo (`note`: outline, fill, detail o done; con `dur`) y `accent: true`
  en el primer trazo y al acabar. La banda del v3 convierte esos acentos en el destello de marimba (`timeline.ts`).
  - Node lee las piezas con `compose/drawn-kit.ts`, empaquetado por esbuild.
- **Ejemplos:** `montage/v6-draw.ts` (sin tomas) y `montage/v6-round2.ts`.

## V6: cámara lenta de verdad

- **Rampa:** `{ from, to, at?, slow, width? }` (`montage/ramp.ts`).
  - Entre `from` y `to`, el tiempo corre rápido, a `slow` alrededor de `at` y rápido otra vez.
  - En `from`, `at` y `to` todo va a su hora (lo de fuera no se mueve), con velocidad 1 en los extremos y sin tirones.
- **Dónde va:**
  - `clip.ramps` y `clip.speed` (número): sobre el tiempo de la toma.
  - `laptop.ramps`: sobre el tiempo de la cámara (las claves van en ese tiempo).
  - `drawing.ramps`.
  - `montage.slowmo`: gancho, sol del prólogo, ola de iconos y dibujos.
  - Con la misma rampa en el plano y en la cámara, todo el cuadro va a cámara lenta.
- **Tomas a alta frecuencia:** `take.fps` (p. ej. 250, pasos de 4 ms exactos del reloj virtual). A 0,25×, cada
  fotograma del vídeo avanza 1,04 de la toma; el compositor mezcla los dos fotogramas vecinos, así que no hay repetidos
  ni tirones.
  - La captura es la de siempre (oculta, `AULA_HIDDEN`, `AULA_HOME` temporal): unos 120 ms por fotograma.
  - Con `AULA_VIDEO_NO_WORLDS=1` no se captura nada: la primera vez lanza solo `--only capture --reuse`, con un
    montaje que no importe la película.
- **Los clics y los eventos de las tomas** se colocan donde los enseña la rampa (`clipLocalOf`).
- **Ejemplo:** `montage/v6-round2.ts`, con la toma `lesson` a 250 fps y el mundo de la V5 clonado en
  `work/v6-tec2-world`.
- **Tomas a 250 fps ya hechas** (`montage/v6-hfr.ts`, en `work/v6-tec2/takes`):
  - `lesson`: el acierto que se pone verde, de noche (el clic, a 5,25 s).
  - `nacl`: la sal en 3D, de día (visible de 2,9 a 6,6 s).
  - Para usarlas: `cp -c -R` a `work/<montaje>/takes`, importa `lessonTake` o `naclTake` como spec y lanza con
    `--reuse`.

## Banda sonora del v3: `sound-v3/` (la del V6)

Es el sintetizador del vídeo v3 (13-10): `Audio.swift` del commit `dfcb4e1` de la app Swift, con su timbre, acordes,
mezcla y efectos intactos. Al dueño le gusta **ese** sonido tal cual. Solo corre en macOS, porque compila con `swiftc`.

```sh
node scripts/video/sound-v3/render.ts work/<montaje>/cuesheet.json work/<montaje>/soundtrack.wav
node scripts/video/sound-v3/render.ts scripts/video/sound-v3/v3.timeline.json v3.wav     # la película del v3
node scripts/video/sound-v3/fidelity.ts v3.wav ref/aula-intro-web.mp4 --hits scripts/video/sound-v3/v3.timeline.json --png fid.png
```

- **Archivos:**
  - `original/`: el `Audio.swift` original, sin tocar, y el `Beat`/`Timeline` de su `Story.swift`, para la prueba.
  - `Audio.swift`: el mismo, con los instantes que estaban escritos a mano para la película del v3 leídos de
    `Timeline`. Son 30 líneas.
  - `Timeline.swift`: la línea de tiempo leída de un JSON.
  - `main.swift`: escribe el WAV de 48 kHz en flotante (con `--s16`, de 16 bits).
- **Prueba de fidelidad** (`timeline.test.ts`): con `v3.timeline.json`, el WAV es idéntico bit a bit al del original.
- **Hoja del montaje → línea de tiempo** (`timeline.ts`):
  - Lo que exige el original:
    - el compás 1 en t = 0;
    - el drop («Meet Aula») entre los compases 2 y 4, porque su intro tiene a lo sumo 3 acordes;
    - mejor el logo al principio de un compás.
  - De dónde sale cada cosa:
    - Las cartelas dan la campana y el compás en suspenso.
    - Las luces dan los barridos, que además abren o cierran el filtro del colchón.
    - Los clics dan su tic.
    - Los subrayados y los conteos son los acentos.
    - Las entradas de plano son los cortes.
    - Las palabras del gancho dan las campanitas.
    - Tres iconos seguidos o más dan el arpegio.
    - El logo da el golpe grave, el acorde de campanas y las notas del cierre.
- **Nivel:** sale a −15 LUFS y unos −1,4 dBTP, como el original. Para que suene tal cual, el compositor no debería
  renormalizarlo a −14.

## Banda sonora original: `sound/`

Música y efectos compuestos por código para la imagen, herederos de `Audio.swift` del v3. Es TypeScript puro en Node
(sin `OfflineAudioContext` ni dependencias), así que se prueba con vitest y da los mismos bytes en cada render.

```sh
node scripts/video/sound/render.ts work/aula-v5-film/cuesheet.json work/aula-v5-film/soundtrack.wav --png sound.png
node scripts/video/sound/render.ts demo:film demo.wav --png demo.png --report demo.json --sheet demo.cues.json
npx vitest run --config scripts/video/vitest.config.ts sound/
```

- **Entrada:** una hoja de efectos.
  - Puede ser la del montaje (`work/<montaje>/cuesheet.json`), que se traduce sola (`fromMontage` en `sound/sheet.ts`).
  - O la v1 propia: `{ version: 1, duration, bpm, downbeat?, key?, mode: 'film' | 'short', sections: [{ bar, kind,
    chords?, energy? }], events: [{ t, type, intensity?, pan?, dur?, … }] }`.
  - Los tipos están en `sound/sheet.ts`. `t` es el inicio de lo que se ve y `dur` lo que dura.
- **Salida:** WAV estéreo de 48 kHz en flotante de 32 bits, con música y efectos ya mezclados, a −14 LUFS y ≤ −2,5 dBTP
  (el AAC sube hasta ~0,7 dB). Opcionalmente, también:
  - `--png`: la lámina de revisión, con el espectrograma de la mezcla, las secciones con sus acordes y una fila por tipo
    de efecto, con su tiempo en la hoja y el golpe medido.
  - `--report`: el informe en JSON (acordes por compás, dónde cayó cada efecto, si se oye y niveles).
- **Forma de canción** (`sound/harmony.ts` y `sound/arrange.ts`), en re mayor salvo que se diga otra cosa:
  - `intro`: tensión (Bm – G – Em7 – A) con el tic-tac del reloj del examen y un latido.
  - `drop`: un respiro de media negra, la subida, el golpe, el ritmo entero y el motivo de Aula (la – re – mi – fa#) en
    campanas.
  - `day` y `night`: cada tanda es una variante, para que no se repita el mismo bucle.
    - Día: A (I–V6–vi–IV, marimba del v3), B (vi–IV–I–V, con más brillo), C (calmado, a medio tiempo) y D (vuelve el
      himno, a negras).
    - Noche: piano eléctrico FM, filtro cerrado, medio tiempo y sub. B lleva bombo sincopado y arpegio; C, casi nada.
  - `card`: un compás en suspenso que prepara el acorde siguiente.
  - `rise`: suena como el día a tope y deja el redoble para los dos últimos compases.
  - `end`: re (golpe del logo), sol/re (plagal) y re con campanas hasta el final.
  - `mode: 'short'` (≥ 114 BPM): bombo a negras, palmas con caja, semicorcheas, bajo sintetizado y pluck.
  - **Carácter:** la película se ciñe al perfil del v3, que es la referencia que le gusta al dueño.
    - Bajo senoidal en la octava 3, bombo redondo, shaker y rim, sin hats.
    - El colchón a ~2,3 kHz de día, y −6 dB por encima de 4,5 kHz.
    - Subgraves y brillo solo en el *drop* y la subida (`boostCurve` y `ride`). El corto va siempre a tope.
    - `node scripts/video/sound/profile.ts a.wav b.wav` mide el perfil (bandas, centroide, golpes por segundo, LRA,
      estéreo) para compararlo con el del v3.
- **Efectos** (`sound/sfx.ts`): cada uno va afinado a la armonía de su compás y elige una nota que no esté sonando ya.
  - Si cae a −30/+60 ms de una semicorchea, se encaja en ella.
  - Las palabras de un rótulo se mueven juntas, así que el escalonado de la imagen se respeta.
  - Palabras:
    - Un tic por palabra solo en los rótulos `type`.
    - En los keynote, un único acento (el roce del pincel y una nota) cuando empieza el subrayado de la cursiva
      (evento `underline`).
    - Si la hoja no lo marca, lo adivina por la intensidad.
  - Los movimientos de cámara pequeños no suenan.
  - Los niveles por tipo están en `TYPE_DB`.
  - Además, la música se aparta bajo cada efecto: unos −3 dB en general y −6 dB lo melódico.
  - La forma añade lo que falte: el golpe del drop, la subida hacia él, la campana de cada cartela y el logo.
- **Comprobaciones** (`sound/analysis.ts`):
  - Cada efecto se vuelve a sintetizar solo, para medir dónde cae su golpe.
  - Se calcula la relación efecto/música en las bandas del efecto y durante el efecto. Las pruebas exigen que los clics,
    las cartelas, los golpes y el logo pasen de +3 dB, y que ningún efecto baje de −3 dB.
- **En el compositor:**
  - `music.wav` apunta a este WAV.
  - `music.clicks = null`, porque los clics ya van dentro del WAV.
  - Para que todo caiga en la rejilla, conviene que las palabras se escalonen en semicorcheas o medios pulsos, y que la
    ola de iconos dure n semicorcheas.

## Versión corta para redes: pintura, rótulos pintados y vertical

Todo con el mismo pincel que la app (`src/renderer/src/design/paint`: silueta con presión, temblor, remate romo, hebras
secas y el ritmo de la mano), con semilla fija y como función pura del tiempo. El código está en `compose/paint.ts`; el
compositor lo recibe en `assets.paint`, porque importa el kit de la app y Node no lo carga.

- **Pincelada que barre el cuadro:** `enter: { kind: 'brush', dur, dir?, seed? }`.
  - Son 3–5 pinceladas largas de pincel seco, escalonadas, que cruzan el cuadro.
  - Cada una tiene la silueta del pincel de la app (presión variable, temblor, hebras al salir), la punta ovalada que
    avanza, rayas secas de cerdas y un poco de desenfoque de velocidad.
  - Cada trazo cruza en el 60 % del barrido, con la curva suave.
  - Ya pintado, cada trazo se convierte en el plano nuevo en ~5 fotogramas, y el papel nuevo (día ↔ noche) va dentro de
    la pintura; fuera sigue el viejo hasta que acaba.
  - Al final se completan los huecos.
  - `dir` (`right`, `left`, `down` o `up`) da el sentido. El lint pide entre 1 pulso y 1 compás.
- **Rótulos pintados:** `style: 'paint'`, grandes, en el papel y sin píldora.
  - Van en `band: 'top' | 'bottom'` (con `montage.bands`) o en `at`.
  - `size` es el cuerpo de la letra; por defecto, el 7,5 % del lado corto.
  - Con `gesture: 'brush'`, cada palabra se revela con una pincelada, cada `stagger` s (0,16 por defecto). Sale con el
    gesto calmado.
  - `underline: {}` o `ring: {}` subraya o rodea a pincel la palabra en cursiva al acabar de escribirse; también se puede
    dar `word`, `t` y `color`.
- **Adornos de pintura:** `montage.paint: [{ t, kind, at, to?, size?, dur?, draw?, color?, seed? }]`.
  - `kind` puede ser `splash`, `underline`, `ring` o `stroke`.
  - `at` es una fracción del cuadro o `mark:x`; con una marca de la toma, se rodea o subraya lo que la app enseña.
  - Se pinta en `draw` s (0,35 por defecto), se queda hasta `dur` (1,2 s por defecto) y se apaga en 0,25 s.
  - El lint los quiere en el pulso, con 2 por compás como mucho y una salpicadura por compás como mucho.
- **Prólogo pintado:** `prologue.draw: [t0, t1]`. Sobre la losa de papel, el arco se pinta de un trazo y luego el horizonte.
  El sol sale después, con `rise`. Para que el primer fotograma ya tenga pintura, conviene empezar un poco antes de 0
  (por ejemplo, −0,15).
- **Vertical y cuadrado:** `montage.bands: { top, bottom, fill? }` (px).
  - La ventana vive en el hueco entre las bandas y no se mete en ellas; las bandas quedan para los rótulos `paint`.
  - Con `fill`, «ventana entera» es la altura del hueco: la ventana se sale por los lados y la cámara elige qué parte se
    ve, sin dejar papel.
  - Ejemplo de vertical 1080×1920: `{ top: 420, bottom: 360, fill: true }`. Para 1:1 basta otro montaje con
    `size: [1080, 1080]` y bandas más bajas.
- **Zonas seguras:** `montage.safe: { top, bottom, left, right }` (px que tapa la interfaz de la red). Los rótulos con
  `band` van en la parte visible de su banda y dentro del ancho seguro, y el centro de la cámara se aparta. En vertical:
  `{ top: 220, bottom: 480, right: 140 }`.
- **Primer plano en 16:9:** con `captionPin: true`, la ventana que no cabe sobre la banda apoya en ella su borde de
  abajo.
- **Pista corta:** `filmGrid(g, cuts, start)` acepta un corte `[1, b)`, que hace que el vídeo empiece en el compás `b` de la
  pista. `shortCuts(desde, compases, final)` da los cortes de «N compases enérgicos y luego el final real del tema».
- **Tamaño:** `montage.maxMB` (o `output.maxMB`) sin `bitrate` calcula la tasa de vídeo para caber; por ejemplo, 30 MB.
  `minTitle` (s) baja la duración mínima de los rótulos para el lint.

## Seguridad

- Cada toma lanza una instancia propia con `AULA_HOME` temporal, que se borra al acabar.
- Esa instancia arranca con `AULA_DEMO=1` y `AULA_SEED=demo`, con la ventana oculta y sin icono en el Dock.
- Nunca toca la Aula instalada ni `~/Library/Application Support/Aula`.
- El compositor es otro Electron, con su perfil dentro de `work/`. Solo puede escribir en su carpeta de salida.

## El guion: `montage/*.ts`

Es un módulo que exporta `defineMontage({...})`. Son solo datos y los tipos están en `montage/types.ts`. El ejemplo
completo es `montage/demo.ts`.

**Tomas: `takes`.** Lo que se graba de la app.

- `duration`, `lang`, `theme` y `viewport`. Por defecto el viewport es 1440×900 pt y siempre se captura a 2 px/pt.
- `setup`: lo que se hace antes de grabar.
- `actions`: lo que pasa durante la toma, con `at` en segundos. Las acciones son:
  - `navigate {route}` y `theme`;
  - `move` y `click {to, dur}`, con un cursor que sigue un arco suave;
  - `drag {from, to}`;
  - `type {text, cps}`, `key` y `scroll {to, dy}`;
  - `eval`.
- Los objetivos (`to`, `from`) son un selector CSS, `text:Texto visible` o un punto `[x, y]` en pt.
- `marks`: cajas que se apuntan en cada fotograma (selector o `text:`). La cámara y el sol las pueden seguir con
  `mark:nombre`.
- `home`: una carpeta plantilla de `AULA_HOME`.
- `env`: variables extra, por ejemplo `AULA_FAKE_AI: '1'`.
- `mainClock: true`: los temporizadores del proceso principal pasan a tiempo virtual. Así la IA simulada escribe al
  ritmo del vídeo.
- `clock`: la hora de la app al empezar (ISO local). Con `clock` o `mainClock`, también el `Date` del proceso principal
  parte de esa hora y avanza con el tiempo virtual (como mucho 50 ms reales por delante, para que nada se quede parado).
- `pixelIdle: true`: deja los gestos de reposo del pixel art (por defecto se apagan con `<html data-pixel-idle="off">`).
- El clic vuelve a buscar su objetivo en el último 40 % del viaje del cursor (paneles que aún entran).
- Antes de grabar, las pantallas a las que se navegará se visitan una vez para calentarlas.

**Planos: `clips`.** Qué toma se ve y cuándo, con `start`, `dur` y `from`.

- `enter`: la transición de entrada. Puede ser `cut`, `fade`, `rise` (sube con un muelle), `sunrise` (el sol sale y su
  luz cambia el plano), `iris` (un círculo de borde suave que se abre desde `at`, un punto o `mark:`) o `door` (la puerta
  del arco del icono se abre desde el icono del prólogo hasta llenar el cuadro).
- `camera`: claves con estos campos:
  - `t`;
  - `zoom`: en px de vídeo por pt, o `fit`. El máximo es 2, la nitidez de la captura;
  - `focus`: un punto en pt o `mark:nombre`;
  - `screen`: dónde cae ese punto en el cuadro;
  - `ease`: `inOut`, `out`, `in`, `linear` o `spring`.
- `montage.camera` es una cámara global en tiempo del vídeo, continua por encima de los cortes. La usan los planos sin
  cámara propia.

**Encima y debajo de la ventana.** El fondo es papel con grano, una luz cálida de un solo color y una viñeta del 4 %.

- `paper`: claves de color del papel por hora (se interpolan en OKLab). Sin claves, el papel sigue el tema de los planos.
- `stamps`: el sello de hora arriba a la izquierda («LUNES · 8:10»); los caracteres que cambian ruedan.
- `frames`: el marco de la ventana por claves de tiempo. Cambia con un fundido de 6 fotogramas.
  - `mac`: semáforos.
  - `windows`: Windows 11, con una barra de 32 pt con el icono y «Aula», los botones — ☐ ✕ de trazo fino de 46 × 32 pt y
    radio de 8.
  - `linux`: cabecera de libadwaita de 46 pt, con el título centrado y el botón de cerrar redondo.
- `cursor: 'sun'`: el cursor-sol (disco de 14 px con halo, 1:1 en pantalla y 0,8 en los primeros planos, onda al pulsar,
  estela de 3 px a más de 600 px/s). Por defecto, la flecha de macOS.
- `drift` (o `clip.drift`): deriva viva, la fracción de zoom que gana un plano por compás (p. ej. `0.01`).

- `titles`:
  - `hero`: grande (96 px), centrado, con la marca de Aula y un velo de papel;
  - `side`: a la izquierda (54 px, apoyo en SF a 22 px);
  - `caption`: en una píldora de papel al 92 % abajo (44 px, apoyo a 20 px).
  - La serif es New York (`ui-serif`). El texto entra palabra a palabra (40 ms de escalonado, sube 10 px, 0,35 s) y se va
    con un fundido de 0,25 s.
  - Las palabras entre `*asteriscos*` salen en cursiva y en ladrillo.
  - `instant: true` lo deja entero desde su primer fotograma, para el fotograma 0 de una parte. `at` mueve el ancla.
  - Con `layer: 'under'` va detrás de la ventana.
- `sun`: el sol guía, con claves de posición (px o `mark:`) y radio. `style: 'halo'` solo ilumina, sin tapar.

**El icono de Aula** (el real: «Sumi-e mínimo B · arco y horizonte», `scripts/dev/icon/paint-art.mjs`, id `sumiB`).

- `compose/icon.ts` pinta el mismo cuadro que `build/icon.png` dos veces: entero y con `sun: false`, que es idéntico
  fuera de la puerta. El sol se recorta como sprite (color y alfa por la diferencia entre los dos), con una máscara por
  columna que corta donde empieza la pintura del horizonte. La losa del prólogo y del final es el papel del icono.
- `prologue`: `{ start, end, size, at, rise: [t0, t1], grow, morph, title, sub, titleAt }`. El icono entra y el medio
  sol ámbar sale por detrás del pincelazo del horizonte; al final, el PNG exacto. Con `morph`, la losa crece hasta ser
  la ventana del primer plano, en un solo movimiento suave hacia el encuadre del final del gesto. El icono ya pintado
  se despinta dentro de la losa (primero el horizonte, luego el arco desde su cola seca) antes de que entre la app, con
  los tramos de `PROLOGUE_STEPS`. Con bandas, la losa no entra en ellas.
- `finale`: `{ start, dur, rise: [t0, t1], sunFrom: [x, y] | 'cursor', size, at, title, sub }`.
  - La ventana del último plano se encoge y se redondea hasta la losa (escala, radio y sombra).
  - Mientras la ventana se apaga, el arco se pinta a pincel encima (`drawInk`: la tinta del icono se descubre a lo largo
    del trazo, con la punta redonda), luego el horizonte, y funde el icono real; tramos en `FINALE_STEPS`. El sol vuela
    hasta el horizonte de la puerta.
  - En la ventana `rise` sale el sol.
  - Acaba en el PNG real exacto, con el titular debajo.
- `notices`: `[{ start, dur, title, body, time, theme }]`. Es el banner de notificación de macOS: icono de Aula, título
  con «…» si no cabe y hora a la derecha. Entra con un muelle desde la derecha.

**Música: `music`.**

- `bpm`, `root` (MIDI) y `seed`.
- Acordes: `chords` en cifrado, uno por compás («D», «A/C#», «Bm», «Dadd9», «F#m»…, con conducción de voces), o
  `progression` en grados.
- `sections`: el arreglo desde un compás.
  - `piano`: arpegios de piano.
  - `dawn`: marimba FM suelta y colchón.
  - `day`: pulsado en corcheas, bombo en 1 y 3, shaker y, con `claps`, palmas en 2 y 4.
  - `night`: pulsado grave, sub-bajo y hats suaves.
  - `light` (0…1) abre o cierra el filtro del colchón.
- `motif` y `minorMotif`: [semitonos, negras]. La primera nota es anacrusa. Por defecto es 5-1-2-3 (A4–D5–E5–F♯5 en re).
- `cues`:
  - `motif`, con `voice` (`marimba`, `pluck`, `bell` o `piano`), `octave` y `minor`;
  - `swell`: una oleada hacia el corte;
  - `hit`: un golpe grave y suave;
  - `end`: acorde add9 con campana.
- `clicks`: un «tic» de madera en cada clic de las tomas, a −18 dB por defecto (`null` lo quita).
- `sfx`: nivel de los sonidos de los personajes pixel art (−12 dB por defecto; `null` los quita).
  - Se leen sus historias (`ICON_ANIMS`) y cada parche que aparece suena en su fotograma: latido, pitido plano, descarga,
    risita, corazones, burbujas, gota, vaivén, humo, destellos, notas, moneda.
  - Si la app emite el evento `aula:pixel` (con `data-pixel` en el canvas), cada toma registra sola cuándo empieza cada
    historia.
  - Si no, se colocan con `montage.pixelSfx: [{ t, story }]`, donde `t` es el momento en que el cursor entra.
  - Van también en `cues.json`.

**Salidas: `outputs`.** Partes del README, avance…

- Cada salida lleva `name`, `range`, `size`, `fps`, `bitrate` y `audioBitrate`.
- `fadeIn` y `fadeOut` son los fundidos de sonido.
- `maxMB` hace que el control de calidad avise si el archivo se pasa de ese peso.
- `stills` guarda PNG a su tamaño.
- Cada parte es un tramo de la misma partitura, normalizado a −14 LUFS.

## Cómo funciona

1. **Captura** (`capture/`). Playwright `_electron` lanza la compilación congelada.
   - Reloj falso de Playwright: `Date`, `performance.now`, `requestAnimationFrame` y temporizadores. Con eso,
     framer-motion (`motion`) avanza con tiempo virtual.
   - Animaciones CSS y WAAPI: la línea de tiempo se congela con CDP `Animation.setPlaybackRate(0)` y cada animación se
     coloca en su tiempo virtual (`document.getAnimations()`). Eso incluye las de motion que van por WAAPI y los
     keyframes de `aulaMark.css` y `chat.css`.
   - `Math.random` es determinista por sitio de llamada y por instante, así que los pixel art salen siempre iguales.
   - Perfil de color sRGB, 2 px/pt y fondo transparente: el vidrio de la barra lateral lo pone el compositor.
   - Antes de cada fotograma espera, en tiempo real, a que se cumpla todo esto: el proceso principal sin IPC
     pendiente, la red sin peticiones, imágenes y fuentes cargadas, y dos fotogramas sin mutaciones del DOM.
2. **Composición** (`compose/`). Un Electron propio y oculto dibuja cada fotograma en canvas, en función solo del tiempo.
   - Las capturas se reducen al decodificar con calidad alta.
   - H.264 se codifica con `VideoEncoder` (VideoToolbox), `avc1.64002A`: High 4.2, 1080p60, GOP de 2 s.
3. **Audio** (`audio/`). La música sale de `OfflineAudioContext`. Se mide según BS.1770-4 (puertas absoluta y
   relativa) y con pico verdadero sobremuestreado ×4. Se lleva a −14 LUFS con un limitador de anticipación, se
   codifica en AAC-LC a 192 kb/s con `AudioEncoder` y se recorta el cebado (2112 muestras) con una lista de edición.
4. **MP4** (`mp4/muxer.ts`). Muxer propio: `ftyp · moov · mdat` (faststart), intercalado cada 0,5 s, `colr`
   BT.709, `elst` y `sgpd/sbgp roll` para el AAC. Es determinista.
5. **Control de calidad.** Se comprueba todo esto sobre el archivo final:
   - el orden de las cajas;
   - perfil y nivel;
   - fps y número de fotogramas;
   - que se decodifica entero con WebCodecs, con el PSNR de tres fotogramas frente al lienzo;
   - LUFS y pico verdadero del AAC decodificado;
   - que AVFoundation lo decodifica (`avconvert`);
   - el cebado que lee CoreAudio (`afinfo`).

## Límites conocidos

- **Determinismo de la captura.** Se midieron tres capturas de cada toma, una a una, comparadas por pares.
  - Con la compilación de `HEAD`, en las tomas Curso, Hoy y Estadísticas: todos los fotogramas iguales o con ≤ 50 px
    distintos (de 5,8 M) en 8 de 9 comparaciones. En la novena, 7 fotogramas tienen ≤ 1000 px distintos. Idénticos bit a
    bit: entre el 79 y el 100 %.
  - Con la compilación actual (luz tras el cristal y pixel art en canvas), en las tomas Galería y Hoy: 4 de 6
    comparaciones al 100 % con ≤ 50 px. Una de cada tres capturas sale con diferencias de ≤ 1000 px en esas zonas.
  - Lo que se hace para conseguirlo (todo en `capture/`):
    - doble arranque, el segundo con el proceso principal en reposo;
    - sin vigilantes de archivos en la app capturada (`no-watch.cjs`, por `electron -r`);
    - sin los avisos `app.focus` ni `app.power` hacia la interfaz (la ventana oculta gana y pierde el foco en tiempo
      real);
    - IntersectionObserver y ResizeObserver entregan en el siguiente paso del reloj virtual;
    - los mensajes a un Worker de la página (los dibujos a mano se pintan en hilos aparte) cuentan como trabajo pendiente
      hasta su respuesta;
    - una petición de red de más de 1,5 s deja de frenar cada paso (el guion de un Worker termina en la sesión del hilo,
      no en la de la página) y se avisa en el registro;
    - 140 ms de silencio tras un paso con actividad (IPC, red, mutaciones, rAF o temporizadores pedidos desde un evento
      real);
    - tras dar por terminada una animación WAAPI se espera a lo que desata su `finish`, y las animaciones nuevas se
      colocan antes de capturar;
    - azar determinista por pila de llamada (4 marcos) e instante;
    - reposo del pixel art apagado;
    - origen del tiempo alineado.
  - El rasterizado por software (SwiftShader) no lo mejora.
  - Para el máster: `--jobs 1` y `--verify`; si una toma difiere, se vuelve a capturar.
- Las llamadas IPC que tardan más de 1,5 s reales (escuchas que no terminan) no frenan cada fotograma. Se avisan en el
  registro.
- **La composición es determinista**: 792 de 792 fotogramas compuestos idénticos (SHA-256).
- Los marcos `windows` y `linux` son decorado del compositor sobre una captura hecha en macOS: la app conserva el hueco
  de los semáforos a la izquierda y no sale su barra propia de Windows.
- Los sonidos de una historia colocada a mano dependen de acertar el instante en que el cursor entra en la tarjeta
  (±1 fotograma). Con el evento `aula:pixel` de la app son exactos.
- El H.264 por hardware puede variar algún byte entre codificaciones. `--verify` lo dice.
- **Rendimiento.** La captura va a unos 110–140 ms por fotograma (1600×1000 a 2×), con varias tomas en paralelo usando
  `--jobs`. La composición va a unos 40 ms por fotograma; lo más lento es decodificar los PNG.
- **Tamaño.** A 14 Mb/s salen unos 1,7 MB por segundo. Para subirlo al README de GitHub (límite de 10 MB por archivo
  en cuentas gratuitas) baja `bitrate` en el montaje o haz un corte más corto.
- **Barra de título.** Los semáforos y la sombra de la ventana se dibujan en el compositor, porque la captura de la
  página no incluye la barra de título nativa.
