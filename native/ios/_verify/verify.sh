#!/bin/bash
# Comprueba la app de Aula para iPhone y iPad hasta donde llega esta máquina:
#   1. El túnel local (LoopbackForwarder.swift) de verdad, en macOS, con una red privada de pega; qué equipos de la red
#      son una Aula de esta persona (AulaHosts.swift); y el servidor de la demostración (DemoServer.swift) contra el
#      archivo grabado, si está.
#   2. El nodo de Tailscale de la app (TailnetController + TailscaleKit + libtailscale sin registros) compilado para
#      macOS desde las fuentes oficiales y arrancado: debe llegar a pedir el inicio de sesión (o a conectarse).
#      De paso compila toda la app (SwiftUI incluida) para macOS, en modo Swift 6.
#   3. Solo con Xcode completo: compila la app para el simulador de iOS (sin firmar).
# Los pasos 1 y 2 funcionan solo con las Command Line Tools. Lo que se genera va a _verify/.derived/ (se puede borrar).
#   native/ios/_verify/verify.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd ../.. && pwd)"
TC="$ROOT/.toolchain"
OUT="_verify/.derived"
MAC="$OUT/mac"
mkdir -p "$MAC"
SWIFT=(xcrun swiftc -swift-version 6 -O -target arm64-apple-macos15.0)

echo "=== 1. El túnel local, en macOS ==="
"${SWIFT[@]}" Aula/Tailnet/LoopbackForwarder.swift _verify/ForwarderTest/main.swift -o "$OUT/forwarder-test"
"$OUT/forwarder-test" | grep -v '^PASS' || true
"$OUT/forwarder-test" >/dev/null

echo "=== 1b. Qué equipos de la red son una Aula de esta persona ==="
"${SWIFT[@]}" Aula/Tailnet/AulaHosts.swift _verify/HostsTest/main.swift -o "$OUT/hosts-test"
"$OUT/hosts-test" | grep -v '^PASS' || true
"$OUT/hosts-test" >/dev/null

echo "=== 1c. El servidor de la demostración, en macOS ==="
if [ -f Aula/Demo.aulademo ]; then
  "${SWIFT[@]}" Aula/DemoServer.swift _verify/DemoTest/main.swift -o "$OUT/demo-test"
  "$OUT/demo-test" Aula/Demo.aulademo | grep -v '^PASS' || true
  "$OUT/demo-test" Aula/Demo.aulademo >/dev/null
else
  echo "(sin Aula/Demo.aulademo: grábala con «npm run build && node scripts/dev/ios-demo.mjs»; la app sale sin demostración)"
fi

echo "=== 2. El nodo de Tailscale de la app, en macOS ==="
if [ ! -x "$TC/go/bin/go" ]; then
  echo "error: falta la herramienta de Go del proyecto en $TC/go (native/tsnet/build.sh dice cómo ponerla)" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$TC/env.sh"
SRC="$TC/src/libtailscale"
REF="$(sed -n 's/^LIBTAILSCALE_REF="\${LIBTAILSCALE_REF:-\(.*\)}"$/\1/p' build-tailscalekit.sh)"
if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$TC/src"
  git clone -q https://github.com/tailscale/libtailscale "$SRC"
fi
if [ "$(git -C "$SRC" rev-parse HEAD)" != "$REF" ]; then
  git -C "$SRC" fetch -q origin
  git -C "$SRC" checkout -q --detach "$REF"
fi
cp tailscalekit/aula_nologs.go "$SRC/aula_nologs.go"
(cd "$SRC" && MACOSX_DEPLOYMENT_TARGET=15.0 CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags -w -buildmode=c-archive -o libtailscale.a)
# TailscaleKit como lo monta su proyecto de Xcode: el .h de C y las fuentes Swift en un mismo módulo
FW="$MAC/TailscaleKit.framework"
rm -rf "$FW"
mkdir -p "$FW/Headers" "$FW/Modules/TailscaleKit.swiftmodule"
cp "$SRC/swift/TailscaleKit/TailscaleKit.h" "$FW/Headers/"
printf 'framework module TailscaleKit {\n  umbrella header "TailscaleKit.h"\n  export *\n  module * { export * }\n}\n' > "$FW/Modules/module.modulemap"
find "$SRC/swift/TailscaleKit" -name '*.swift' -print0 | xargs -0 "${SWIFT[@]}" -suppress-warnings -module-name TailscaleKit -import-underlying-module -F "$MAC" -parse-as-library \
  -emit-module -emit-module-path "$FW/Modules/TailscaleKit.swiftmodule/arm64-apple-macos.swiftmodule" \
  -emit-library -o "$FW/TailscaleKit" -Xlinker -install_name -Xlinker @rpath/TailscaleKit.framework/TailscaleKit \
  "$SRC/libtailscale.a" -framework CoreFoundation -framework Security -framework IOKit -lresolv
LINK=(-F "$MAC" -framework TailscaleKit -Xlinker -rpath -Xlinker "$PWD/$MAC")
echo "--- compila toda la app (macOS, Swift 6)"
"${SWIFT[@]}" "${LINK[@]}" -parse-as-library Aula/*.swift Aula/Tailnet/*.swift -o "$MAC/aula-app-check"
echo "--- arranca el nodo"
"${SWIFT[@]}" "${LINK[@]}" Aula/Tailnet/TailnetController.swift Aula/Tailnet/AulaHosts.swift Aula/Tailnet/LoopbackForwarder.swift _verify/NodeSmoke/main.swift -o "$MAC/node-smoke"
STATE="${AULA_TAILSCALE_DIR:-$(mktemp -d)/tailscale}"
AULA_TAILSCALE_DIR="$STATE" perl -e 'alarm 120; exec @ARGV' "$MAC/node-smoke" 2>&1 | grep -E '^(PASS|FAIL|estado)'

if xcodebuild -version >/dev/null 2>&1; then
  echo "=== 3. La app para el simulador de iOS ==="
  [ -d Frameworks/TailscaleKit.xcframework ] || ./build-tailscalekit.sh
  xcodebuild build -project Aula.xcodeproj -scheme Aula -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$OUT/xcode" CODE_SIGNING_ALLOWED=NO -quiet
  echo "PASS  la app compila para el simulador de iOS"
else
  echo "=== 3. (omitido) sin Xcode completo no se puede compilar para iOS ==="
fi
echo "TODO BIEN"
