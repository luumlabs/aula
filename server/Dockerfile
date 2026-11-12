# syntax=docker/dockerfile:1
# Aula como servidor (sin ventana), en un contenedor: la persona que lo instala usa Aula desde su iPhone, su iPad o su
# Android por SU red privada de Tailscale. Guía: docs/SERVER.md.
#
#   docker build --build-arg AULA_VERSION=0.2.4 -t aula-server server/
#
# Dentro va la Aula de Linux tal cual se publica (la AppImage de esa versión, comprobada contra su latest-linux*.yml) o,
# para probar sin publicar, la AppImage que haya en server/dist/ (Aula-<versión>-linux-<x86_64|arm64>.AppImage). El
# contexto es la carpeta server/ (lo de fuera no entra en la imagen).

ARG DEBIAN=debian:trixie-slim

# ── 1. Aula, sacada de su AppImage ─────────────────────────────────────────────────────────────────────────────────────
FROM ${DEBIAN} AS unpack
ARG TARGETARCH
ARG AULA_VERSION=
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl openssl \
 && rm -rf /var/lib/apt/lists/*
COPY dist/ /tmp/dist/
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) arch=x86_64; feed=latest-linux.yml ;; \
      arm64) arch=arm64; feed=latest-linux-arm64.yml ;; \
      *) echo "Aula no tiene paquete de Linux para $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    image=$(ls /tmp/dist/Aula-*-linux-$arch.AppImage 2>/dev/null | head -1 || true); \
    if [ -z "$image" ]; then \
      [ -n "$AULA_VERSION" ] || { echo "Falta --build-arg AULA_VERSION (o una AppImage en server/dist/)" >&2; exit 1; }; \
      name="Aula-$AULA_VERSION-linux-$arch.AppImage"; \
      base="https://github.com/luumlabs/aula/releases/download/v$AULA_VERSION"; \
      image="/tmp/$name"; \
      curl -fsSL -o "$image" "$base/$name"; \
      curl -fsSL -o /tmp/feed.yml "$base/$feed"; \
      want=$(sed -n "/url: $name\$/{n;s/^ *sha512: *//p;}" /tmp/feed.yml | head -1); \
      got=$(openssl dgst -sha512 -binary "$image" | base64 -w0); \
      [ -n "$want" ] && [ "$want" = "$got" ] || { echo "$name no coincide con su $feed" >&2; exit 1; }; \
    fi; \
    chmod +x "$image"; \
    cd /opt && "$image" --appimage-extract >/dev/null && mv squashfs-root aula; \
    test -x /opt/aula/aula; \
    test -x /opt/aula/resources/bin/aula-tsnet || { echo "Esta Aula no trae el componente de Tailscale" >&2; exit 1; }

# ── 2. El servidor ─────────────────────────────────────────────────────────────────────────────────────────────────────
FROM ${DEBIAN}
ARG AULA_VERSION=
LABEL org.opencontainers.image.title="Aula server" \
      org.opencontainers.image.description="Aula without a window: use it from your iPhone, iPad and Android over your own Tailscale network" \
      org.opencontainers.image.source="https://github.com/luumlabs/aula" \
      org.opencontainers.image.documentation="https://github.com/luumlabs/aula/blob/main/docs/SERVER.md" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${AULA_VERSION}"
# lo que Chromium (Electron) necesita sin escritorio: GTK, NSS, sonido, una pantalla virtual (Xvfb) y fuentes; tini como
# proceso 1 (pasa las señales a Aula y recoge a sus hijos)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl tini xvfb xauth util-linux \
      libgtk-3-0t64 libnss3 libgbm1 libasound2t64 libxss1 libxtst6 libatk-bridge2.0-0t64 libatspi2.0-0t64 libcups2t64 \
      libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 libnotify4 libsecret-1-0 \
      libxshmfence1 libuuid1 \
      fonts-liberation fonts-dejavu-core fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*
COPY --from=unpack /opt/aula /opt/aula
COPY aula-server /usr/local/bin/aula-server
# un usuario sin privilegios; sus datos, en /data (un volumen)
RUN useradd --create-home --uid 1000 --shell /usr/sbin/nologin aula \
 && mkdir -p /data && chown aula:aula /data && chmod 700 /data \
 && chmod 755 /usr/local/bin/aula-server
USER aula
ENV AULA_HOME=/data \
    AULA_BIN=/opt/aula/aula \
    AULA_SERVER=1 \
    LANG=C.UTF-8
VOLUME ["/data"]
HEALTHCHECK --interval=1m --timeout=10s --start-period=2m CMD ["/usr/local/bin/aula-server", "health"]
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/aula-server"]
CMD ["run"]
