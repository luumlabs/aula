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
# archivo de al lado (.pass, 0600). La huella de su certificado (pública) está en release-cert.sha256: con la clave por
# defecto, el APK solo se firma si coincide, y --new-key se niega si ese archivo existe.
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

DEFAULT_KEYSTORE="$HOME/.aula-signing/android/aula-release.keystore"
KEYSTORE="${AULA_ANDROID_KEYSTORE:-$DEFAULT_KEYSTORE}"
PASSFILE="${KEYSTORE%.keystore}.pass"
# la huella de la clave de Aula para Android (el SHA-256 de su certificado), la misma que exige scripts/release-local.sh
PIN_FILE="$HERE/release-cert.sha256"
if [ "$mode" = newkey ]; then
  if [ -e "$PIN_FILE" ]; then
    echo "La clave de Aula para Android ya existe (su huella está en $PIN_FILE): una nueva no serviría, Android no" \
      "instalaría el APK encima de la app. Restaura la buena de su copia de seguridad (docs/PUBLISHING.md → Keeping the keys)." >&2
    exit 1
  fi
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
BT="$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1 || true)"
JAR="$SDK/platforms/android-$API/android.jar"
[ -n "$BT" ] && [ -x "$BT/aapt2" ] || { echo "Faltan las build-tools del SDK de Android en $SDK (native/android/setup.sh)" >&2; exit 1; }
[ -f "$JAR" ] || { echo "Falta la plataforma android-$API en $SDK (native/android/setup.sh)" >&2; exit 1; }

# la huella de PIN_FILE en minúsculas y sin «:», leída como scripts/release-local.sh (sin «SHA256:» ni comentarios «#»)
pin_sha256() {
  sed -e 's/#.*//' -e 's/[Ss][Hh][Aa]-\{0,1\}256//g' "$PIN_FILE" | tr -d ' :\t\r\n' | tr 'A-F' 'a-f'
}

# el SHA-256 del certificado de la clave (el primero que da keytool), en minúsculas y sin «:»; la contraseña va por archivo
keystore_sha256() {
  keytool -list -rfc -keystore "$KEYSTORE" -storepass:file "$PASSFILE" 2>/dev/null \
    | awk '/-----BEGIN CERTIFICATE-----/ && !seen { on = 1 } on { print } /-----END CERTIFICATE-----/ && on { on = 0; seen = 1 }' \
    | openssl x509 -noout -fingerprint -sha256 2>/dev/null | sed 's/^.*=//' | tr -d ':' | tr 'A-F' 'a-f'
}

# Antes de compilar: la clave tiene que estar y, si es la de siempre (la ruta por defecto), ser la de la huella del
# repositorio. Otra clave (AULA_ANDROID_KEYSTORE: una de prueba, la de CI) no se compara: release-local.sh no la publicaría
if [ "$mode" = release ]; then
  if [ ! -f "$KEYSTORE" ] || [ ! -f "$PASSFILE" ]; then
    if [ -e "$PIN_FILE" ]; then
      echo "Falta la clave de Aula para Android ($KEYSTORE y su .pass): restáurala de su copia de seguridad (docs/PUBLISHING.md → Keeping the keys)." >&2
    else
      echo "Falta la clave de Aula para Android ($KEYSTORE y su .pass): restáurala de su copia de seguridad o, solo si ninguna versión publicada lleva aún un APK, native/android/build.sh --new-key" >&2
    fi
    exit 1
  fi
  if [ -e "$PIN_FILE" ] && [ "$KEYSTORE" = "$DEFAULT_KEYSTORE" ]; then
    command -v openssl >/dev/null || { echo "Falta openssl para comparar la clave con $PIN_FILE" >&2; exit 1; }
    PIN="$(pin_sha256)"
    printf '%s\n' "$PIN" | grep -Ex '[0-9a-f]{64}' >/dev/null \
      || { echo "$PIN_FILE no es una huella SHA-256 (64 cifras hexadecimales, con o sin «:»)." >&2; exit 1; }
    GOT="$(keystore_sha256 || true)"
    [ -n "$GOT" ] || { echo "No se pudo leer el certificado de $KEYSTORE (¿la contraseña de su .pass?)." >&2; exit 1; }
    if [ "$GOT" != "$PIN" ]; then
      echo "La clave de $KEYSTORE no es la de Aula para Android: su certificado (SHA-256 $GOT) no es el de $PIN_FILE" \
        "($PIN). Restaura la buena de su copia de seguridad (docs/PUBLISHING.md → Keeping the keys): firmado con otra," \
        "Android no instalaría el APK encima de la app." >&2
      exit 1
    fi
    echo "Clave de Aula para Android: la de $PIN_FILE"
  elif [ -e "$PIN_FILE" ]; then
    echo "Clave de AULA_ANDROID_KEYSTORE ($KEYSTORE): no se compara con $PIN_FILE (scripts/release-local.sh no publica un APK de otra clave)"
  fi
fi

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
# (sin listas vacías: con set -u, el bash 3.2 del Mac da «"${A[@]}"» de una lista vacía por variable sin definir)
LINK=(-I "$JAR" --manifest "$HERE/AndroidManifest.xml" -o "$T/base.apk" --java "$T/java"
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$API" --version-code "$CODE" --version-name "$VERSION" --auto-add-overlay)
if [ "$mode" = debug ]; then LINK+=(--debug-mode); fi   # la de prueba se puede depurar (adb run-as); la publicada, no
"$BT/aapt2" link "${LINK[@]}" "$T/res.zip" "$T/gen.zip"

# ── 4. el código ──
mkdir -p "$T/classes" "$T/dex"
find "$HERE/src" "$T/java" -name '*.java' > "$T/sources.txt"
javac --release 17 -encoding UTF-8 -Xlint:-options -classpath "$JAR" -d "$T/classes" @"$T/sources.txt"
# las reglas que no dependen de Android (Tunnel.java), comprobadas en la JVM: si alguna falla, no hay paquete
mkdir -p "$T/test"
javac --release 17 -encoding UTF-8 -Xlint:-options -classpath "$T/classes" -d "$T/test" "$HERE/tools/TunnelTest.java"
java -cp "$T/classes:$T/test" com.luumlabs.aula.TunnelTest
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
  # (la clave y su huella ya se comprobaron antes de compilar)
  APK="$OUT/Aula-$VERSION-android.apk"
  # solo --ks-pass: con el mismo archivo en --key-pass, apksigner lee una línea por contraseña y la segunda no existe.
  # En un almacén PKCS12 (--new-key) la clave lleva la contraseña del almacén, que apksigner prueba primero; sin
  # entrada, si no valiera, falla en vez de quedarse esperando a que se escriba otra.
  "$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass "file:$PASSFILE" --out "$APK" "$T/aligned.apk" </dev/null
fi
rm -f "$APK.idsig"
"$BT/apksigner" verify --min-sdk-version $MIN_SDK "$APK"
rm -rf "$T"
echo "$APK ($(du -h "$APK" | cut -f1))"
