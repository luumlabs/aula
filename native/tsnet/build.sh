#!/bin/bash
# Builds the Tailscale sidecar:
#   native/tsnet/build.sh [test] [darwin]   bin/aula-tsnet (macOS universal: arm64 + x86_64, like the app)
#   native/tsnet/build.sh [test] linux      bin/linux-x64/aula-tsnet and bin/linux-arm64/aula-tsnet (the Linux app and the
#                                           server, see docs/SERVER.md)
#   native/tsnet/build.sh [test] android    the Android app's client (native/android): bin/android/<abi>/libaulatsnet.so
#   native/tsnet/build.sh [test] all        everything above
# `test` runs go vet + go test first.
#
# With the project-local Go toolchain in <root>/.toolchain/go (GOPATH, GOCACHE and GOMODCACHE are kept under
# <root>/.toolchain so nothing is written to the user's home) it builds offline by default (GOPROXY=off: the modules are
# already in .toolchain/gopath); to fetch modules the first time: GOPROXY= native/tsnet/build.sh. Without it (CI), the
# `go` on the PATH is used: it fetches the Go version go.mod asks for and the modules (checked against go.sum).
# Reproducible: -trimpath, no build id, CGO off (static binaries).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TC="$ROOT/.toolchain"

if [ -x "$TC/go/bin/go" ]; then
  if [ ! -f "$TC/env.sh" ]; then
    {
      echo '# Source this file to use the project-local Go toolchain.'
      echo '# Everything (GOPATH, build cache, module cache) stays under <root>/.toolchain.'
      echo '_aula_tc_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"'
      echo 'export PATH="$_aula_tc_dir/go/bin:$PATH"'
      echo 'export GOPATH="$_aula_tc_dir/gopath"'
      echo 'export GOCACHE="$_aula_tc_dir/gocache"'
      echo 'export GOMODCACHE="$_aula_tc_dir/gopath/pkg/mod"'
      echo 'export GOTOOLCHAIN=local'
      echo 'unset _aula_tc_dir'
    } > "$TC/env.sh"
  fi
  # shellcheck source=/dev/null
  source "$TC/env.sh"
  export GOPROXY="${GOPROXY-off}"
elif command -v go >/dev/null 2>&1; then
  # CI: the system Go downloads the version go.mod asks for (GOTOOLCHAIN=auto) and the modules
  export GOTOOLCHAIN="${GOTOOLCHAIN:-auto}"
else
  echo "error: Go toolchain not found at $TC/go (and no go on the PATH)" >&2
  echo "Download the latest stable darwin-arm64 archive from https://go.dev/dl/," >&2
  echo "verify its sha256 against https://go.dev/dl/?mode=json, then:" >&2
  echo "  mkdir -p \"$TC\" && tar -xzf go<version>.darwin-arm64.tar.gz -C \"$TC\"" >&2
  exit 1
fi
export GOFLAGS="${GOFLAGS:-} -mod=readonly"

cd "$HERE"
if [ "${1:-}" = "test" ]; then
  go vet ./...
  go test -count=1 ./...
  shift
fi
what="${1:-darwin}"
LDFLAGS="-s -w -buildid="

build_darwin() {
  mkdir -p bin
  for arch in arm64 amd64; do
    GOOS=darwin GOARCH=$arch CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS" -o "bin/aula-tsnet-$arch" .
  done
  # one file for both kinds of Mac (the app is universal; @electron/universal leaves an already-universal binary alone)
  lipo -create -output bin/aula-tsnet bin/aula-tsnet-arm64 bin/aula-tsnet-amd64
  rm -f bin/aula-tsnet-arm64 bin/aula-tsnet-amd64
  echo "built $HERE/bin/aula-tsnet"
}

build_linux() {
  # the folder names are electron-builder's ${arch} (x64, arm64): electron-builder.yml → linux.extraResources
  for pair in x64:amd64 arm64:arm64; do
    mkdir -p "bin/linux-${pair%%:*}"
    GOOS=linux GOARCH=${pair##*:} CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS" -o "bin/linux-${pair%%:*}/aula-tsnet" .
    echo "built $HERE/bin/linux-${pair%%:*}/aula-tsnet"
  done
}

build_android() {
  # a static Linux binary that the Android app runs as a child process (packed as lib/<abi>/libaulatsnet.so so Android
  # installs it executable); tailscale.com/feature/androidbin makes it work as an app's process (interfaces, DNS, certificates)
  for pair in arm64-v8a:arm64 x86_64:amd64; do
    mkdir -p "bin/android/${pair%%:*}"
    GOOS=linux GOARCH=${pair##*:} CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS" -o "bin/android/${pair%%:*}/libaulatsnet.so" ./client
    echo "built $HERE/bin/android/${pair%%:*}/libaulatsnet.so"
  done
}

case "$what" in
  darwin) build_darwin ;;
  linux) build_linux ;;
  android) build_android ;;
  all) build_darwin; build_linux; build_android ;;
  *) echo "usage: $0 [test] [darwin|linux|android|all]" >&2; exit 2 ;;
esac
echo "($(go version | awk '{print $3}'), tailscale.com $(go list -m -f '{{.Version}}' tailscale.com))"
