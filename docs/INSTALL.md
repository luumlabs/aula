# Install Aula

<p align="right"><b>English</b> · <a href="INSTALL.es.md">Español</a></p>

Download the file for your system from the [latest release](https://github.com/luumlabs/aula/releases/latest):

| System | File | First launch |
| --- | --- | --- |
| macOS 13 or later (Apple Silicon and Intel) | `Aula-<version>-mac.dmg` | Open the .dmg, drag Aula to *Applications* and open it. Since 0.2.6 Aula is signed with an Apple Developer ID and notarized, so macOS opens it without extra steps. If you're replacing Aula 0.2.5 or earlier, macOS asks once for your Mac password for “Aula Safe Storage” (see [Updates](#updates)). |
| Windows 10 and 11 (x64 and ARM, one installer) | `Aula-Setup-<version>.exe` | Run the installer (it doesn't need admin rights). If SmartScreen shows up, click *More info → Run anyway*. Aula isn't code-signed for Windows yet. |
| Linux x64 | `Aula-<version>-linux-x86_64.AppImage` or `Aula-<version>-linux-amd64.deb` | AppImage: make it executable (`chmod +x Aula-*.AppImage`) and open it. Debian or Ubuntu: `sudo apt install ./Aula-<version>-linux-amd64.deb`. |
| Linux ARM64 | `Aula-<version>-linux-arm64.AppImage` | Make it executable (`chmod +x`) and open it. |
| Android 8 or later (phones and tablets) | `Aula-<version>-android.apk` | Open it on your phone and allow installing from that app when Android asks. It is a window to Aula on your Mac or on [a server of your own](SERVER.md): see [Devices](DEVICES.md). |

On a Mac, the release page also lists some 0.2.5 Mac files: they're only there so older copies can update through
0.2.5. To install by hand, use the `.dmg` named with that release's own version.

> **Updating from 0.1.x:** install the current version by hand this one time (download it here and install it over
> your copy; your courses and settings stay). Aula 0.1.x will say the new version's signature isn't valid: since 0.2.0
> Aula is signed with new keys, because the old ones were lost. From 0.2.0 on, Aula updates itself again. On a Mac,
> macOS asks once more for permission to use Aula's saved keys.

On Linux you need a 64-bit distribution with glibc. Install GNOME Keyring or KWallet too, or Aula has to store your
keys unencrypted.

The first time you open Aula it asks your name, helps you [pick an AI](../README.md#pick-an-ai) and, if you want,
connects your study platform. Your library starts with two example courses, so you can try everything before making
your own.

## Updates

Aula looks for a new version when it starts and every six hours. It downloads it in the background, checks its
signature and installs it when you quit (or when you click *Restart to update* in the sidebar). On macOS, keep Aula in
*Applications* for this to work; if a new version doesn't start, Aula goes back to the previous one. The AppImage
updates itself too. The `.deb` doesn't: Aula tells you when a new version is out, and you
download its `.deb` from the [releases](https://github.com/luumlabs/aula/releases) and install it the same way.

**On a Mac, the first update to 0.2.6 or later** changes how Aula is signed (now with an Apple Developer ID). The
first time the new version opens, macOS asks once for your Mac password so Aula can use “Aula Safe Storage”, where
your keys and study-platform sessions are kept: type it and choose *Always Allow*. Copies on 0.2.0 to 0.2.4 update
to 0.2.5 first and then to the latest version.

## Troubleshooting

| Problem | What to do |
|---|---|
| macOS can't verify the developer, or there's no *Open* button | Download the latest `Aula-<version>-mac.dmg`: since 0.2.6 Aula is notarized and opens normally. Versions up to 0.2.5 weren't: on macOS 15 or later, try to open Aula once, then go to *System Settings → Privacy & Security* and click *Open Anyway*; on macOS 13 and 14, right-click Aula and choose *Open*. |
| *Aula can’t open the keychain* in the sidebar (Mac) | Usually you chose *Deny* when macOS asked about “Aula Safe Storage”. Nothing is lost: your saved keys stay locked until you allow it. Click the notice, then *Reopen Aula*; when macOS asks again, type your Mac password and choose *Always Allow*. |
| macOS says the app is damaged | Move Aula to *Applications* and try again. If it still won't open, run `xattr -dr com.apple.quarantine /Applications/Aula.app` in Terminal. |
| macOS doesn't install an update | Check that Aula is in *Applications*, not in *Downloads* or running from the .dmg. *Settings → About* says what went wrong and lets you try again or download the update. |
| The AppImage doesn't start | Make it executable (`chmod +x`). It needs FUSE 2: `sudo apt install libfuse2` (on Ubuntu 24.04 and later, `libfuse2t64`). |
| Ubuntu 23.10 or later, with the AppImage | Ubuntu restricts the user namespaces that Chromium's sandbox needs, so the AppImage starts with that sandbox turned off. Aula still works, but the pages it opens (your study platform, for example) are less isolated. On x64, use the `.deb` instead: it keeps the sandbox on by installing the AppArmor profile Ubuntu needs. |
| Aula can't find `claude` or `codex` | Install the CLI and open it once in a terminal to sign in. After that, *Settings → Your AI* finds it. For ChatGPT, *Connect with ChatGPT* can also download the official Codex for you. |
| Creating a course with ChatGPT stops with *Code Mode is unavailable* | Codex is missing `codex-code-mode-host`, a program that goes next to it. Update Aula: it completes the Codex it installed by itself, the next time it uses it. If you installed Codex yourself, reinstall or update it (`npm install -g @openai/codex@latest`). If the file is there and it keeps failing, check that your antivirus isn't blocking it. |
| A course stopped at a usage limit | Nothing is lost. Open it and press *Resume* when your limit renews, or keep what's already there. |
| *Settings → About* says your keys aren't encrypted | On Linux without GNOME Keyring or KWallet your system can't encrypt them. Install one and sign in again. |
| Anything else | [Open an issue](https://github.com/luumlabs/aula/issues/new/choose). |
