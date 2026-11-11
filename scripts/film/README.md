# El corto de Aula

> *Developer notes, in Spanish like the code comments. The film itself is in English.*

«Nine days.» es el corto de animación del README (1 min 50 s): un estudiante perdido en una tormenta de apuntes, nueve
días antes de un examen, encuentra un arco encendido, lo cruza, sube una escalera de hojas mientras el sol cuenta los
días y llega listo. Acaba con veinte pantallas de la app de verdad.

Está **pintado con código**, fotograma a fotograma, en un lienzo de una ventana oculta de Electron: tinta y acuarela
sobre papel, cámara con profundidad, grano de película y un cuadro panorámico que se abre cuando se derrama el color.
La música y el sonido también se sintetizan aquí (Web Audio sin tiempo real). No captura la app, no usa ffmpeg y no
añade dependencias; de `scripts/video` solo toma el codificador H.264/AAC y el empaquetador MP4.

```sh
npm run build && node scripts/film/shots.mjs     # las capturas de la app real del final → scripts/film/assets/ (git no las guarda)
node scripts/film/render.ts                      # el corto → scripts/film/work/aula-short-film.mp4 (unos 45 s en un Mac con Apple Silicon)
node scripts/film/render.ts --stills 16.8,37.2   # solo esos instantes, como PNG (work/stills/)
node scripts/film/render.ts --range 13:18        # solo ese tramo
node scripts/film/render.ts --fps 12 --silent    # borrador rápido
```

| Archivo | Qué hay |
| --- | --- |
| `engine/core.ts` | Medidas, curvas de tiempo, azar con semilla, ruido y la paleta |
| `engine/paint.ts` | Papel, aguadas, trazos de pincel, resplandores y el acabado (grano, viñeta, franjas) |
| `engine/figure.ts` | El estudiante de la bufanda |
| `engine/props.ts` | Hojas, el arco de Aula, torres de apuntes, mesa y flexo |
| `scenes/night.ts` | La noche: el escritorio, las torres de apuntes y el viento que empieza |
| `scenes/storm.ts` | La tormenta, plano a plano y animada «a doses» (12 dibujos por segundo): el calendario, el flexo, los relámpagos y la gran ola |
| `scenes/arch.ts` | El llano con el arco a lo lejos y el umbral |
| `scenes/dawn.ts` | La escalera, la ballena de papel y el día del examen |
| `scenes/aula.ts` | Las pantallas de la app y el final (las hojas forman el arco) |
| `score.ts` | La música y los efectos |
| `timing.ts` | Los tiempos del final, compartidos por imagen y música |
| `film.ts`, `page.ts`, `render.ts` | El montaje, la página que pinta y codifica, y la orden |

Todo es determinista: el mismo fotograma sale igual siempre (no se usa `Math.random` ni el reloj).

**Publicarlo.** Los MP4 van como archivos de la versión v0.1.0 de GitHub, sustituyendo a los anteriores (nunca como una
versión nueva, ver `docs/PUBLISHING.md`), y el póster del README sale de un fotograma:

```sh
node scripts/film/render.ts --name Aula-film --bitrate 9000000        # el máster
node scripts/film/render.ts --name Aula-film-web --bitrate 1800000 --grain 0.4   # el del README: 27 MB como mucho (lo comprueba public-docs.test.ts)
gh release upload v0.1.0 scripts/film/work/Aula-film.mp4 scripts/film/work/Aula-film-web.mp4 --clobber
node scripts/film/render.ts --stills 28.2
npx electron scripts/dev/film-poster.mjs scripts/film/work/stills/aula-short-film-28.20.png 1:50
```

**Lo que no se ha podido comprobar aquí:** la música y el sonido no se han escuchado, solo medido (−15 LUFS, pico
verdadero por debajo de −2 dBTP); el movimiento se ha revisado por fotogramas sueltos.
