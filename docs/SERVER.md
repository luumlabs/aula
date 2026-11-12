# Aula as a server

Aula can run without a window on a computer that is always on (a home server, a NAS, a small VPS, a Linux container) and
be used from the student's iPhone, iPad and Android, the same way those devices use Aula on a Mac. Courses, materials,
the AI and its keys all live on the server; the devices are only windows to it.

Everything travels over **the student's own Tailscale network**: the server and each device sign in to Tailscale with the
same personal account, and only that account's devices are let in. Nothing goes through the Aula project or anyone else,
and the server opens no port to the internet.

```
iPhone / iPad / Android                         Linux server or container
┌───────────────────────────┐                 ┌───────────────────────────────────────────────┐
│ Aula app                  │   WireGuard     │ aula-tsnet (Tailscale node "aula-server", :80)│
│  └ embedded Tailscale node├── (your own  ──▶│   only your own devices                       │
│                           │    tailnet)     │   └▶ Aula without a window (--server)          │
└───────────────────────────┘                 └───────────────────────────────────────────────┘
```

It is the same Aula as the desktop app, started with `--server` (or `AULA_SERVER=1`): the Linux build plus a virtual
screen (Xvfb) for the windows Aula keeps hidden (reading PDFs, the study-platform browser). Nothing is left out.

## The owner

On a Mac, keys, platforms and devices are managed in Aula's window. A server has no window, so **the first device you
link becomes the owner** and does what the window does:

| | Owner device | Other linked devices |
| --- | --- | --- |
| Courses, lessons, practice, chat, calendar, inbox, documents, creating courses | ✓ | ✓ |
| Daily settings (appearance, language, reminders, *Aula always on*, memory) | ✓ | ✓ |
| The AI: API keys, a custom OpenAI-compatible service, the spending cap, local models, ChatGPT (with the one-time code) | ✓ | choose among the ready ones |
| Study platforms (signing in through Aula's live browser) | ✓ | sign in when a session expires |
| Linking and removing devices, giving another owner code | ✓ | — |
| Privacy switches (memory, web search) | ✓ | — |
| Exporting or deleting all the data, updates, turning access off, Tailscale sign-in | on the server (see below) | — |

A device is only an owner if it used an **owner code**: the one the server prints when it starts without an owner, the one
`aula-server link` gives, or one an owner gives in *Settings → Your devices → Another owner*. The server enforces the
split (`src/main/services/remote/policy.ts`): an owner can call what the window can, except what needs the server's own
screen or would lock every device out.

## Running it with Docker

```bash
docker run -d --name aula --restart unless-stopped --shm-size=1g \
  -v aula-data:/data ghcr.io/luumlabs/aula-server:latest
docker logs -f aula
```

or with Compose (`server/compose.yaml`):

```bash
docker compose -f server/compose.yaml up -d
docker compose -f server/compose.yaml logs -f aula
```

The image is `linux/amd64` and `linux/arm64` (a Raspberry Pi 4 or 5 with a 64-bit system works). Your data is in the
`/data` volume.

### The first time

1. **Sign the server in to Tailscale with your account.** The log prints a line like
   `sign in to Tailscale with YOUR account …: https://login.tailscale.com/a/…`. Open that page on any device and sign in
   with the account you use (or will use) on your phone and tablet. Then the log says
   `On your Tailscale network as "aula-server"`.
2. **Install the Aula app on your device** (iPhone or iPad from `native/ios`, Android from the release's `.apk`), sign in to
   Tailscale there **with the same account**. The app finds `aula-server` by itself (if you also have a Mac with Aula, it
   asks which one to open).
3. **Type the owner code.** The log prints
   `Link your first device (it will be the owner) with the code 123456`. Codes last 10 minutes; while there is no owner, a
   new one is printed when the last one expires, and you can ask for one at any time:

   ```bash
   docker exec aula aula-server link
   ```
4. **Set up the AI from the device**: *Settings → Your AI* (an API key, a custom service, or ChatGPT with its one-time
   code). Then create your first course as on the Mac.

To link more devices, use *Settings → Your devices → Link* on the owner device (or `aula-server link --device`).

### Without opening the sign-in page

Give the container a Tailscale **auth key** from your own account (Tailscale admin console → Settings → Keys →
*Generate auth key*), **not tagged**: the server only lets in devices owned by the same user as itself, and a tagged node
belongs to no user.

```bash
docker run -d --name aula --shm-size=1g -e TS_AUTHKEY=tskey-auth-… -v aula-data:/data ghcr.io/luumlabs/aula-server:latest
```

### The console

```bash
docker exec aula aula-server status          # Tailscale, devices, the code that is waiting
docker exec aula aula-server link            # an owner code
docker exec aula aula-server link --device   # a code for an ordinary device
```

`aula-server` talks to Aula on `127.0.0.1` inside the container with a key Aula writes to `/data/Remote/admin.json`
(readable only by the `aula` user). It never answers through Tailscale.

| Variable | Default | |
| --- | --- | --- |
| `AULA_TAILNET_HOSTNAME` | `aula-server` | The name on your tailnet. It must start with `aula-` so the apps find it; device names (`aula-ipad`, `aula-iphone`, `aula-android`) are not accepted |
| `TS_AUTHKEY` | — | Sign in without the page (see above) |
| `LANG` | `C.UTF-8` | `es_ES.UTF-8` for the console messages in Spanish |
| `AULA_HOME` | `/data` | The data folder |

### Updating, backing up, starting over

- **Update**: `docker pull ghcr.io/luumlabs/aula-server:latest` and recreate the container (the app inside does not
  update itself). A new image is published with every Aula release.
- **Back up**: the `/data` volume is everything (courses, progress, settings, devices, the Tailscale identity, keys).
- **Start over**: remove the container and the volume. To keep the courses but sign out of Tailscale, delete
  `/data/Remote/tailnet` while the container is stopped.

### Building the image yourself

```bash
docker build --build-arg AULA_VERSION=0.2.4 -t aula-server server/
```

It downloads that version's Linux AppImage from the GitHub release, checks its SHA-512 against the release's
`latest-linux*.yml`, and unpacks it. To try an AppImage you built (`npx electron-builder --linux AppImage`), put it in
`server/dist/` and leave out `AULA_VERSION`.

## Running it without Docker

On any 64-bit Linux with a desktop library stack (Debian, Ubuntu, Fedora…; an LXC container works too): install Aula from
the release (the `.deb`, or the AppImage), Xvfb and `curl`, and run it with the same script the image uses:

```bash
sudo apt install ./Aula-0.2.4-linux-amd64.deb xvfb curl
curl -fsSLo aula-server https://raw.githubusercontent.com/luumlabs/aula/main/server/aula-server && chmod +x aula-server
AULA_BIN=/opt/Aula/aula ./aula-server run
```

As a systemd service (as an ordinary user, with its data in `~/.config/Aula`):

```ini
# ~/.config/systemd/user/aula.service
[Unit]
Description=Aula as a server
After=network-online.target

[Service]
Environment=AULA_BIN=/opt/Aula/aula
ExecStart=%h/aula-server run
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now aula
loginctl enable-linger "$USER"   # keep it running after you log out
journalctl --user -u aula -f     # the sign-in page and the first code
```

## Security notes

- **Who can reach it.** Only devices on your tailnet, signed in as the same Tailscale user as the server, and linked with
  a code. The Tailscale node refuses everyone else (other users of a shared tailnet, nodes shared in, tagged machines)
  before they reach Aula; Aula then requires the device's token (90 days without use and it expires).
- **Keys at rest.** A server has no system keychain, so API keys are stored unencrypted in `/data/secrets.enc` with mode
  `0600` (Settings → About says so on the owner device). Protect the volume as you would protect the server.
- **Chromium's sandbox.** Docker usually blocks the user namespaces Chromium's sandbox needs, so in the image Aula runs
  with `--no-sandbox` and says so in the log; it still runs as an unprivileged user inside the container. On a host that
  allows unprivileged user namespaces (or with a seccomp profile that allows them) the sandbox stays on.
- **No inbound ports.** Tailscale connects outwards (and through its relays when direct connections are not possible).
  Nothing has to be opened on your router.

## Other ways to reach it

The devices reach the server only over Tailscale. A plain WireGuard tunnel or a reverse proxy in front of Aula is not
supported: the device linking, the owner check and the apps' discovery all rely on Tailscale knowing which account a
device belongs to. Tailscale is free for personal use and works through NAT without opening ports; a self-hosted
control server compatible with Tailscale is not supported yet.

## What is verified

- `server/smoke.sh`, on every change and before every image is pushed, on Linux x64 and arm64 (GitHub Actions): the
  image starts Aula without a window, its Tailscale node gets as far as asking to sign in, the log and `aula-server link`
  give an owner code, a device links with it and, as the owner, saves an API key (stored `0600`), gives another code, is
  refused *delete everything*, and opens Aula's live browser, which renders a web page on the virtual screen; then the
  container stops cleanly.
- `src/main/electron/remote/server.test.ts` and `src/main/services/remote/remote.test.ts`: the console only from the
  server and with its key, owner codes, what an owner and an ordinary device may call, events about devices reaching
  only owners, and the per-installation device cookie.
