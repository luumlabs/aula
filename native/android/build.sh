#!/bin/bash
# Compila la app de Android (native/android) sin Gradle ni librerías: aapt2, javac, d8, zipalign y apksigner.
#
#   native/android/build.sh            build/Aula-<versión>-android.apk, firmada con la clave de Aula para Android
#   native/android/build.sh --debug    build/Aula-<versión>-android-debug.apk, con una clave de prueba (emulador, CI)
#   native/android/build.sh --new-key  crea la clave de Aula para Android (una sola vez; guárdala: sin ella no se puede
#                                      publicar una actualización que Android acepte encima de la app instalada)
#
# Necesita el SDK de Android con build-tools y la plataforma (ANDROID_HOME, o <raíz>/.toolchain/android-sdk:
# native/android/setup.sh lo instala), un JDK 17 o posterior (JAVA_HOME, o <raíz>/.toolchain/jdk) y Go para el componente
# de Tailscale (native/tsnet/build.sh android). La versión sale de package.json. La clave de firma vive fuera del
# repositorio: $AULA_ANDROID_KEYSTORE (por defecto ~/.aula-signing/android/aula-release.keystore) y su contraseña en el
# archivo de al lado (.pass, 0600).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TC="$ROOT/.toolchain"
OUT="$HERE/build"
API=36
MIN_SDK=26

mode=release
case "${1:-}" in
  --debug) mode=debug ;;
  --new-key) mode=newkey ;;
  "") ;;
  *) echo "uso: $0 [--debug|--new-key]" >&2; exit 2 ;;
esac

# ── herramientas ──
if [ -z "${JAVA_HOME:-}" ] && [ -d "$TC/jdk" ]; then
  JAVA_HOME="$(find "$TC/jdk" -maxdepth 3 -type d -name Home | head -1)"
  [ -n "$JAVA_HOME" ] || JAVA_HOME="$TC/jdk"
fi
[ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ] || { echo "Falta un JDK 17+ (JAVA_HOME o .toolchain/jdk: native/android/setup.sh)" >&2; exit 1; }
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"

KEYSTORE="${AULA_ANDROID_KEYSTORE:-$HOME/.aula-signing/android/aula-release.keystore}"
PASSFILE="${KEYSTORE%.keystore}.pass"
if [ "$mode" = newkey ]; then
  [ -e "$KEYSTORE" ] && { echo "Ya existe $KEYSTORE: no se toca (perderla impediría actualizar la app)." >&2; exit 1; }
  mkdir -p "$(dirname "$KEYSTORE")" && chmod 700 "$(dirname "$KEYSTORE")"
  umask 077
  head -c 32 /dev/urandom | base64 | tr -d '/+=\n' | head -c 32 > "$PASSFILE"
  keytool -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -alias aula -keyalg EC -groupname secp256r1 -validity 10000 \
    -dname "CN=Aula, O=Luum Labs" -storepass:file "$PASSFILE" -keypass:file "$PASSFILE" >/dev/null
  chmod 600 "$KEYSTORE" "$PASSFILE"
  echo "Clave creada: $KEYSTORE (contraseña en $PASSFILE). Haz una copia de seguridad de los dos."
  keytool -list -v -keystore "$KEYSTORE" -storepass:file "$PASSFILE" | grep -E "SHA256:" | head -1
  exit 0
fi

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$TC/android-sdk}}"
BT="$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)"
JAR="$SDK/platforms/android-$API/android.jar"
[ -n "$BT" ] && [ -x "$BT/aapt2" ] || { echo "Faltan las build-tools del SDK de Android en $SDK (native/android/setup.sh)" >&2; exit 1; }
[ -f "$JAR" ] || { echo "Falta la plataforma android-$API en $SDK (native/android/setup.sh)" >&2; exit 1; }

VERSION="$(sed -n 's/^  "version": "\([0-9.]*\)",$/\1/p' "$ROOT/package.json" | head -1)"
IFS=. read -r MA MI PA <<< "$VERSION"
CODE=$((MA * 10000 + MI * 100 + PA))
echo "Aula $VERSION (versionCode $CODE) · build-tools $(basename "$BT") · android-$API"

rm -rf "$OUT/tmp" && mkdir -p "$OUT/tmp"
T="$OUT/tmp"

# ── 1. el componente de Tailscale (un binario estático por arquitectura) ──
"$ROOT/native/tsnet/build.sh" android >/dev/null

# ── 2. los dibujos: los mismos de la app del iPhone (claro y oscuro) y el icono ──
GEN="$T/gen-res"
mkdir -p "$GEN/drawable-nodpi" "$GEN/drawable-night-nodpi"
A="$ROOT/native/ios/Aula/Assets.xcassets"
for pair in ArchDawn:arch_dawn ArchNoon:arch_noon ArchDusk:arch_dusk ArchNight:arch_night SpotLamp:spot_lamp; do
  cp "$A/${pair%%:*}.imageset/light.png" "$GEN/drawable-nodpi/${pair##*:}.png"
  cp "$A/${pair%%:*}.imageset/dark.png" "$GEN/drawable-night-nodpi/${pair##*:}.png"
done
# icono adaptable: el arco entero dentro de la zona que ninguna forma recorta (76 de 108 dp), sobre el mismo papel
for pair in mdpi:108 hdpi:162 xhdpi:216 xxhdpi:324 xxxhdpi:432; do
  size=${pair##*:}
  mkdir -p "$GEN/mipmap-${pair%%:*}"
  java -Djava.awt.headless=true "$HERE/tools/Icon.java" "$A/AppIcon.appiconset/icon-1024.png" \
    "$GEN/mipmap-${pair%%:*}/ic_launcher_foreground.png" "$size" $(( size * 76 / 108 )) F2EADC
done

# ── 3. recursos y manifiesto ──
"$BT/aapt2" compile --dir "$HERE/res" -o "$T/res.zip"
"$BT/aapt2" compile --dir "$GEN" -o "$T/gen.zip"
mkdir -p "$T/java"
DEBUG_MODE=()
[ "$mode" = debug ] && DEBUG_MODE=(--debug-mode)   # la de prueba se puede depurar (adb run-as); la publicada, no
"$BT/aapt2" link -I "$JAR" --manifest "$HERE/AndroidManifest.xml" -o "$T/base.apk" --java "$T/java" "${DEBUG_MODE[@]}" \
  --min-sdk-version $MIN_SDK --target-sdk-version $API --version-code $CODE --version-name "$VERSION" \
  --auto-add-overlay "$T/res.zip" "$T/gen.zip"

# ── 4. el código ──
mkdir -p "$T/classes" "$T/dex"
find "$HERE/src" "$T/java" -name '*.java' > "$T/sources.txt"
javac --release 17 -encoding UTF-8 -Xlint:-options -classpath "$JAR" -d "$T/classes" @"$T/sources.txt"
"$BT/d8" --release --min-api $MIN_SDK --lib "$JAR" --output "$T/dex" $(find "$T/classes" -name '*.class')

# ── 5. el paquete: recursos + código + componente de Tailscale; alineado y firmado ──
cp "$T/base.apk" "$T/unsigned.apk"
(cd "$T/dex" && zip -q -X "$T/unsigned.apk" classes.dex)
mkdir -p "$T/pkg/lib"
for abi in arm64-v8a x86_64; do
  mkdir -p "$T/pkg/lib/$abi"
  cp "$ROOT/native/tsnet/bin/android/$abi/libaulatsnet.so" "$T/pkg/lib/$abi/"
done
(cd "$T/pkg" && zip -q -X -r "$T/unsigned.apk" lib)
"$BT/zipalign" -P 16 -f 4 "$T/unsigned.apk" "$T/aligned.apk"

if [ "$mode" = debug ]; then
  DKS="$OUT/debug.keystore"
  [ -f "$DKS" ] || keytool -genkeypair -keystore "$DKS" -storetype PKCS12 -alias debug -keyalg EC -groupname secp256r1 \
    -validity 10000 -dname "CN=Aula debug" -storepass android -keypass android >/dev/null
  APK="$OUT/Aula-$VERSION-android-debug.apk"
  "$BT/apksigner" sign --ks "$DKS" --ks-pass pass:android --key-pass pass:android --out "$APK" "$T/aligned.apk"
else
  [ -f "$KEYSTORE" ] && [ -f "$PASSFILE" ] || { echo "Falta la clave de Aula para Android ($KEYSTORE): native/android/build.sh --new-key" >&2; exit 1; }
  APK="$OUT/Aula-$VERSION-android.apk"
  "$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass "file:$PASSFILE" --key-pass "file:$PASSFILE" --out "$APK" "$T/aligned.apk"
fi
rm -f "$APK.idsig"
"$BT/apksigner" verify --min-sdk-version $MIN_SDK "$APK"
rm -rf "$T"
echo "$APK ($(du -h "$APK" | cut -f1))"
