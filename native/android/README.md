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
| `src/…/MainActivity.java` | The screens (start, sign in to Tailscale, approval, which Aula, not answering), then the interface in a `WebView` that feels like an app: no zoom, no long-press menus, outside links in the browser, files picked on the phone, edge to edge with the system bars and the keyboard respected, light and dark |
| `src/…/Tailnet.java` | Starts the Tailscale process, reads its events and sends it commands; restarts it with back-off if it dies; it survives rotation and theme changes |
| `../tsnet/client/` | The Tailscale side: `needs_login` with the sign-in page, `running` with the Aulas it found, and the loopback proxy (`forwarding`), which serves only requests that carry its secret (the `aula_gate` cookie the app sets for the WebView) |
| `res/` | Texts (English, Spanish), the paper-and-brick theme in light and dark, the network rules (plain HTTP only to 127.0.0.1) and the adaptive icon. The drawings and the icon are taken from the iPhone app when building |
| `build.sh`, `setup.sh` | Build without Gradle; install the JDK and the Android SDK in `<root>/.toolchain` |

**Which Aula.** Any machine on the tailnet whose name starts with `aula-` and is not a device (`aula-ipad`,
`aula-iphone`, `aula-android`): `aula-mac`, `aula-server`, `aula-casa`… If there are several, the app asks once and
remembers; *Settings → Open another Aula* (in Aula itself) changes it. Each Aula keeps its own link cookie, so switching
does not unlink the phone from the other one.

## Build

```bash
native/android/setup.sh --emulator   # once: JDK 21 and the Android SDK (+ emulator) in .toolchain; shows the SDK licence
native/android/build.sh --new-key    # once: Aula's Android signing key, in ~/.aula-signing/android (back it up)
native/android/build.sh              # build/Aula-<version>-android.apk, signed
native/android/build.sh --debug      # signed with a throwaway key, for the emulator
```

No Gradle, no AndroidX, no third-party libraries: `aapt2`, `javac`, `d8`, `zipalign` and `apksigner`. The APK is
universal (arm64-v8a for phones, x86_64 for emulators and Chromebooks), Android 8.0 (API 26) or later, target API 36.

**The signing key.** Android only installs an update over the installed app if it is signed with the same key. The key
lives outside the repository (`~/.aula-signing/android/aula-release.keystore` and its password next to it); losing it
means every user has to uninstall and install again. Keep a copy somewhere safe.

## Publishing

The APK is attached to each GitHub release (`Aula-<version>-android.apk`). People install it from there (Android asks
once to allow installing apps from the browser). Google Play would need a developer account in the owner's name, a
privacy form and an `.aab`; F-Droid builds from source and would need the build in its format.
