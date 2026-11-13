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
docker run -d --name aula --restart unless-stopped --shm-size=1g -e TZ=Europe/Madrid \
  -v aula-data:/data ghcr.io/luumlabs/aula-server:latest
docker logs -f aula
```

or with Compose (`server/compose.yaml`; first uncomment its `TZ` line and put your own time zone in it):

```bash
docker compose -f server/compose.yaml up -d
docker compose -f server/compose.yaml logs -f aula
```

**`TZ` is your time zone** (an IANA name: `Europe/Madrid`, `America/Mexico_City`, `America/New_York`…). A container
does not know where you are, so without it the server runs on UTC: study reminders, quiet hours, automations, the
calendar's *today* and the times you tell the tutor would all be hours off. The log says which zone Aula is using when it
starts, and warns when it is UTC because nothing was set. Older names that are links to current ones
(`America/Buenos_Aires`, `US/Eastern`…) work too: the image includes `tzdata-legacy`.

The image is `linux/amd64` and `linux/arm64` (a Raspberry Pi 4 or 5 with a 64-bit system works). Your data is in the
`/data` volume.

### The first time

1. **Sign the server in to Tailscale with your account.** The log prints a line like
   `sign in to Tailscale with YOUR account …: https://login.tailscale.com/a/…`. Open that page on any device and sign in
   with the account you use (or will use) on your phone and tablet. Then the log says
   `On your Tailscale network as "aula-server"`.
2. **Install the Aula app on your device** (iPhone or iPad from `native/ios`; Android from the
   `Aula-<version>-android.apk` attached to the GitHub release, see `native/android/README.md`), sign in to Tailscale
   there **with the same account**. The app finds `aula-server` by itself (if you also have a Mac with Aula, it
   asks which one to open).
3. **Type the owner code.** The log prints
   `Link your first device (it will be the owner) with the code 123456`. Codes last 10 minutes; while there is no owner, a
   new one is printed when the last one expires, and you can ask for one at any time:

   ```bash
   docker exec aula aula-server link
   ```

   A code stops working after 5 wrong attempts. Wrong attempts with owner codes also add up from one code to the next,
   and a restart does not clear them: after 5 in total, the server stops giving out owner codes by itself and the log
   says `Too many wrong attempts with the owner code: no more are given out automatically. Ask for a new one with
   “aula-server link”.` Then the next one comes from `aula-server link`, which starts the count again (so does linking a
   device with an owner code).
4. **Set up the AI from the device**: *Settings → Your AI* (an API key, a custom service, or ChatGPT with its one-time
   code). Then create your first course as on the Mac.

To link more devices, use *Settings → Your devices → Link* on the owner device (or `aula-server link --device`).

### Without opening the sign-in page

Give the container a Tailscale **auth key** from your own account (Tailscale admin console → Settings → Keys →
*Generate auth key*), **not tagged**: the server only lets in devices owned by the same user as itself, and a tagged node
belongs to no user.

```bash
docker run -d --name aula --shm-size=1g -e TZ=Europe/Madrid -e TS_AUTHKEY=tskey-auth-… \
  -v aula-data:/data ghcr.io/luumlabs/aula-server:latest
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
| `AULA_TAILNET_HOSTNAME` | `aula-server` | The name on your tailnet, so the apps find it. One DNS label (no dots) of at most 63 characters that matches `aula-[a-z0-9]([a-z0-9-]*[a-z0-9])?`: `aula-` and then ASCII letters, digits and hyphens, not starting or ending with a hyphen (upper case becomes lower case). It cannot be a device's name: `aula-ipad`, `aula-iphone`, `aula-android` and `aula-device`, alone or followed by `-<digits>` (`aula-ipad-2`). Any other value is ignored, with dots too (`aula-casa.lan` is not cut to `aula-casa`), and the server is called `aula-server`; the log says which name it got (`On your Tailscale network as …`) |
| `TS_AUTHKEY` | — | Sign in without the page (see above) |
| `TZ` | UTC | Your time zone (`Europe/Madrid`, `America/Mexico_City`…). Reminders, quiet hours, automations, the calendar and the times Aula reads in what you write use it |
| `LANG` | `C.UTF-8` | The server's language while *Aula's language* (*Settings → Language and reminders*) is *System language*: `es_ES.UTF-8` makes the console and log messages, the linking page and the texts Aula writes on the server (inbox and chat notices, generated guides) Spanish. Each device shows its interface in its own language |
| `AULA_HOME` | `/data` | The data folder (outside the image `aula-server` uses `~/.config/Aula`: give the server its own, see *Running it without Docker*) |
| `AULA_NO_SANDBOX` | — | `1` always runs Chromium without its sandbox (`--no-sandbox`), whatever `aula-server` would decide. Only for when its guess is wrong and Aula stops at start with *No usable sandbox!* (see *Security notes*) |

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
`latest-linux*.yml`, and unpacks it. To try an AppImage you built, put it in `server/dist/` and leave out
`AULA_VERSION`. Build it with the Tailscale component inside (it needs Go: without it the AppImage has no `aula-tsnet`
and the server says devices cannot reach it), for the server's architecture (`--x64` or `--arm64`):

```bash
npm run build && native/tsnet/build.sh linux && npx electron-builder --linux AppImage --x64
cp release/Aula-<version>-linux-x86_64.AppImage server/dist/   # with --arm64: Aula-<version>-linux-arm64.AppImage
docker build -t aula-server server/
```

## Running it without Docker

On any 64-bit Linux with a desktop library stack (Debian, Ubuntu, Fedora…; an LXC container works too): install Aula from
the release (the `.deb`, or the AppImage), Xvfb and `curl`, and run it with the same script the image uses:

```bash
sudo apt install ./Aula-0.2.4-linux-amd64.deb xvfb curl
curl -fsSLo aula-server https://raw.githubusercontent.com/luumlabs/aula/main/server/aula-server && chmod +x aula-server
export AULA_HOME="$HOME/.local/share/aula-server"   # its own data folder (see below)
AULA_BIN=/opt/Aula/aula ./aula-server run
./aula-server status                                # in another terminal, with the same AULA_HOME
```

**Give the server its own data folder** (`AULA_HOME`), also for `aula-server status` and `link`, which find the running
server through it. Without it, `aula-server` uses `~/.config/Aula` (or `$XDG_CONFIG_HOME/Aula`), the folder the desktop
Aula of the same user uses on Linux: both would share courses, settings, keys, the linked devices and the Tailscale
identity, and only one of them can run at a time. The server does not save the remote-access switch
(`Remote/state.json`), so a desktop Aula that opens a folder a server used does not turn remote access on by itself; but
a folder used by a server of version 0.2.3 (builds from before the server was released, which did save it) can still
have it on, and the desktop app then turns remote access on when it starts (*Settings → Aula on your devices* turns it
off).

On a host Aula uses the system's time zone (`timedatectl set-timezone Europe/Madrid`, or `TZ`) and language (`LANG`),
and the first lines of the log say which zone it took. Prefer the `.deb` on Ubuntu 24.04 or later: it installs an
AppArmor profile that lets Aula use Chromium's sandbox (see *Security notes*).

As a systemd service (as an ordinary user, with its data in its own folder):

```ini
# ~/.config/systemd/user/aula.service
[Unit]
Description=Aula as a server
After=network-online.target

[Service]
Environment=AULA_BIN=/opt/Aula/aula
Environment=AULA_HOME=%h/.local/share/aula-server
ExecStart=%h/aula-server run
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now aula
loginctl enable-linger "$USER"   # keep it running after you log out
journalctl --user -u aula -f     # the sign-in page and the first code
AULA_HOME="$HOME/.local/share/aula-server" ~/aula-server status   # the console, with the service's AULA_HOME
```

## Security notes

- **Who can reach it.** Only devices on your tailnet, signed in as the same Tailscale user as the server, and linked with
  a code. The Tailscale node refuses everyone else (other users of a shared tailnet, nodes shared in, tagged machines)
  before they reach Aula; Aula then requires the device's token (90 days without use and it expires).
- **Keys at rest.** A server has no system keychain, so API keys are stored unencrypted in `/data/secrets.enc` with mode
  `0600` (Settings → About says so on the owner device). Protect the volume as you would protect the server.
- **Chromium's sandbox.** `aula-server run` adds `--no-sandbox` only when Chromium could not sandbox itself at all (no
  user namespaces for Aula and no setuid `chrome-sandbox` that can work) or when `AULA_NO_SANDBOX=1` asks for it. On a host the sandbox stays on when unprivileged
  user namespaces are allowed, and on Ubuntu 24.04 or later (which restricts them through AppArmor) when Aula was
  installed from the `.deb`, whose AppArmor profile allows them for `/opt/Aula/aula` (unless it was turned off with
  `aa-disable`); the AppImage has no such profile. If the sandbox is off on a host, the log says so as a warning and how
  to fix it, since nothing else isolates Aula there. Whether the profile is actually loaded cannot be checked without
  root: if it is installed but not loaded, Chromium stops at start with *No usable sandbox!* (and systemd keeps
  restarting it). Then load it (`sudo apparmor_parser -r /etc/apparmor.d/aula`) or set `AULA_NO_SANDBOX=1`.
  Docker usually blocks user namespaces, so in the image Aula runs with `--no-sandbox` and the log says the container
  still isolates it: it runs as an unprivileged user inside the container. `aula-server` checks again at every start, so
  a container that is given user namespaces (a seccomp profile that allows them) gets the sandbox back.
- **No inbound ports.** Tailscale connects outwards (and through its relays when direct connections are not possible).
  Nothing has to be opened on your router.

## Other ways to reach it

The devices reach the server only over Tailscale. A plain WireGuard tunnel or a reverse proxy in front of Aula is not
supported: the device linking, the owner check and the apps' discovery all rely on Tailscale knowing which account a
device belongs to. Tailscale is free for personal use and works through NAT without opening ports; a self-hosted
control server compatible with Tailscale is not supported yet.

## What is verified

- `server/smoke.sh`, on every change and before every image is pushed, on Linux x64 and arm64 (GitHub Actions): the
  image starts Aula without a window in the time zone given with `TZ` (and older zone names work outside Aula too),
  its Tailscale node gets as far as asking to sign
  in, the log and `aula-server link` give an owner code, a device links with it and, as the owner, saves an API key
  (stored `0600`), gives another code, is refused *delete everything*, and opens Aula's live browser, which renders a web
  page on the virtual screen; then the container stops cleanly.
- `server/aula-server.test.sh`, run by the smoke test inside the image (it also runs on its own, without Docker): on a
  fake system, when `aula-server` turns Chromium's sandbox off and what it says (the
  `.deb`'s AppArmor profile on Ubuntu 24.04, also turned off with `aa-disable`, the setuid helper, containers,
  `AULA_NO_SANDBOX`), the time zone note, and the console texts in English and Spanish.
- `src/main/electron/remote/server.test.ts` and `src/main/services/remote/remote.test.ts`: the console only from the
  server and with its key, owner codes, what an owner and an ordinary device may call, events about devices reaching
  only owners, and the per-installation device cookie.
