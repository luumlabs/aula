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
- Texto: `text-text`, `text-text2`, `text-text3`. Líneas: `border-line`, `border-line-soft`. Rellenos: `bg-fill1…4` (hover, botón, pulsado), `bg-selected`.
- Acción: `bg-accent text-on-accent` (UNA por vista), `text-accent-text` (enlaces), `bg-accent-wash` (fila elegida, «espera tu respuesta»).
- Estado (siempre con palabra o icono): `success`, `warning`, `danger`, `info` y sus `-soft`. Sol: `--sun`, `--sun-glow`.
- Identidad del curso: `toneForHue(course.hue)` → `fillLight/fillDark` (losetas y velos planos al 14–22 %), `inkLight/inkDark`
  (cifras, barras y anillos del curso, la luz tras el cristal de sus tarjetas). Nunca pinta la interfaz entera.
  Diez tonos: coral, ámbar, arena, oliva, salvia, turquesa, pizarra, azul noche (`navy`), vino (`wine`) y rosa.
- **Nada violeta, morado ni lila** (decisión del dueño): ni en los tonos (los antiguos índigo y ciruela pintan ahora azul
  noche y vino), ni en los personajes (`PALETTE` ya no tiene `purple*`; el pintor templa los colores y en las costuras
  entre un rosa y un azul no deja mezcla violeta: `pixel/brush/painter.ts` `isViolet`), ni en compañeros, gráficas, resaltado de código o
  logos (los de marca violeta van en tinta). `colorGuard.ts` lo define (OKLCH 270–335°, croma ≥ 0,06); `colorGuard.test.ts`
  lo vigila en el código y `node scripts/dev/violet-sweep.mjs` (tras `npm run build`) lo busca en capturas reales.

## Tipografía (clases `t-*`)
`t-display` (saludo, 40 serif) · `t-title1` (título de pantalla, 28 serif) · `t-title2` (sección, 22 serif) · `t-headline` ·
`t-body` · `t-callout` (filas) · `t-ui` (controles) · `t-footnote` · `t-caption` · `t-eyebrow` (una por pantalla como mucho) ·
`t-reading` (lecciones, 18/28 serif) · `t-number` (cifra protagonista, serif tabular) · `t-number-inline` · `t-mono`.
`font-serif` para cifras grandes sueltas (cuentas atrás, racha).

## Componentes
- `Card` — burbuja/tarjeta (radio 22, `bg-surface`, sombra sepia `e1`). `interactive` (se levanta 2 px con `e2`), `floating`
  (flota 3 px, en el compositor), `mark` (color de identidad: una «luz tras el cristal», mancha pastel mate de ese color —luminosidad y croma
  fijos en claro, nunca un gris— que reposa dentro de la tarjeta, deriva despacio y se acerca al ratón; `markSize="sm"` en fichas bajas), `wash` (velo plano de un color),
  `elevation`, `enterAnim`, `padded`. Nada de rayas de color a la izquierda: para eso está `mark` (o `GlassLight` suelta, en
  cualquier burbuja `relative isolate`); en filas de lista, el color va en la loseta del icono.
- `Group` + `Row` — lista agrupada (el contenedor por defecto dentro de una tarjeta). `Row`: `leading`, `title`, `subtitle`,
  `trailing`, `chevron`, `onClick`, `selected`, `mark`, `index` (escalona la entrada).
- `PageHeader`, `SectionTitle` (títulos serif). `Button` (`primary` ladrillo, `secondary`, `ghost`, `plain`, `danger`; tamaños
  sm 28 · md 32 · lg 40 · xl 48), `IconButton`, `SegmentedTabs` (cápsula con píldora que se desliza), `Chip`, `Badge`, `Kbd`.
- `Icon` — los iconos propios de Aula (`name`: today, learn, practice, cards, exam, mistakes, sources, reference, course,
  create, refine, tutor, calendar, search, settings, …; ver `icons/paths.ts`). lucide-react solo para glifos de ciencia.
- `AulaMark` — el arco y el sol, animado solo con CSS (`aulaMark.css`); `state`: idle (medio sol; asoma con `hover`),
  thinking (el sol respira y la puerta se ilumina), working (el atardecer: un sol cruza el arco y se pone en ladrillo), done
  (salta y suelta un anillo de luz: «listo»), waiting, paused, offline. `useMarkPhase(busy)` da working → done → idle. Para
  vacíos, bienvenida y TODO lo que muestre a Aula trabajando (fuera del chat: `useAulaMarkState()` de `screens/chat/liveStatus`).
- Chat (`screens/chat`): `Conversation` (mensajes, «pensando» al enviar, desplazamiento que no pelea), `Activity` (una fila por
  herramienta con su icono y animación; al terminar, resumen «Consultó 3 materiales · creó 5 tarjetas»). Vista previa de todo en
  la galería (`navigate({ name: 'gallery' })`).
- Personajes (dibujados a mano; los nombres `Pixel*` se quedan por compatibilidad): `PixelIcon` / `CourseIcon`
  (`animation="drop" | "dissolve"`, `celebrate`) y `Companion` (`working`, `celebrate`): cada personaje tiene su historia
  (reposo de vez en cuando, la historia entera al pasar el ratón por él o por su fila/tarjeta, celebración al entrar en el
  curso); canvas sin re-render de React y cada fotograma pintado una vez en un hilo aparte. Los iconos se pintan leyendo su
  pixel art; los 44 compañeros están redibujados uno a uno (`pixel/brush/cast/`). Formato y cómo añadir más:
  `pixel/README.md`. `Sprite` (glifos de la interfaz a mano), `Spinner` (toques de pincel en corro), `PixelFlame`,
  `PixelMedal`, `PixelSky`, `PixelCheck` (a pluma), `PixelCurtain` y `pixelBurst(elemento)` (gotas de pintura) para logros.
- Movimiento (bucles siempre en CSS/WAAPI de transform y opacity, nunca un bucle de motion en JavaScript): `Stagger`/`StaggerItem`, `Floating` (`useFloat`), `Reveal`, `LiveDot`, `AnimatedNumber`, `ProgressRing`, `ProgressBar`.
  Muelles `spring.snappy` (controles), `spring.smooth` (paneles), `spring.bouncy` (solo interruptor, diálogo, aviso).
- Capas: `Dialog`, `Drawer`, `ConfirmDialog`, `toast.*` (el mismo aviso no se apila), `Tooltip`, `Menu` y `Select` (abren hacia arriba
  si no caben debajo: `placePopover`), `TextField` (`flex-1`, `w-*`… van al envoltorio), `TextArea`, `Switch`, `Slider`, `EmptyState`.
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
  (garabato a lápiz en los vacíos) y `InkArrow` (la flecha de la bienvenida).
- **Se dibujan una sola vez** por sesión y dibujo (`drawKey`), cuando se ven por primera vez, con el ritmo de una mano
  (arranca, frena en curvas y esquinas, se levanta; varios trazos uno tras otro). Las líneas son vectores (`drawings.ts`:
  silueta, huecos secos y eje; `Ink.tsx`: una máscara por trazo que la mano recorre); los rellenos, máscaras con grano hechas
  una vez en un hilo aparte (`recipes.ts`, `paint.worker.ts`). En reposo no cuesta nada; lo vivo (sol, «boil») se para en
  calma, con la ventana oculta y con «Reducir movimiento», que además lo enseña todo ya dibujado.
- Semilla fija (`seedOf('id')`): el mismo dibujo en cada arranque. Tintas: `--ink`, `--graphite`, `--pigment-brick`,
  `--pigment-sun` (en oscuro, claras y cálidas; nunca un gris; nada violeta). Nunca debajo de texto pequeño, campos ni
  ejercicios; la luz tras el cristal NO se dibuja. Todo junto en la galería (`navigate({ name: 'gallery' })`).

## Pantallas
- `screens/<nombre>/index.tsx` (export default); título con `useScreenTitle(t('title'), acciones?)`.
- Contenedor: `<div className="@container flex-1 min-h-0 overflow-y-auto px-6 pt-1 pb-24">` y rejilla `grid grid-cols-12 gap-4`
  con variantes de contenedor (`@3xl:`, `@5xl:`). Deja `pb-24` para el botón flotante de Aula.
- Datos: `useRpc('dominio.metodo', args, { events: [...] })`. Navegar: `navigate({ name: 'course', id })`.
- Textos con i18n (`i18n/locales/{es,en}/<espacio>.json`), tono de persona: concretos, sin eslóganes, plurales de verdad.
- Vacío con `EmptyState` (la marca de Aula), carga con `skeleton` o `Spinner`, error con frase + «Reintentar».
- Antes de dar una pantalla por buena: claro y oscuro, ventana pequeña (1000×680) y grande, teclado, movimiento reducido.
