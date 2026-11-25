# Piezas del App Store (iPhone y iPad)

> *Developer notes for the tools that make the App Store screenshots and App Previews of the iOS app. In Spanish, like
> the code comments.*

Las capturas y la vista previa (App Preview) de Aula para iPhone y iPad, sin ffmpeg ni dependencias nuevas: Electron y
Playwright pintan el arte, AVFoundation monta y codifica, y la música sale del sintetizador de `scripts/video/audio`.
Todo lo que producen va a `docs/app-store/media/`, que git ignora.

| Archivo | Qué hace |
|---|---|
| `store-copy.mjs` | Los textos (en y es) y las medidas: titulares de las 7 capturas (y dónde se parten a mano), el encuadre de cada captura que no va entera, ranuras, rótulos y tiempos del guion de 27 s |
| `store-art.mjs` + `store-art.html` | `shots`: las capturas compuestas (1320×2868, 1206×2622, 2752×2064, JPEG sin alfa). `video`: la franja, los rótulos, «Sequence shortened», los toques y la cartela en PNG a tamaño de fotograma, y el EDL |
| `preview-music.mjs` | `render`: el piano original de 27 s a −18 LUFS y ≤ −1,5 dBTP. `measure`: sonoridad y picos de un WAV o del AAC de un MP4 |
| `app-preview.swift` | EDL → MP4: tomas colocadas con `at`, fundidos (`dissolveIn`), rótulos, 30 fps constantes, H.264 High 4.0 + AAC 256 kb/s, moov delante |
| `preview-probe.swift` | Comprueba el MP4 contra lo que pide Apple (sale con 1 si falla) y exporta pósteres y una hoja de contacto |

## Orden

```sh
M=docs/app-store/media
node scripts/dev/appstore/preview-music.mjs render $M/music/preview-27s.wav
node scripts/dev/appstore/store-art.mjs video --taps $M/taps.json          # art/ y <device>-<lang>.edl.json
# grabar las tomas del simulador en $M/takes/<device>/<lang>/ y rellenar from/to de cada EDL
xcrun swift -suppress-warnings scripts/dev/appstore/app-preview.swift $M/iphone-en.edl.json $M/previews/aula-preview-iphone-en.mp4
xcrun swift -suppress-warnings scripts/dev/appstore/preview-probe.swift $M/previews/aula-preview-iphone-en.mp4 iphone \
  --duration 27 --stills 2.5,5.0 --stills-dir $M/previews/iphone-en --sheet $M/previews/iphone-en.jpg
node scripts/dev/appstore/preview-music.mjs measure $M/previews/aula-preview-iphone-en.mp4
node scripts/dev/appstore/store-art.mjs shots                              # lee $M/raw/<device>/<lang>/0N-<nombre>.png
```

Prueba en seco, sin simulador: `store-art.mjs shots --standins <json>` encuadra otras imágenes en las tarjetas y les pone
el sello «DRY RUN»; cualquier MP4 sirve de toma para `app-preview.swift`.

La pista de audio no se puede quitar (App Store Connect la pide); sin `audio` en el EDL, `app-preview.swift` pone
silencio.
