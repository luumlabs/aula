#!/bin/bash
# Builds native/tsnet/bin/aula-tsnet (macOS universal: arm64 + x86_64, like the app) with the project-local Go
# toolchain in <root>/.toolchain/go. GOPATH, GOCACHE and GOMODCACHE are kept
# under <root>/.toolchain so nothing is written to the user's home.
#
#   native/tsnet/build.sh          # build
#   native/tsnet/build.sh test     # go vet + go test, then build
#
# Offline by default (GOPROXY=off: the modules are already in .toolchain/gopath)
# and reproducible (-trimpath, no build id). To fetch modules the first time:
#   GOPROXY= native/tsnet/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TC="$ROOT/.toolchain"

if [ ! -x "$TC/go/bin/go" ]; then
  cat >&2 <<EOF
error: Go toolchain not found at $TC/go
Download the latest stable darwin-arm64 archive from https://go.dev/dl/,
verify its sha256 against https://go.dev/dl/?mode=json, then:
  mkdir -p "$TC" && tar -xzf go<version>.darwin-arm64.tar.gz -C "$TC"
EOF
  exit 1
fi
if [ ! -f "$TC/env.sh" ]; then
  cat > "$TC/env.sh" <<'EOF'
# Source this file to use the project-local Go toolchain.
# Everything (GOPATH, build cache, module cache) stays under <root>/.toolchain.
_aula_tc_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export PATH="$_aula_tc_dir/go/bin:$PATH"
export GOPATH="$_aula_tc_dir/gopath"
export GOCACHE="$_aula_tc_dir/gocache"
export GOMODCACHE="$_aula_tc_dir/gopath/pkg/mod"
export GOTOOLCHAIN=local
unset _aula_tc_dir
EOF
fi
# shellcheck source=/dev/null
source "$TC/env.sh"
export GOPROXY="${GOPROXY-off}"
export GOFLAGS="${GOFLAGS:-} -mod=readonly"

cd "$HERE"
if [ "${1:-}" = "test" ]; then
  go vet ./...
  go test -count=1 ./...
fi

mkdir -p bin
for arch in arm64 amd64; do
  GOOS=darwin GOARCH=$arch CGO_ENABLED=0 \
    go build -trimpath -ldflags "-s -w -buildid=" -o "bin/aula-tsnet-$arch" .
done
# one file for both kinds of Mac (the app is universal; @electron/universal leaves an already-universal binary alone)
lipo -create -output bin/aula-tsnet bin/aula-tsnet-arm64 bin/aula-tsnet-amd64
rm -f bin/aula-tsnet-arm64 bin/aula-tsnet-amd64
echo "built $HERE/bin/aula-tsnet ($(go version | awk '{print $3}'), tailscale.com $(go list -m -f '{{.Version}}' tailscale.com))"
