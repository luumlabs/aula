#!/usr/bin/env bash
# Compila una versión de Aula EN ESTE ORDENADOR (sin GitHub Actions) y, solo si se pide con --upload, la sube a GitHub
# como BORRADOR. Nunca publica: la versión no la ve nadie (ni se ofrece como actualización) hasta que pulses
# «Publish release» en GitHub. Pasos completos: docs/PUBLISHING.md.
#
#   scripts/release-local.sh                 comprobaciones + el APK de Android y los instaladores de macOS, Windows y
#                                            Linux en release/<versión>/ (el APK primero: si algo falla, mejor antes de los
#                                            minutos de los de escritorio). Cada sistema queda firmado y con su BUILD_INFO
#                                            en cuanto está: si falla uno, los anteriores no se pierden (sigue con --only)
#   scripts/release-local.sh --only mac      solo un sistema (mac | win | linux | android; se puede repetir). Recompila
#                                            SOLO ese sistema: los archivos ya compilados de los otros se quedan como están
#   scripts/release-local.sh --skip-checks   sin typecheck ni pruebas (si ya las pasaste)
#   scripts/release-local.sh --upload --repo luumlabs/aula [--partial]
#                                            sube lo ya compilado y comprobado a un borrador de ese repositorio (necesita
#                                            `gh`). El repositorio se dice SIEMPRE a mano (nunca se deduce de origin) y
#                                            tiene que ser el de electron-builder.yml → publish (el que miran las copias).
#                                            Si el borrador ya existe (p. ej. el del flujo «Release» de Actions, o uno
#                                            subido con --partial), le AÑADE lo que aún no tiene: lo que ya tiene igual
#                                            (mismo SHA-256) no se vuelve a subir, y si tiene un archivo con el mismo nombre
#                                            y otro contenido se niega (nunca sustituye uno). Sin los tres sistemas y el
#                                            APK se niega (publicada, los que faltan dejarían de ver versiones o no
#                                            tendrían qué instalar): --partial para subirla así a sabiendas
#
# macOS se firma con el certificado propio «Aula Local Signing» (~/.aula-signing/, scripts/build/mac-sign.cjs): sin él
# se niega, porque las copias ya firmadas con él rechazarían una versión ad hoc. AULA_MAC_ADHOC=1 para probar sin él.
# Android se firma con la clave de publicación de Aula para Android (~/.aula-signing/android, o $AULA_ANDROID_KEYSTORE;
# native/android/build.sh): solo en este ordenador, nunca en CI. Android solo instala una actualización encima de la app
# si la firma es de la misma clave, así que su huella (el SHA-256 de su certificado, que es público) está en el
# repositorio, native/android/release-cert.sha256, y el guion no compila ni sube un APK de otra clave.
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
      [ $# -ge 2 ] || die "--only necesita un sistema: mac, win, linux o android"
      case "$2" in mac|win|linux|android) ONLY+=("$2") ;; *) die "Sistema desconocido: «$2» (mac, win, linux o android)" ;; esac
      shift 2 ;;
    --skip-checks) CHECKS=0; shift ;;
    --upload) UPLOAD=1; shift ;;
    --partial) PARTIAL=1; shift ;;
    --repo)
      [ $# -ge 2 ] || die "--repo necesita <dueño>/<repositorio>, p. ej. --repo luumlabs/aula"
      REPO="$2"; shift 2 ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) die "Opción desconocida: $1 (usa --help)" ;;
  esac
done
ALL=0
[ ${#ONLY[@]} -eq 0 ] && { ONLY=(android mac win linux); ALL=1; }
# en este orden y sin repetir: Android primero (unos segundos, y lo que más requisitos tiene: si falla, que sea antes de
# los minutos de los instaladores de escritorio)
ASKED=("${ONLY[@]}")
ONLY=()
for p in android mac win linux; do
  for q in "${ASKED[@]}"; do
    if [ "$q" = "$p" ]; then ONLY+=("$p"); break; fi
  done
done
# ¿algún instalador de escritorio? (necesitan `npm run build` y la firma de las actualizaciones; el APK, no)
DESKTOP=0
for p in "${ONLY[@]}"; do
  [ "$p" = android ] || DESKTOP=1
done

VERSION=$(node -p "require('./package.json').version")
OUT="release/$VERSION"
TAG="v$VERSION"
NOTES="docs/release-notes/$VERSION.md"
APK="Aula-$VERSION-android.apk"
# el repositorio que miran las copias instaladas para actualizarse
PUB_OWNER=$(sed -n 's/^  owner: *//p' electron-builder.yml | head -1)
PUB_REPO=$(sed -n 's/^  repo: *//p' electron-builder.yml | head -1)
TITLE=$(sed -n 's/^  releaseName: *//p' electron-builder.yml | head -1)

# ── Android: la clave de publicación y las herramientas (las mismas que busca native/android/build.sh) ────────────────
ANDROID_KEYSTORE="${AULA_ANDROID_KEYSTORE:-$HOME/.aula-signing/android/aula-release.keystore}"
ANDROID_PASSFILE="${ANDROID_KEYSTORE%.keystore}.pass"
# la huella de la clave de Aula para Android (el SHA-256 de su certificado, que es público) en el repositorio: con ella,
# una clave nueva (si se perdiera la buena) no pasa por buena aunque esté en ~/.aula-signing/android
ANDROID_PIN_FILE=native/android/release-cert.sha256
ANDROID_PIN=""
ANDROID_SDK=""
ANDROID_BT=""

# el JDK y las build-tools del SDK con las que se comprueba un APK (apksigner, aapt2): JAVA_HOME o .toolchain/jdk,
# ANDROID_HOME o .toolchain/android-sdk (native/android/setup.sh los instala)
android_tools() {
  [ -z "$ANDROID_BT" ] || return 0
  if [ -z "${JAVA_HOME:-}" ] && [ -d .toolchain/jdk ]; then
    JAVA_HOME="$(find "$PWD/.toolchain/jdk" -maxdepth 3 -type d -name Home 2>/dev/null | head -1 || true)"
    [ -n "$JAVA_HOME" ] || JAVA_HOME="$PWD/.toolchain/jdk"
  fi
  { [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ] && [ -x "$JAVA_HOME/bin/keytool" ]; } \
    || die "Falta un JDK 17+ para Android (JAVA_HOME o .toolchain/jdk): native/android/setup.sh lo instala."
  export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"
  ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$PWD/.toolchain/android-sdk}}"
  ANDROID_BT="$(ls -d "$ANDROID_SDK"/build-tools/* 2>/dev/null | sort -V | tail -1 || true)"
  { [ -n "$ANDROID_BT" ] && [ -x "$ANDROID_BT/apksigner" ] && [ -x "$ANDROID_BT/aapt2" ]; } \
    || die "Faltan las build-tools del SDK de Android en $ANDROID_SDK (apksigner, aapt2): native/android/setup.sh."
}

# y, para compilarlo, todo lo demás que usa native/android/build.sh: javac 17+, d8 y zipalign, la plataforma de Android
# para la que compila y Go (native/tsnet/build.sh android). Mejor saberlo antes de compilar nada
android_build_tools() {
  local api javac_major
  android_tools
  [ -x "$JAVA_HOME/bin/javac" ] || die "$JAVA_HOME no es un JDK (falta javac): native/android/setup.sh instala uno."
  javac_major=$("$JAVA_HOME/bin/javac" -version 2>&1 | sed -n 's/^javac \([0-9][0-9]*\).*/\1/p' || true)
  [ "${javac_major:-0}" -ge 17 ] 2>/dev/null || die "El JDK de $JAVA_HOME es anterior al 17 (javac ${javac_major:-?}): native/android/setup.sh instala uno."
  { [ -x "$ANDROID_BT/d8" ] && [ -x "$ANDROID_BT/zipalign" ]; } \
    || die "Faltan d8 o zipalign en $ANDROID_BT: native/android/setup.sh."
  # la plataforma, la de «API=» de build.sh (si no se encuentra ahí, la comprueba el propio build.sh, que va primero)
  api=$(sed -n 's/^API="\{0,1\}\([0-9][0-9]*\).*/\1/p' native/android/build.sh | head -1)
  if [ -n "$api" ] && [ ! -f "$ANDROID_SDK/platforms/android-$api/android.jar" ]; then
    die "Falta la plataforma android-$api en $ANDROID_SDK (platforms/android-$api/android.jar): native/android/setup.sh."
  fi
  need_go
}

# Go para el componente de Tailscale (native/tsnet/build.sh: el de .toolchain/go, o el del PATH)
need_go() {
  [ -x .toolchain/go/bin/go ] || command -v go >/dev/null \
    || die "Falta Go para el componente de Tailscale (.toolchain/go, o go en el PATH): native/tsnet/build.sh dice cómo instalarlo."
}

# SHA-256 (hex) del primer certificado PEM que llega por la entrada
pem_sha256() {
  node -e '
    const pem = require("node:fs").readFileSync(0, "utf8")
    const m = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem)
    if (!m) process.exit(1)
    const der = Buffer.from(m[1].replace(/\s+/g, ""), "base64")
    process.stdout.write(require("node:crypto").createHash("sha256").update(der).digest("hex"))'
}

# la huella de native/android/release-cert.sha256 → ANDROID_PIN (64 cifras hexadecimales en minúscula). Vale con o sin
# «:» y con la etiqueta «SHA256:» que imprime keytool; «#» empieza un comentario
android_pin() {
  [ -f "$ANDROID_PIN_FILE" ] \
    || die "Falta $ANDROID_PIN_FILE, la huella de la clave de Aula para Android: docs/PUBLISHING.md → The Android app."
  ANDROID_PIN=$(sed -e 's/#.*//' -e 's/[Ss][Hh][Aa]-\{0,1\}256//g' "$ANDROID_PIN_FILE" | tr -d ' :\t\r\n' | tr 'A-F' 'a-f')
  printf '%s\n' "$ANDROID_PIN" | grep -Ex '[0-9a-f]{64}' >/dev/null \
    || die "$ANDROID_PIN_FILE no es una huella SHA-256 (64 cifras hexadecimales, con o sin «:»)."
}

# La clave de publicación de Android: en este ordenador (nunca en CI) y la MISMA de siempre, la de la huella del
# repositorio. Sin esa huella (la primera vez) no se sigue: el guion dice cuál es la de la clave que hay, para guardarla
android_key() {
  local want
  [ -z "${GITHUB_ACTIONS:-}" ] || die "El APK de Android se firma solo en el ordenador de quien publica: la clave nunca va a CI."
  if [ ! -f "$ANDROID_KEYSTORE" ] || [ ! -f "$ANDROID_PASSFILE" ]; then
    if [ -f "$ANDROID_PIN_FILE" ]; then
      die "Falta la clave de Aula para Android ($ANDROID_KEYSTORE y su .pass): restáurala de la copia de seguridad (docs/PUBLISHING.md → Keeping the keys). Una clave nueva no sirve: Android no instalaría el APK encima de la app."
    fi
    die "Falta la clave de Aula para Android ($ANDROID_KEYSTORE y su .pass): restáurala de la copia de seguridad (docs/PUBLISHING.md → Keeping the keys). Solo si ninguna versión publicada lleva aún un APK: native/android/build.sh --new-key."
  fi
  android_tools
  want=$(keytool -list -rfc -keystore "$ANDROID_KEYSTORE" -storepass:file "$ANDROID_PASSFILE" 2>/dev/null | pem_sha256) \
    || die "No se pudo leer el certificado de $ANDROID_KEYSTORE (¿la contraseña de su .pass?)."
  if [ ! -f "$ANDROID_PIN_FILE" ]; then
    die "Falta $ANDROID_PIN_FILE: la huella de la clave de Aula para Android, que se exige a cada APK. Solo la primera vez
  (ninguna versión publicada lleva aún un APK) y si $ANDROID_KEYSTORE es la clave buena (la de la copia de seguridad):
    echo $want > $ANDROID_PIN_FILE
  y haz commit de ese archivo antes de compilar (docs/PUBLISHING.md → The Android app)."
  fi
  android_pin
  [ "$want" = "$ANDROID_PIN" ] \
    || die "La clave de $ANDROID_KEYSTORE no es la de Aula para Android (su certificado no es el de $ANDROID_PIN_FILE): restaura la buena de la copia de seguridad. Firmado con otra, Android no instalaría el APK encima de la app."
}

# El APK que se publica: firma válida para Android 8+ de UN solo firmante, que es la clave de Aula para Android (la
# huella del repositorio: ni la de prueba de --debug ni una nueva), el paquete com.luumlabs.aula de ESTA versión y no
# depurable.
android_check_apk() {
  local apk="$1" out got badging
  android_tools
  android_pin
  out=$("$ANDROID_BT/apksigner" verify --min-sdk-version 26 --print-certs "$apk" 2>&1) \
    || { printf '%s\n' "$out" >&2; die "apksigner no da por buena la firma de $apk."; }
  # «Signer #1 certificate SHA-256 digest: …» (build-tools antiguas) o «V3.0 Signer: certificate SHA-256 digest: …»;
  # el sello de origen («Source Stamp») no es un firmante
  got=$(printf '%s\n' "$out" | sed -n -e '/^Source Stamp/d' -e 's/^.*Signer.* certificate SHA-256 digest: *\([0-9A-Fa-f:]*\)$/\1/p' \
    | tr 'A-F' 'a-f' | tr -d ':' | sort -u)
  [ "$(printf '%s\n' "$got" | grep -c .)" = 1 ] || die "$apk tiene que llevar una sola firma (la de Aula para Android)."
  [ "$got" = "$ANDROID_PIN" ] \
    || die "$apk no está firmado con la clave de Aula para Android (la huella de $ANDROID_PIN_FILE): ¿es el de --debug, o de una clave nueva? Android no lo instalaría encima de la app."
  badging=$("$ANDROID_BT/aapt2" dump badging "$apk" 2>/dev/null) || die "aapt2 no puede leer $apk."
  [ "$(printf '%s\n' "$badging" | sed -n "1s/^package: name='\([^']*\)'.*/\1/p")" = com.luumlabs.aula ] \
    || die "$apk no es la app com.luumlabs.aula."
  [ "$(printf '%s\n' "$badging" | sed -n "1s/.* versionName='\([^']*\)'.*/\1/p")" = "$VERSION" ] \
    || die "$apk no es de la versión $VERSION: vuelve a compilarlo (--only android)."
  if printf '%s\n' "$badging" | grep -x 'application-debuggable' >/dev/null; then die "$apk es depurable (el de --debug): no se publica."; fi
  printf '✓ %s: firmado con la clave de Aula para Android, versión %s\n' "${apk##*/}" "$VERSION"
}

# SHA-256 (hex) de un archivo
file_sha256() {
  node -e '
    const h = require("node:crypto").createHash("sha256")
    require("node:fs").createReadStream(process.argv[1]).on("data", (c) => h.update(c))
      .on("end", () => process.stdout.write(h.digest("hex")))' "$1"
}

# ¿el archivo local es el mismo que el del borrador con ese nombre? Por el SHA-256 que da GitHub ($2, «sha256:…»); si no
# lo da, se descarga y se compara
same_as_draft() {
  local f="$1" digest="$2" tmp ok=1
  if [ -n "$digest" ]; then
    [ "$digest" = "sha256:$(file_sha256 "$f")" ]
    return
  fi
  tmp=$(mktemp -d)
  if gh release download "$TAG" -R "$REPO" -p "${f##*/}" -D "$tmp" >/dev/null 2>&1 && cmp -s "$f" "$tmp/${f##*/}"; then ok=0; fi
  rm -rf "$tmp"
  return $ok
}

# ── Subir (solo si se pide) ────────────────────────────────────────────────────────────────────────────────────────
if [ $UPLOAD -eq 1 ]; then
  [ -n "$REPO" ] || die "Di a qué repositorio se sube: --upload --repo $PUB_OWNER/$PUB_REPO (no se deduce de origin)."
  [ "$REPO" = "$PUB_OWNER/$PUB_REPO" ] \
    || die "--repo $REPO no es el de electron-builder.yml → publish ($PUB_OWNER/$PUB_REPO): las copias instaladas no lo verían."
  command -v gh >/dev/null || die "Falta la herramienta gh (https://cli.github.com) y haber hecho «gh auth login»."
  [ -d "$OUT" ] || die "No hay nada compilado en $OUT: lanza antes scripts/release-local.sh"
  [ -f "$NOTES" ] || die "Faltan las notas $NOTES"
  [ -z "$(git status --porcelain)" ] || die "Hay cambios sin guardar en git: haz commit (y push) antes de subir."
  # lo que leen las copias instaladas (latest*.yml), lo que descargan (instaladores, zip y sus .blockmap) y el APK
  shopt -s nullglob
  YMLS=("$OUT"/latest*.yml)
  APKS=("$OUT"/*.apk)
  FILES=("$OUT"/latest*.yml "$OUT"/*.dmg "$OUT"/*.zip "$OUT"/*.exe "$OUT"/*.AppImage "$OUT"/*.deb "$OUT"/*.blockmap "$OUT"/*.apk)
  shopt -u nullglob
  [ ${#FILES[@]} -gt 0 ] || die "No hay nada que subir en $OUT."
  if [ ${#YMLS[@]} -gt 0 ]; then
    node scripts/release-verify.mjs "$OUT" "$VERSION" || die "La carpeta $OUT no pasa la comprobación."
    # firma propia de las actualizaciones (Ed25519): sin ella las copias instaladas rechazan la versión (docs/PUBLISHING.md)
    node scripts/release-sign.mjs --verify "$OUT" || die "Los latest*.yml de $OUT no llevan la firma de Aula: vuelve a compilar."
    # el título de cada latest*.yml es el de electron-builder.yml (releaseInfo.releaseName)
    for y in "${YMLS[@]}"; do
      [ "$(sed -n 's/^releaseName: *//p' "$y" | head -1)" = "$TITLE" ] || die "$(basename "$y") no dice «releaseName: $TITLE»: vuelve a compilar ese sistema."
    done
  fi
  # Android: solo el APK de publicación de esta versión (nunca el de --debug ni el de otra versión)
  if [ ${#APKS[@]} -gt 0 ]; then
    for a in "${APKS[@]}"; do [ "${a##*/}" = "$APK" ] || die "$a no es $APK: quítalo de $OUT (solo se sube el APK de publicación de esta versión)."; done
    android_check_apk "$OUT/$APK"
  fi
  # macOS: firmado con el certificado propio (si no, las copias firmadas con él la rechazarían)
  if [ -d "$OUT/mac-universal/Aula.app" ] && [ "${AULA_MAC_ADHOC:-}" != 1 ]; then
    codesign -d -r- "$OUT/mac-universal/Aula.app" 2>&1 | grep -q 'certificate root = H"' \
      || die "La app de macOS de $OUT no está firmada con «Aula Local Signing»: vuelve a compilar mac en este Mac (docs/PUBLISHING.md → Signing)."
  fi
  HEAD_SHA=$(git rev-parse HEAD)
  HEAD_TREE=$(git rev-parse 'HEAD^{tree}')
  # lo compilado tiene que ser de ESTE contenido (el árbol de HEAD; vale una copia con el mismo árbol, como el commit
  # limpio del repositorio público) y de un árbol sin cambios (BUILD_INFO lo escribe la compilación)
  for p in mac win linux android; do
    case "$p" in mac) f=latest-mac.yml ;; win) f=latest.yml ;; linux) f=latest-linux.yml ;; android) f=$APK ;; esac
    [ -f "$OUT/$f" ] || continue
    INFO="$OUT/BUILD_INFO.$p"
    [ -f "$INFO" ] || die "Falta $INFO: vuelve a compilar $p con este guion."
    grep -qx "tree=$HEAD_TREE" "$INFO" \
      || die "Lo de $p en $OUT se compiló desde otro contenido (commit $(sed -n 's/^commit=//p' "$INFO")): vuelve a compilar (--only $p)."
    grep -qx "dirty=0" "$INFO" || die "Lo de $p en $OUT se compiló con cambios sin commit: haz commit y vuelve a compilar (--only $p)."
  done
  # el commit tiene que estar ya en ESE repositorio (la release apunta a él)
  gh api "repos/$REPO/commits/$HEAD_SHA" --jq .sha >/dev/null 2>&1 \
    || die "El commit $HEAD_SHA no está en $REPO: súbelo (git push) a ese repositorio antes."
  VIS=$(gh repo view "$REPO" --json visibility -q .visibility 2>/dev/null || echo "?")
  [ "$VIS" = PUBLIC ] || printf '\n! %s es %s: con el repositorio privado las copias instaladas no ven las versiones.\n' "$REPO" "$VIS"
  # ¿hay ya un borrador? (el del flujo «Release» de Actions, o uno subido antes con este guion): se le AÑADE lo que falta
  DRAFT=0
  ON_DRAFT=""
  if gh release view "$TAG" -R "$REPO" --json isDraft >/dev/null 2>&1; then
    [ "$(gh release view "$TAG" -R "$REPO" --json isDraft -q .isDraft)" = "true" ] || die "La $TAG ya está publicada en $REPO: sube otra versión (cambia \"version\"). Un APK que faltó se añade a mano: docs/PUBLISHING.md → Android."
    DRAFT=1
    # el borrador apunta a un commit (su etiqueta y su código fuente al publicar): tiene que ser este mismo contenido
    TARGET=$(gh release view "$TAG" -R "$REPO" --json targetCommitish -q .targetCommitish)
    TARGET_TREE=$(gh api "repos/$REPO/commits/$TARGET" --jq .commit.tree.sha 2>/dev/null || true)
    [ "$TARGET_TREE" = "$HEAD_TREE" ] \
      || die "El borrador $TAG apunta a «$TARGET», con otro contenido que HEAD: añadirle esto mezclaría dos compilaciones. Sube desde ese commit, o borra el borrador en GitHub."
    # lo que ya tiene, con el SHA-256 que GitHub calcula de cada archivo subido («sha256:…»; vacío en los antiguos)
    DRAFT_ASSETS=$(gh release view "$TAG" -R "$REPO" --json assets -q '.assets[] | [.name, (.digest // "")] | @tsv')
    ON_DRAFT=$(printf '%s\n' "$DRAFT_ASSETS" | cut -f1)
    # nunca se sustituye un archivo (cada latest*.yml tiene que ir con los archivos de SU compilación), pero lo que el
    # borrador ya tiene IGUAL no se vuelve a subir: así $OUT puede seguir con los sistemas ya subidos (p. ej. con
    # --partial) cuando luego solo falta el APK. Un archivo igual al del borrador es de la misma compilación, y un
    # latest*.yml igual lista los mismos SHA-512: lo que se añade encaja con lo que ya está
    UP=()
    SAME=()
    CLASH=()
    for f in "${FILES[@]}"; do
      n="${f##*/}"
      if ! printf '%s\n' "$ON_DRAFT" | grep -xF "$n" >/dev/null; then
        UP+=("$f")
      elif same_as_draft "$f" "$(printf '%s\n' "$DRAFT_ASSETS" | awk -F'\t' -v n="$n" '$1 == n { print $2 }')"; then
        SAME+=("$n")
      else
        CLASH+=("$n")
      fi
    done
    [ ${#CLASH[@]} -eq 0 ] \
      || die "El borrador $TAG ya tiene ${CLASH[*]} con OTRO contenido que $OUT (otra compilación): este guion nunca sustituye archivos. Quita de $OUT los de ese sistema, o borra en GitHub los de ese sistema (su latest*.yml con todos sus archivos) y vuelve a subir."
    [ ${#SAME[@]} -eq 0 ] || printf '\n· Ya están en el borrador, iguales (no se vuelven a subir): %s\n' "${SAME[*]}"
    FILES=(${UP[@]+"${UP[@]}"})
  fi
  # ¿está (en $OUT o ya en el borrador)? (grep sin -q: con pipefail, un -q que acaba antes puede dar por fallido el printf)
  on_release() { [ -f "$OUT/$1" ] || printf '%s\n' "$ON_DRAFT" | grep -xF "$1" >/dev/null; }
  # los tres sistemas (A1-P2-21: publicada sin uno, esa pasa a ser «la última» y ese sistema deja de ver versiones) y el
  # APK (docs/SERVER.md y native/android/README.md mandan a la release a buscarlo)
  MISSING=()
  for f in latest-mac.yml latest.yml latest-linux.yml latest-linux-arm64.yml "$APK"; do on_release "$f" || MISSING+=("$f"); done
  if [ ${#MISSING[@]} -gt 0 ] && [ $PARTIAL -eq 0 ]; then
    die "Faltan ${MISSING[*]} (ni en $OUT ni en el borrador): publicada así, esos sistemas dejarían de ver versiones (y sin el APK, Android no tendría qué instalar). Compílalos (--only) o usa --partial a sabiendas."
  fi
  # cada archivo que nombran las notas tiene que estar (A5-P1-3: las notas prometían una .deb que no se subió)
  for f in $(grep -oE 'Aula-[A-Za-z0-9._-]+\.(dmg|zip|exe|AppImage|deb|apk)' "$NOTES" | sort -u); do
    on_release "$f" || die "Las notas ($NOTES) nombran $f, que no está en $OUT ni en el borrador."
  done
  [ ${#MISSING[@]} -eq 0 ] || printf '\n! Release PARCIAL (--partial): faltan %s.\n' "${MISSING[*]}"
  if [ ${#FILES[@]} -eq 0 ]; then
    say "El borrador $TAG de $REPO ya tiene todo lo de $OUT: no hay nada que subir."
    exit 0
  fi
  if [ $DRAFT -eq 1 ]; then
    say "Añadiendo ${#FILES[@]} archivos al BORRADOR $TAG que ya hay en $REPO (nadie lo ve hasta que lo publiques):"
  else
    say "Subiendo ${#FILES[@]} archivos a un BORRADOR $TAG «${TITLE:-Aula $VERSION}» en $REPO (nadie lo ve hasta que lo publiques):"
  fi
  printf '  %s\n' "${FILES[@]##*/}"
  printf '  commit %s · notas: la parte en inglés de %s\n' "$HEAD_SHA" "$NOTES"
  read -r -p "Escribe «yes» para subirlo: " ok
  [ "$ok" = "yes" ] || die "Cancelado."
  if [ $DRAFT -eq 1 ]; then
    # sin --clobber: si mientras tanto apareció uno con el mismo nombre, gh se niega en vez de sustituirlo
    gh release upload "$TAG" -R "$REPO" "${FILES[@]}"
    say "Listo: añadidos al borrador $TAG de $REPO. Pruébalo y pulsa «Publish release» en GitHub cuando quieras que llegue a todos."
  else
    # la página de GitHub enseña la parte en inglés de las notas; las copias leen las dos lenguas de latest*.yml
    BODY=$(mktemp)
    awk '/<!-- *lang:es *-->/ { exit } { print }' "$NOTES" > "$BODY"
    gh release create "$TAG" -R "$REPO" --draft --target "$HEAD_SHA" --title "${TITLE:-Aula $VERSION}" --notes-file "$BODY" "${FILES[@]}"
    rm -f "$BODY"
    say "Listo: borrador $TAG creado en $REPO. Pruébalo y pulsa «Publish release» en GitHub cuando quieras que llegue a todos."
  fi
  exit 0
fi

[ -z "$REPO" ] || die "--repo solo sirve con --upload."

# ── Comprobar y compilar ───────────────────────────────────────────────────────────────────────────────────────────
grep -q "^$VERSION\$" VERSION || die "VERSION no coincide con package.json ($VERSION)."
grep -q "## \[$VERSION\]" CHANGELOG.md || die "CHANGELOG.md no tiene la entrada [$VERSION]."
[ -f "$NOTES" ] || die "Faltan las notas $NOTES (con <!-- lang:en --> y <!-- lang:es -->)."
grep -q "releaseNotesFile: $NOTES" electron-builder.yml || die "electron-builder.yml → releaseInfo.releaseNotesFile debe ser $NOTES."
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then die "La etiqueta $TAG ya existe: esa versión ya salió. Sube \"version\"."; fi

# las claves, antes de los minutos de compilación (si falta alguna o no es la de la app, mejor saberlo ya)
if [ $DESKTOP -eq 1 ]; then
  node scripts/release-sign.mjs --check-key || die "Sin la clave de firma de las actualizaciones no se puede publicar (docs/PUBLISHING.md)."
fi
# nunca una compilación de auditoría (acepta --remote-debugging-port, src/main/electron/debug-guard.ts)
[ -z "${AULA_AUDIT_BUILD:-}" ] || die "AULA_AUDIT_BUILD está puesto: eso es para auditar, nunca para publicar. Quítalo (unset AULA_AUDIT_BUILD)."
for p in "${ONLY[@]}"; do
  # el componente de Tailscale (native/tsnet/build.sh) va en macOS y Linux (y en Android: android_build_tools)
  case "$p" in mac|linux) need_go ;; esac
  case "$p" in
    mac)
      # macOS: el certificado estable «Aula Local Signing» (scripts/build/mac-sign.cjs; A1-P1-5)
      [ "${AULA_MAC_ADHOC:-}" = 1 ] && { printf '\n! AULA_MAC_ADHOC=1: macOS se firma ad hoc (solo para probar; --upload lo rechaza).\n'; continue; }
      [ -f "$HOME/.aula-signing/aula-signing.keychain-db" ] && [ -f "$HOME/.aula-signing/keychain.pass" ] \
        || die "Falta el llavero de «Aula Local Signing» (~/.aula-signing/aula-signing.keychain-db + keychain.pass): sin él, las copias de macOS rechazarían esta versión (docs/PUBLISHING.md → Signing)." ;;
    android)
      # Android: todo lo que usa native/android/build.sh y la clave buena (la de la huella del repositorio)
      android_build_tools
      android_key ;;
  esac
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
if [ $ALL -eq 1 ]; then
  rm -rf "$OUT"
else
  # solo lo de los sistemas que se recompilan; lo demás (ya probado) se queda
  mkdir -p "$OUT"
  for p in "${ONLY[@]}"; do
    case "$p" in
      mac)     rm -rf "$OUT"/Aula-*-mac.* "$OUT"/latest-mac.yml "$OUT"/mac* "$OUT"/BUILD_INFO.mac ;;
      win)     rm -rf "$OUT"/Aula-Setup-* "$OUT"/Aula-*-win-* "$OUT"/latest.yml "$OUT"/win-* "$OUT"/BUILD_INFO.win ;;
      linux)   rm -rf "$OUT"/*.AppImage "$OUT"/*.deb "$OUT"/latest-linux*.yml "$OUT"/linux-* "$OUT"/BUILD_INFO.linux ;;
      android) rm -rf "$OUT"/*.apk "$OUT"/BUILD_INFO.android ;;
    esac
  done
fi
mkdir -p "$OUT"

# Cada sistema se deja listo en cuanto está (sus actualizaciones firmadas y su BUILD_INFO), para que si falla el
# siguiente no haya que recompilar los anteriores: se sigue con --only y los que faltan
DONE=()
built_so_far() {
  local status=$?
  if [ $status -ne 0 ] && [ ${#DONE[@]} -gt 0 ]; then
    printf '\n! Ya están en %s, listos para subir: %s. Para no recompilarlos, sigue solo con los que faltan (--only).\n' "$OUT" "${DONE[*]}" >&2
  fi
}
trap built_so_far EXIT
system_done() {
  local p="$1" dirty="$BUILD_DIRTY"
  if [ "$p" != android ]; then
    # firma de Aula en cada latest*.yml con la clave privada de ~/.aula-signing/update-ed25519.key (o
    # $AULA_UPDATE_SIGNING_KEY); las copias instaladas no instalan nada sin ella (docs/PUBLISHING.md → «Update
    # signatures»). Firma también los de los sistemas ya compilados: la firma es la misma (Ed25519 es determinista)
    say "Firmando las actualizaciones"
    node scripts/release-sign.mjs "$OUT" || die "No se pudieron firmar las actualizaciones (¿falta ~/.aula-signing/update-ed25519.key?)."
  fi
  # de qué commit sale (--upload se niega si no es HEAD o si había cambios sin commit); si cambió algo mientras
  # compilaba, no cuenta como limpio (ni este sistema ni los que vengan detrás)
  { [ "$(git rev-parse HEAD)" = "$BUILD_COMMIT" ] && [ -z "$(git status --porcelain)" ]; } || { dirty=1; BUILD_DIRTY=1; }
  { echo "commit=$BUILD_COMMIT"; echo "tree=$BUILD_TREE"; echo "dirty=$dirty"; echo "built=$(date -u +%Y-%m-%dT%H:%M:%SZ)"; } > "$OUT/BUILD_INFO.$p"
  DONE+=("$p")
}

# un sistema cada vez (las arquitecturas de cada uno salen de electron-builder.yml); --publish never: aquí no se sube nada
WEB_BUILT=0
for p in "${ONLY[@]}"; do
  # la interfaz y el proceso principal, una vez y antes del primer instalador de escritorio (el APK no los lleva: es la
  # ventana a un Aula de escritorio o servidor)
  if [ "$p" != android ] && [ $WEB_BUILT -eq 0 ]; then
    npm run build
    WEB_BUILT=1
  fi
  case "$p" in
    mac) [ "$(uname)" = Darwin ] || die "El instalador de macOS solo se puede compilar (y firmar) en un Mac."
         # «Aula en tus dispositivos»: el componente de Tailscale va dentro del paquete (Resources/bin) y git no lo guarda
         native/tsnet/build.sh || die "No se pudo compilar native/tsnet/bin/aula-tsnet (hace falta Go en .toolchain/go: lo dice native/tsnet/build.sh)."
         lipo -archs native/tsnet/bin/aula-tsnet | grep -q 'x86_64' && lipo -archs native/tsnet/bin/aula-tsnet | grep -q 'arm64' \
           || die "native/tsnet/bin/aula-tsnet no es universal (arm64 + x86_64)."
         npx electron-builder --mac --publish never -c.directories.output="$OUT"
         [ -x "$OUT/mac-universal/Aula.app/Contents/Resources/bin/aula-tsnet" ] || die "El paquete de macOS salió sin Resources/bin/aula-tsnet." ;;
    win) npx electron-builder --win --publish never -c.directories.output="$OUT" ;;
    linux)
      # el componente de Tailscale para Linux (x64 y arm64): «Aula en tus dispositivos» y Aula como servidor. Si falta,
      # electron-builder solo avisa y el paquete sale sin él: se comprueba antes y después
      native/tsnet/build.sh linux || die "No se pudo compilar native/tsnet/bin/linux-*/aula-tsnet (lo dice native/tsnet/build.sh)."
      for a in x64 arm64; do
        [ -x "native/tsnet/bin/linux-$a/aula-tsnet" ] || die "native/tsnet/build.sh linux no dejó native/tsnet/bin/linux-$a/aula-tsnet."
      done
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
      fi
      # x64 sale en linux-unpacked y arm64 en linux-arm64-unpacked (las de todos los paquetes de Linux)
      for d in linux-unpacked linux-arm64-unpacked; do
        [ -x "$OUT/$d/resources/bin/aula-tsnet" ] || die "El paquete de Linux ($d) salió sin resources/bin/aula-tsnet."
      done ;;
    android)
      # la app de Android, firmada con la clave de publicación (native/android/build.sh la deja en native/android/build/)
      rm -f "native/android/build/$APK"
      native/android/build.sh || die "No se pudo compilar la app de Android (native/android/build.sh)."
      [ -f "native/android/build/$APK" ] || die "native/android/build.sh no dejó native/android/build/$APK."
      # se comprueba ANTES de copiarlo: en release/<versión>/ solo entra un APK de publicación bueno
      android_check_apk "native/android/build/$APK"
      cp "native/android/build/$APK" "$OUT/$APK" ;;
  esac
  system_done "$p"
done
trap - EXIT
rm -rf "$OUT"/*-unpacked 2>/dev/null || true   # las carpetas sin empaquetar de Windows y Linux (la .app de mac se queda para probarla)

say "Comprobando $OUT"
if ls "$OUT"/latest*.yml >/dev/null 2>&1; then node scripts/release-verify.mjs "$OUT" "$VERSION"; fi
ls -lh "$OUT" | grep -E '\.(dmg|zip|exe|AppImage|deb|apk|yml)$' || true
[ "$BUILD_DIRTY" = 0 ] || printf '\n! Compilado con cambios sin commit: sirve para probar, pero --upload no lo subirá.\n'
say "Siguiente paso: prueba los instaladores de $OUT (y el APK en un teléfono) y luego «scripts/release-local.sh --upload --repo $PUB_OWNER/$PUB_REPO» (sube un borrador, o añade a uno que ya haya)."
