#!/usr/bin/env bash
# Compila una versión de Aula EN ESTE ORDENADOR (sin GitHub Actions) y, solo si se pide con --upload, la sube a GitHub
# como BORRADOR. Nunca publica: la versión no la ve nadie (ni se ofrece como actualización) hasta que pulses
# «Publish release» en GitHub. Pasos completos: docs/PUBLISHING.md.
#
#   scripts/release-local.sh                 comprobaciones + instaladores de macOS, Windows y Linux en release/<versión>/
#   scripts/release-local.sh --only mac      solo un sistema (mac | win | linux; se puede repetir). Recompila SOLO ese
#                                            sistema: los archivos ya compilados de los otros se quedan como están
#   scripts/release-local.sh --skip-checks   sin typecheck ni pruebas (si ya las pasaste)
#   scripts/release-local.sh --upload --repo luumlabs/aula [--partial]
#                                            sube lo ya compilado y comprobado a un borrador de ese repositorio (necesita
#                                            `gh`). El repositorio se dice SIEMPRE a mano (nunca se deduce de origin) y
#                                            tiene que ser el de electron-builder.yml → publish (el que miran las copias).
#                                            Sin los tres sistemas se niega (publicada, los que faltan dejarían de ver
#                                            versiones): --partial para subirla así a sabiendas
#
# macOS se firma con el certificado propio «Aula Local Signing» (~/.aula-signing/, scripts/build/mac-sign.cjs): sin él
# se niega, porque las copias ya firmadas con él rechazarían una versión ad hoc. AULA_MAC_ADHOC=1 para probar sin él.
#
# Hecho para macOS (el único sistema que puede firmar y compilar los tres). En Windows o Linux, usa --only con el suyo.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

ONLY=()
CHECKS=1
UPLOAD=0
PARTIAL=0
REPO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only)
      [ $# -ge 2 ] || die "--only necesita un sistema: mac, win o linux"
      case "$2" in mac|win|linux) ONLY+=("$2") ;; *) die "Sistema desconocido: «$2» (mac, win o linux)" ;; esac
      shift 2 ;;
    --skip-checks) CHECKS=0; shift ;;
    --upload) UPLOAD=1; shift ;;
    --partial) PARTIAL=1; shift ;;
    --repo)
      [ $# -ge 2 ] || die "--repo necesita <dueño>/<repositorio>, p. ej. --repo luumlabs/aula"
      REPO="$2"; shift 2 ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *) die "Opción desconocida: $1 (usa --help)" ;;
  esac
done
ALL=0
[ ${#ONLY[@]} -eq 0 ] && { ONLY=(mac win linux); ALL=1; }

VERSION=$(node -p "require('./package.json').version")
OUT="release/$VERSION"
TAG="v$VERSION"
NOTES="docs/release-notes/$VERSION.md"
# el repositorio que miran las copias instaladas para actualizarse
PUB_OWNER=$(sed -n 's/^  owner: *//p' electron-builder.yml | head -1)
PUB_REPO=$(sed -n 's/^  repo: *//p' electron-builder.yml | head -1)
TITLE=$(sed -n 's/^  releaseName: *//p' electron-builder.yml | head -1)

# ── Subir (solo si se pide) ────────────────────────────────────────────────────────────────────────────────────────
if [ $UPLOAD -eq 1 ]; then
  [ -n "$REPO" ] || die "Di a qué repositorio se sube: --upload --repo $PUB_OWNER/$PUB_REPO (no se deduce de origin)."
  [ "$REPO" = "$PUB_OWNER/$PUB_REPO" ] \
    || die "--repo $REPO no es el de electron-builder.yml → publish ($PUB_OWNER/$PUB_REPO): las copias instaladas no lo verían."
  command -v gh >/dev/null || die "Falta la herramienta gh (https://cli.github.com) y haber hecho «gh auth login»."
  [ -d "$OUT" ] || die "No hay nada compilado en $OUT: lanza antes scripts/release-local.sh"
  [ -f "$NOTES" ] || die "Faltan las notas $NOTES"
  node scripts/release-verify.mjs "$OUT" "$VERSION" || die "La carpeta $OUT no pasa la comprobación."
  # firma propia de las actualizaciones (Ed25519): sin ella las copias instaladas rechazan la versión (docs/PUBLISHING.md)
  node scripts/release-sign.mjs --verify "$OUT" || die "Los latest*.yml de $OUT no llevan la firma de Aula: vuelve a compilar."
  [ -z "$(git status --porcelain)" ] || die "Hay cambios sin guardar en git: haz commit (y push) antes de subir."
  # los tres sistemas (A1-P2-21): publicada sin uno, esa pasa a ser «la última» y ese sistema deja de ver versiones
  MISSING=()
  for y in latest-mac.yml latest.yml latest-linux.yml latest-linux-arm64.yml; do [ -f "$OUT/$y" ] || MISSING+=("$y"); done
  if [ ${#MISSING[@]} -gt 0 ] && [ $PARTIAL -eq 0 ]; then
    die "Faltan ${MISSING[*]} en $OUT: publicada así, esos sistemas dejarían de ver versiones. Compílalos (--only) o usa --partial a sabiendas."
  fi
  # el título de cada latest*.yml es el de electron-builder.yml (releaseInfo.releaseName)
  for y in "$OUT"/latest*.yml; do
    [ -f "$y" ] || continue
    [ "$(sed -n 's/^releaseName: *//p' "$y" | head -1)" = "$TITLE" ] || die "$(basename "$y") no dice «releaseName: $TITLE»: vuelve a compilar ese sistema."
  done
  # cada archivo que nombran las notas tiene que estar (A5-P1-3: las notas prometían una .deb que no se subió)
  for f in $(grep -oE 'Aula-[A-Za-z0-9._-]+\.(dmg|zip|exe|AppImage|deb)' "$NOTES" | sort -u); do
    [ -f "$OUT/$f" ] || die "Las notas ($NOTES) nombran $f, que no está en $OUT."
  done
  # macOS: firmado con el certificado propio (si no, las copias firmadas con él la rechazarían)
  if [ -d "$OUT/mac-universal/Aula.app" ] && [ "${AULA_MAC_ADHOC:-}" != 1 ]; then
    codesign -d -r- "$OUT/mac-universal/Aula.app" 2>&1 | grep -q 'certificate root = H"' \
      || die "La app de macOS de $OUT no está firmada con «Aula Local Signing»: vuelve a compilar mac en este Mac (docs/PUBLISHING.md → Signing)."
  fi
  HEAD_SHA=$(git rev-parse HEAD)
  # lo compilado tiene que ser de ESTE contenido (el árbol de HEAD; vale una copia con el mismo árbol, como el commit
  # limpio del repositorio público) y de un árbol sin cambios (BUILD_INFO lo escribe la compilación)
  for p in mac win linux; do
    case "$p" in mac) y=latest-mac.yml ;; win) y=latest.yml ;; linux) y=latest-linux.yml ;; esac
    [ -f "$OUT/$y" ] || continue
    INFO="$OUT/BUILD_INFO.$p"
    [ -f "$INFO" ] || die "Falta $INFO: vuelve a compilar $p con este guion."
    grep -qx "tree=$(git rev-parse 'HEAD^{tree}')" "$INFO" \
      || die "Lo de $p en $OUT se compiló desde otro contenido (commit $(sed -n 's/^commit=//p' "$INFO")): vuelve a compilar (--only $p)."
    grep -qx "dirty=0" "$INFO" || die "Lo de $p en $OUT se compiló con cambios sin commit: haz commit y vuelve a compilar (--only $p)."
  done
  # el commit tiene que estar ya en ESE repositorio (la release apunta a él)
  gh api "repos/$REPO/commits/$HEAD_SHA" --jq .sha >/dev/null 2>&1 \
    || die "El commit $HEAD_SHA no está en $REPO: súbelo (git push) a ese repositorio antes."
  VIS=$(gh repo view "$REPO" --json visibility -q .visibility 2>/dev/null || echo "?")
  [ "$VIS" = PUBLIC ] || printf '\n! %s es %s: con el repositorio privado las copias instaladas no ven las versiones.\n' "$REPO" "$VIS"
  if gh release view "$TAG" -R "$REPO" --json isDraft >/dev/null 2>&1; then
    [ "$(gh release view "$TAG" -R "$REPO" --json isDraft -q .isDraft)" = "true" ] || die "La $TAG ya está publicada en $REPO: sube otra versión (cambia \"version\")."
    die "Ya hay un borrador $TAG en $REPO. Bórralo allí (o sube los archivos a mano) antes de volver a subir."
  fi
  # lo que leen las copias instaladas (latest*.yml) y lo que descargan (instaladores, zip y sus .blockmap)
  shopt -s nullglob
  FILES=("$OUT"/latest*.yml "$OUT"/*.dmg "$OUT"/*.zip "$OUT"/*.exe "$OUT"/*.AppImage "$OUT"/*.deb "$OUT"/*.blockmap)
  shopt -u nullglob
  [ ${#MISSING[@]} -eq 0 ] || printf '\n! Release PARCIAL (--partial): faltan %s.\n' "${MISSING[*]}"
  # la página de GitHub enseña la parte en inglés de las notas; las copias leen las dos lenguas de latest*.yml
  BODY=$(mktemp)
  awk '/<!-- *lang:es *-->/ { exit } { print }' "$NOTES" > "$BODY"
  say "Subiendo ${#FILES[@]} archivos a un BORRADOR $TAG «${TITLE:-Aula $VERSION}» en $REPO (nadie lo ve hasta que lo publiques):"
  printf '  %s\n' "${FILES[@]##*/}"
  printf '  commit %s · notas: la parte en inglés de %s\n' "$HEAD_SHA" "$NOTES"
  read -r -p "Escribe «yes» para subirlo: " ok
  [ "$ok" = "yes" ] || die "Cancelado."
  gh release create "$TAG" -R "$REPO" --draft --target "$HEAD_SHA" --title "${TITLE:-Aula $VERSION}" --notes-file "$BODY" "${FILES[@]}"
  rm -f "$BODY"
  say "Listo: borrador $TAG creado en $REPO. Pruébalo y pulsa «Publish release» en GitHub cuando quieras que llegue a todos."
  exit 0
fi

[ -z "$REPO" ] || die "--repo solo sirve con --upload."

# ── Comprobar y compilar ───────────────────────────────────────────────────────────────────────────────────────────
grep -q "^$VERSION\$" VERSION || die "VERSION no coincide con package.json ($VERSION)."
grep -q "## \[$VERSION\]" CHANGELOG.md || die "CHANGELOG.md no tiene la entrada [$VERSION]."
[ -f "$NOTES" ] || die "Faltan las notas $NOTES (con <!-- lang:en --> y <!-- lang:es -->)."
grep -q "releaseNotesFile: $NOTES" electron-builder.yml || die "electron-builder.yml → releaseInfo.releaseNotesFile debe ser $NOTES."
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then die "La etiqueta $TAG ya existe: esa versión ya salió. Sube \"version\"."; fi

# la clave de firma, antes de los minutos de compilación (si falta o no es la de la app, mejor saberlo ya)
node scripts/release-sign.mjs --check-key || die "Sin la clave de firma de las actualizaciones no se puede publicar (docs/PUBLISHING.md)."
# nunca una compilación de auditoría (acepta --remote-debugging-port, src/main/electron/debug-guard.ts)
[ -z "${AULA_AUDIT_BUILD:-}" ] || die "AULA_AUDIT_BUILD está puesto: eso es para auditar, nunca para publicar. Quítalo (unset AULA_AUDIT_BUILD)."
# macOS: el certificado estable «Aula Local Signing» (scripts/build/mac-sign.cjs; A1-P1-5)
for p in "${ONLY[@]}"; do
  [ "$p" = mac ] || continue
  [ "${AULA_MAC_ADHOC:-}" = 1 ] && { printf '\n! AULA_MAC_ADHOC=1: macOS se firma ad hoc (solo para probar; --upload lo rechaza).\n'; continue; }
  [ -f "$HOME/.aula-signing/aula-signing.keychain-db" ] && [ -f "$HOME/.aula-signing/keychain.pass" ] \
    || die "Falta el llavero de «Aula Local Signing» (~/.aula-signing/aula-signing.keychain-db + keychain.pass): sin él, las copias de macOS rechazarían esta versión (docs/PUBLISHING.md → Signing)."
done

if [ $CHECKS -eq 1 ]; then
  say "Comprobaciones"
  npm run typecheck
  npm test
fi

say "Compilando $VERSION (${ONLY[*]})"
# de qué se compila (antes de compilar: lo que cuenta es el estado al empezar)
BUILD_COMMIT=$(git rev-parse HEAD); BUILD_TREE=$(git rev-parse 'HEAD^{tree}')
BUILD_DIRTY=$([ -z "$(git status --porcelain)" ] && echo 0 || echo 1)
npm run build
if [ $ALL -eq 1 ]; then
  rm -rf "$OUT"
else
  # solo lo de los sistemas que se recompilan; lo demás (ya probado) se queda
  mkdir -p "$OUT"
  for p in "${ONLY[@]}"; do
    case "$p" in
      mac)   rm -rf "$OUT"/Aula-*-mac.* "$OUT"/latest-mac.yml "$OUT"/mac* "$OUT"/BUILD_INFO.mac ;;
      win)   rm -rf "$OUT"/Aula-Setup-* "$OUT"/Aula-*-win-* "$OUT"/latest.yml "$OUT"/win-* "$OUT"/BUILD_INFO.win ;;
      linux) rm -rf "$OUT"/*.AppImage "$OUT"/*.deb "$OUT"/latest-linux*.yml "$OUT"/linux-* "$OUT"/BUILD_INFO.linux ;;
    esac
  done
fi
# un sistema cada vez (las arquitecturas de cada uno salen de electron-builder.yml); --publish never: aquí no se sube nada
for p in "${ONLY[@]}"; do
  case "$p" in
    mac) [ "$(uname)" = Darwin ] || die "El instalador de macOS solo se puede compilar (y firmar) en un Mac."
         npx electron-builder --mac --publish never -c.directories.output="$OUT" ;;
    win) npx electron-builder --win --publish never -c.directories.output="$OUT" ;;
    linux)
      DEB_OPTS=()
      if [ "$(uname)" = Darwin ]; then
        # la .deb necesita GNU tar en macOS: el de brew o el que trae electron-builder en su caché (linux-tools-mac)
        if ! command -v gtar >/dev/null; then
          GTAR=$(ls -d "$HOME"/Library/Caches/electron-builder/linux-tools-mac@*/linux-tools-mac-darwin-*/bin/gtar 2>/dev/null | tail -1 || true)
          [ -n "$GTAR" ] && export PATH="$(dirname "$GTAR"):$PATH"
        fi
        # sin el programa xz, la .deb va con gzip (dpkg acepta las dos)
        command -v xz >/dev/null || DEB_OPTS=(-c.deb.compression=gz)
      fi
      if [ "$(uname)" = Darwin ] && ! command -v gtar >/dev/null; then
        printf '\n! Sin GNU tar (brew install gnu-tar) no se puede hacer la .deb en un Mac: solo AppImage.\n'
        npx electron-builder --linux AppImage --x64 --arm64 --publish never -c.directories.output="$OUT"
      else
        npx electron-builder --linux --publish never -c.directories.output="$OUT" ${DEB_OPTS[@]+"${DEB_OPTS[@]}"}
      fi ;;
  esac
done
rm -rf "$OUT"/*-unpacked 2>/dev/null || true   # las carpetas sin empaquetar de Windows y Linux (la .app de mac se queda para probarla)
# firma de Aula en cada latest*.yml con la clave privada de ~/.aula-signing/update-ed25519.key (o $AULA_UPDATE_SIGNING_KEY);
# las copias instaladas no instalan nada sin ella (docs/PUBLISHING.md → «Firma de las actualizaciones»)
say "Firmando las actualizaciones"
node scripts/release-sign.mjs "$OUT" || die "No se pudieron firmar las actualizaciones (¿falta ~/.aula-signing/update-ed25519.key?)."
# de qué commit sale lo compilado (--upload se niega si no es HEAD o si había cambios sin commit)
# si cambió algo mientras compilaba, no cuenta como limpio
{ [ "$(git rev-parse HEAD)" = "$BUILD_COMMIT" ] && [ -z "$(git status --porcelain)" ]; } || BUILD_DIRTY=1
# un BUILD_INFO.<sistema> por sistema compilado (con --only, los de los demás se quedan como estaban)
for p in "${ONLY[@]}"; do
  { echo "commit=$BUILD_COMMIT"; echo "tree=$BUILD_TREE"; echo "dirty=$BUILD_DIRTY"; echo "built=$(date -u +%Y-%m-%dT%H:%M:%SZ)"; } > "$OUT/BUILD_INFO.$p"
done

say "Comprobando $OUT"
node scripts/release-verify.mjs "$OUT" "$VERSION"
ls -lh "$OUT" | grep -E '\.(dmg|zip|exe|AppImage|deb|yml)$' || true
[ "$BUILD_DIRTY" = 0 ] || printf '\n! Compilado con cambios sin commit: sirve para probar, pero --upload no lo subirá.\n'
say "Siguiente paso: prueba los instaladores de $OUT y luego «scripts/release-local.sh --upload --repo $PUB_OWNER/$PUB_REPO» (sube un borrador)."
