#!/usr/bin/env bash
# Captura de la app EMPAQUETADA (release/linux-unpacked, tras `npx electron-builder --linux dir`). Playwright no puede
# controlarla (los fusibles apagan --inspect), así que se arranca en un Xvfb propio y se captura la pantalla entera.
#   scripts/dev/packaged-shot.sh salida.png
set -euo pipefail
OUT=${1:-shots/packaged.png}
HOME_DIR=$(mktemp -d)
cp -r resources/demo-course/Packs "$HOME_DIR/"
Xvfb :97 -screen 0 1440x900x24 >/dev/null 2>&1 &
XPID=$!
trap 'kill $XPID 2>/dev/null || true' EXIT
sleep 1
DISPLAY=:97 AULA_HOME="$HOME_DIR" AULA_SKIP_ONBOARDING=1 timeout 25 release/linux-unpacked/aula --no-sandbox >/dev/null 2>&1 &
sleep 12
DISPLAY=:97 import -window root "$OUT"
echo "captura: $OUT"
