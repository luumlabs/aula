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
| `Aula/WebView.swift` | The `WKWebView` that shows Aula through the loopback tunnel; outside links open in the browser. It tells the page the real safe-area margins (SwiftUI hides them from a full-screen view), turns off iOS 26's blur under the status bar, and makes the page behave like an app: no zoom, no long-press menus on links and images, no selecting the text of buttons |
| `Aula/Tailnet/TailnetController.swift` | Owns the embedded TailscaleKit node, finds `aula-mac` among the tailnet's machines |
| `Aula/Tailnet/LoopbackForwarder.swift` | `127.0.0.1` listener piped through the tailnet. Only connections that present the listener's secret (the `aula_gate` cookie the app sets for the web view, or `_ft` for native requests) are dialed; the port and secret change after a suspension |
| `Aula/DemoServer.swift` | The demo (*Try it with an example course*): a tiny HTTP server on `127.0.0.1` that plays back a recording of the real app, so Aula can be tried with no Mac. See below |
| `Aula/Assets.xcassets` | The app icon and the drawings of the connect screen (the arch at each hour and the desk lamp, in light and dark), taken from the real app with `node scripts/dev/ios-art.mjs` |
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

### The demo (trying Aula without a Mac)

The connect screen offers *Try it with an example course*. It opens the real interface with the example course
(Trigonometry, six weeks of simulated study) served by the app itself: nothing leaves the device and nothing is
saved. A bar at the top says it is the demo and has *Exit*.

It is a recording, not a second copy of Aula:

```bash
npm run build && node scripts/dev/ios-demo.mjs    # writes native/ios/Aula/Demo.aulademo (about 10 MB)
```

The script opens the real app with the example course and a simulated AI, links a "device" to it exactly as an iPad
would, walks through every screen at tablet and phone sizes, and writes down what the Mac served: the interface, its
files and the answer to each call. `DemoServer.swift` plays that back:

- A call the recording has is answered as recorded, with its dates moved to today (so the exam is always "in 20
  days" and the example never looks old).
- A call it has only for other arguments (another flashcard, another topic) gets the recorded answer for that
  method, with the ids swapped.
- Anything else (creating a course, uploading a file) answers "not available in the demo".
- In the chat, any question gets a short reply saying it is the demo, with the sample quiz.

Git does not keep `Demo.aulademo` (it is rebuilt from the app): **record it before archiving the app**, and again
whenever the interface changes. Without the file the app builds and runs the same, just without the demo button.
`_verify/verify.sh` checks the server against the recording (`_verify/DemoTest`).

## Sending the app to the App Store

The app is the window to the Aula on the student's Mac, so its first screen also says where to get Aula for Mac
(*Don't have Aula on your Mac yet?* → the download page, with a button to send the link to the Mac).

Ready in the project:

- An archive builds (`xcodebuild archive`, checked unsigned): iPhone and iPad, iOS 18.1+, version from `MARKETING_VERSION`.
- `Aula/PrivacyInfo.xcprivacy`: no tracking, no collected data, and the two "required reason" system functions the
  embedded Tailscale node uses (file timestamps in its own folder, the system clock for elapsed time).
- Permission texts in English and Spanish (camera, microphone, local network), the app icon without transparency, a
  launch screen, all orientations on iPad.

What only the owner of the Apple account can do:

1. Join the **Apple Developer Program** (paid) and pick that team in *Signing & Capabilities*.
2. Create the app in **App Store Connect** with the bundle id `com.luumlabs.aula.ios`, then *Product → Archive →
   Distribute App* in Xcode.
3. Answer the **export compliance** question: the app carries Tailscale (WireGuard), which is standard encryption that
   is not Apple's own. That declaration is the owner's to make.
4. Give a **privacy policy** address (the *Privacy* section of the README can be the base) and fill in the privacy
   answers: the app collects nothing.
5. Screenshots for iPhone and iPad showing Aula in use, a description and keywords.

**Review.** Apple's reviewers have no Mac with Aula, so they try it through the demo. Record it before archiving
(`npm run build && node scripts/dev/ios-demo.mjs`) and say so in the review notes, for example:

> Aula for iPhone and iPad is the companion of Aula for Mac (free, https://github.com/luumlabs/aula): the student's
> courses live on their own Mac and this app opens them over their private Tailscale network. No account is created
> in the app and it collects no data. To try it without a Mac, tap **Try it with an example course** on the first
> screen: it opens the full interface with a sample course stored inside the app.

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
  starts the embedded node and opens Tailscale's sign-in page in Safari. The connect screen was checked on both, in light and dark. The *Aula for Mac* sheet opens from the connect screen.
- The demo, in both simulators: it opens on *Today* with the example course, the course and the inbox open, the
  sample quiz in the chat grades answers, a new question gets the demo reply, and *Exit* returns to the connect
  screen. On the iPad also: the day's plan, a flashcard review (flip and rate), the calendar, statistics, tools, and
  *Create course*, which answers "This isn't part of the demo". `_verify/DemoTest` checks the server on macOS against the recording (dates moved to today, files, recorded
  and substituted calls, chat events).

- On a real iPad (iPadOS 27.2), built with the owner's development team and installed over the cable
  (`xcodebuild … -allowProvisioningUpdates DEVELOPMENT_TEAM=<team>` and `xcrun devicectl device install app`): signing
  in to Tailscale, finding `aula-mac`, typing the code and using the Aula of the Mac through the tunnel (Today, a chat
  with its answer). After reinstalling the app it reconnects by itself. The interface starts below the time and the
  battery, with nothing blurred under them.
- In the iPhone simulator, a two-finger pinch does not zoom the interface, and the bottom tabs sit above the home
  indicator.

Not verified yet:

- A real iPhone.
- On a real device: that a pinch or a double tap does not zoom (only tried in the simulator), the camera and the
  microphone, and a long session with the device going to sleep and coming back.
- Recordings playing through the tunnel inside `WKWebView` (media requests must carry the tunnel cookie).

Known limits: no push notifications on the phone (that needs Apple's push service and a paid developer account; the
inbox updates live while the app is open); the Mac must be on with Aula running.
