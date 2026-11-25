# Sistema de diseño de Aula — «Papel y luz», más vivo

Aula conserva su identidad original:
**papel cálido** donde se lee, **una sola luz** (el ladrillo `#B4502F` / `#EA9A6C` en oscuro) para la acción principal y la
selección, el **sol** (`--sun`) solo para lo que está en vivo, **serif** (New York en macOS; Newsreader fuera) para títulos,
saludos y cifras, y la tipografía del sistema (SF) para la interfaz. Nada de degradados de colores ni arcoíris.

Lo nuevo de la versión 2: la pantalla se aprovecha entera con **tarjetas tipo burbuja** (rejilla tipo bento, aire de 16 px
entre ellas), y hay **detalles animados**: los iconos de los cursos y los compañeros, **dibujados a mano** (línea a pincel,
relleno plano y cálido), se pintan al abrir un curso o se asientan en las listas, y cada uno hace lo suyo (la pipeta vierte, el
corazón late y se ríe…, con el «line boil» de la animación a mano), el calendario y los exámenes cercanos **flotan** despacio, las cifras cuentan hasta su valor, las
barras y anillos se llenan, la selección se desliza, los logros sueltan una ráfaga de gotas de pintura. Movimiento suave, nunca
estridente; con «Reducir movimiento» todo queda quieto.

Importa todo desde `@renderer/design`. Referencia de calidad: `screens/home/*`.

## Color (tokens en `styles.css`, claro y oscuro)
- Superficies: `bg-canvas` (lienzo/vidrio), `bg-paper` (fondo de cada pantalla), `bg-surface` (tarjetas y grupos),
  `bg-raised` (menús, diálogos), `bg-sunken` (pozos, código), `bg-field` (campos), `bg-bubble` (mensaje del estudiante), `bg-tile` (losetas neutras).
- Texto: `text-text`, `text-text2`, `text-text3`. Líneas: `border-line`, `border-line-soft` y el **filete** `border-rule` /
  `bg-rule` (tinta al 14 %: separa partes de una página sin meter otra caja). Rellenos: `bg-fill1…4` (hover, botón, pulsado), `bg-selected`.
- Acción: `bg-accent text-on-accent` (UNA por vista), `text-accent-text` (enlaces), `bg-accent-wash` (fila elegida, «espera tu respuesta»).
- Estado (siempre con palabra o icono): `success`, `warning`, `danger`, `info` y sus `-soft`. Sol: `--sun`, `--sun-glow`.
- Identidad del curso: `toneForHue(course.hue)` → `fillLight/fillDark` (losetas y velos planos al 14–22 %), `inkLight/inkDark`
  (cifras, barras y anillos del curso, la muestra de pigmento de sus tarjetas). Nunca pinta la interfaz entera.
  Diez tonos: coral, ámbar, arena, oliva, salvia, turquesa, pizarra, azul noche (`navy`), vino (`wine`) y rosa.
- Aguada de grafito: `bg-wash-1…4` (`--wash-*`, de clara a intensa), para los datos globales.
- **Quién lleva color** (y el color nunca va solo):
  - el **ladrillo**, la acción (un solo botón `primary` por vista), la selección y lo de hoy;
  - la **tinta del curso**, los datos de ese curso: sus barras de dominio y la cifra de su examen;
  - el **grafito** (`--wash-*`), los datos globales: la constancia en Estadísticas;
  - siempre con su forma o su palabra: un tema sin ver es una barra vacía con contorno, un fallo es una «×» a tinta, «9 de 10
    bien» va escrito.
- **Nada violeta, morado ni lila** (decisión del dueño): ni en los tonos (los antiguos índigo y ciruela pintan ahora azul
  noche y vino), ni en los personajes (`PALETTE` ya no tiene `purple*`; el pintor templa los colores y en las costuras
  entre un rosa y un azul no deja mezcla violeta: `pixel/brush/painter.ts` `isViolet`), ni en compañeros, gráficas, resaltado de código o
  logos (los de marca violeta van en tinta). `colorGuard.ts` lo define (OKLCH 270–335°, croma ≥ 0,06); `colorGuard.test.ts`
  lo vigila en el código y `node scripts/dev/violet-sweep.mjs` (tras `npm run build`) lo busca en capturas reales.

## Tipografía (clases `t-*`)
`t-display` (saludo, 40 serif) · `t-title1` (título de pantalla, 28 serif) · `t-title2` (sección, 22 serif) · `t-headline` ·
`t-body` · `t-callout` (filas) · `t-ui` (controles) · `t-footnote` · `t-caption` (12, la más pequeña) · `t-eyebrow` (una por
pantalla como mucho) · `t-reading` (lecciones, 20/32 serif) · `t-marginal` (nota al margen y pie de figura: serif cursiva
13/18 en `text2`) · `t-number` (cifra protagonista, serif tabular) · `t-number-inline` · `t-mono`.
`font-serif` para cifras grandes sueltas (cuentas atrás, racha). La escala va en `rem` (px ÷ 15): el ajuste «Tamaño del
texto» cambia la raíz y todo crece con él; lo nuevo, también en `rem`.
**Las cifras van dentro de frases** («4 cosas para hoy · unos 54 min») y nunca se enseña un cero («0 min», «0 / 60»).

## Componentes
- `Card` — burbuja/tarjeta (radio 22, `bg-surface`, sombra sepia `e1`). `interactive` (se levanta 2 px con `e2`), `floating`
  (flota 3 px, en el compositor), `mark` (color de identidad: una «muestra de pigmento», unas pasadas de pincel plano de ese color en la esquina de la
  tarjeta, como quien prueba un color en el margen del papel; plana, mate y QUIETA: ni deriva ni sigue al ratón; `markSize="sm"` en fichas bajas), `wash` (velo plano de un color),
  `elevation`, `enterAnim`, `padded`. Nada de rayas de color a la izquierda ni de luces difusas que se muevan detrás de las
  tarjetas (decisión del dueño): para eso está `mark` (o `PigmentMark` suelta, en cualquier burbuja `relative isolate`); en filas de lista, el color va en la loseta del icono.
  `variant="sheet"`: sin fondo ni sombra, con un filete arriba (una parte de la página, no un objeto; sin `mark`).
- `Section` (filete arriba, título serif que le da nombre, `detail`, `action`; `size="sm"` para notas al margen; `rule={false}`
  en la primera de una columna) y `Rule` (filete suelto): para ordenar una página sin meter cajas.
- `Group` + `Row` — lista agrupada (el contenedor por defecto dentro de una tarjeta). `Row`: `leading`, `title`, `subtitle`,
  `trailing`, `chevron`, `onClick`, `selected`, `mark`, `index` (escalona la entrada). `Group plain`: sin borde ni fondo, solo
  las filas con su filete (dentro de una tarjeta: nunca una caja dentro de otra).
- `PageHeader`, `SectionTitle` (títulos serif). `Button` (`primary` ladrillo, `secondary`, `ghost`, `plain`, `danger`; tamaños
  sm 28 · md 32 · lg 40 · xl 48; la variante sale en `data-variant`, y las pruebas cuentan los `primary`), `IconButton`, `SegmentedTabs` (cápsula con píldora que se desliza), `Chip`, `Badge`, `Kbd`.
- `Icon` — los iconos propios de Aula (`name`: today, learn, practice, cards, exam, mistakes, sources, reference, course,
  create, refine, tutor, calendar, search, settings, …; ver `icons/paths.ts`). lucide-react solo para glifos de ciencia.
- `AulaMark` — el arco y el sol, animado solo con CSS (`aulaMark.css`); `state`: idle (medio sol; asoma con `hover`),
  thinking (el sol respira y la puerta se ilumina), working (el atardecer: un sol cruza el arco y se pone en ladrillo), done
  (salta y suelta un anillo de luz: «listo»), waiting, paused, offline. `useMarkPhase(busy)` da working → done → idle. Para
  vacíos, bienvenida y TODO lo que muestre a Aula trabajando (fuera del chat: `useAulaMarkState()` de `screens/chat/liveStatus`).
- Código (`lib/code/CodeSurface`): la tarjeta única del código, la del bloque `code` y la de cualquier ``` de un texto
  (`RichText`): el nombre del lenguaje, «Copiar», los colores sobrios de highlight.js (que se carga aparte y colorea al
  acercarse a la vista), números desde 3 líneas y las líneas largas que se desplazan dentro. En un control (una opción) va
  sin botones; el `código en línea` es una pastilla del texto.
- Chat (`screens/chat`): `Conversation` (mensajes, «pensando» al enviar, desplazamiento que no pelea), `Activity` (una fila por
  herramienta con su icono y animación; al terminar, resumen «Consultó 3 materiales · creó 5 tarjetas»). Vista previa de todo en
  la galería (`navigate({ name: 'gallery' })`).
- Iconos de curso (dibujados a mano; los nombres `Pixel*` se quedan por compatibilidad): `PixelIcon` / `CourseIcon`
  (`animation="drop" | "dissolve"`, `celebrate`): cada icono tiene su historia (reposo de vez en cuando, la historia entera al
  pasar el ratón por él o por su fila/tarjeta, celebración al entrar en el curso); canvas sin re-render de React y cada
  fotograma pintado una vez en un hilo aparte, leyendo su pixel art. Formato y cómo añadir más: `pixel/README.md`. `Sprite`
  (glifos de la interfaz a mano), `Spinner` (toques de pincel en corro), `PixelCheck` (a pluma), `PixelCurtain` y
  `pixelBurst(elemento)` (gotas de pintura) para logros de verdad. Las pegatinas (`Companion`), la llama, el cielo, el sobre
  y la medalla ya no existen: lo vigila `artRules.test.ts`.
- Movimiento (bucles siempre en CSS/WAAPI de transform y opacity, nunca un bucle de motion en JavaScript): `Stagger`/`StaggerItem`, `Floating` (`useFloat`), `Reveal`, `LiveDot`, `AnimatedNumber`, `ProgressRing`, `ProgressBar`.
  Muelles `spring.snappy` (controles), `spring.smooth` (paneles), `spring.bouncy` (solo interruptor, diálogo, aviso).
- Capas: `Dialog`, `Drawer`, `ConfirmDialog`, `toast.*` (el mismo aviso no se apila), `Tooltip`, `Menu` y `Select` (abren hacia arriba
  si no caben debajo: `placePopover`), `TextField` (`flex-1`, `w-*`… van al envoltorio), `TextArea`, `DateField` (la fecha escrita en el
  idioma de la interfaz, nunca «mm/dd/yyyy»; al pulsar, el calendario del sistema), `Switch`, `Slider`, `EmptyState`. El foco de un campo
  es un anillo de 2 px con `--focus` (se ve sobre el papel).
  Toda capa modal atrapa Tab (`useTabTrap`: ya lo llevan `Dialog`, `Drawer`, ⌘K y la bienvenida); Esc cierra primero el menú o
  la lista abiertos y nada más. `Tooltip` se mide y no se sale de la ventana (`placeTooltip`). Una `Card` con `onClick` es un
  botón (Intro y Espacio). `SegmentedTabs` no usa `layoutId` (motion lo guarda para siempre): la píldora se mide.

## Dibujo a mano (`paint/`)
El lenguaje del icono (sumi-e «arco y horizonte»): **línea de tinta, pluma, pincel o lápiz de grosor variable**, con
principio y final a la vista (se posa, corre con la presión de la mano, tiembla un poco, se levanta afilándose o abriéndose
en hebras secas; donde la mano vuelve, la línea se solapa), y **rellenos planos y cálidos** de borde cortado a mano con un
grano de papel muy suave, algo fuera de registro de su línea. Minimalista y amable; en pocos sitios y con propósito:
- `AulaMark`: el arco de un trazo, el horizonte y el medio sol. `draw` (el pincel la dibuja al aparecer y el sol sale),
  `alive` (en reposo el sol respira) y `boil` (la línea «hierve» casi sin verse): vacíos y bienvenida.
- `BrushUnderline` (el saludo de Hoy), `InkRing` (hoy rodeado a mano), `CoverBand` + `DrawnBorder` (la portada de cada curso
  y su tarjeta), `DrawnTile` (el icono de la cabecera del curso y del aviso de logro), `DrawnBorder` en los logros
  conseguidos, `InkBurst` (rayitas que celebran un logro), `InkCheck` + `InkStrike` (un paso del plan hecho), `PencilRays`
  (garabato a lápiz en los vacíos), `InkArrow` (la flecha de la bienvenida) e `InkRule` (filete a pluma seca: un corte de
  sección o el subrayado fino de una sugerencia al pasar el ratón; nunca en cada fila; va dentro de una caja `relative` y se
  coloca con clases).
- **El boli rojo de quien corrige**: un error se marca con UNA señal, la respuesta tachada a mano (`InkStrike`) y una
  `MarginNote` (serif cursiva en ladrillo, con flecha corta con `arrow`) que dice el porqué; sin caja rosa, borde rojo ni
  pigmento. `MarginNote tone="graphite"` para comentar sin corregir.
- **Se dibujan una sola vez** por sesión y dibujo (`drawKey`), cuando se ven por primera vez, con el ritmo de una mano
  (arranca, frena en curvas y esquinas, se levanta; varios trazos uno tras otro). Las líneas son vectores (`drawings.ts`:
  silueta, huecos secos y eje; `Ink.tsx`: una máscara por trazo que la mano recorre); los rellenos, máscaras con grano hechas
  una vez en un hilo aparte (`recipes.ts`, `paint.worker.ts`). En reposo no cuesta nada; lo vivo (sol, «boil») se para en
  calma, con la ventana oculta y con «Reducir movimiento», que además lo enseña todo ya dibujado.
- **El diente del papel** (`.paper-grain`, en `paint/paint.css`): el fondo de las pantallas lleva un grano muy fino y quieto,
  como papel de acuarela; las tarjetas, encima, siguen lisas. Y la **muestra de pigmento** (`PigmentMark`, receta `swatch`):
  el color de identidad como pasadas de pincel plano en una esquina (tarjetas, notas de las lecciones, diapositivas).
- **Dibujos a tinta y acuarela** (`ArchLight`, `InkSpot`, `inkArt.css`): la misma mano que Faro (una línea con pulso y
  aguadas que se salen de ella, pintadas por filtros SVG) pero con los motivos de Aula, nunca los de Faro. `ArchLight` es
  el arco de Aula con la luz dentro (`dawn`, `noon`, `dusk`, `night`; `archLightFor(hora)`): en el saludo de Hoy y en la
  bienvenida. `InkSpot` son objetos del estudio (`books`, `cards`, `pencil`, `flask`, `calendar`, `lamp`, `hourglass`) para las
  pantallas vacías (`EmptyState art="…"`) y el chat sin empezar. La tinta se dibuja UNA vez al aparecer y el dibujo se
  queda quieto. La única excepción es el arco grande de Hoy (`ArchLight live`): mientras el ratón está encima se mueve
  a cámara lenta —sus cuatro láminas (aguada, color, luz y tinta) se apartan cada una a su profundidad siguiendo al
  puntero con retraso, y la luz sube—, con transiciones de más de dos segundos y sin bucles; al irse el ratón vuelve a su
  sitio, y con «Reducir movimiento» no se mueve. Tonos `--wc-*` (ladrillo y sol más cuatro apagados), más hondos en oscuro. Un dibujo por pantalla, nunca
  de fondo de una tarjeta ni debajo de texto. El icono de la app sigue la misma receta (`scripts/dev/icon/ink-art.mjs`).
- **Profundidad suave**: las tarjetas llevan su borde fino y una sombra larga y baja, metida hacia dentro (`--e1`, `--e2`),
  no un halo alrededor. **Botones en píldora** (`Button`: `rounded-full` en todos los tamaños).
- **Dos voces en el chat**: lo que dice Aula va en serif sobre el papel, sin burbuja; lo del estudiante, en su burbuja
  (20/20/6/20) con la letra de la interfaz.
- **La fila elegida se pinta** (`SelectionPaint`, receta `pass`): en la barra lateral y en la lista de conversaciones, lo
  elegido es una sola pasada de pincel plano en ladrillo muy aguado (entra cargada y se queda seca al final), no una
  píldora gris. Se desliza de fila en fila con el `layoutId` de siempre. Para listas; no para celdas cuadradas.
- **Toques de pincel** (`.dab`, `paint/dabs.ts`): los cuadraditos de color (días de la racha, dominio de cada tema y su
  leyenda) van cortados a mano con la receta `tile`, cuatro variantes que se reparten solas. Si el cuadrado lleva anillo o
  contorno de foco, el toque va en un `span` de dentro (la máscara recortaría el anillo).
- Semilla fija (`seedOf('id')`): el mismo dibujo en cada arranque. Tintas: `--ink`, `--graphite`, `--pigment-brick`,
  `--pigment-sun` (en oscuro, claras y cálidas; nunca un gris; nada violeta). Nunca debajo de texto pequeño, campos ni
  ejercicios. Todo junto en la galería (`navigate({ name: 'gallery' })`).

## Una sola mano: tinta y acuarela
- **Un solo estilo de dibujo**: tinta y acuarela (`ArchLight`, `InkSpot`, `paint/*`) más los iconos pixel de los cursos
  (`PixelIcon`, `PixelCurtain`). Nada de pegatinas ni sprites que solo adornan (las pegatinas, la llama, el cielo, el sobre, la
  medalla). Se quedan los iconos pixel pequeños que significan algo (el icono del curso, el `?` de las
  preguntas de la lección, la marca del examen en el mes, la hoja de Documentos, los de la calculadora y la tabla periódica).
- **Un dibujo y un gesto de tinta por pantalla, como mucho**: la mano en todas partes es otra forma de plantilla.
- **Pigmento solo para el examen** (`PigmentMark`, `Card mark`, `Row mark`): la tarjeta «El examen» del Resumen del curso y la
  portada del simulacro; en una esquina sin texto, nunca debajo de texto, campos ni botones. (El `mark` de una opción de
  respuesta es su marca de bien o mal, no pigmento.)
- **Flotar** (`Floating`, `Card floating`) solo los exámenes y la semana de Hoy, la tarjeta del examen del curso, el mes y la
  semana del calendario, y las herramientas fijadas.
- **Celebrar**: un acierto o terminar algo, `InkBurst` (rayitas a tinta; `Celebrate at={cuándo}` las dibuja alrededor de la marca
  de un acierto y se van). Las gotas de `pixelBurst`, solo en logros de verdad
  (el aviso de logro, el informe del simulacro, el resumen de una sesión); nunca en las acciones de todos los días.

## Pantallas
- `screens/<nombre>/index.tsx` (export default); título con `useScreenTitle(t('title'), acciones?)`. **El título sale una
  sola vez**: si la pantalla ya pinta su h1 (el curso, el monitor de creación), `useScreenTitle(título, acciones, deps,
  { compactOnly: true })` y la barra superior solo lo pone en el teléfono; si no, la barra es el título visible y la pantalla
  deja `<h1 className="sr-only">` con el mismo texto.
- Contenedor: `<div className="@container flex-1 min-h-0 overflow-y-auto px-6 pt-1 pb-10">` y rejilla `grid grid-cols-12 gap-4`
  con variantes de contenedor (`@3xl:`, `@5xl:`).
- Datos: `useRpc('dominio.metodo', args, { events: [...] })`. Navegar: `navigate({ name: 'course', id })`.
- Textos con i18n (`i18n/locales/{es,en}/<espacio>.json`), tono de persona: concretos, sin eslóganes, plurales de verdad.
- Vacío con `EmptyState` (la marca de Aula), carga con `skeleton` o `Spinner`, error con frase + «Reintentar».
- Antes de dar una pantalla por buena: claro y oscuro, ventana pequeña (1000×680) y grande, teclado, movimiento reducido.
