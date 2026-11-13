# Aula for Android

The window to the student's Aula — on their Mac or on their own server (docs/SERVER.md) — from an Android phone or tablet,
the same way the iPhone and iPad app works (docs/DEVICES.md). Courses, the AI and the data stay where Aula is; the phone
reaches it over the student's **own** Tailscale network.

```
Android                                                    Mac or server
┌──────────────────────────────────────────────┐          ┌──────────────────────────────┐
│ MainActivity (WebView) ── 127.0.0.1:<port> ──┐│ WireGuard│ aula-tsnet ("aula-mac",      │
│                                              ▼│ (tailnet)│  "aula-server") → Aula       │
│ libaulatsnet.so (child process, tsnet node   ├┼─────────▶│                              │
│ "aula-android": finds the Aulas, opens a      ││          │                              │
│ loopback proxy guarded by a per-launch secret)││          │                              │
└──────────────────────────────────────────────┘          └──────────────────────────────┘
```

No Tailscale app, no VPN permission and no Google services are needed: the app carries its own Tailscale node (the
same `tsnet` the Mac uses, `native/tsnet/client`), built as a static Linux binary and run as a child process — Android
installs it executable because it ships as `lib/<abi>/libaulatsnet.so` with `extractNativeLibs`. Tailscale's
`feature/androidbin` makes it work inside an app (Android denies apps the network list, `/etc/resolv.conf` and the usual
certificate paths).

| File | What it does |
| --- | --- |
| `src/…/MainActivity.java` | The screens (start, sign in to Tailscale, approval, which Aula, not answering), then the interface in a `WebView` that feels like an app: no zoom, no long-press menus, outside links in the browser, Back through the interface's history (also with Android 16's predictive back), files picked on the phone (one or several), edge to edge with the system bars and the keyboard respected, light and dark |
| `src/…/Tailnet.java` | Starts the Tailscale process, reads its events and sends it commands; if it dies, says so (`exited`: its tunnel is gone, the app asks the new process for another) and restarts it with back-off; it survives rotation and theme changes |
| `src/…/Tunnel.java` | The rules that need no Android, checked on the JVM by `tools/TunnelTest.java` on every build: only the tunnel the interface is shown on opens inside the app (cookies are not per port, so any other `127.0.0.1` port would get them), and what a `/health` answer means (show it, wait for the same tunnel, or ask for a new one) |
| `../tsnet/client/` | The Tailscale side: `needs_login` with the sign-in page, `running` with the Aulas it found, and the loopback proxy (`forwarding`), which serves only requests that carry its secret (the `aula_gate` cookie the app sets for the WebView) |
| `res/` | Texts (English, Spanish), the paper-and-brick theme in light and dark, the network rules (plain HTTP only to 127.0.0.1) and the adaptive icon. The drawings and the icon are taken from the iPhone app when building |
| `build.sh`, `setup.sh` | Build without Gradle; install the JDK and the Android SDK in `<root>/.toolchain` |

**Which Aula.** A machine of the **same Tailscale user** as the phone whose name (the first DNS label, lowercase ASCII)
matches `aula-[a-z0-9]([a-z0-9-]*[a-z0-9])?` (63 characters at most) and is not a device: `aula-ipad`, `aula-iphone`,
`aula-android` and `aula-device`, each optionally followed by `-<digits>` (`aula-ipad-2`). So `aula-mac`, `aula-server`,
`aula-casa`… The same rule as the Mac, the server and the iPhone app; `../tsnet/client` applies it and lists **only the
Aulas of the phone's own Tailscale user**: other users of a shared tailnet, machines shared in from another tailnet and
tagged machines never appear (the Aula itself lets in only its own user's devices too), and if two machines answer to
the same name, neither is listed. If there are several, the app asks once and remembers; *Settings → Open another Aula*
(in Aula itself) changes it. Each Aula keeps its own link cookie, so switching does not unlink the phone from the other
one.

**What stays on the phone.** The node's identity (its Tailscale private key) lives in `no_backup/tailnet`, which Android
never copies, and `res/xml/data_extraction_rules.xml` keeps everything else (the WebView cookie that links the phone to
the Aula) out of cloud backups and phone-to-phone transfers: since Android 12, `allowBackup="false"` alone no longer
stops the latter.

## Build

```bash
native/android/setup.sh --emulator   # once: JDK 21 and the Android SDK (+ emulator) in .toolchain; shows the SDK licence
native/android/build.sh --new-key    # once: Aula's Android signing key, in ~/.aula-signing/android (back it up)
native/android/build.sh              # build/Aula-<version>-android.apk, signed
native/android/build.sh --debug      # signed with a throwaway key, for the emulator
```

No Gradle, no AndroidX, no third-party libraries: `aapt2`, `javac`, `d8`, `zipalign` and `apksigner`; before packaging,
`tools/TunnelTest.java` runs on the JVM and a failure stops the build. The APK is universal (arm64-v8a for phones, x86_64
for emulators and Chromebooks), Android 8.0 (API 26) or later, target API 36. `build.sh` runs with the `/bin/bash` 3.2 of
macOS.

**The signing key.** Android only installs an update over the installed app if it is signed with the same key. The key
lives outside the repository (`~/.aula-signing/android/aula-release.keystore` and its password next to it, one line in
`aula-release.pass`); losing it means every user has to uninstall and install again. Keep a copy somewhere safe.

**The pin.** The SHA-256 of that key's certificate (public: anyone can read it from the APK) is committed in
`release-cert.sha256`, once, before the first release with an APK (docs/PUBLISHING.md says how). While that file exists,
`build.sh` (release mode, with the default keystore) compares the keystore's certificate with it before building and
stops if they differ, and `build.sh --new-key` refuses to make a key. A keystore somewhere else, given with
`AULA_ANDROID_KEYSTORE` (a test key, like the throwaway one CI uses), is not compared; such an APK is never published,
because `scripts/release-local.sh` checks the key and every APK against the pin.

## Publishing

The APK is attached to each GitHub release (`Aula-<version>-android.apk`). People install it from there (Android asks
once to allow installing apps from the browser). How it gets there: docs/PUBLISHING.md → *The Android app (APK)*. It is
built and checked only on the maintainer's Mac, by `scripts/release-local.sh` (one signer, the pinned key, this version,
not debuggable), never in CI: the release key never leaves that Mac. CI builds a `--debug` APK and, to catch bugs of the
release mode, a release-mode one signed with a throwaway key; neither is published.

Google Play would need a developer account in the owner's name, a privacy form and an `.aab`; F-Droid builds from source
and would need the build in its format.
