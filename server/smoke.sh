#!/bin/bash
# Prueba de humo de la imagen del servidor (la usa el flujo «Server» de GitHub en Linux x64 y arm64):
#   server/smoke.sh <imagen>
# Arranca el contenedor y comprueba, sin cuenta de Tailscale, lo que se puede comprobar de verdad: Aula arranca sin ventana,
# su componente de Tailscale llega hasta pedir que se inicie sesión, la consola da un código de propietario, un dispositivo
# se vincula con él (por el servidor local del contenedor, como llegaría por la red privada) y, como propietario, usa Aula:
# guarda una clave, da otro código y abre el navegador de Aula en vivo, que pinta una página en la pantalla virtual. Antes,
# dentro de la imagen, las pruebas de aula-server (server/aula-server.test.sh); y Aula va en la zona horaria que se le da.
set -euo pipefail
IMAGE="${1:?uso: server/smoke.sh <imagen>}"
NAME="aula-smoke-$$"
fail() {
  echo "FALLO: $*" >&2
  echo "── estado: $(docker inspect -f '{{.State.Status}} (salida {{.State.ExitCode}})' "$NAME" 2>&1)" >&2
  echo "── registro del contenedor ──" >&2; docker logs "$NAME" 2>&1 | tail -60 >&2 || true
  echo "── registro de Aula (/data/Logs/main.log) ──" >&2
  docker cp "$NAME:/data/Logs/main.log" /tmp/aula-smoke-main.log >/dev/null 2>&1 && tail -80 /tmp/aula-smoke-main.log >&2 || echo "(no hay)" >&2
  echo "── procesos ──" >&2; docker top "$NAME" 2>&1 | cut -c1-200 >&2 || true
  exit 1
}
ok() { echo "✓ $*"; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# una zona sin horario de verano (México no lo tiene desde 2022): la comprobación no depende de la fecha
ZONE=America/Mexico_City
docker run -d --name "$NAME" --shm-size=1g -e LANG=es_ES.UTF-8 -e TZ="$ZONE" "$IMAGE" >/dev/null
inside() { docker exec "$NAME" "$@"; }

# 0. las pruebas de la consola, con el bash y las herramientas de la imagen
tests=$(inside bash -c "$(cat "$(dirname "$0")/aula-server.test.sh")" aula-server.test.sh /usr/local/bin/aula-server 2>&1) \
  || fail "las pruebas de aula-server fallaron:
$tests"
ok "las pruebas de aula-server pasan dentro de la imagen ($(printf '%s\n' "$tests" | grep -c '^✓') casos)"

# 1. arranca y deja su consola
for _ in $(seq 1 90); do
  [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = true ] || fail "el contenedor se paró al arrancar"
  inside aula-server status --json >/dev/null 2>&1 && break
  sleep 2
done
inside aula-server status --json >/dev/null 2>&1 || fail "la consola no responde"
# lo que Aula cuenta en su salida puede llegar al registro un momento después de que la consola responda
logged() { for _ in $(seq 1 15); do docker logs "$NAME" 2>&1 | grep -q "$1" && return 0; sleep 1; done; return 1; }
logged "como servidor, sin ventana\|running as a server, without a window" || fail "Aula no dijo que arrancó como servidor"
ok "Aula arranca sin ventana y su consola responde"
# si va sin el aislamiento de Chromium, lo dice como lo que es: un contenedor (no un equipo al que le falte la .deb)
if docker logs "$NAME" 2>&1 | grep -q -- '--no-sandbox'; then
  logged "el contenedor sigue aislando a Aula" || fail "va con --no-sandbox sin decir que el contenedor la aísla"
  ok "sin espacios de nombres: --no-sandbox, y dice que el contenedor sigue aislando a Aula"
fi
# la zona horaria: la dice al arrancar, la usan las herramientas (tzdata) y la usa Aula (su ICU, la de los recordatorios)
logged "zona horaria: $ZONE" || fail "no dijo su zona horaria ($ZONE)"
[ "$(inside date +%z)" = "-0600" ] || fail "date no va en $ZONE: $(inside date 2>&1)"
aulazone=$(inside env ELECTRON_RUN_AS_NODE=1 /opt/aula/aula -e 'process.stdout.write(Intl.DateTimeFormat().resolvedOptions().timeZone)' 2>/tmp/aula-smoke-zone.err) || true
[ "$aulazone" = "$ZONE" ] || fail "Aula no va en $ZONE: «$aulazone» $(head -c 400 /tmp/aula-smoke-zone.err 2>/dev/null)"
ok "Aula va en la zona horaria que se le da ($ZONE)"
# los nombres antiguos (tzdata-legacy) también son zonas para date y para aula-server, no solo para la ICU de Aula
[ "$(inside env TZ=America/Buenos_Aires date +%z)" = "-0300" ] || fail "falta tzdata-legacy: date no conoce America/Buenos_Aires"
ok "los nombres antiguos de zona (America/Buenos_Aires) valen también fuera de Aula"

# 2. Tailscale llega hasta pedir que se inicie sesión (sin cuenta, no puede ir más allá)
for _ in $(seq 1 60); do inside aula-server status --json | grep -q '"state":"needsLogin","authURL":"https://login.tailscale.com/' && break; sleep 2; done
inside aula-server status --json | grep -q '"state":"needsLogin","authURL":"https://login.tailscale.com/' || fail "Tailscale no llegó a pedir el inicio de sesión: $(inside aula-server status --json | head -c 400)"
inside aula-server status | grep -q "Inicia sesión con TU cuenta de Tailscale\|Sign in with YOUR Tailscale account" || fail "la consola no dice cómo iniciar sesión: $(inside aula-server status 2>&1 | head -c 600)"
logged "inicia sesión en Tailscale con TU cuenta\|sign in to Tailscale with YOUR account" || fail "el registro no dice cómo iniciar sesión"
ok "el componente de Tailscale arranca y pide iniciar sesión"

# 3. sin propietario, el registro ya da un código; la consola da otro
logged "Vincula tu primer dispositivo (será el propietario) con el código [0-9]\{6\}\|Link your first device (it will be the owner) with the code [0-9]\{6\}" || fail "no se ofreció el código del primer propietario"
code=$(inside aula-server link | sed -n 's/^\(Código de propietario\|Owner code\): \([0-9]\{6\}\)$/\2/p')
[ -n "$code" ] || fail "aula-server link no dio un código"
ok "código de propietario: por el registro y por la consola"

# 4. un dispositivo se vincula y usa Aula como propietario (por 127.0.0.1 dentro del contenedor)
port=$(inside sh -c 'sed -n "s/.*\"port\":\([0-9]*\).*/\1/p" /data/Remote/admin.json')
[ -n "$port" ] || fail "no hay puerto en admin.json"
inside curl -fsS -c /tmp/jar -o /tmp/pair.json -X POST -H 'content-type: application/json' \
  --data "{\"code\":\"$code\",\"name\":\"Prueba de humo\",\"platform\":\"android\"}" "http://127.0.0.1:$port/pair/complete" || fail "no se pudo vincular"
inside grep -q '"owner":true' /tmp/pair.json || fail "el dispositivo no quedó como propietario"
rpc() { inside curl -fsS -b /tmp/jar -X POST -H 'content-type: application/json' --data "$1" "http://127.0.0.1:$port/rpc"; }
rpc '{"method":"app.info"}' | grep -q '"platform":"linux"' || fail "app.info"
rpc '{"method":"ai.setKey","args":{"providerId":"deepseek","key":"sk-humo-0000000000000000"}}' | grep -q '"ok":true' || fail "el propietario no pudo guardar una clave"
rpc '{"method":"app.info"}' | grep -q '"secretProtection":"basic"' || fail "sin llavero, las claves deberían ir en claro (0600) y decirlo"
inside sh -c 'test "$(stat -c %a /data/secrets.enc)" = 600' || fail "secrets.enc no es 0600"
rpc '{"method":"remote.startPairing","args":{"owner":false}}' | grep -q '"pairing":{"code":"[0-9]\{6\}"' || fail "el propietario no pudo dar un código"
rpc '{"method":"data.deleteAll"}' | grep -q '"code":"forbidden"' || fail "borrar todo debería hacerse solo en el servidor"
inside curl -fsS -b /tmp/jar "http://127.0.0.1:$port/" | grep -q '<meta name="aula-device" content="owner">' || fail "la interfaz no sabe que es propietario"
ok "el propietario guarda una clave, da códigos y se le niega lo del servidor"

# 5. las ventanas escondidas funcionan en la pantalla virtual: el navegador de Aula en vivo pinta una página
live=$(rpc '{"method":"live.open","args":{"url":"https://example.com","purpose":"browse"}}')
id=$(printf '%s' "$live" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$id" ] || fail "no se abrió el navegador en vivo: $live"
frame=''
for _ in $(seq 1 30); do
  frame=$(rpc "{\"method\":\"live.frame\",\"args\":{\"id\":\"$id\",\"maxWidth\":600}}")
  printf '%s' "$frame" | grep -q '"mime":"image/jpeg","data":"/9j/' && break
  sleep 2
done
printf '%s' "$frame" | grep -q '"mime":"image/jpeg","data":"/9j/' || fail "el navegador en vivo no dio ninguna imagen"
[ "${#frame}" -gt 4000 ] || fail "la imagen del navegador en vivo es demasiado pequeña"
rpc "{\"method\":\"live.close\",\"args\":{\"id\":\"$id\"}}" >/dev/null
ok "el navegador de Aula en vivo pinta páginas en la pantalla virtual (${#frame} bytes)"

# 6. sigue sano y se para en orden
[ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = true ] || fail "el contenedor se paró"
docker stop -t 20 "$NAME" >/dev/null
code=$(docker inspect -f '{{.State.ExitCode}}' "$NAME")
[ "$code" = 0 ] || fail "al pararlo salió con el código $code"
ok "se para en orden (código 0)"
echo "Todo en orden: $IMAGE"
