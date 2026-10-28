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
