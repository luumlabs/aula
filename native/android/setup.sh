#!/bin/bash
# Instala en <raíz>/.toolchain lo que necesita native/android/build.sh, sin tocar nada fuera del proyecto:
#   · un JDK (Eclipse Temurin 21, de Adoptium), comprobado con su SHA-256;
#   · el SDK de Android: las herramientas de línea de órdenes de Google (comprobadas con su SHA-1 del catálogo de Google) y,
#     con ellas, build-tools, la plataforma android-36 y platform-tools (adb);
#   · con --emulator, también el emulador y una imagen de sistema para probar la app (unos 2 GB más).
#
#   native/android/setup.sh [--emulator]
#
# El SDK de Android tiene su propia licencia (https://developer.android.com/studio/terms): quien ejecuta este guion la
# acepta. Con las herramientas antiguas (sdkmanager) se enseña y se pregunta; AULA_ACCEPT_ANDROID_LICENSES=1 la da por
# leída.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TC="$ROOT/.toolchain"
SDK="$TC/android-sdk"
API=36
BUILD_TOOLS=37.0.0
mkdir -p "$TC"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) os=mac; arch=aarch64; gos=mac_arm64; img=arm64-v8a ;;
  Darwin-x86_64) os=mac; arch=x64; gos=mac_x86_64; img=x86_64 ;;
  Linux-x86_64) os=linux; arch=x64; gos=linux; img=x86_64 ;;
  Linux-aarch64) os=linux; arch=aarch64; gos=linux; img=arm64-v8a ;;
  *) echo "Sistema no previsto: $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac

# ── el JDK ──
if [ ! -d "$TC/jdk" ]; then
  echo "· JDK 21 (Temurin)"
  meta=$(curl -fsSL "https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=$arch&image_type=jdk&os=$os&vendor=eclipse")
  url=$(printf '%s' "$meta" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const a=JSON.parse(s)[0];console.log(a.binary.package.link)})')
  sum=$(printf '%s' "$meta" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const a=JSON.parse(s)[0];console.log(a.binary.package.checksum)})')
  curl -fsSL -o "$TC/jdk.tar.gz" "$url"
  echo "$sum  $TC/jdk.tar.gz" | shasum -a 256 -c - >/dev/null
  mkdir -p "$TC/jdk" && tar -xzf "$TC/jdk.tar.gz" -C "$TC/jdk" --strip-components 1 && rm "$TC/jdk.tar.gz"
fi
JAVA_HOME="$TC/jdk"; [ -d "$TC/jdk/Contents/Home" ] && JAVA_HOME="$TC/jdk/Contents/Home"
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"
java -version 2>&1 | head -1

# ── las herramientas de línea de órdenes de Google ──
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "· Android SDK command-line tools"
  xml=$(curl -fsSL https://dl.google.com/android/repository/repository2-3.xml)
  read -r zip sha <<< "$(printf '%s' "$xml" | node -e '
    let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{
      const pkg=/<remotePackage path="cmdline-tools;latest">([\s\S]*?)<\/remotePackage>/.exec(s)[1]
      for (const a of pkg.match(/<archive>[\s\S]*?<\/archive>/g)) {
        const url=/<url>(.*?)<\/url>/.exec(a)[1]
        if (url.includes(process.argv[1])) { console.log(url, /checksum type="sha1">(\w+)</.exec(a)[1]); return }
      }
      process.exit(1)
    })' "$gos")"
  curl -fsSL -o "$TC/cmdline-tools.zip" "https://dl.google.com/android/repository/$zip"
  echo "$sha  $TC/cmdline-tools.zip" | shasum -a 1 -c - >/dev/null
  rm -rf "$TC/cmdline-tmp" && mkdir -p "$TC/cmdline-tmp" "$SDK/cmdline-tools"
  (cd "$TC/cmdline-tmp" && unzip -q "$TC/cmdline-tools.zip")
  rm -rf "$SDK/cmdline-tools/latest" && mv "$TC/cmdline-tmp/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -rf "$TC/cmdline-tmp" "$TC/cmdline-tools.zip"
fi
# ── los paquetes. Las herramientas nuevas de Google (cmdline-tools 23 o posterior) traen «android sdk» en lugar de
# sdkmanager, con los nombres separados por «/» y sin paso de licencias aparte (sus términos se enseñan al usarla); se le
# pide que no mande métricas de uso (--no-metrics). Con unas anteriores, sdkmanager y su paso de licencias. ──
NEWCLI="$SDK/cmdline-tools/latest/bin/android"
pkgs=("platform-tools" "build-tools;$BUILD_TOOLS" "platforms;android-$API")
[ "${1:-}" = "--emulator" ] && pkgs+=("emulator" "system-images;android-$API;google_apis;$img")
echo "· ${pkgs[*]}"
if [ -x "$NEWCLI" ]; then
  "$NEWCLI" --no-metrics --sdk="$SDK" sdk install "${pkgs[@]//;//}"
else
  SDKM="$SDK/cmdline-tools/latest/bin/sdkmanager"
  if [ "${AULA_ACCEPT_ANDROID_LICENSES:-}" = 1 ]; then yes | "$SDKM" --sdk_root="$SDK" --licenses >/dev/null
  else "$SDKM" --sdk_root="$SDK" --licenses; fi
  "$SDKM" --sdk_root="$SDK" --install "${pkgs[@]}"
fi
echo "Listo: JAVA_HOME=$JAVA_HOME ANDROID_HOME=$SDK"
