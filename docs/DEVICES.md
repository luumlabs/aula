# Aula on your iPad and iPhone

Aula can be used from the student's own iPad and iPhone while everything (courses, the AI, the data) stays on their
Mac. The devices are only a window: they reach the Mac over the student's private Tailscale network.

- **iPad**: the whole app, as on the Mac (courses, lessons, practice, chat, calendar, documents).
- **iPhone**: the same interface in a narrow layout built around Aula as an assistant: four tabs at the bottom
  (*Inbox*: what Aula did and what is pending, with the always-on switch first; *Aula*: the chat; *Calendar*; *Today*).

It is off by default. Nothing here runs unless the student turns it on in **Settings → Aula on your devices**.

## How it works

```
iPad / iPhone                                Mac (Aula open)
┌──────────────────────────┐                ┌───────────────────────────────────────────────┐
│ Aula app (WKWebView)     │                │ aula-tsnet (Tailscale node "aula-mac", :80)   │
│  └ 127.0.0.1:<port>      │   WireGuard    │   only peers of the same Tailscale user       │
│     loopback forwarder ──┼── (tailnet) ──▶│   └▶ 127.0.0.1:<port>  remote server (Node)   │
│ embedded Tailscale node  │                │        same interface + /rpc /events /asset   │
└──────────────────────────┘                └───────────────────────────────────────────────┘
```

On the Mac (`src/main/electron/remote/`, `src/main/services/remote/`):

- **Remote server** (`server.ts`): plain `node:http` on `127.0.0.1` only. It serves the compiled interface with a small
  bridge (`bridge.ts`) that defines `window.aula` over HTTP instead of Electron IPC: `POST /rpc` (same envelope as the
  window), `GET /events` (one JSON event per line), `GET /asset/…` (course images, materials and recordings, with byte
  ranges) and `PUT /upload/<id>` (files picked on the device).
- **Linking** (`devices.ts`): the Mac shows a one-time 6-digit code (10 minutes, 5 attempts). The device sends it once
  and gets a long random token; the Mac stores only its SHA-256. Tokens expire after 90 days unused and each device can
  be removed in Settings. The token travels as an `HttpOnly; SameSite=Strict` cookie (or `Authorization: Bearer`).
- **What a device may ask for** (`policy.ts`): a closed allowlist. Studying, chat, calendar, inbox, documents and
  creating courses are open; API keys and secrets, settings (except the always-on switch), anything that opens a
  dialog or window on the Mac, export/delete-everything, updates and the remote access itself are refused before
  reaching any handler. A method that is added later stays closed until it is listed.
- **Uploads** (`uploads.ts`): the device has no Mac paths. The bridge uploads the picked file and hands the app an
  `aula-upload://<id>/<name>` reference; the server swaps it for the path of the copy (in the system temp folder,
  swept after 7 days) and registers it as a file the student gave, exactly like a file dropped on the Mac window.
- **Private network** (`tailnet.ts` + `native/tsnet/`): a Go sidecar built on Tailscale's `tsnet` (ported from Faro)
  joins the student's tailnet as `aula-mac` and forwards port 80 to the remote server. It only accepts peers that
  belong to the **same Tailscale user**, proves to itself that the upstream is Aula (HMAC challenge on `/health`)
  before forwarding, and never uploads logs. Tailscale does not need to be installed on the Mac. The server also
  rejects any request whose `Host` is not this computer unless it carries the sidecar's per-launch key.

## Aula's browser, live

The study-platform browser lives on the Mac. From a device (or from the Mac's own chat) the student can see and drive
it: a hidden window on the Mac is shown picture by picture and taps, scrolling and typing are replayed into it
(`src/main/electron/browser/live.ts`, `src/renderer/src/app/shell/LivePanel.tsx`, `live.*` in `src/shared/ipc/live.ts`).

- **Signing in away from home.** When a platform session has expired, *Sign in* opens the platform in the live browser;
  the student signs in as usual and presses *I've signed in*, and Aula checks the session. The password travels from the
  device to the Mac inside the private network and goes straight into the page: Aula does not log it and no model sees it.
- **Doing an assignment with Aula beside you.** Aula can put a page in front of the student in the chat
  (`student_browser_show`). The student works on it; *Let Aula review it* hands the page over and Aula reads the page
  text and the student's answers (`student_browser_review`, never password, code or payment fields), explains what is
  wrong with a similar example and gives the page back (`student_browser_return`). The student fixes it and submits.
- **What Aula cannot do there.** There is no tool to click, type or submit in the live window, so Aula never does the
  assignment or a test. While Aula holds the page the student's input is refused, and an order sent with a stale turn
  (`controlId`) is refused too.
- The page takes the size of whoever is looking (a phone gets the phone layout). Pictures are produced only while
  somebody watches; the window closes by itself after 20 idle minutes and the session stays saved.
- This computer and the local network are not reachable from the live window (the platform session blocks them on every
  request), except a platform that itself lives on the local network.

## Using it

On the Mac: **Settings → Aula on your devices** → turn it on → **Sign in** (Tailscale, once) → **Link** shows the code.

On the device, either:

1. **The Aula app** (`native/ios`, see below): it embeds its own Tailscale node, so the Tailscale app is not needed.
   Sign in to Tailscale with the same account, the app finds `aula-mac` by itself, type the code.
2. **Safari**, with the Tailscale app installed and connected on the device: open `http://aula-mac`, type the code,
   then *Share → Add to Home Screen* to get a full-screen icon. This needs no Xcode and works today.

The Mac has to be awake with Aula open (or in the tray). Settings (the AI, keys, platforms) are changed on the Mac.

## The iPhone / iPad app (`native/ios`)

A small SwiftUI app, no third-party packages:

| File | What it does |
|---|---|
| `Aula/AulaApp.swift`, `AppModel.swift`, `RootView.swift`, `Texts.swift` | The app, its state machine (sign in → find the Mac → open) and the waiting screens (es/en) |
| `Aula/WebView.swift` | The `WKWebView` that shows Aula through the loopback tunnel; outside links open in the browser |
| `Aula/Tailnet/TailnetController.swift` | Owns the embedded TailscaleKit node, finds `aula-mac` among the tailnet's machines |
| `Aula/Tailnet/LoopbackForwarder.swift` | `127.0.0.1` listener piped through the tailnet. Only connections that present the listener's secret (the `aula_gate` cookie the app sets for the web view, or `_ft` for native requests) are dialed; the port and secret change after a suspension |
| `build-tailscalekit.sh` | Builds `Frameworks/TailscaleKit.xcframework` from Tailscale's official `libtailscale`, with log uploads disabled |
| `Aula.xcodeproj` | The Xcode project (iOS 18.1+, iPhone and iPad) |

Build it (needs a Mac with **Xcode 16.1 or newer**; the Command Line Tools are not enough):

```bash
native/tsnet/build.sh                 # once: tells you how to get the project-local Go toolchain
native/ios/build-tailscalekit.sh      # builds Frameworks/TailscaleKit.xcframework
open native/ios/Aula.xcodeproj        # pick your team in Signing & Capabilities, choose your device, Run
```

A free Apple ID is enough to run it on your own device (the build expires after 7 days); a paid developer account is
only needed for TestFlight or the App Store.

## What is verified, and what is not

Verified on a Mac, by tests in this repository:

- The remote server end to end over real HTTP (`src/main/electron/remote/server.test.ts`), linking, the allowlist and
  uploads (`src/main/services/remote/remote.test.ts`), and the sidecar (`native/tsnet/build.sh test`).
- The interface from a browser at tablet and phone sizes against a running Aula: linking with the code, courses and
  lessons, live events, assets with ranges, uploads, the phone layout.
- The Mac sidecar joining Tailscale's control plane up to "needs sign-in".
- `native/ios/_verify/verify.sh`: the loopback forwarder at runtime (36 checks), the whole app compiled for macOS in
  Swift 6 mode against TailscaleKit built from source, and the app's Tailscale node started for real up to "needs
  sign-in".
- With Xcode 27.2: `build-tailscalekit.sh` builds the framework for device and simulator, and `Aula.xcodeproj` builds
  for the iOS Simulator (Debug) and for a device (Release, unsigned) without errors or warnings in the project's code.
  In the iPhone and iPad simulators (iOS 27.2) the app opens on *Connect to your Aula*, and *Sign in to Tailscale*
  starts the embedded node and opens Tailscale's sign-in page in Safari.

Not verified yet (it needs a signed-in tailnet and a real device):

- Everything after signing in to Tailscale: finding `aula-mac`, typing the code and using Aula through the tunnel.
- Running it on a real iPhone or iPad (it needs your Apple ID as the signing team).
- A full session over a real tailnet between a device and the Mac.
- Recordings playing through the tunnel inside `WKWebView` (media requests must carry the tunnel cookie).

Known limits: no push notifications on the phone (that needs Apple's push service and a paid developer account; the
inbox updates live while the app is open); the Mac must be on with Aula running.
