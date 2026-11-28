# Aula on your iPad, iPhone and Android

Aula can be used from the student's own iPad, iPhone and Android phone or tablet while everything (courses, the AI, the
data) stays on their Mac, their Windows PC — or on their own server, with no desktop app at all ([SERVER.md](SERVER.md)). The devices are only a
window: they reach Aula over the student's private Tailscale network (their own account).

- **iPad**: the whole app, as on the Mac (courses, lessons, practice, chat, calendar, documents).
- **iPhone**: the same interface in a narrow layout built around Aula as an assistant: four tabs at the bottom
  (*Inbox*: what Aula did and what is pending, with the always-on switch first; *Aula*: the chat; *Calendar*; *Today*).
- **Android**: the same, phone or tablet layout by width (`native/android`, [its README](../native/android/README.md)).

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
- **What a device may ask for** (`policy.ts`): a closed allowlist. Studying, chat, calendar, inbox, documents,
  creating courses and the daily-use settings (below) are open; API keys and secrets, the rest of the settings,
  anything that opens a dialog or window on the Mac, export/delete-everything, updates and the remote access itself
  are refused before reaching any handler. A method that is added later stays closed until it is listed. `ai.consent`
  and `ai.acceptConsent` (the AI notice, below) are open and answered by the remote server itself.
- **Uploads** (`uploads.ts`): the device has no Mac paths. The bridge uploads the picked file and hands the app an
  `aula-upload://<id>/<name>` reference; the server swaps it for the path of the copy (in the system temp folder,
  swept after 7 days) and registers it as a file the student gave, exactly like a file dropped on the Mac window.
- **Private network** (`tailnet.ts` + `native/tsnet/`): a Go sidecar built on Tailscale's `tsnet` (ported from Faro)
  joins the student's tailnet as `aula-mac` (or `aula-windows` on Windows, `aula-server` in server mode) and forwards
  port 80 to the remote server. It only accepts peers that
  belong to the **same Tailscale user**, proves to itself that the upstream is Aula (HMAC challenge on `/health`)
  before forwarding, and never uploads logs. Tailscale does not need to be installed on the computer (and on Windows,
  the embedded `aula-tsnet.exe` runs in userspace without admin rights or interfering with an existing Tailscale Windows
  install, reusing the desktop instance's existing data folder `%APPDATA%\Aula` directly with no data migration). The
  server also rejects any request whose `Host` is not this computer unless it carries the sidecar's per-launch key.

## Settings on a device

There is one Aula, on the Mac, so there is one set of settings: a change made on the iPad changes Aula everywhere
(the Mac window and the other devices follow at once). On a device the Settings screen shows only the daily-use
part, and the server enforces the same split (`policy.ts`): a device that sends anything else is refused, whatever
its interface shows.

| On a device | What can be done | How the server limits it |
| --- | --- | --- |
| **Your AI** | Choose among the AIs that are already ready on the Mac, and their model and reasoning level | `ai.choices` lists only ready providers, without key hints or addresses. `ai.choose` takes `providerId`, `model`, `reasoning`, `activate` and nothing else (a base URL, a key or any other field refuses the call); the provider must be ready on the Mac and the model must be one of its list (`chooseAI` in `services/ai/service.ts`). `ai.models` gives a provider's model list |
| **Appearance** | Theme, text size, motion | `settings.update` with `general.theme`, `general.textScale` (0.85 to 1.3), `general.motion` |
| **Language and reminders** | Name, language, daily reminder and its time | `general.name` (up to 80 characters), `general.language`, `general.reminders`, `general.reminderTime` (HH:mm) |
| **Aula always on** | The switch and quiet hours | `persistent.enabled`, `persistent.quietHours` (`null` or `{ from, to }` in HH:mm) |
| **What Aula remembers** | See, add, correct, forget one, pause | `memory.list`, `memory.status`, `memory.add`, `memory.edit`, `memory.pause`, and `memory.forget` with exactly one id |
| **About** | The version, the legal notices, and links to the source code, the privacy policy and the support page (they open in the device's browser); at the end, *Support Aula* (an optional button to GitHub Sponsors; in the iPhone and iPad app only with the United States App Store, see `supportLink()` below) | `app.info` |

A `settings.update` from a device is checked field by field against that list, each with its type and range, and
is refused **whole** if it carries anything else (another section, another field, a wrong type): the good fields
of a mixed patch are not applied.

Only on the Mac (hidden on a device and refused by the server): adding or changing API keys, signing in to ChatGPT
or Claude, downloading local models, the daily spending cap, a custom AI service or its address, **Your
platforms**, **Aula on your devices**, **Privacy and data** (its switches, the data folder, export and delete
everything), exporting or clearing the memory, forgetting several memories in one call, updates and automatic
updates, "open at login" and the cursor (a touch device has none).

## The AI notice (App Store guideline 5.1.2(i))

Before the first call from a device that sends something to the AI (a chat message, an answer to grade, course
material, a document request, importing a document, since a recording is transcribed, handing the live browser to
Aula, running or turning on an automation, *Aula always on* or one of its routines that use the AI, or resuming it after
a pause), the device shows a sheet that names who will receive it
and why: the AI provider active on the Mac (answers) and, if it is another company, the one that transcribes recordings
(`src/main/services/ai/recipients.ts`, names in `src/shared/ai/recipient.ts`: a preset is its company, a custom address
is its host, OpenCode is the provider of its `provider/model`, and a model on the Mac itself names nobody). *Continue*
sends; *Cancel* sends nothing (the chat puts the text back in the box).

- **Where it is kept.** On the Mac, per device, in `Remote/devices.json` (`aiConsent`: the accepted ids). Not in the
  device's browser storage: the app's page lives on `http://127.0.0.1:<port>` and the port changes after each
  suspension, so `localStorage` would be lost. Removing the device in Settings forgets it. If the AI changes to a
  company not accepted yet, the device asks again (`ai.changed` makes it look again).
- **Who enforces it.** The Mac: the remote server refuses any AI-bound call from a device that has not accepted the
  current recipients with the error `ai_consent` (with the recipients in its details) before any handler runs
  (`src/main/services/remote/ai-consent.ts`); the interface catches it, shows the sheet and retries once. The list of
  methods is one, shared by both sides: `src/shared/ai/consent.ts`. The Mac's own window never shows it.
- **In the demo** there is no Mac: the sheet says that the demo sends nothing and that, with a Mac, Aula asks here
  first, with the same privacy policy link. Its answer lives only in memory.
- **Cancel is not a failure.** Nothing was sent, so no screen shows it as an error (`toast.error` skips that message).

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
- **From a device, only the student's platforms.** While a device drives the window (opens it, taps, types, goes back
  or forward) it only opens the student's platforms (their host, the platform's cloud and file hosts, and the other hosts
  of a self-hosted platform's own site, such as the university's SSO) and sign-in pages (Microsoft, Google, Apple, Okta,
  Shibboleth, CAS, ADFS, academic federations). Asked for by the device itself, only the account's own host, the
  platform's fixed hosts (`classroom.google.com`, `teams.microsoft.com`…), a self-hosted platform's site and the listed
  providers; another tenant of the platform's cloud or its file hosts (`*.instructure.com`, `*.sharepoint.com`,
  `*.googleusercontent.com`; a self-hosted Moodle never gets MoodleCloud), a provider's tenant (`x.okta.com`) or what
  only looks like a sign-in step by its host or its path (`sso.uni.edu`, `/idp/…`, Keycloak's `/realms/…/login-actions/`,
  never on shared hosting such as `netlify.app` or `workers.dev`, nor by the path on a general portal) only when the page
  itself leads there; so do the Microsoft Forms and Google Forms links Teams and Classroom post, and the site of a course
  tool the platform launches in the whole window (an LTI launch from Moodle's `mod/lti/launch.php`, Canvas's
  `external_tools`, Brightspace or Blackboard: the tool's sign-in, its return through the platform and its own site).
  edX is one organisation, so an `edx.org` account opens all of `edx.org`. Anything else is not opened: the page stays
  where it was and the device says why (back and forward work as usual when every entry they could land on may be
  shown; otherwise they go to exactly the nearest entry that may). What the device sees follows the same rule: a page it could ask for itself, or one of those
  "only when the page leads there" steps reached by a link, form, redirect or pop-up from a page it could already see
  (its origin is remembered for that window). A page opened from the computer or by Aula (the chat's
  `student_browser_show`) that the device could not ask for itself is not shown on the device (no pictures, no input),
  even if it looks like a sign-in page, and a page Aula puts in front of the student hands the window back to the
  computer until the device touches it again; the tool tells the AI when that happens (only when there are linked
  devices: without them the Mac's chat is unchanged). Frames inside the page: their
  first load (a video, a course tool the page embeds), what a page the device can see starts in them (an LTI launch,
  with forms between the frame, the platform and the tool), navigation within the frame's own site, going back to a
  site a frame of that page already reached (the tool after its sign-in) and sign-in steps all work; a link or redirect
  from someone else's frame to another site is not opened, also from a blank or `srcdoc` document that frame writes
  (it is judged as the frame that holds it), and a frame is judged by what it has loaded, never by the empty frame
  Chromium prepares for a jump (`tests/e2e/device-live-frames.e2e.ts`). (A frame's first load is not checked, so a page that embeds
  an arbitrary site shows that one site.) On the computer nothing changes (if the last one to drive was a device, the
  computer says what was not opened and a click on the page takes over). Rule: `src/engine/live/reach.ts`.
- This computer and the local network are not reachable from the live window (the platform session blocks them on every
  request), except a platform that itself lives on the local network.

## Using it

On the Mac: **Settings → Aula on your devices** → turn it on → **Sign in** (Tailscale, once) → **Link** shows the code.

On the device, either:

1. **The Aula app** (`native/ios`, see below, or `native/android`): it embeds its own Tailscale node, so the Tailscale
   app is not needed. Sign in to Tailscale with the same account, the app finds your Aula by itself, type the code.
   It looks for the machines on the tailnet that are **yours** (owned by the same Tailscale user as the device, untagged
   and not shared in from another tailnet, the same rule the Aula side applies to devices) and whose name is an Aula's:
   the first label of the MagicDNS name, in ASCII lowercase, is `aula-` plus a DNS label (at most 63 characters, no
   hyphen at either end) and not a device's own name (`aula-ipad`, `aula-iphone`, `aula-android`, `aula-device`, each
   maybe followed by `-<digits>`): `aula-mac`, `aula-server`… Another person's Aula on a shared tailnet is never listed
   or opened, and the app only ever connects to the tailnet address of an Aula it listed (never to a name some other
   machine could take later). If there are several (a Mac and a server), it asks which one to open and remembers it;
   *Settings → Open another Aula* changes it, even while the current one is still being tried. Each Aula sets its own
   link cookie (`aula_device_<installation>`), so a device stays linked to both.
2. **Safari**, with the Tailscale app installed and connected on the device: open `http://aula-mac`, type the code,
   then *Share → Add to Home Screen* to get a full-screen icon. This needs no Xcode and works today.

The Mac has to be awake with Aula open (or in the tray). Settings opens on the device with the daily-use part (see
*Settings on a device*); keys, platforms, devices and data are managed on the Mac.

## The iPhone / iPad app (`native/ios`)

A small SwiftUI app, no third-party packages:

| File | What it does |
|---|---|
| `Aula/AulaApp.swift`, `AppModel.swift`, `RootView.swift`, `Texts.swift` | The app, its state machine (sign in → find the Mac → open) and the waiting screens (es/en), which end with *Privacy policy · Licenses* |
| `Aula/SafariView.swift` | Tailscale's sign-in page in a sheet inside the app (`SFSafariViewController`), which closes by itself once the node is signed in |
| `Aula/LicensesView.swift`, `Aula/Licenses.json` | The *Licenses* sheet: Aula's notice and license, and the full license text of everything TailscaleKit puts in the binary (libtailscale, the Go standard library, wireguard-go and the other Go modules it links) |
| `Aula/WebView.swift` | The `WKWebView` that shows Aula through the loopback tunnel; outside links open in the browser. It tells the page the real safe-area margins (SwiftUI hides them from a full-screen view; never less than the status bar), turns off iOS 26's blur under the status bar, ends above the keyboard (the page itself never scrolls or pans), has no form bar (‹ › ✓) over the keyboard, follows Aula's own theme and offers the page `window.aulaApp` (see *The native shell and the page*) |
| `Aula/SupportLink.swift` | Whether the page may show *Support Aula* (*Settings → About*, a button to GitHub Sponsors): only when StoreKit's `Storefront` is `USA` (App Store guideline 3.1.1(a)), followed with `Storefront.updates`. It is asked on the device and never sent. Without it, `WebView.swift` doesn't open GitHub Sponsors even if the interface asks; `_verify/verify.sh` tests both rules |
| `Aula/Shell.js` | What both apps put in the page (Android copies it when building): it makes the page behave like an app (no zoom, no tap flash, only what the interface marks `.selectable` and fields can be selected) and tells the app the page's theme and edge colors |
| `Aula/Tailnet/TailnetController.swift` | Owns the embedded TailscaleKit node, lists the student's Aulas among the tailnet's machines and dials only their tailnet addresses |
| `Aula/Tailnet/AulaHosts.swift` | Which machines are the student's Aulas (same Tailscale user, untagged, an Aula's name): pure logic, the same rule as the Android app's `native/tsnet/client` and the desktop; `_verify/verify.sh` tests it |
| `Aula/Tailnet/LoopbackForwarder.swift` | `127.0.0.1` listener piped through the tailnet. Only connections that present the listener's secret (the `aula_gate` cookie the app sets for the web view, or `_ft` for native requests) are dialed; the port and secret change after a suspension |
| `Aula/DemoServer.swift` | The demo (*Try it with an example course*): a tiny HTTP server on `127.0.0.1` that plays back a recording of the real app, so Aula can be tried with no Mac. See below |
| `Aula/Assets.xcassets` | The app icon in its three looks (light, dark and tinted: the system picks one with its mode; `npx electron scripts/dev/icon/build-icons.mjs` writes them) and the drawings of the connect screen (the arch at each hour and the desk lamp, in light and dark), taken from the real app with `node scripts/dev/ios-art.mjs` |
| `build-tailscalekit.sh` | Builds `Frameworks/TailscaleKit.xcframework` from Tailscale's official `libtailscale`, with log uploads disabled, Aula's bundle id (`com.luumlabs.aula.TailscaleKit`) and its own privacy manifest (`tailscalekit/PrivacyInfo.xcprivacy`) in each framework, and each framework's debug symbols (`TailscaleKit.framework.dSYM`, made with `dsymutil` before the binary is stripped) inside the xcframework, so Xcode adds them to every archive; then runs `scripts/licenses.mjs` |
| `scripts/licenses.mjs` | Writes `Aula/Licenses.json` from the Go modules that `go list -deps` says are linked for iOS, each with its `LICENSE`/`NOTICE`/`PATENTS` files, after Aula's own notice (`scripts/aula-notice.mjs`: `NOTICE.md` as plain text, then `LICENSE.md`) |
| `Aula.xcodeproj` | The Xcode project (iOS 18.1+, iPhone and iPad) |

Build it (needs a Mac with **Xcode 16.1 or newer**; the Command Line Tools are not enough):

```bash
native/tsnet/build.sh                 # once: tells you how to get the project-local Go toolchain
native/ios/build-tailscalekit.sh      # builds Frameworks/TailscaleKit.xcframework (AULA_TOOLCHAIN=<folder> in a git worktree)
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

The App Store video and screenshots use a second recording that is **never** put in the app:

```bash
npm run build && node scripts/dev/ios-demo.mjs --preview --lang en   # docs/app-store/media/archives/Preview-en.aulademo
node scripts/dev/ios-demo.mjs --preview --lang es --check-ai         # only says which AI it would use
```

It records at the sizes of the screenshot devices (iPad 13″ in landscape, iPhone 18 Pro Max), in that interface
language, with the real AI of the Claude Code CLI (its signed-in subscription, never an API key) for exactly one call:
the tutor's answer to "Explain my mistake". At the end it does what the marketing shows (the arc lesson up to its
figure, `27` in the arc exercise and the red pen, the tutor, a flashcard flipped and rated), keeping the first answer of
every call from then on, so the progress plays back untouched and each new call is the last of its method. It prints
the tutor's answer for review. `--fake-ai` rehearses it with the simulated AI. The simulator loads it with
`-AulaDemo` (Debug builds only, see `docs/app-store/listing.md`).

The recording also includes `LICENSE.md`, `NOTICE.md`, `THIRD_PARTY_NOTICES.md` (including Sketchy's MIT notice)
and the build's `THIRD_PARTY_LICENSES.txt`. They travel inside the archive with the renderer and fonts, and the demo
server serves their full text at the matching root paths. Recording fails before launching the app if any notice is
missing or empty; run the build first to generate the dependency licenses.

Git does not keep `Demo.aulademo` (it is rebuilt from the app): **record it before archiving the app**, and again
whenever the interface changes. Without the file the app builds and runs the same, just without the demo button.
`_verify/verify.sh` checks the server against the recording (`_verify/DemoTest`).

## The native shell and the page (iPhone, iPad and Android)

Both apps are a native shell around Aula's own interface. They share `native/ios/Aula/Shell.js`, which they run in the
page, and offer the page the same `window.aulaApp` (`WebView.swift`, `MainActivity.AppBridge`):

| Call | What it does |
| --- | --- |
| `page(json)` | Sent by `Shell.js`: whether the page is dark (`html.dark`, the theme of *Settings → Appearance*) and the color of each edge, with the paper's grain, the sidebar beside the sheet and any dimming layer composited. The apps paint what is outside the web view with it (the status bar area, the demo bar; on Android, the system bars) and follow **Aula's** theme, not the system's: the time and the battery stay readable when Aula is dark on a light phone. The web view itself keeps the system's `prefers-color-scheme`, so *As the system* keeps working |
| `switchAula()`, `aulaCount()` | *Open another Aula*; with one Aula the list says so and has *Cancel* (and Back) to return to the open one without reloading. `aulaCount()` is Android only |
| `setCanGoBack(bool)` | The interface has somewhere to go back to even if its history does not say so. Android's Back (gesture, button, predictive back) and, on iOS, a swipe from the left edge first ask the interface with `window.__aulaBack()` (it closes what is open on top or goes back, and says whether it did; `src/renderer/src/app/shell/deviceBack.ts`, which also keeps a guard history entry while there is something to undo), then go back in the web view's history (only within the same Aula); with nowhere to go, Android sends the app to the background without closing it (the private network keeps running). On iOS the page follows the finger during the swipe when `window.__aulaBackKind()` says it is a plain step back (`'back'` or `'home'`; with `'overlay'`, something on top that only closes, it acts on release) |
| `showLicenses()` | The native *Licenses* screen (Aula and everything the app carries) |
| `exitDemo()`, `demoNotice(bool)` | Leave the demo; with `demoNotice(true)` the interface shows its own demo notice and the native bar goes away |
| `edgeToEdge(bool)` | Android only: the interface draws under the system bars itself. By default the web view stops at the bars and the app paints them with the page's colors; with `edgeToEdge(true)` it fills the screen and the page gets the room it must leave as `--aula-safe-top/right/bottom/left` (also `--aula-inset-*`), to use as `max(env(safe-area-inset-top), var(--aula-safe-top, 0px))`. An `aula:insets` event says they changed |
| `supportLink()` | Whether *Settings → About* may show *Support Aula* (`src/renderer/src/lib/supportLink.ts`). iOS returns `true` only with the United States App Store and, if that changes with the page open, fires an `aula:app` event; Android always returns `true` (it is not distributed through a store). An app without it (an older one) hides the section; a plain browser shows it |
| `fontScale()` | Android only: the system font size, 1 to 1.3. The app also hands it to the interface with `window.__aulaFontScale(n)` (or `__aulaPendingFontScale` before it loads; `design/theme.tsx` multiplies it into the text size) and as `--aula-font-scale`. The iOS app does the same with the system text size (Dynamic Type, also clamped to 1 to 1.3), before the page paints and whenever it changes |

On iOS a tap on the status bar calls `window.__aulaScrollTop()` (`app/shell/screenScroll.ts`), which scrolls the screen in
front back to the top, like tapping the current bottom tab again on a phone.

Both apps also put `ime-open` on `<html>` while the on-screen keyboard is up (`app/shell/keyboard.ts` then moves the
bottom tabs out of the way).

On iOS the web view ends at the top of the keyboard (only the system safe areas are ignored, not the keyboard's),
so the composer sits on the keyboard and nothing slides away. On Android, turning the system dark, changing the font
size or the language no longer recreates the activity: the interface keeps what was being typed (if a web view did not
pick up the new `prefers-color-scheme` by itself, the app falls back to recreating it). A slide presentation or a
video can go full screen (Back leaves it), and adding materials offers the camera next to the file picker (the photo
goes to the app's own `PhotoProvider`; no camera permission). The 502/403 of a tunnel whose Aula stopped answering
takes the app back to *Your Aula isn't answering* instead of showing the raw text.

**Android: the demo and a development Aula.** The Android app plays the same recording as the iPhone
(`DemoServer.java`, `Demo.aulademo` copied to `assets/` by `build.sh` when it exists): *Try it with an example course*
on the sign-in, *can't find* and *won't start* screens, with a bar that says it is the demo and *Exit*. A debug build
(`build.sh --debug`) can also open the Aula of the Mac it is plugged into, with no Tailscale: turn on *Aula on your
devices* on the Mac, note the port of its local address (`http://127.0.0.1:<port>`, the remote server; `remote.status`
gives it as `localURL`), then

```bash
adb reverse tcp:<port> tcp:<port>
adb shell am start -n com.luumlabs.aula/.MainActivity --ei aula.devPort <port>
```

The same port on both sides keeps the server's `Host` check happy, and plain HTTP only ever goes to `127.0.0.1`.

**Android: licenses.** `build.sh` writes `assets/licenses.json` with `native/ios/scripts/licenses.mjs --android`: Aula's
notice and every Go module linked into `libaulatsnet.so` (Tailscale, wireguard-go, the Go standard library…), each
with its full license text. *Privacy policy · Licenses* is at the foot of every waiting screen, as on the iPhone.

## Sending the app to the App Store

The app is the window to the Aula on the student's Mac, so its first screen also says where to get Aula for Mac
(*Don't have Aula on your Mac yet?* → the download page, with a button to send the link to the Mac).

Ready in the project:

- An archive builds (`xcodebuild archive`, checked unsigned): iPhone and iPad, iOS 18.1+, not offered on Apple silicon
  Macs nor Vision Pro. The version (`MARKETING_VERSION`) is the Mac version the app ships with; the build
  (`CURRENT_PROJECT_VERSION`) only goes up, one per upload. The team is passed on the command line
  (`DEVELOPMENT_TEAM=<team>`), so the project stays neutral.
- `Aula/PrivacyInfo.xcprivacy`: no tracking; the "required reason" system functions (file timestamps in the node's own
  folder and the system clock, used by the embedded Tailscale node; `UserDefaults`, which remembers which Aula to
  open); and what Tailscale keeps to connect the device (Email Address, seen by Tailscale's sign-in inside the app,
  User ID and Device ID; linked, not for tracking, App Functionality). Each `TailscaleKit.framework` carries its own
  manifest too.
- TailscaleKit's debug symbols: the xcframework carries a `TailscaleKit.framework.dSYM` for each framework (made
  before stripping, with the binary's UUID), and Xcode copies it into the archive's `dSYMs/` next to the app's, so App
  Store Connect can symbolicate crashes in it (without them it warns that the archive has no dSYM for
  `TailscaleKit.framework`). A copy stays in `Frameworks/TailscaleKit.dSYMs/`; like the framework, git does not keep
  them. They name the folders the framework was built in, but only reach Apple inside the archive: the framework in
  the app is stripped.
- Tailscale's sign-in inside the app, and *Privacy policy · Licenses* on every waiting screen.
- The AI notice before the first thing a device sends to the AI (above), also in the demo, which must be recorded
  again after it changes (`Demo.aulademo` carries the interface; `app-store-check.mjs` looks for it).
- Permission texts in English and Spanish (camera, microphone, local network), the app icon without transparency, a
  launch screen, all orientations on iPad.

Everything to paste into App Store Connect (texts, review notes, privacy label, export compliance, age rating,
availability) is in [`docs/app-store/listing.md`](app-store/listing.md); the support page is [`SUPPORT.md`](SUPPORT.md).
Before archiving, `node scripts/dev/app-store-check.mjs` checks the texts, the version, both manifests, TailscaleKit's
dSYMs (their UUIDs against each binary, with `dwarfdump --uuid`), the license notices and the demo recording.

**Review.** Apple's reviewers have no Mac with Aula, so they try it through the demo. Record it before archiving
(`npm run build && node scripts/dev/ios-demo.mjs`): without `Demo.aulademo` the app has no demo button.

## What is verified, and what is not

Verified on a Mac, by tests in this repository:

- The remote server end to end over real HTTP (`src/main/electron/remote/server.test.ts`), linking, the allowlist and
  uploads (`src/main/services/remote/remote.test.ts`), and the sidecar (`native/tsnet/build.sh test`).
- The interface from a browser at tablet and phone sizes against a running Aula: linking with the code, courses and
  lessons, live events, assets with ranges, uploads, the phone layout.
- Settings on a device, against a running Aula with a second window linked as a device (tablet and phone sizes,
  light and dark): the screen shows only the daily-use cards; the theme and the language chosen on the device change
  the Mac's `settings.json` and the Mac window; adding, correcting and forgetting a memory reach the Mac; and the
  server refuses `data.deleteAll`, `data.exportAll`, `memory.clear`, `memory.export`, `ai.configure`, `ai.setKey`, an
  `ai.choose` with an address or for an AI that is not ready, and a `settings.update` with any field outside the list
  (alone or mixed with a good one), leaving the Mac's settings untouched.
- The Mac sidecar joining Tailscale's control plane up to "needs sign-in".
- `native/ios/_verify/verify.sh`: the loopback forwarder at runtime (36 checks), which machines are the student's Aulas
  (`_verify/HostsTest`, the same cases as `native/tsnet/client/main_test.go`), the whole app compiled for macOS in
  Swift 6 mode against TailscaleKit built from source, and the app's Tailscale node started for real up to "needs
  sign-in".
- With Xcode 27.2: `build-tailscalekit.sh` builds the framework for device and simulator, and `Aula.xcodeproj` builds
  for the iOS Simulator (Debug) and for a device (Release, unsigned) without errors or warnings in the project's code.
  In the iPhone and iPad simulators (iOS 27.2) the app opens on *Connect to your Aula* and *Sign in to Tailscale*
  starts the embedded node. The connect screen was checked on both, in light and dark. The *Aula for Mac* sheet opens
  from the connect screen.
- Since 0.2.7, with the framework rebuilt (Aula's bundle id and a privacy manifest in each slice; a Release build for a
  device, unsigned, carries both manifests and `Licenses.json`): in the iPhone simulator, *Sign in to Tailscale* shows
  Tailscale's page in a sheet inside the app and its close button dismisses it; *Licenses* lists Aula and every
  component with its license and opens each full text; *Privacy policy* opens the policy in Safari (at its Spanish half
  on a Spanish device). Checked in English (light) and Spanish (dark). On the smallest iPhone (SE, 3rd generation),
  with the demo button, the whole connect screen fits in both languages: the sign-in note is whole and *Privacy policy ·
  Licenses* is at the bottom. The sheet closing by itself after a real sign-in is not tried yet.
- With the framework rebuilt with its dSYMs (Xcode 27.2): an unsigned `xcodebuild archive` has
  `TailscaleKit.framework.dSYM` in `dSYMs/` with the same UUID as the `TailscaleKit` inside `Aula.app`, and the app
  itself carries no dSYM nor the build folders' paths.
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

- A real Windows PC hosting mobile devices over Tailscale (the Windows sidecar `aula-tsnet.exe` x64/arm64 is cross-compiled and vetted with `GOOS=windows`, and packaging/runtime logic is covered by automated tests, but live execution on Windows — including Windows Defender Firewall/SmartScreen behavior and live Android/iOS pairing against `aula-windows` — requires testing on a real Windows machine and the Windows CI packaging workflow).
- A real iPhone.
- On a real device: that a pinch or a double tap does not zoom (only tried in the simulator), the camera and the
  microphone, and a long session with the device going to sleep and coming back.
- Recordings playing through the tunnel inside `WKWebView` (media requests must carry the tunnel cookie).

Known limits: no push notifications on the phone (that needs Apple's push service and a paid developer account; the
inbox updates live while the app is open); the Mac must be on with Aula running.
