#!/bin/bash
# Pruebas de server/aula-server, sin Docker ni root: cuándo Chromium va sin su aislamiento (y qué se dice, también con
# AULA_NO_SANDBOX), la zona horaria y
# los textos de la consola en los dos idiomas. Se hacen sobre un sistema de mentira (una carpeta con lo que se mira de /proc,
# /etc y /usr/share/zoneinfo). Las ejecuta server/smoke.sh dentro de la imagen; también aquí:
#   bash server/aula-server.test.sh [ruta de aula-server]
set -uo pipefail
SCRIPT="${1:-$(cd "$(dirname "$0")" && pwd)/aula-server}"
[ -r "$SCRIPT" ] || { echo "no encuentro $SCRIPT" >&2; exit 2; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILS=0

# shellcheck source=server/aula-server
source "$SCRIPT"
set +e   # aula-server pone -euo pipefail; aquí cada caso va en su subshell con esas mismas opciones
unset container AULA_NO_SANDBOX   # los del entorno (la imagen pone container); cada caso dice los suyos

ok() { echo "✓ $1"; }
ko() { echo "✗ $1${2:+ — $2}" >&2; FAILS=$((FAILS + 1)); }
expect() { if [ "$2" = "$3" ]; then ok "$1"; else ko "$1" "esperaba «$3», salió «$2»"; fi; }
contains() { case "$2" in *"$3"*) ok "$1" ;; *) ko "$1" "no aparece «$3» en: $2" ;; esac; }
lacks() { case "$2" in *"$3"*) ko "$1" "sobra «$3» en: $2" ;; *) ok "$1" ;; esac; }

# Un sistema de mentira, nuevo cada vez: sin restricciones, sin perfiles, fuera de un contenedor, con permisos normales.
fake() {
  local r
  r=$(mktemp -d "$TMP/root.XXXXXX")
  mkdir -p "$r/proc/sys/kernel" "$r/proc/sys/user" "$r/proc/self" "$r/etc/apparmor.d" "$r/usr/share/zoneinfo"
  printf 'Name:\tbash\nNoNewPrivs:\t0\nCapBnd:\t000001ffffffffff\n' > "$r/proc/self/status"
  echo "$r"
}
# el perfil que instala la .deb de Aula (plantilla de electron-builder: apparmor-profile.tpl)
deb_profile() {
  cat > "$1/etc/apparmor.d/${3:-aula}" <<EOF
abi <abi/4.0>,
include <tunables/global>

profile "aula" "$2" flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/aula>
}
EOF
}
ubuntu24() { echo 1 > "$1/proc/sys/kernel/apparmor_restrict_unprivileged_userns"; }

# sandbox <raíz> <ejecutable> [userns abiertos: 0|1] [chrome-sandbox setuid de root: 0|1] → «on» u «off»
sandbox() {
  (
    set -euo pipefail
    ROOTFS=$1 EXE_UNDER_TEST=$2 USERNS=${3:-0} SETUID=${4:-0}
    userns_open() { [ "$USERNS" = 1 ]; }
    setuid_root() { [ "$SETUID" = 1 ] && [ "$1" = "$(dirname "$EXE_UNDER_TEST")/chrome-sandbox" ]; }
    if sandbox_works "$2"; then echo on; else echo off; fi
  )
}

EXE=/opt/Aula/aula

# ── el aislamiento ──
r=$(fake); expect "con espacios de nombres para todos, va aislada" "$(sandbox "$r" "$EXE" 1)" on
r=$(fake); expect "sin espacios de nombres, sin perfil ni setuid (Docker): sin aislamiento" "$(sandbox "$r" "$EXE")" off
r=$(fake); ubuntu24 "$r"; deb_profile "$r" "$EXE"
expect "Ubuntu 24.04 con la .deb: su perfil de AppArmor deja a Aula aislarse" "$(sandbox "$r" "$EXE")" on
r=$(fake); ubuntu24 "$r"; deb_profile "$r" /opt/Otra/otra otra
expect "Ubuntu 24.04 con el perfil de otro programa: sin aislamiento" "$(sandbox "$r" "$EXE")" off
r=$(fake); ubuntu24 "$r"; deb_profile "$r" /opt/Aula/aula-helper
expect "un perfil para otra ruta que empieza igual no vale" "$(sandbox "$r" "$EXE")" off
r=$(fake); ubuntu24 "$r"; deb_profile "$r" /opt/AulaXapp/aula
expect "los puntos de la ruta no son comodines" "$(sandbox "$r" /opt/Aula.app/aula)" off
r=$(fake); ubuntu24 "$r"; deb_profile "$r" /opt/Aula.app/aula
expect "una ruta con puntos sí se reconoce" "$(sandbox "$r" /opt/Aula.app/aula)" on
r=$(fake); ubuntu24 "$r"; printf 'profile aula /opt/Aula/aula flags=(unconfined) {\n  allow userns create,\n}\n' > "$r/etc/apparmor.d/a"
expect "un perfil escrito a mano (sin comillas, «allow userns create,»)" "$(sandbox "$r" "$EXE")" on
r=$(fake); ubuntu24 "$r"; printf 'profile "aula" "/opt/Aula/aula" {\n  deny userns,\n  # userns,\n}\n' > "$r/etc/apparmor.d/aula"
expect "un perfil que los niega (o solo lo menciona en un comentario) no vale" "$(sandbox "$r" "$EXE")" off
r=$(fake); ubuntu24 "$r"; deb_profile "$r" "$EXE"; mkdir -p "$r/etc/apparmor.d/disable"
ln -s /etc/apparmor.d/aula "$r/etc/apparmor.d/disable/aula"   # lo que deja «aa-disable aula»
expect "un perfil apagado con aa-disable (su enlace en disable/) no vale" "$(sandbox "$r" "$EXE")" off
r=$(fake); ubuntu24 "$r"; deb_profile "$r" "$EXE"; deb_profile "$r" /opt/Otra/otra otra; mkdir -p "$r/etc/apparmor.d/disable"
ln -s /etc/apparmor.d/otra "$r/etc/apparmor.d/disable/otra"
expect "… pero apagar el de otro programa no apaga el de Aula" "$(sandbox "$r" "$EXE")" on
r=$(fake); deb_profile "$r" "$EXE"; echo 0 > "$r/proc/sys/kernel/apparmor_restrict_unprivileged_userns"
expect "si AppArmor no es lo que los cierra, el perfil no ayuda" "$(sandbox "$r" "$EXE")" off
r=$(fake); ubuntu24 "$r"; deb_profile "$r" "$EXE"; echo 0 > "$r/proc/sys/kernel/unprivileged_userns_clone"
expect "con unprivileged_userns_clone=0 el perfil no basta" "$(sandbox "$r" "$EXE")" off
r=$(fake); ubuntu24 "$r"; deb_profile "$r" "$EXE"; echo 0 > "$r/proc/sys/user/max_user_namespaces"
expect "con max_user_namespaces=0 el perfil no basta" "$(sandbox "$r" "$EXE")" off
r=$(fake); expect "chrome-sandbox de root con setuid: va aislada" "$(sandbox "$r" "$EXE" 0 1)" on
r=$(fake); printf 'NoNewPrivs:\t1\nCapBnd:\t000001ffffffffff\n' > "$r/proc/self/status"
expect "con no_new_privs el setuid no sirve" "$(sandbox "$r" "$EXE" 0 1)" off
r=$(fake); printf 'NoNewPrivs:\t0\nCapBnd:\t00000000a80425fb\n' > "$r/proc/self/status"
expect "sin CAP_SYS_ADMIN (las capacidades de Docker) el setuid no sirve" "$(sandbox "$r" "$EXE" 0 1)" off

# lo que se dice: en un contenedor, que el contenedor la aísla; en un equipo, cómo arreglarlo
note() { ( set -euo pipefail; ROOTFS=$1; ES=$2; container=${3:-}; no_sandbox_note ); }
r=$(fake); touch "$r/.dockerenv"
contains "en Docker se dice que el contenedor la aísla" "$(note "$r" '')" "the container still isolates Aula"
contains "… y en español" "$(note "$r" 1)" "el contenedor sigue aislando a Aula"
r=$(fake); mkdir -p "$r/run"; touch "$r/run/.containerenv"
contains "en Podman también" "$(note "$r" '')" "the container still isolates Aula"
r=$(fake); contains "con \$container (containerd, LXC…) también" "$(note "$r" '' oci)" "the container still isolates Aula"
r=$(fake); out=$(note "$r" '')
lacks "en un equipo no se habla de ningún contenedor" "$out" "container"
contains "en un equipo se dice cómo arreglarlo" "$out" "install Aula from the .deb"
contains "… y en español" "$(note "$r" 1)" "instala Aula con la .deb"
# con AULA_NO_SANDBOX se dice que es por ella (no que falten los espacios de nombres)
forced_note() { ( set -euo pipefail; ROOTFS=$1; ES=$2; container=''; no_sandbox_note forced ); }
r=$(fake); out=$(forced_note "$r" '')
contains "AULA_NO_SANDBOX en un equipo: se dice que es por ella" "$out" "because AULA_NO_SANDBOX asks for it; nothing else isolates Aula"
lacks "… sin hablar de espacios de nombres" "$out" "namespaces"
contains "… y en español" "$(forced_note "$r" 1)" "porque lo pide AULA_NO_SANDBOX; en este equipo nada más aísla a Aula"
r=$(fake); touch "$r/.dockerenv"
contains "AULA_NO_SANDBOX en Docker: el contenedor la sigue aislando" "$(forced_note "$r" '')" "because AULA_NO_SANDBOX asks for it; the container still isolates Aula"
contains "… y en español" "$(forced_note "$r" 1)" "el contenedor sigue aislando a Aula"

# run(): los argumentos con los que arranca Aula (un Aula de mentira que los apunta)
mkdir -p "$TMP/opt/Aula" "$TMP/bin"
cat > "$TMP/opt/Aula/aula" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" > "$AULA_ARGS"
EOF
chmod +x "$TMP/opt/Aula/aula"
ln -s "$TMP/opt/Aula/aula" "$TMP/bin/aula"
REAL=$(readlink -f "$TMP/opt/Aula/aula")
launch() {  # launch <raíz> <userns: 0|1> [AULA_NO_SANDBOX] → lo que dice; los argumentos quedan en $TMP/args
  rm -f "$TMP/args"
  (
    set -euo pipefail
    ROOTFS=$1 USERNS=$2 ES='' DISPLAY=:0 AULA_HOME="$TMP/home" AULA_BIN="$TMP/bin/aula" AULA_ARGS="$TMP/args" TZ=
    AULA_NO_SANDBOX=${3:-}
    export AULA_ARGS
    userns_open() { [ "$USERNS" = 1 ]; }
    run
  ) 2>&1
}
r=$(fake); launch "$r" 1 >/dev/null
lacks "run: con espacios de nombres, sin --no-sandbox" "$(cat "$TMP/args" 2>/dev/null)" "--no-sandbox"
contains "run: arranca como servidor" "$(cat "$TMP/args" 2>/dev/null)" "--server"
r=$(fake); touch "$r/.dockerenv"; out=$(launch "$r" 0)
contains "run: en Docker, con --no-sandbox" "$(cat "$TMP/args" 2>/dev/null)" "--no-sandbox"
contains "run: y lo dice" "$out" "the container still isolates Aula"
r=$(fake); ubuntu24 "$r"; deb_profile "$r" "$REAL"; out=$(launch "$r" 0)
lacks "run: la .deb en Ubuntu 24.04 (por su enlace, como /usr/bin/aula) va aislada" "$(cat "$TMP/args" 2>/dev/null)" "--no-sandbox"
lacks "run: y no avisa de nada del aislamiento" "$out" "sandbox"
# si se equivoca (un perfil instalado pero sin cargar), AULA_NO_SANDBOX=1 lo arregla: siempre --no-sandbox, y lo dice
r=$(fake); ubuntu24 "$r"; deb_profile "$r" "$REAL"; out=$(launch "$r" 0 1)
contains "run: AULA_NO_SANDBOX=1 quita el aislamiento aunque parezca que va" "$(cat "$TMP/args" 2>/dev/null)" "--no-sandbox"
contains "run: y dice que es por AULA_NO_SANDBOX" "$out" "because AULA_NO_SANDBOX asks for it"
r=$(fake); out=$(launch "$r" 1 true)
contains "run: AULA_NO_SANDBOX=true también vale" "$(cat "$TMP/args" 2>/dev/null)" "--no-sandbox"
r=$(fake); out=$(launch "$r" 1 0)
lacks "run: AULA_NO_SANDBOX=0 no la quita" "$(cat "$TMP/args" 2>/dev/null)" "--no-sandbox"
lacks "run: … ni dice nada" "$out" "AULA_NO_SANDBOX"

# ── la zona horaria ──
zone() { ( set -euo pipefail; ROOTFS=$1; ES=$2; TZ=$3; zone_note ); }
r=$(fake); mkdir -p "$r/usr/share/zoneinfo/Europe" "$r/usr/share/zoneinfo/Etc"
touch "$r/usr/share/zoneinfo/Europe/Madrid" "$r/usr/share/zoneinfo/UTC" "$r/usr/share/zoneinfo/Etc/UTC"
expect "TZ: se dice cuál" "$(zone "$r" '' Europe/Madrid)" "Aula · time zone: Europe/Madrid"
expect "TZ con «:» delante" "$(zone "$r" 1 :Europe/Madrid)" "Aula · zona horaria: Europe/Madrid"
expect "TZ como ruta de zoneinfo" "$(zone "$r" '' /usr/share/zoneinfo/Europe/Madrid)" "Aula · time zone: Europe/Madrid"
out=$(zone "$r" '' Mars/Olympus)
contains "TZ que no es una zona: se avisa" "$out" "TZ=Mars/Olympus is not a time zone on this system"
lacks "… sin dar por hecho que Aula va en UTC" "$out" "Aula may not understand"
contains "… y en español" "$(zone "$r" 1 Mars/Olympus)" "TZ=Mars/Olympus no es una zona horaria de este sistema"
# los nombres antiguos (tzdata-legacy, en la imagen) son enlaces: valen
mkdir -p "$r/usr/share/zoneinfo/America/Argentina"; touch "$r/usr/share/zoneinfo/America/Argentina/Buenos_Aires"
ln -s Argentina/Buenos_Aires "$r/usr/share/zoneinfo/America/Buenos_Aires"
expect "TZ con un nombre antiguo que el sistema tiene (un enlace)" "$(zone "$r" '' America/Buenos_Aires)" "Aula · time zone: America/Buenos_Aires"
expect "UTC pedida a propósito no es un aviso" "$(zone "$r" '' UTC)" "Aula · time zone: UTC"
contains "sin TZ ni /etc/localtime (un contenedor): se avisa de que va en UTC" "$(zone "$r" '' '')" "the time zone is UTC"
contains "… y en español" "$(zone "$r" 1 '')" "la zona horaria es UTC"
ln -s ../usr/share/zoneinfo/Etc/UTC "$r/etc/localtime"
contains "sin TZ y /etc/localtime en UTC (Debian con tzdata): se avisa" "$(zone "$r" '' '')" "the time zone is UTC"
rm "$r/etc/localtime"; ln -s /usr/share/zoneinfo/America/Bogota "$r/etc/localtime"
expect "sin TZ, la del sistema (un equipo)" "$(zone "$r" '' '')" "Aula · time zone: America/Bogota"
rm "$r/etc/localtime"; echo TZif > "$r/etc/localtime"
expect "/etc/localtime copiado, sin enlace" "$(zone "$r" '' '')" "Aula · time zone: the system's (/etc/localtime)"
r=$(fake); rmdir "$r/usr/share/zoneinfo"
expect "sin zoneinfo no se puede comprobar: se dice tal cual" "$(zone "$r" '' Europe/Madrid)" "Aula · time zone: Europe/Madrid"

# ── la consola en los dos idiomas ──
cli() { local lang=$1; shift; env -u LC_ALL -u LC_MESSAGES LANG="$lang" AULA_HOME="$TMP/cli" AULA_BIN="$TMP/nada" bash "$SCRIPT" "$@" 2>&1; }
out=$(cli C.UTF-8 help)
contains "help en inglés" "$out" "aula-server link [--device]  a code to link a device"
lacks "help sin español" "$out" "arranca Aula"
lacks "help sin código del script" "$out" "set -e"
contains "help en inglés: AULA_NO_SANDBOX" "$out" "AULA_NO_SANDBOX        1: Chromium always runs without its sandbox"
contains "help en español" "$(cli es_ES.UTF-8 --help)" "aula-server link [--device]  un código para vincular un dispositivo"
contains "help en español: AULA_NO_SANDBOX" "$(cli es_ES.UTF-8 --help)" "AULA_NO_SANDBOX        1: Chromium siempre sin su aislamiento"
contains "orden desconocida, en inglés" "$(cli C.UTF-8 nope)" "aula-server: unknown command: nope"
contains "orden desconocida, en español" "$(cli es_ES.UTF-8 nope)" "aula-server: orden desconocida: nope"
contains "sin Aula, en inglés" "$(cli C.UTF-8 run)" "Aula not found at $TMP/nada (set AULA_BIN)."
contains "sin Aula, en español" "$(cli es_ES.UTF-8 run)" "No encuentro Aula en $TMP/nada"
mkdir -p "$TMP/cli/Remote"; echo '{}' > "$TMP/cli/Remote/admin.json"
contains "admin.json incompleto, en inglés" "$(cli C.UTF-8 status)" "admin.json is incomplete."
contains "admin.json incompleto, en español" "$(cli es_ES.UTF-8 status)" "admin.json está incompleto."
contains "sin servidor, en inglés" "$(rm -rf "$TMP/cli"; cli C.UTF-8 link)" "Aula is not running as a server"

if [ "$FAILS" -gt 0 ]; then echo "aula-server: $FAILS pruebas fallaron" >&2; exit 1; fi
echo "aula-server: todo en orden"
