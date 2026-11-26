# Las imágenes de la portada del README

> *Developer notes, in Spanish like the code comments.*

Todo es la app de verdad. Las fotos fijas salen de `scripts/landing-shots.mjs` (la app compilada, el curso de ejemplo
con seis semanas de estudio simuladas, `AULA_SEED=demo`, a escala 2, en inglés y en español). Las animaciones salen del
vídeo `docs/media/demo/aula-demo-90s.mp4` con `scripts/dev/landing-gif.swift`: `hero.gif` (9,2–19,8 s) y `lesson.gif`
(21,4–31,4 s), con sus fotogramas fijos para «Reducir movimiento» (19,5 s y 29,4 s).

**Honestidad.** La respuesta del chat (`tutor-*.jpg`) es de la IA simulada de las pruebas (`AULA_FAKE_AI=1`), y el
README lo dice debajo de la imagen. En `hero.gif` la creación del curso va acelerada y el pie del vídeo lo dice.

Solo tema claro: las animaciones vienen del vídeo, que es claro, y mezclar temas en la misma página se ve roto.
Pesos objetivo: fotos < 300 KB, animaciones < 4 MB. Si cambia el guion del vídeo, revisa los cuatro instantes.

Para rehacerlas (macOS, desde la raíz del repositorio; las ventanas de la app se abren en pantalla, no las toques):

```bash
npm run build
node scripts/landing-shots.mjs                       # tutor, notes y exam, en inglés y en español
xcrun swiftc -O scripts/dev/landing-gif.swift -o "$TMPDIR/landing-gif"
V=docs/media/demo/aula-demo-90s.mp4; L=docs/media/landing
"$TMPDIR/landing-gif" $V $L/hero.gif   9.2 19.8 10 960 $L/hero-still.jpg   19.5
"$TMPDIR/landing-gif" $V $L/lesson.gif 21.4 31.4 10 800 $L/lesson-still.jpg 29.4
sips -Z 176 docs/media/aula-icon.png --out $L/icon-176.png
npx electron scripts/dev/social-preview.mjs          # docs/media/social-preview.png (se sube a mano en Settings)
```

Los recortes caen entre líneas, nunca a media frase. Si cambia la chuleta o el simulacro, mira las fotos antes de subirlas.
