# Personajes que cobran vida, dibujados a mano

Cada icono de curso (16×16, `sprites.ts`) y cada compañero (24×24, `companions.ts`) tiene **su pequeña historia** en
fotogramas: la pipeta que vierte y hace reaccionar el matraz, el corazón que late, se acelera, recibe una descarga y se
ríe, el ábaco que cuenta, el libro que pasa páginas, el gato que bosteza… Las historias se escriben en pixel art (es un
formato cómodo para animar), pero en pantalla **todo se ve dibujado a mano**: línea a pincel de grosor variable (se posa,
tiembla y se levanta), rellenos planos y cálidos cortados a mano, grano de papel muy sutil y un «line boil» leve (cada
paso de la historia es otro dibujo). Ver «Dibujado a mano» más abajo.

| Pista       | Cuándo                                                                                        | Duración  |
|-------------|-----------------------------------------------------------------------------------------------|-----------|
| `idle`      | de vez en cuando (cada 7–18 s, al azar) si está en pantalla y nadie lo toca: un gesto sutil     | ≤ 3 s     |
| `hover`     | al entrar el ratón en el icono o en su fila/tarjeta/botón: la historia completa (se repite)     | ≤ 5 s     |
| `celebrate` | con la prop `celebrate` (true al montar, o un contador que cambia): al entrar en el curso, logros | ≤ 3,5 s   |

Con «Reducir movimiento» no hay reposo ni celebración ni entrada ni «hervor»: el dibujo queda quieto y, al pasar el ratón,
se enseña **un único fotograma** (el `still` de la pista `hover`).

## Piezas

- `anim.ts` — motor **puro** (sin DOM): formato, compilación a tableros de colores, `frameAt`, `runsOf`. Probado en `anim.test.ts`.
- `fx.ts` — efectos compartidos (chispas `tw1/tw2/tw3/tw5/twx`, `heart`, `heart3`, `note`, `note2`, `drop`, `bub`, `puff`,
  `puff5`, `dust`, `bolt`, `zap`, `zz`, `bang`, `ask`, confeti `c1…c5`, `star`, `coin`, `whooshL`) y ayudas: `hop()`,
  `sparkleRing()`, `celebrate(size, pose, mid)` (la celebración típica con la pose especial de cada personaje).
- `stories/*.ts` — las historias, por categoría (`general`, `math`, `science`, `health`, `humanities`, `languages`,
  `society`, `tech`, `arts`) y los compañeros (`companions-a`, `companions-b`). Se reúnen en `iconAnims.ts` y `companionAnims.ts`.
- `characters.ts` — une cada sprite con su historia, la compila **una vez por tono** (caché) y genera los parches
  automáticos de los compañeros.
- `player.ts` — pone en un `<canvas>` el dibujo de cada fotograma y anima **sin React por fotograma**: un único
  `requestAnimationFrame` para todos (solo copia un dibujo cuando cambia el fotograma o el del «hervor», y se detiene si no
  hay nada que animar), un único `IntersectionObserver` (fuera de pantalla no anima; lo que se ve se pinta antes) y un
  único temporizador para el reposo. `<html data-pixel-idle="off">` apaga el reposo (capturas).
- `brush/` — el dibujo a mano (ver abajo).
- Componentes: `PixelIcon`, `CourseIcon` (`Pixel.tsx`) y `Companion` (`Companion.tsx`). El ratón se escucha en el ancestro
  más cercano con `[data-pixel-hover]`, `button`, `a[href]` o `role=button|option|menuitem|link|tab`; si no hay, en el
  padre del icono. Pon `data-pixel-hover` en una tarjeta clicable para que despierte a su icono.

## Formato de una historia

```ts
chemistry: {
  legend: 'R:red2 P:pink2 q:pink1',              // colores extra (se suman a la leyenda del sprite)
  cels: {                                         // parches dibujados a mano
    pip: { at: [6, -3], rows: ['.RR.', 'RRRr', '.kk.', '.WP.', '..P.'] },
    slL: { at: [3, 7], rows: ['..LLL', '.lll...gs'] }
  },
  idle:      { ms: 140, frames: ['bub1@6,12', 'bub1@7,11', ''] },
  hover:     { ms: 110, still: 17, frames: ['slL @-1,0', '', 'pip@0,-4', 'pip *2', '%lP %Lq spl'] },
  celebrate: { ms: 100, frames: celebrate(16, '%lt puff@6,-3') }
}
```

**Colores** (leyenda `X:nombre`, una letra por color): un nombre de `PALETTE` (`ink`, `white`, `red2`, `gold1`…), `a1…a4`
(la rampa del color del curso, de claro a oscuro), `pN` (color N de la paleta del compañero) o `#rrggbb` (evítalo: rompe
la paleta; las pruebas solo aceptan PALETTE, la rampa y la paleta del compañero). **Nada violeta ni morado**: `PALETTE` no tiene
`purple*` (usa `blue*`, `pink*`, `teal*` o la rampa `a1…a4`) y ninguna paleta de compañero puede tener violetas
(`design/colorGuard.test.ts`). En los compañeros, cada color de su
paleta ya tiene letra: `0…9` y `A…J` (índice 10 = `A`).

**Parches** (`cels`): `at` es la esquina superior izquierda en coordenadas del sprite; puede ser negativa o pasar del
borde: hay **3 píxeles de margen** alrededor para chispas, saltos y humo. En las filas, `.` deja ver lo de debajo y `_`
borra. Un parche puede traer su propia `legend`. No llames a un parche como un efecto de `fx.ts` (las pruebas lo vigilan).

**Fotogramas**: cada uno es una lista de operaciones separadas por espacios que se aplican **en orden** sobre el dibujo base:

| Operación        | Qué hace                                                         |
|------------------|------------------------------------------------------------------|
| *(vacío)*        | el dibujo base tal cual                                          |
| `nombre`         | pega el parche (propio, automático o de `fx.ts`)                 |
| `nombre@dx,dy`   | lo pega desplazado                                               |
| `@dx,dy`         | mueve todo lo pintado hasta ahora (saltos, temblores)            |
| `<>`             | espejo horizontal de todo lo pintado                              |
| `%XY`            | el color de la letra X pasa a ser el de Y (`%X_` lo borra)       |
| `-`              | vacía el tablero (para redibujar entero con parches)             |
| `*n`             | el fotograma dura n pasos de `ms`                                |

Orden útil: lo que va **antes** de `@0,-2` sube con el personaje; lo que va **después** se queda quieto (las chispas).

**Pistas**: `ms` por paso (100–160 suele ir bien), `frames`, y en `hover` el `still` (fotograma clave para movimiento
reducido). Al terminar, el reproductor vuelve al dibujo base. `rep(n, …)` (de `anim.ts`) repite fotogramas.

**Compañeros**: además de sus parches tienen cuatro automáticos, sacados de sus capas: `blink` (ojos cerrados), `pose`
(su otra pose), `happy` (ojos felices ^ ^, dibujados a partir de la capa de ojos cerrados) y `wink` (guiño). Con
`working` siguen con su bucle de siempre (parpadeo, pose, flotar), ahora sin re-render de React.

## Añadir o cambiar una historia

1. Mira el sprite con coordenadas (`sprites.ts`; para los compañeros, `companionRows()` de `characters.ts`).
2. Dibuja los parches y escribe las pistas en el archivo de su categoría en `stories/`.
3. Genera las hojas de fotogramas y míralas grandes: `scripts/dev/pixel-sheets.ts` (instrucciones en su cabecera;
   `SCALE=8 … <carpeta> icons chemistry` para ver uno solo muy grande).
4. `npx vitest run src/renderer/src/design/pixel` (comprueba que todo compila, colores, duraciones y que cada pista hace algo).

## Dibujado a mano (`brush/`)

- `frames.ts` — cada (personaje, fotograma, tamaño, papel, dibujo del «hervor») se pinta **una vez**, en un hilo aparte
  (`paint.worker.ts`, por prioridad: lo que se ve primero), y se guarda como mapa de bits (64 MB como mucho; se tira lo
  menos usado). Pintar uno cuesta 1–5 ms a tamaño real; el hilo de la interfaz solo copia imágenes.
- **Iconos de curso**: `trace.ts` lee el pixel art como un ilustrador (la tinta del contorno → trazos por su esqueleto,
  partidos en las esquinas; las líneas de color de 1 px → pinceladas; el resto → manchas planas que llegan hasta el centro de
  la línea; las familias de color → relleno plano con la luz y la sombra como veladura suave) y `painter.ts` lo pinta con
  el pincel de PAINT-UI (`design/paint/brush.ts`: `brushOutline`, `pressureProfile`, sus cerdas secas). `palette.ts`
  templa los colores a pigmentos cálidos (ladrillo, arcilla, ocre, crema, salvia, azul tinta) sin cambiarles la familia
  y nunca violeta; la tinta es `SUMI`; en papel oscuro la silueta va en marfil (`IVORY`) salvo contra rellenos claros.
- **Compañeros**: los 44 están **redibujados uno a uno** (`brush/cast/a.ts`, `b.ts`, `c.ts`): cada uno es un «muñeco»
  (`Rig`) que se dibuja a pincel en el estado que pidan las operaciones de su historia (`rigs.ts` lee `blink`, `happy`,
  `wink`, `pose`, `@dx,dy`, `<>`, `%XY`, sus parches propios como estado —`yawn`, `boo`, `sh`…— o como objeto suelto —la
  manzana que cae, la tinta del pulpo— y los efectos compartidos de `fx.ts`, también dibujados). Las historias no cambian.
- **Dibujos sueltos** (`drawings.ts`): la medalla, la llama de la racha, el sol y la luna del saludo. `Sprite` pinta a mano
  los glifos de la interfaz (sus colores CSS se resuelven con `css.ts`).

### Cambiar o añadir un compañero dibujado

1. Su historia sigue en `stories/` (formato de arriba). Si usa un parche nuevo, el muñeco decide qué es: un estado
   (`s.cels.has('nombre')`) o un objeto suelto (`props.nombre(k, x, y)`).
2. El muñeco, en `brush/cast/*.ts`: coordenadas del sprite (0–24), `k.fill`/`k.body` (manchas), `k.edge` (silueta),
   `k.line` (líneas), `k.face(s, …)` (ojos según el estado, mejillas y boca), `k.layer()` (lo de después tapa lo de antes),
   `k.sparkle`. Geometría útil en `cast/geo.ts` (`tube`, `band`, `roundRect`, `wave`, `rot`). Colores: los de su paleta.
3. `npx vitest run src/renderer/src/design/pixel` comprueba que los 44 tienen muñeco, que todos sus fotogramas se pintan y
   que no sale violeta.
