#!/usr/bin/env python3
"""Busca claves y secretos antes de publicar (nunca imprime el secreto, solo dónde está).

    scripts/check-secrets.py --tree             revisa el árbol del proyecto que se subiría a GitHub (lo que sigue git
                                                y lo nuevo que no ignora .gitignore)
    scripts/check-secrets.py --tree --list      además lista los archivos revisados
    scripts/check-secrets.py <ruta>...          revisa esas carpetas/archivos, binarios incluidos (p. ej.
                                                release/<v>/mac-universal/Aula.app); los recursos de Chromium (*.pak,
                                                icudtl.dat, instantáneas de V8) no se miran: no son nuestros y dan falsos
                                                positivos

Detecta claves de OpenAI (sk-…, sk-proj-…), OpenRouter (sk-or-v1-…), Anthropic (sk-ant-…), Hugging Face (hf_…), xAI
(xai-…), Google (AIza…), GitHub (ghp_/gho_/github_pat_…), AWS, Slack, tokens de Canvas, enlaces privados de calendario,
JWT largos y claves privadas PEM/OpenSSH. Los valores de ejemplo evidentes («abcdefgh…», «00000000…») no cuentan.
Con CHECK_SECRETS_FILES=<archivo>[:<archivo>…] (p. ej. la clave privada con la que se firman las versiones), el
contenido de esos archivos tampoco puede aparecer en lo revisado, y en --tree ninguno puede estar dentro del proyecto.

Sale con 1 si encuentra algo. Lo usa el guion de publicación del mantenedor antes de subir el repositorio.
"""
import fnmatch
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (nombre, patrón). Los dos primeros son los de siempre de build-app.sh. Los prefijos con guion (sk-proj-, sk-or-v1-…) necesitan
# su propio patrón: «sk-[A-Za-z0-9]{20,}» se corta en el segundo guion y no los veía.
PATTERNS = [
    ("clave de API (sk-…)", rb"sk-[A-Za-z0-9]{20,}"),
    ("clave de API (tp-…)", rb"tp-[A-Za-z0-9]{20,}"),
    ("clave de OpenAI (sk-proj-/sk-svcacct-/sk-admin-)", rb"\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_\-]{20,}"),
    ("clave de OpenRouter (sk-or-v1-)", rb"\bsk-or-v1-[A-Za-z0-9]{32,}"),
    ("clave de Anthropic", rb"\bsk-ant-[A-Za-z0-9_\-]{32,}"),
    ("token de Hugging Face", rb"\bhf_[A-Za-z0-9]{30,}"),
    ("clave de xAI", rb"\bxai-[A-Za-z0-9]{40,}"),
    ("token de GitHub", rb"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}"),
    ("token de GitHub (fine-grained)", rb"\bgithub_pat_[A-Za-z0-9_]{40,}"),
    ("clave de AWS", rb"\bAKIA[0-9A-Z]{16}\b"),
    ("clave de Google", rb"\bAIza[0-9A-Za-z_\-]{35}\b"),
    ("token de Slack", rb"\bxox[baprs]-[A-Za-z0-9\-]{10,}"),
    ("token de Canvas", rb"\b\d{1,6}~[A-Za-z0-9]{40,}"),
    ("enlace privado de calendario de Canvas", rb"/feeds/calendars/user_[A-Za-z0-9]{20,}"),   # admitido en Tests/ (ver abajo)
    # JWT largo (cabecera.carga.firma): un token de sesión o de acceso real; los de ejemplo de las pruebas son cortos
    ("token JWT", rb"\beyJ[A-Za-z0-9_\-]{15,}\.eyJ[A-Za-z0-9_\-]{30,}\.[A-Za-z0-9_\-]{30,}"),
    ("clave privada PEM", rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----"),
]
COMPILED = [(n, re.compile(p)) for n, p in PATTERNS]
# Las pruebas de redacción de secretos necesitan enlaces de calendario con forma real (y hosts inventados): en las pruebas
# (tests/, *.test.ts, __fixtures__/) no se marcan.
TESTS_ALLOWED = {"enlace privado de calendario de Canvas"}
TEST_PATH = re.compile(r"(^|/)(tests|__fixtures__)/|\.test\.tsx?$")
# recursos de Chromium dentro de una app empaquetada: binarios de terceros con falsos positivos
VENDOR_SKIP = ["*.pak", "icudtl.dat", "v8_context_snapshot*.bin", "snapshot_blob.bin"]
# Un valor de ejemplo evidente («sk-proj-abcdefgh…», «12345~abcdefgh…», «…00000000…») no es una clave: una real nunca lleva
# ocho caracteres seguidos del alfabeto o de los dígitos, ni el mismo carácter ocho veces.
_RUNS = [seq[i:i + 8] for seq in ("abcdefghijklmnopqrstuvwxyz", "0123456789") for i in range(len(seq) - 7)]


def synthetic(match):
    low = match.lower()
    return any(r.encode() in low for r in _RUNS) or re.search(rb"(.)\1{7}", low) is not None
# nombres de archivo que no deberían estar nunca en el repositorio (claves privadas exportadas, certificados…)
BAD_NAMES = ["*private*key*", "*clave*privada*", "*.ed25519", "*.p12", "*.pfx", "*.pem", "*.key", "secrets.json", "secrets.enc", ".env",
             ".env.*", "*.mobileprovision", "id_rsa*", "id_ed25519*"]
ALLOWED_NAMES = {"check-secrets.py"}
# Los archivos se leen por trozos solapados: TODOS se revisan, también el ejecutable de la app (~250 MB). Antes, los de más de
# 64 MB se saltaban en silencio y el escaneo decía «✓ sin claves» sin haber mirado el binario principal.
CHUNK = 16 * 1024 * 1024
OVERLAP = 4096          # más que cualquier coincidencia mínima de los patrones


def gitignore_patterns():
    pats = [".git"]
    path = os.path.join(ROOT, ".gitignore")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and not line.startswith("!"):
                pats.append(line)
    return pats


def ignored(rel, is_dir, pats):
    name = os.path.basename(rel)
    for p in pats:
        dir_only = p.endswith("/")
        q = p.rstrip("/")
        if dir_only and not is_dir:
            continue
        if q.startswith("/"):
            if fnmatch.fnmatch(rel, q[1:]):
                return True
        elif "/" in q:
            if fnmatch.fnmatch(rel, q) or fnmatch.fnmatch(rel, q + "/*"):
                return True
        elif fnmatch.fnmatch(name, q):
            return True
    return False


def tree_files():
    """Archivos que se subirían: los de git si es un repositorio; si no, el árbol menos lo de .gitignore."""
    try:
        out = subprocess.run(["git", "-C", ROOT, "ls-files", "-co", "--exclude-standard", "-z"], capture_output=True, check=True)
        if out.stdout:
            return [os.path.join(ROOT, f) for f in out.stdout.decode().split("\0") if f]
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    pats, files = gitignore_patterns(), []
    for d, dirs, names in os.walk(ROOT):
        reld = os.path.relpath(d, ROOT)
        reld = "" if reld == "." else reld
        dirs[:] = [x for x in dirs if not ignored(os.path.join(reld, x), True, pats)]
        files += [os.path.join(d, n) for n in names if not ignored(os.path.join(reld, n), False, pats)]
    return files


def walk(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
        else:
            for d, _, names in os.walk(p):
                for n in names:
                    yield os.path.join(d, n)


def scan_file(f, rel, extra_literals):
    """Problemas de un archivo, leyéndolo por trozos de CHUNK bytes que se solapan OVERLAP bytes (una clave partida entre dos
    trozos se encuentra igual). Cada tipo de secreto se apunta una vez por archivo, con la línea (o la posición en un binario)."""
    found = {}
    in_tests = TEST_PATH.search(rel.replace(os.sep, "/")) is not None
    overlap = max([OVERLAP] + [len(lit) for _, lit in extra_literals if lit])
    lines_before = 0          # saltos de línea antes del comienzo de `window`
    offset = 0                # posición en el archivo del comienzo de `window`
    prev = b""
    with open(f, "rb") as fh:
        while True:
            block = fh.read(CHUNK)
            if not block:
                break
            window = prev + block
            for label, rx in COMPILED:
                if label in found or (label in TESTS_ALLOWED and in_tests):
                    continue
                m = next((m for m in rx.finditer(window) if not synthetic(m.group(0))), None)
                if m:
                    line = lines_before + window.count(b"\n", 0, m.start()) + 1
                    shown = m.group(0)[:4].decode("latin-1") + "…"
                    where = f"{line}" if offset + m.start() < CHUNK else f"{line} (byte {offset + m.start()})"
                    found[label] = f"{rel}:{where}: {label} ({shown})"
            for label, lit in extra_literals:
                if lit and label not in found and lit in window:
                    found[label] = f"{rel}: {label}"
            prev = window[-overlap:]
            lines_before += window.count(b"\n", 0, len(window) - len(prev))
            offset += len(window) - len(prev)
    return list(found.values())


def scan(files, extra_literals):
    problems = []
    for f in files:
        rel = os.path.relpath(f, ROOT) if f.startswith(ROOT) else f
        name = os.path.basename(f)
        if name not in ALLOWED_NAMES and any(fnmatch.fnmatch(name.lower(), b) for b in BAD_NAMES):
            problems.append(f"{rel}: nombre de archivo de clave o secreto")
        if name in ALLOWED_NAMES or os.path.islink(f) or any(fnmatch.fnmatch(name, v) for v in VENDOR_SKIP):
            continue
        if not os.path.lexists(f):
            continue          # borrado en la copia de trabajo (git aún lo lista): no se publica
        try:
            problems += scan_file(f, rel, extra_literals)
        except OSError as e:
            # nunca «✓» sin haberlo mirado: un archivo que no se puede leer cuenta como problema
            problems.append(f"{rel}: ✗ no revisado (no se pudo leer: {e.strerror or e})")
    return problems


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    tree = "--tree" in argv
    files = tree_files() if tree else list(walk(args or [ROOT]))
    # archivos secretos (CHECK_SECRETS_FILES): su contenido no puede aparecer en nada de lo revisado
    extra = []
    for key_file in filter(None, os.environ.get("CHECK_SECRETS_FILES", "").split(":")):
        path = os.path.abspath(os.path.expanduser(key_file))
        if not os.path.isfile(path):
            continue
        if tree and path.startswith(ROOT + os.sep):
            print(f"✗ un archivo secreto está DENTRO del proyecto: {key_file}")
            return 1
        secret = open(path, "rb").read().strip()
        if len(secret) >= 32:
            extra.append((f"contiene el secreto de {os.path.basename(path)}", secret))
    problems = scan(files, extra)
    if "--list" in argv:
        for f in files:
            print("  ·", os.path.relpath(f, ROOT))
    if problems:
        print("✗ Posibles claves o secretos:")
        for p in problems:
            print("   ", p)
        return 1
    print(f"✓ sin claves ni secretos ({len(files)} archivos revisados)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
