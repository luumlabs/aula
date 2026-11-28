# Publishing a release

Aula ships as a GitHub release with one installer per system and the Android app (`Aula-<version>-android.apk`).
Installed copies look for new versions there, download them in the background and install them when the student
restarts (or quits) Aula. Publishing a release also builds the server image (`ghcr.io/luumlabs/aula-server`,
docs/SERVER.md).

- [How updates work](#how-updates-work)
- [Checklist](#checklist)
- [Publishing from your computer](#publishing-from-your-computer-no-github-actions) (while GitHub Actions is off)
- [Publishing with GitHub Actions](#publishing-with-github-actions)
- [Checking packaging changes](#checking-packaging-changes)
- [The Android app (APK)](#the-android-app-apk)
- [Test, then publish](#test-then-publish)
- [The server image (ghcr.io)](#the-server-image-ghcrio)
- [Testing the published installers on Windows and Linux](#testing-the-published-installers-on-windows-and-linux)
- [Rehearsing an update locally](#rehearsing-an-update-locally)
- [Signing](#signing)
- [The macOS signing bridge](#the-macos-signing-bridge)
- [Update signatures (Ed25519)](#update-signatures-ed25519)

## How updates work

Code: `src/main/electron/updates.ts`, `src/main/services/updates/`, `electron-builder.yml → publish`.

1. About 45 s after launch and then every 6 hours (if *Settings → About → Update automatically* is on, or when the
   student presses *Check for updates*), Aula asks GitHub for the **latest published release**:
   `releases.atom` + `releases/latest`, then that release's `developer-id-mac.yml` (macOS 0.2.5 and newer),
   `latest-mac.yml` (older macOS clients), `latest.yml` (Windows) or
   `latest-linux.yml` / `latest-linux-arm64.yml`. **Drafts are never seen** (GitHub doesn't list them) and
   **pre-releases are never offered** (`allowPrerelease: false`, and a version like `0.2.0-beta` is ignored even if it
   isn't marked as a pre-release). A release without this system's `latest*.yml` isn't offered to that system. After a
   check that fails for lack of connection, the next one is 30 minutes later; after the computer wakes up, Aula checks
   if the last check was more than 6 hours ago. No per-install identifier is sent (electron-updater's
   `x-user-staging-id` is the same nil UUID for everyone).
2. If it's newer, it downloads the installer (only the changed blocks when a `.blockmap` is there), checks its
   **SHA-512** against the `latest*.yml` and then requires **Aula's own Ed25519 signature** of that file (see
   [Update signatures](#update-signatures-ed25519)). An unsigned or badly signed update is never installed.
3. The sidebar shows *Version X ready · Restart to update* and *Settings → About* shows the release notes (from
   `latest*.yml`, the part in the student's language, **only if they carry their own signature**). It installs on
   *Restart and update* or the next time Aula quits (on macOS also when the Mac shuts down or logs out).

> **Never publish a release that isn't the app as *Latest*** (a video, a promo, a page of assets). Installed copies ask
> for `releases/latest`: they'd get that release's tag, find no `latest*.yml` and silently stop seeing updates until the
> next app release. Mark those as *pre-release*, or attach the files to an app release.

Per system:

| System | Installs with | Notes |
| --- | --- | --- |
| macOS | **Aula's own installer** (`src/main/services/updates/mac-install.ts`), not Squirrel.Mac | See below. |
| Windows | electron-updater's NSIS updater (`Aula-Setup-<v>.exe`, per user, no admin prompt) | If the app is ever code-signed, electron-updater also checks the new installer has the same publisher. |
| Linux | electron-updater's AppImage updater | The new AppImage replaces the old file (named after the new version); if its folder isn't writable, Aula doesn't download and says so. The `.deb` doesn't update itself, but it **checks**: the sidebar and Settings show the new version with *Download*. |

**Why not Squirrel.Mac.** electron-updater normally hands the `.zip` to Squirrel.Mac, which only accepts a new version
that satisfies the *designated requirement* of the running app's signature. With Aula's ad-hoc signature that
requirement is the exact hash of the executable (`cdhash H"…"`), so **every** update is refused — tested: *"Code
signature … did not pass validation: code failed to satisfy specified code requirement(s)"*. Aula's installer instead:

1. extracts the downloaded zip (SHA-512 and Ed25519 signature already checked) with `ditto` and verifies the new app:
   bundle id `com.luumlabs.aula`, the expected version, that this Mac's macOS is at least its `LSMinimumSystemVersion`,
   `codesign --verify --deep --strict` (nothing missing or altered) and, if the running app is signed with a
   certificate, its expected signing identity. The 0.2.5 bridge explicitly permits the pinned Aula local certificate
   to move to Aula's Apple Developer ID Application identity; an Apple-signed installation cannot move back to the
   local signer. See [The macOS signing bridge](#the-macos-signing-bridge);
2. on *Restart* (or quit, or shutdown) swaps it in with two `rename`s in the app's folder — the old app becomes
   `.Aula-previous.app` — and rolls back instantly if anything fails;
3. reopens Aula; the new version deletes `.Aula-previous.app` once its window loads. If it doesn't manage to start
   within 2 minutes, a small watchdog (`/bin/sh`) puts the previous version back, reopens it and records the failed
   version. **Install on quit has no watchdog** (nobody reopens Aula right away): if a version installed that way doesn't
   start, the previous one is still next to it as the hidden `.Aula-previous.app` until the new one opens once; the fix
   is to install the release by hand.

A version that failed to verify or install is **not retried automatically** (no download loops) — unless the same version
is uploaded again with different files (Aula records the SHA-512s of what failed). The sidebar shows *Version X not
installed · See why*, which opens *Settings → About*: it explains what happened and offers *Download* (the releases page)
and *Try again*. With an **invalid signature** it offers neither the download nor the notes (that release may not be
ours) and tells the student not to download it by hand unless the project announces it. If Aula runs from *Downloads*
or from the `.dmg` (macOS *App Translocation*) or from a folder it can't write to, it doesn't download anything; the
sidebar says so and Settings asks the student to move it (to *Applications*, or a folder they can write to) or to ask
whoever manages the computer. The notice can be dismissed for that version.

Errors the student can see (and nothing else): no connection (while checking or downloading), no published version,
damaged download, invalid signature, no permission, no disk space, macOS too old for the new version, couldn't install.
A failed *automatic* check (e.g. offline) stays silent.

## Checklist

1. **Version.** Bump `"version"` in `package.json`, the root records in `package-lock.json`, and `VERSION` — `MAJOR.MINOR.PATCH`.
2. **Changelog.** Add the `## [<version>]` entry to `CHANGELOG.md`.
3. **Release notes.** Write `docs/release-notes/<version>.md` with both languages, each after its marker, so the app
   can show the right one (GitHub hides the markers):
   ```md
   <!-- lang:en -->
   # Aula 0.1.1
   …
   ## What's new
   …
   <!-- lang:es -->
   # Aula 0.1.1
   …
   ```
   (An `## Install` / `## Instalar` section is dropped inside the app.) End each language with a **Source code** line —
   the AGPL asks for clear directions to the source next to the installers (see `docs/release-notes/0.1.0.md`): the
   *Source code* archives of the release (tag `v<version>`) are the exact source of its installers. Then point
   `electron-builder.yml → releaseInfo` at it (`releaseName`, `releaseNotesFile`): electron-builder copies the notes
   into every `latest*.yml`.
4. **Checks**:
   ```bash
   if [ -L node_modules ]; then unlink node_modules; fi  # remove only the link, preserving its shared target
   npm ci
   npm run typecheck
   npm test
   npm run build
   npx playwright test -c tests/e2e/playwright.config.ts   # Linux: xvfb-run -a npx playwright …
   ```
   Install dependencies in each release worktree. Remove an existing `node_modules` symlink with `unlink` before
   running `npm ci`, so npm operates on local dependencies and preserves the shared target. Packaging requires a
   physical `node_modules` directory because linked dependencies can omit required runtime modules. The native
   `.toolchain` directory can remain linked.
   CI (`.github/workflows/ci.yml`) runs the same on Linux and Windows, x64 and arm64. On a Linux machine without a
   desktop, the e2e tests need a window manager and libnotify like a real desktop has (`sudo apt install openbox
   libnotify4`, then `xvfb-run -a sh -c 'openbox & npx playwright test -c tests/e2e/playwright.config.ts'`).
5. **Android.** On the Mac you publish from: the Android toolchain (`native/android/setup.sh`, once) and Aula's Android
   release key in `~/.aula-signing/android/` (restored from its backup, see [The Android app](#the-android-app-apk)).
   Its fingerprint must be committed in `native/android/release-cert.sha256` (once, before the first APK: the script
   tells you the value). `scripts/release-local.sh` builds and checks the APK; Actions never does (the key never leaves
   that Mac).
6. **macOS.** On the same Mac: exactly one valid *Developer ID Application* identity of team `87BM9KFJZW` in the
   keychain, a `notarytool` keychain profile (`faro-notary`, or the one in `AULA_NOTARY_PROFILE`) and the five original
   files of the v0.2.5 bridge for `--bridge-dir`. See [The Developer ID release](#the-developer-id-release-026-and-later).
7. Commit and push to `main`.
8. **After publishing**: the *Server* workflow builds the server image for that version. The first time only, make
   the package public by hand ([The server image](#the-server-image-ghcrio)), or nobody can `docker pull` it. Then
   `node scripts/dev/check-public-feed.mjs luumlabs/aula <version>` checks what every installed copy sees, including the
   v0.2.5 bridge files under the new tag.

## Publishing from your computer (no GitHub Actions)

Build the signed Mac and Android packages on the maintainer's Mac. The script can also build Windows and Linux when
their packaging tools run on that host. If the bundled Windows NSIS tool cannot execute on the Mac, use the
[Release workflow](#publishing-with-github-actions) for Windows and Linux, then add the locally verified Mac and
Android files to the same draft.

```bash
scripts/release-local.sh            # checks + the Android APK and the macOS, Windows and Linux installers in release/<version>/
```

It refuses to start if `VERSION`, `CHANGELOG.md`, the release notes or `releaseInfo` don't match `package.json`, or the
tag already exists. Before compiling anything it checks the Mac signing configuration and the keys (update signatures,
the macOS Developer ID identity and notarization profile, see
[The Developer ID release](#the-developer-id-release-026-and-later), and the Android release key, which must match the
fingerprint in `native/android/release-cert.sha256`) and the tools: Go for
the Tailscale component, and for Android everything `native/android/build.sh` uses (JDK 17+, the SDK build-tools with
`apksigner`, `aapt2`, `d8` and `zipalign`, and the `android-36` platform). It runs `npm run typecheck` and `npm test`,
then builds the **APK first** (`native/android/build.sh`: a few seconds, and the step with the most prerequisites, so
if it fails it does so before the long desktop builds), then `npm run build` and `electron-builder --publish never`
once per system (nothing is uploaded). Each system is finished as soon as it's built: its `latest*.yml` signed and
`release/<version>/BUILD_INFO.<system>` written (the commit and tree it was built from, and whether there were
uncommitted changes). So if a later system fails, the ones before it stay ready to upload, and the script says which:
build only the rest with `--only`. Finally `scripts/release-verify.mjs` checks the channel metadata and every artifact's
SHA-512. The legacy Mac channel is the sole version exception: after 0.2.5 it must match the pinned bridge manifest
exactly. Options: `--only mac|win|linux|android` (repeatable; it rebuilds
only that system and leaves the files of the others as they are — only **before** the version is released: once the
tag `v<version>` exists the script stops, see [Adding a `.deb` to a published release](#adding-a-deb-to-a-published-release)
and [The Android app](#the-android-app-apk)), `--skip-checks`, and `--bridge-dir <original-0.2.5-files>` for later Mac
releases. Skipping checks does not bypass artifact, signature or notarization verification before upload.

What you get in `release/<version>/`:

| System | Files |
| --- | --- |
| macOS (universal) | `Aula-<v>-mac.dmg`, `Aula-<v>-mac.zip` (+ `.blockmap`s), `developer-id-mac.yml`, and the legacy `latest-mac.yml` with its original bridge files — **updates download the zip** |
| Windows (x64 + arm64 in one installer) | `Aula-Setup-<v>.exe` (+ `.blockmap`) and `latest.yml` |
| Linux | `Aula-<v>-linux-x86_64.AppImage`, `Aula-<v>-linux-arm64.AppImage` (+ `latest-linux.yml`, `latest-linux-arm64.yml`) and `Aula-<v>-linux-amd64.deb` |
| Android (arm64-v8a + x86_64, Android 8.0+) | `Aula-<v>-android.apk`, signed with Aula's Android release key. No `latest*.yml`: the app doesn't update itself, people install the new APK over the old one |

Notes for building on a Mac:
- macOS carries the Tailscale component of *Aula on your devices* (`Resources/bin/aula-tsnet`, see `docs/DEVICES.md`).
  Git doesn't keep it: the script builds it with `native/tsnet/build.sh`, which needs the project-local Go toolchain in
  `.toolchain/go` (the script says how to get it), and stops if the package comes out without it.
- The Linux packages carry it too (`resources/bin/aula-tsnet`, one per architecture: *Aula on your devices* and Aula as
  a server, `docs/SERVER.md`). `native/tsnet/build.sh linux` builds it into `native/tsnet/bin/linux-x64` and
  `linux-arm64` with the same Go toolchain, **before** `electron-builder`: if it's missing, electron-builder only warns
  and makes packages without it. The script checks it's in both packages.
- Android needs the JDK and the Android SDK in `.toolchain` (`native/android/setup.sh`, once), Go (its Tailscale
  component, `native/tsnet/build.sh android`) and the release key matching `native/android/release-cert.sha256`; see
  [The Android app](#the-android-app-apk).
- Windows carries the Tailscale component too (`resources/bin/aula-tsnet.exe`, x64 and arm64 inside the dual-arch NSIS
  installer: *Aula on your devices*). `native/tsnet/build.sh windows` cross-compiles `native/tsnet/bin/win-x64` and
  `win-arm64` with the same Go toolchain before `electron-builder` (no Wine needed; the installer stays unsigned). The
  script checks both unpacked packages contain `resources/bin/aula-tsnet.exe`.
- The Linux `.deb` needs GNU tar on the `PATH` as `gtar` (`brew install gnu-tar`, or the `gtar` that electron-builder
  keeps in `~/Library/Caches/electron-builder/linux-tools-mac*`). Without it the script builds only the AppImages (the
  ones that update themselves) and says so.
- Native modules: Aula's production dependencies are plain JavaScript/WebAssembly; the "missing optional dependencies"
  line about `@napi-rs/canvas-*` is expected and harmless (pdf.js only uses it to draw in Node, and Aula draws pages in a
  hidden window).

**Smoke-test** the files: open `release/<version>/mac-universal/Aula.app` (or the `.dmg`), on a Windows / Linux
machine run the `.exe` / AppImage, and install the APK on an Android phone (over the previous version's app, if there is
one). To try the actual update, see [Rehearsing an update locally](#rehearsing-an-update-locally).

**Upload** (you run this; it never publishes):

```bash
gh auth login                                          # once
scripts/release-local.sh --upload --repo luumlabs/aula # asks you to type «yes» before uploading
```

The repository is always given explicitly (it's never guessed from `origin`) and must be the one in
`electron-builder.yml → publish`, the one installed copies check. **Upload from a clone of the public repository**: the
release points at your current commit, which must already be on `luumlabs/aula`. The script re-verifies
`release/<version>/` (and the APK, see [The Android app](#the-android-app-apk)), requires a clean tree, refuses files
built from other content or from uncommitted changes (`BUILD_INFO.<system>`; a copy with the same tree, like the public
repository's clean commit, is fine). The only older artifacts allowed are the exact Mac bridge files fixed by the
committed manifest. It warns if the repository isn't public, and creates a **draft** release `v<version>`
(title: `releaseInfo.releaseName`; description: the English part of `docs/release-notes/<version>.md`) with the
installers, zips, `.blockmap`s, `latest*.yml` and the APK from that folder — exactly the files you tested. The tag is
created by GitHub when you publish.

If the draft **already exists** (the one the Actions *Release* workflow made, or one you uploaded before, e.g. with
`--partial`), `--upload` **adds** to it instead, only if the draft points at a commit with this same content. It never
replaces a file (a `latest*.yml` must stay with the files of its own build). For each file in `release/<version>/`:

- not on the draft yet: it's uploaded;
- already on the draft **with the same content** (GitHub's SHA-256 of the asset; downloaded and compared if GitHub
  doesn't give one): it's skipped. So `release/<version>/` can keep the systems you already uploaded: after
  `--upload --partial` without the APK, `--only android` and then `--upload` adds just the APK;
- already on the draft with **other content** (another build): it refuses and names the files. Move that system's files
  out of `release/<version>/`, or delete that system's files on GitHub (its `latest*.yml` with all its files) and upload
  again.

That's also how the Mac files and the APK join a draft built by Actions. It refuses to upload unless all three systems
(`developer-id-mac.yml`, `latest-mac.yml`, `latest.yml`, `latest-linux.yml`, `latest-linux-arm64.yml`) and
`Aula-<v>-android.apk` end up on the
release, counting what the draft already has; `--partial` uploads anyway, on purpose. Every `Aula-…` file the release
notes name must be there too. Use this checked upload path for 0.2.5 and later so the final Mac ZIP and DMG, both channels
and the preserved bridge files are verified together before the draft is changed.

Upload each channel YAML, including `developer-id-mac.yml`, **together with** the files it lists (same build): if you rebuild one system, upload its
installer and its `latest*.yml` again, never one without the other — otherwise the SHA-512 won't match and copies will
report a damaged download (and won't retry that version on their own).

### Adding a `.deb` to a published release

A `.deb` doesn't update itself, so it can be added to a release that's already out without touching any `latest*.yml` —
as long as it's built from **the tag's code** and uploaded **alone**. (Built together with the AppImages, as
`release-local.sh` does, it's also listed and signed in `latest-linux.yml`, as in v0.1.0; the AppImage updater ignores
it.) From a clone of the public repository:

```bash
git worktree add /tmp/aula-v0.2.4 v0.2.4                      # the exact tree of the release
cd /tmp/aula-v0.2.4 && npm ci                                  # or symlink the clone's node_modules
npm run build
native/tsnet/build.sh linux                                    # from 0.2.4 on: the Tailscale sidecar goes inside
test -x native/tsnet/bin/linux-x64/aula-tsnet                  # (electron-builder makes the .deb without it otherwise)
npx electron-builder --linux deb --x64 --publish never -c.directories.output=/tmp/aula-deb
gh release upload v0.2.4 /tmp/aula-deb/Aula-0.2.4-linux-amd64.deb -R luumlabs/aula   # ONLY the .deb
```

`native/tsnet/build.sh linux` needs Go: the project-local `.toolchain/go` (symlink the clone's `.toolchain` into the
worktree) or `go` on the `PATH`. Tags before 0.2.4 have no sidecar: skip those two lines. Never upload the
`latest-linux.yml` electron-builder leaves next to it: it would replace the signed one of the AppImages. Don't use
`scripts/release-local.sh --only linux` for this: it stops because the tag exists, and it would rebuild the AppImages
with other SHA-512s.

## Publishing with GitHub Actions

> **Update signatures.** The private key that signs updates lives only on the maintainer's computer, so installers
> built by Actions are **unsigned** and installed copies will refuse them. After the builds, download the draft's
> `latest*.yml` and installers, sign them locally and replace the `.yml` files (see
> [Update signatures](#update-signatures-ed25519)), or store the key as the `AULA_UPDATE_SIGNING_KEY` secret and add a
> signing step before the upload.
>
> **No macOS and no Android in Actions.** Mac signing uses Aula's Developer ID identity and notarization, and carries
> the v0.2.5 bridge (see [Signing](#signing)); the APK uses Aula's Android release key. Signing takes place on the
> maintainer's Mac, so the workflow builds Windows and Linux only. Add the Mac files and the APK to the same draft from
> your Mac: `scripts/release-local.sh --only mac --only android --bridge-dir /path/to/original-v0.2.5`. Then run
> `scripts/release-local.sh --upload --repo luumlabs/aula`
> (it adds them to the existing draft; see [Upload](#publishing-from-your-computer-no-github-actions)). The *verify*
> job lists what's still missing.

When Actions is available: *Actions → Release → Run workflow* on `main`. The **Release** workflow
(`.github/workflows/release.yml`) is **manual only** — it never runs when a tag is pushed, because publishing the draft
creates the tag and a tag-triggered build would upload untested installers over the tested ones. It:

1. **prepare**: checks `VERSION`, `CHANGELOG.md`, the notes and `releaseInfo`; stops if `v<version>` is already
   published or if its draft already has files (it never replaces installers); otherwise creates the empty draft
   (English notes, title from `releaseInfo`), so the three builds don't race to create it;
2. **build** on Windows and Linux (with the Linux Tailscale sidecar, checked before anything is uploaded) and uploads
   each system's files to that draft (`releaseType: draft`);
3. **verify**: downloads the draft and runs `scripts/release-verify.mjs` on it (every `latest*.yml` against the SHA-512
   of its files), says which files still have to come from the Mac (`latest-mac.yml`, the APK) and checks the update
   signatures.

Then add the Mac files and the APK (above), and [test and publish](#test-then-publish). Publishing starts the *Server*
workflow ([The server image](#the-server-image-ghcrio)).

## Checking packaging changes

The **Packaging** workflow (`.github/workflows/packaging.yml`) builds validation installers on native Windows and
Linux runners with Node 22. It runs on pull requests that change packaging dependencies/configuration and can also
be started manually. It uses read-only repository permissions, no publication credentials, and a fixed
`electron-builder --publish never`; it never creates or modifies a GitHub release.

The workflow checks the installer inventory, SHA-512 metadata and release-note content, then keeps the installers
as Actions artifacts named with the tested commit. `BUILD_INFO.json` records the commit, tree, Node version and
lockfile hash. These are **validation artifacts**, with unsigned update feeds: do not upload them to a release.
Inspect their runtime dependencies, exclusions, licenses and unpacked files when changing the packager. Mac
universal packaging/signing and the release-signature checks remain separate requirements before publication.

Every desktop package also runs `scripts/build/verify-ocr.cjs` after packing, before signing or making installers.
It checks the actual `app.asar` (including unpacked entries) against the installed dependency: all six Tesseract
core variants must retain their JavaScript and WASM files. Tesseract 7's Node adapter can select a full core even
when Aula requests LSTM-only OCR. Only the duplicate base64 `*.wasm.js` files are excluded. The release tests load
the six real packaged cores and check that missing or damaged files fail this guard; no language download is needed.

## The Android app (APK)

`native/android` (see its README) builds `Aula-<version>-android.apk`. It goes on every release next to the installers:
`docs/SERVER.md`, `docs/DEVICES.md` and the app's README send Android users there. It's built **only on the
maintainer's Mac**, by `scripts/release-local.sh` (in the default run, or `--only android`), because it's signed with
Aula's Android release key, which lives outside the repository and never goes to CI (CI builds a `--debug` APK and a
release-mode APK signed with a throwaway key, only to catch release-mode bugs; neither is published). Android installs an update over the app only if it's signed with the **same key** and has a higher
`versionCode` (`MAJOR·10000 + MINOR·100 + PATCH`, from `package.json`).

Once per Mac:

```bash
native/android/setup.sh                 # the JDK and the Android SDK in .toolchain (shows the SDK licence)
# the release key: ~/.aula-signing/android/aula-release.keystore + aula-release.pass (0600), restored from its backup.
# Only for the very first Android release, when no APK signed with it exists yet: native/android/build.sh --new-key
```

**The key's fingerprint is in the repository**: `native/android/release-cert.sha256` holds the SHA-256 of the release
key's certificate (the certificate is public: anyone can read it from the APK). The script requires every APK, and the
keystore in `~/.aula-signing/android/`, to match it. Without it, a lost key replaced by a new one would pass every check
and ship an APK that can't install over anyone's app. It's written **once**, before the first release with an APK
(0.2.4): when the file is missing, `scripts/release-local.sh` stops before building and prints the line to run, with the
fingerprint of the keystore it found. Check that keystore is the real one (the one in the backup), then commit:

```bash
echo '<the fingerprint the script printed>' > native/android/release-cert.sha256   # or the SHA256: line of --new-key
git add native/android/release-cert.sha256 && git commit -m "Android: pin the release key's certificate"
```

(Hex, with or without `:`. `#` starts a comment.) Never change it to make a new key pass: that is the case the file
exists to stop. Only if the key is really lost, and every Android user will have to uninstall and reinstall, replace
it on purpose in its own commit and say so in the release notes.

What the script does with it: before building, it checks that the keystore's certificate matches the fingerprint. It
then runs `native/android/build.sh` (release mode, with that key) and checks the APK before it enters
`release/<version>/` and again on `--upload`: `apksigner verify` passes for Android 8.0+, it has **one** signer, and that
signer's certificate matches `native/android/release-cert.sha256` (so not the `--debug` key, and not a new key), the
package is `com.luumlabs.aula`, `versionName` is this version, and it isn't debuggable. It writes `BUILD_INFO.android`
like the other systems. `--upload` adds it to the draft with the rest. It can also add the APK alone to a draft that
already has the other systems: files the draft already has with the same content are skipped (see
[Upload](#publishing-from-your-computer-no-github-actions)).

**If a published release is missing the APK**, add it like a `.deb` (no `latest*.yml` lists it, so nothing else
changes): build it from the tag's code and upload **only** the APK.

```bash
git worktree add /tmp/aula-v0.2.4 v0.2.4 && cd /tmp/aula-v0.2.4
ln -s <your clone>/.toolchain .toolchain                      # its JDK, Android SDK and Go
native/android/build.sh                                       # → native/android/build/Aula-0.2.4-android.apk
export PATH="$(find .toolchain/jdk -maxdepth 3 -type d -name Home | head -1)/bin:$PATH"   # apksigner runs `java`
"$(ls -d .toolchain/android-sdk/build-tools/* | sort -V | tail -1)/apksigner" verify --print-certs \
  native/android/build/Aula-0.2.4-android.apk                 # the signer: CN=Aula, O=Luum Labs
gh release upload v0.2.4 native/android/build/Aula-0.2.4-android.apk -R luumlabs/aula   # ONLY the APK
```

The signer's SHA-256 must be the one in `native/android/release-cert.sha256`, never `CN=Aula debug`'s or another key's.

**Keep the key safe**: back it up with the other keys ([Keeping the keys](#keeping-the-keys)). If it's lost, no later
APK installs over the app: every Android user has to uninstall it (losing its Tailscale sign-in and link) and install
the new one.

## Test, then publish

Nobody sees a draft and installed copies aren't offered it. Check that the draft points at the commit the installers
were built from (`BUILD_INFO.<system>`): its tag and *Source code* archives are the source the AGPL promises. Download
the installers from the draft, try them on each system (and the APK on an Android phone, installed over the previous
version: Android refuses it if the key changed), then press **Publish release** on GitHub: from then on copies find it within 6 hours (or at their next launch).
Each system has its own `latest*.yml`, so a system is never offered a version whose build isn't there. Pre-releases are
never offered as updates; use them for testers who download by hand.

Publishing it as a full release also starts the *Server* workflow, which pushes the server image for that version
([The server image](#the-server-image-ghcrio)); a pre-release doesn't.

**Private repository.** While `luumlabs/aula` is private, only its members can download the files and installed copies
can't check for updates (they'd quietly report "no published version"). Make the repository public (or publish the
releases elsewhere) before announcing.

## The server image (ghcr.io)

`.github/workflows/server.yml` (docs/SERVER.md) runs when a release is published **as a full release** (the `released`
event: never for a pre-release; a pre-release promoted to a full release gets its image at that moment). For amd64 and
arm64 it builds the image from that version's **published** AppImage (checked against its `latest-linux*.yml`), runs
`server/smoke.sh` on it and pushes `ghcr.io/luumlabs/aula-server:<version>`. It moves `:latest`, which `server/compose.yaml`
and docs/SERVER.md tell people to pull, **only if that version is the repository's latest release** (the one installed
copies are offered): a pre-release, or a rebuild of an older version, never moves it. To rebuild by hand (e.g. after a
fix to `server/Dockerfile`): *Actions → Server → Run workflow* with `publish` = the version.

**Once: make the package public.** A package that a workflow creates on ghcr.io starts out **private**, even from a
public repository, and the workflow's `GITHUB_TOKEN` can't change that. Until someone does it by hand, every
`docker pull` / `docker compose up` fails with *denied*. After the first run that pushes an image (0.2.4):

1. open the package settings: <https://github.com/users/luumlabs/packages/container/aula-server/settings> (from the
   repository: *Packages → aula-server → Package settings*);
2. *Danger Zone → Change visibility → Public*, and confirm with the package name.

It stays public for every later version. The workflow's last step checks it the way a user would, pulling without
logging in: if the package isn't public it leaves a *warning* in the run and its summary with this link, but doesn't
fail (the release is already out). To check by hand: `docker logout ghcr.io && docker pull ghcr.io/luumlabs/aula-server:<version>`.

## Testing the published installers on Windows and Linux

*Actions → Platforms → Run workflow* (`.github/workflows/platforms.yml`, script `scripts/ci/installed.mjs`) downloads the
**published** installers and uses them like a student would, on real Windows and Linux machines (x64 and arm64). It needs
no secrets (everything is public, and Aula runs with its simulated AI). Run it right after publishing a release, with
`from` = the previous version and `to` = the one you just published (it must be the latest release: that's what installed
copies are offered):

| Job | What it checks |
| --- | --- |
| windows update (quit / restart) | `Aula-Setup-<from>.exe /S` installs per user (HKCU, `%LOCALAPPDATA%\Programs\aula`, no admin); Aula opens, finds `<to>` on github.com, downloads it, checks Aula's signature and installs it on quit (or with *Restart and update*, which reopens it); `<to>` is installed in the same folder, the courses and settings are still there, the log has no errors |
| windows fresh install | `Aula-Setup-<to>.exe` from scratch: opens (with `AULA_HOME` and with the real `%APPDATA%\Aula`), is up to date, closes with its window, and a silent uninstall removes the app and keeps the data |
| linux AppImage update | the `<from>` AppImage, with and without libfuse2 (without it, extracted with `APPIMAGE_EXTRACT_AND_RUN`), replaces itself with the published `<to>` AppImage (same SHA-512) on quit or on *Restart* |
| linux .deb | `apt install` of the `<from>` `.deb`: it sees `<to>` and only offers the download; then `apt install` of `<to>` over it opens up to date with the same data |

Each job uploads its `main.log`s and screenshots as an artifact, and the summary of the run lists every check. On Windows,
*Restart and update* reopens Aula through the shell, without the environment it was started with: a copy started with
`AULA_HOME` comes back with the normal data folder (students never set it, so the job uses `%APPDATA%\Aula`). The runners
are administrators, so a standard (non-admin) Windows account is only covered by checking where things are installed.

## Rehearsing an update locally

Sign every rehearsal build the way installed copies expect. From 0.2.6 that is Aula's Developer ID identity: an
installed copy signed with it rejects an ad-hoc update, and an ad-hoc copy never accepts one. `electron-builder.yml`
now notarizes whenever `APPLE_KEYCHAIN_PROFILE` (or another Apple credential) is set, so rehearsal builds pass
`-c.mac.notarize=false` and pin the identity by its SHA-1 (`$ID` below); installed copies don't check notarization.
These builds carry the real team signature: keep them local and delete them afterwards. A build that never has to
update (a smoke test) can be ad hoc instead: `-c.mac.identity=- -c.mac.hardenedRuntime=false -c.mac.notarize=false
-c.mac.forceCodeSigning=false`, which is what `AULA_MAC_ADHOC=1` does. The signing-migration rehearsal deliberately
changes identity after the bridge; follow [The macOS signing bridge](#the-macos-signing-bridge) for its required
sequence and checks.

```bash
ID=$(security find-identity -v -p codesigning | node scripts/release-mac-config.mjs identity)   # the one Developer ID Application
```

Run the GUI rehearsals below in a **dedicated macOS test account**. `AULA_HOME` isolates Aula's data, but published
copies also use `~/Library/Caches/aula-updater`, and a mock keychain does not isolate that cache. Do not run these
commands in your normal account or change `HOME` to simulate a separate account.

**Quick rehearsal** (your own builds). `scripts/dev/fake-github-releases.mjs` imitates GitHub's releases on `127.0.0.1`
(drafts hidden, pre-releases not "latest", ranges for differential downloads). Build two versions that look for updates
there, into a temporary folder:

```bash
T=$(mktemp -d); npm run build
for V in 0.1.0 0.1.1; do
  npx electron-builder --mac zip --arm64 --publish never -c.extraMetadata.version=$V -c.directories.output=$T/rel-$V \
    -c.publish.host=127.0.0.1:8765 -c.publish.protocol=http -c.mac.identity=$ID -c.mac.notarize=false
  node scripts/release-sign.mjs $T/rel-$V
  cp $T/rel-$V/latest-mac.yml $T/rel-$V/developer-id-mac.yml
  mkdir -p $T/R/v$V && cp $T/rel-$V/{*.zip,*.blockmap,latest-mac.yml,developer-id-mac.yml} $T/R/v$V/
done
echo '[{"tag":"v0.1.1"},{"tag":"v0.1.0"}]' > $T/R/releases.json        # add "draft": true to hide one
node scripts/dev/fake-github-releases.mjs $T/R 8765 &
mkdir -p $T/inst && ditto $T/rel-0.1.0/mac-arm64/Aula.app $T/inst/Aula.app
AULA_HOME=$T/data AULA_UPDATE_CHECK_DELAY_MS=3000 AULA_UPDATE_AUTO_INSTALL=1 \
  $T/inst/Aula.app/Contents/MacOS/Aula --use-mock-keychain
```

These are temporary test versions of the current source: they use `developer-id-mac.yml` even with a synthetic
version number. Keep them local and delete their signed artifacts after the rehearsal. The simple ZIP-only fixture
does not replace the universal ZIP, DMG and immutable-bridge checks required for a release.

`AULA_UPDATE_CHECK_DELAY_MS` shortens the first check; `AULA_UPDATE_AUTO_INSTALL=1` presses *Restart and update* as soon
as the update is ready (`=quit` quits instead, to try install-on-quit). After a few seconds `$T/inst/Aula.app` is 0.1.1
and running; the log is in `$AULA_HOME/Logs/main.log` (`[updates]`). Never point these at `/Applications` or at your real
data folder. The interface states can be captured without a server: `node scripts/dev/shots-updates.mjs <out>`.

**High-fidelity rehearsal** (the **published** app, unchanged, against an imitation of github.com — what A1 and FIX2 did
before 0.1). `scripts/dev/fake-github-com.mjs` answers like github.com over HTTPS (`releases.atom`, `releases/latest` →
302 → JSON, downloads → 302 to `release-assets.githubusercontent.com`, ranges); the app is pointed at it with Chromium's
`--host-resolver-rules`:

```bash
T=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes -keyout $T/key.pem -out $T/cert.pem -days 2 -subj /CN=github.com \
  -addext subjectAltName=DNS:github.com,DNS:release-assets.githubusercontent.com          # throwaway, delete it after
npx electron-builder --mac zip --universal --publish never -c.extraMetadata.version=0.1.1 -c.directories.output=$T/rel-0.1.1 \
  -c.mac.identity=$ID -c.mac.notarize=false                                                # never notarize a rehearsal
node scripts/release-sign.mjs $T/rel-0.1.1                                                 # the real key: delete these files after
mkdir -p $T/R/v0.1.1 && cp $T/rel-0.1.1/{*.zip,*.blockmap,latest-mac.yml} $T/R/v0.1.1/
echo '[{"tag":"v0.1.1"},{"tag":"v0.1.0"}]' > $T/R/releases.json
node scripts/dev/fake-github-com.mjs $T/R 18443 $T/cert.pem $T/key.pem &
ditto <the published Aula.app> $T/inst/Aula.app                                           # from the release's .zip or .dmg
AULA_HOME=$T/data AULA_HIDDEN=1 AULA_UPDATE_CHECK_DELAY_MS=3000 AULA_UPDATE_AUTO_INSTALL=1 \
  $T/inst/Aula.app/Contents/MacOS/Aula --use-mock-keychain --ignore-certificate-errors \
  "--host-resolver-rules=MAP github.com 127.0.0.1:18443, MAP release-assets.githubusercontent.com 127.0.0.1:18443"
```

`$T/R/requests.log` lists every request, and `$T/data/Logs/main.log` what the app did. `AULA_HIDDEN=1` keeps every
window hidden and the app out of the Dock, also in the published **0.1.0** (0.1.1 only adds a guard against HTML full
screen, which a rehearsal never enters), so use the downloaded app **unchanged**: re-signing it (e.g. ad hoc, to add
`LSUIElement`) turns its designated requirement into a `cdhash`, and the installer then skips the certificate check it
does on students' copies. Remove the quarantine first (`xattr -dr com.apple.quarantine $T/inst/Aula.app`): a
quarantined copy nobody approved with *Open Anyway* is stopped by Gatekeeper even when launched from a shell, and macOS
shows *“Aula” Not Opened* on the screen. The first launch of a quarantined copy, and whether *App Management* lets it
replace itself in `/Applications`, can only be tried by hand (a test macOS account). Don't run this against
`/Applications/Aula.app` or your real Aula data folder. Keep `--use-mock-keychain`: `AULA_HOME` does not isolate the
macOS Keychain, and changing `HOME` is not a substitute. Delete the signed rehearsal files and the TLS key afterwards.
The installed app refuses `--remote-debugging-port` (see [What's hardened](#whats-hardened-in-the-package)): to drive a
packaged build with CDP (`scripts/dev/security-check.mjs`, measurements), build it with `AULA_AUDIT_BUILD=1 npm run build`
(`release-local.sh` refuses that).

For a short **startup smoke of 0.2.5 or later**, copy the verified final app to a temporary directory and use a newly
created, empty `AULA_HOME`, `AULA_NO_UPDATES=1`, `AULA_NO_LOGIN_ITEM=1`, `AULA_FAKE_AI=1`, `AULA_HIDDEN=1` and
`--use-mock-keychain`. Keep it at the welcome screen without opening providers or connecting accounts. The login-item
flag prevents startup and settings changes from registering or removing a login item during the test. Neither that
flag nor a mock keychain proves the update flow: this smoke only checks startup, with updates disabled. Older binaries
do not recognize the login-item flag and still require a separate test account.

## Signing

| System | Now | With (more) certificates |
| --- | --- | --- |
| macOS | **Developer ID** from 0.2.6: Aula's *Developer ID Application* identity (team `87BM9KFJZW`, pinned by its SHA-1), hardened runtime, Apple's secure timestamp, notarized and stapled (from 0.2.7, the DMG itself too); no more *Open Anyway*. `scripts/release-local.sh` checks the configuration, the identity and the notary profile before building, and `scripts/release-mac-verify.mjs` checks the final ZIP and DMG before upload (see [The Developer ID release](#the-developer-id-release-026-and-later)). The 0.2.5 bridge, signed with the retired *Aula Local Signing* certificate, travels unchanged in every later release. `AULA_MAC_ADHOC=1` is for test builds only and never permits upload. | — |
| Windows | Unsigned: SmartScreen shows *More info → Run anyway* the first time. Updates work. | `CSC_LINK`/`CSC_KEY_PASSWORD` (or Azure Trusted Signing). electron-updater then requires updates signed by the same publisher. |
| Linux | AppImage and .deb are not signed (normal for Linux). | — |
| Android | Signed with Aula's own Android release key (`~/.aula-signing/android/aula-release.keystore`, its password in `aula-release.pass`; made once with `native/android/build.sh --new-key`). Android installs an update over the app only if it's signed with the same key, so **every later APK must be signed with it**: its certificate's SHA-256 is committed in `native/android/release-cert.sha256`, and `release-local.sh` refuses to build with a keystore, or upload an APK, that doesn't match it (see [The Android app](#the-android-app-apk)). | Google Play would need an `.aab` and Play App Signing. |

Never commit certificates, `.p12` files or keys: `.gitignore` already blocks the usual names.

**Back up the Android release key** the same way: `~/.aula-signing/android/aula-release.keystore` and
`aula-release.pass`. If it's lost, every Android user has to uninstall the app and install the next version by hand.

**Back up the Developer ID certificate** together with the update keys (same offline places): export it with its
private key from Keychain Access as a `.p12`, with a strong password stored next to it. Installed copies from 0.2.6
trust Aula's **team** (`87BM9KFJZW`) and the certificate type, not this exact certificate, so a lost, expired or revoked
one is replaced by a new *Developer ID Application* certificate of the same team without stranding anyone; the backup
only saves that step. A certificate of another team is never accepted: Mac users would have to install by hand.

The retired local certificate (`~/.aula-signing/aula-signing.p12` and `p12.pass`, or `aula-signing.keychain-db` and
`keychain.pass`; `cert.pem` is public) signed 0.2.0 to 0.2.5 and signs nothing any more: the 0.2.5 bridge is published
and every later release carries its original bytes, checked by hash. Keep its backup as the record of that pin
(`LEGACY_PIN` in `scripts/release-common.mjs`).

## The macOS signing bridge

An installed 0.2.4 checks the certificate of its replacement. It cannot install a Developer ID build directly, and
GitHub's latest-release feed does not walk clients through intermediate releases. Publishing 0.2.5 and immediately
replacing it with 0.2.6 as latest would therefore leave clients that missed 0.2.5 behind.

The bridge keeps two signed Mac channels on every release:

| Client | Metadata file | What it offers |
| --- | --- | --- |
| 0.2.4 and older clients with the current update keys | `latest-mac.yml` | The original, locally signed 0.2.5 bridge |
| 0.2.5 and newer | `developer-id-mac.yml` | The current Mac version |

On the 0.2.5 release both files announce 0.2.5. The channel name does not mean that 0.2.5 has an Apple signature:
**the bridge retains the existing local certificate and is not notarized**. Windows and Linux keep their existing
channels. Configuring the Mac channel must explicitly leave `allowDowngrade` false.

### Preparing and preserving 0.2.5

1. Build and test 0.2.5 with the existing local signing configuration and update keys. Do not change its designated
   requirement to accept other certificates, and do not change its Ed25519 keys.
2. The release script prepares both metadata files. Its standalone command is:
   ```bash
   node scripts/release-mac-bridge.mjs prepare release/0.2.5 0.2.5
   node scripts/release-mac-verify.mjs release/0.2.5 0.2.5
   ```
   Preparation copies the signed metadata byte for byte. The verifier extracts the final ZIP and checks that it
   contains the correct universal app with the pinned local signature; an optional unpacked build directory is not
   a substitute for checking the ZIP that users receive.
3. After publishing, download the original metadata and Mac artifacts of v0.2.5 into a separate directory. Generate
   and review their public manifest:
   ```bash
   node scripts/release-mac-bridge.mjs manifest /path/to/original-v0.2.5 /tmp/mac-bridge-0.2.5.json
   ```
   Commit the reviewed result as `resources/updates/mac-bridge-0.2.5.json` for the subsequent release. The manifest
   records the original files and their hashes after verifying their metadata and signatures. It cannot be part of
   the bridge's own source commit: the artifact hashes do not exist until that commit has been built.

Never rebuild the bridge for later releases or change its signed notes. Keep the original files and the public
manifest. Every subsequent latest release must include them because the GitHub updater resolves the listed download
filenames under the **latest tag**, even when the metadata's version is 0.2.5. Leaving them only on the v0.2.5 release
is insufficient.

### The Developer ID release (0.2.6 and later)

From 0.2.6 every Mac build is signed with Aula's **Developer ID Application** identity (team `87BM9KFJZW`), with the
hardened runtime and Apple's secure timestamp, notarized, and stapled before electron-builder makes the ZIP and the
DMG. From 0.2.7 the DMG itself is signed, notarized and stapled too ([The DMG itself](#the-dmg-itself-027-and-later)).
The Mac part of `electron-builder.yml`:

```yaml
mac:
  # no `identity` (release-local.sh pins it by SHA-1), no `sign` hook, no `timestamp` (unset = Apple's secure timestamp)
  hardenedRuntime: true
  forceCodeSigning: true                          # under mac only: the Windows installer stays unsigned
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist      # allow-jit: Electron, its helpers and the OCR's WASM need it
  entitlementsInherit: build/entitlements.mac.plist
dmg:
  sign: false     # electron-builder would sign it without notarizing; release-local.sh signs, notarizes and staples it
```

What the Mac that runs `scripts/release-local.sh` needs:

- **Exactly one valid** `Developer ID Application: … (87BM9KFJZW)` identity in the keychain
  (`security find-identity -v -p codesigning`). The script passes its 40-hex SHA-1 as `-c.mac.identity=<sha1>`: given
  a name, electron-builder can fall back to the `Apple Distribution` identity of the same team. When a renewed
  certificate sits next to the old one, remove the old one from the keychain first.
- A **notarytool keychain profile**: `faro-notary`, or the one named in `AULA_NOTARY_PROFILE`. Create one with
  `xcrun notarytool store-credentials <name> --apple-id <Apple ID> --team-id 87BM9KFJZW` (it asks for an app-specific
  password and keeps it in the keychain).
- The five original files of the published v0.2.5 bridge, for `--bridge-dir`:

```bash
B=$(mktemp -d); gh release download v0.2.5 -R luumlabs/aula -p latest-mac.yml -p 'Aula-0.2.5-mac.*' -D "$B"
node scripts/release-mac-bridge.mjs check-baseline "$B"
scripts/release-local.sh --only mac --bridge-dir "$B"
```

Before the build (about 10 minutes, plus the notarization), the script stops when:

- `electron-builder.yml` has a `mac.identity` (`null` skips signing, `"-"` signs ad hoc, a name can pick the wrong
  certificate), a `mac.sign` hook, a `mac.timestamp`, `notarize: false`, a `type` other than distribution, a signed DMG,
  `hardenedRuntime` or `forceCodeSigning` other than `true`, or an entitlements file without `allow-jit` or with
  `get-task-allow` (`node scripts/release-mac-config.mjs check`);
- the bridge files don't match `resources/updates/mac-bridge-0.2.5.json` (`check-baseline`);
- there isn't exactly one Developer ID identity, `xcrun notarytool history --keychain-profile <profile>` fails, or
  `xcrun --find stapler` finds nothing.

The script exports only `APPLE_KEYCHAIN_PROFILE` and unsets `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_API_KEY`,
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_KEYCHAIN`, `CSC_LINK`, `CSC_NAME`, `CSC_KEY_PASSWORD` and `CSC_KEYCHAIN`:
electron-builder would prefer them over the profile, or sign from another keychain. Without any notarization
credential electron-builder only *warns* and skips notarization; the pre-flight and the verifier make that a failure.

#### The DMG itself (0.2.7 and later)

0.2.6 signed and notarized the app inside the DMG, but not the DMG: `spctl -a -t open --context
context:primary-signature` rejected it (`no usable signature`) and `xcrun stapler validate` found no ticket. Gatekeeper
evaluates the DMG when someone opens the download, so from 0.2.7 `release-local.sh` finishes it right after
electron-builder and **before the update feeds are signed**:

```bash
node scripts/release-mac-dmg.mjs finish release/<v> <v> --identity <sha1> --keychain-profile <profile>
```

On a copy of `Aula-<v>-mac.dmg`, it:

- signs it with the same pinned identity and Apple's secure timestamp (`codesign --sign <sha1> --timestamp`);
- notarizes it (`xcrun notarytool submit --wait`) and stops on anything but `Accepted`, printing Apple's log
  (`xcrun notarytool log <id>`);
- staples the ticket (`xcrun stapler staple`, retried twice while a fresh ticket propagates) and checks the team
  requirement, `xcrun stapler validate` and `spctl --assess --type open --context context:primary-signature` reporting
  `source=Notarized Developer ID`;
- rebuilds `Aula-<v>-mac.dmg.blockmap` with electron-builder's own block-map builder, and changes only the DMG's
  `sha512` and `size` in `latest-mac.yml` (every other line stays byte for byte).

Only then does it swap in the DMG, its blockmap and the feed. If anything fails, the three stay exactly as
electron-builder left them and the release stops before `release-sign.mjs`; build Mac again (`--only mac`). The feed
signature and `developer-id-mac.yml` (copied from `latest-mac.yml` by `release-mac-bridge.mjs prepare`) therefore
describe the final DMG. The ZIP, which updates download, is not touched. The step refuses the 0.2.5 bridge and anything
older, a feed that is already signed, and a DMG that isn't the one the feed describes. `AULA_MAC_ADHOC=1` builds skip
it.

After the build, and again on `--upload`, `scripts/release-mac-verify.mjs` checks the final ZIP (extracted with `ditto`)
**and** the final DMG (attached with `hdiutil attach -readonly -nobrowse`, always detached afterwards), because new
users install from the DMG and updates download the ZIP. On the `Aula.app` inside each:

- `CFBundleIdentifier` `com.luumlabs.aula`, the version, `CFBundleExecutable` `Aula` (0.2.5's watchdog reopens the app
  by that name) and `LSMinimumSystemVersion` no higher than 13.0 (0.2.5 copies on macOS 13 must be able to install it);
  universal arm64 + x86_64;
- `codesign --verify --deep --strict` against the Developer ID requirement of `src/main/services/updates/mac-trust.ts`;
- for the app, every nested `.app` and **every Mach-O** (helpers, frameworks, dylibs, `chrome_crashpad_handler`,
  `app_shim_loader`, `ShipIt`, `aula-tsnet`): the team requirement, and per architecture the hardened-runtime flag, a
  secure `Timestamp=`, `TeamIdentifier=87BM9KFJZW` and `Authority=Developer ID Application`; no `get-task-allow`, and
  `allow-jit` on the app and its helpers;
- `xcrun stapler validate` and `spctl --assess --type execute` reporting `source=Notarized Developer ID`.

From 0.2.7 it checks the DMG itself first, before mounting it: the team requirement, `Authority=Developer ID
Application`, `TeamIdentifier=87BM9KFJZW` and a secure `Timestamp=`, `xcrun stapler validate`, and `spctl --assess
--type open --context context:primary-signature` reporting `source=Notarized Developer ID`. Re-verifying 0.2.6, whose
DMG was published unsigned, keeps the 0.2.6 rules.

The carried `Aula-0.2.5-mac.zip` is re-verified against the old local pin; the other bridge files are checked by hash.

`AULA_MAC_ADHOC=1` builds a **test-only** app: ad hoc (checked after the build), without the hardened runtime or
notarization (`-c.mac.identity=- -c.mac.hardenedRuntime=false -c.mac.notarize=false -c.mac.forceCodeSigning=false`),
and with no Apple credentials in the environment. The verifier and `--upload` refuse it, and no installed copy accepts
it as an update.

The new app policy is one-way: only the pinned Aula local identity may move to Aula's Apple Developer ID Application
identity, with Apple's signing chain, the expected certificate type, team and bundle identifier checked. Once running
under Developer ID, the app rejects the old local identity. Unknown or unreadable current signatures never enable the
transition. SHA-512 and Aula's Ed25519 update signature are still mandatory before the installer considers either
signer.

The publication script keeps `latest-mac.yml` and its original artifacts fixed to the committed bridge manifest,
while `developer-id-mac.yml` and the new artifacts must match the current release. A missing manifest, changed bridge
byte, unexpected version, unverified final ZIP or DMG, or absent notarization must stop publication. Do not relax the
general clean-tree and build-provenance checks to accommodate old bridge files.

**For every future release**, because 0.2.5 and the 0.2.4 copies that still have to reach it are frozen:

- **Every Latest release must carry the five bridge files** (`latest-mac.yml`, `Aula-0.2.5-mac.zip`, `.zip.blockmap`,
  `.dmg` and `.dmg.blockmap`), byte for byte, next to its own `developer-id-mac.yml`. `release-local.sh` requires
  `--bridge-dir` for every Mac release after 0.2.5, and `--upload` refuses a release without both Mac feeds (never
  use `--partial` for the release you publish).
- **Never delete the v0.2.5 release or its assets**, and never edit them.
- Never change the bundle id (`com.luumlabs.aula`), the executable name (`Aula`) or the Apple team, never raise
  `LSMinimumSystemVersion` above 13.0 for a release 0.2.5 copies can be offered, and never rotate the Ed25519 update
  keys except as described in [Keeping the keys](#keeping-the-keys).
- If something goes wrong after publishing, the **kill switch** is to mark v0.2.5 as *Latest* again (or turn the new
  release back into a draft): v0.2.5 carries both Mac channels, and installed copies never downgrade.
- After publishing, `node scripts/dev/check-public-feed.mjs luumlabs/aula <version>` checks what every system sees and
  downloads `latest-mac.yml` and `Aula-0.2.5-mac.*` from the new tag (about 530 MB) to compare them with the manifest.

Before publishing, rehearse 0.2.4 → 0.2.5 → Developer ID with the
[high-fidelity rehearsal](#rehearsing-an-update-locally), using the **published** 0.2.4 and 0.2.5 apps unchanged:
`R/releases.json` = `[{"tag":"v0.2.6"},{"tag":"v0.2.5"},{"tag":"v0.2.4"}]`, `R/v0.2.6/` = `release/0.2.6` exactly as
`release-local.sh` built it (the new files and the five bridge originals; no extra signing), `R/v0.2.5/` = the public
originals. Cover a 0.2.4 client that first connects after 0.2.6 is latest, restart and quit installation, 0.2.5 →
0.2.6 directly, rollback through 0.2.5's watchdog, and the kill switch. Use isolated test data and a mock keychain for
automation. `AULA_HOME` alone does not isolate macOS Keychain: checking preservation of real Safe Storage authorization,
App Management when the app replaces itself in `/Applications`, and first-launch Gatekeeper behavior from a downloaded
DMG requires a separate macOS test account. Do not claim those checks from a mock-keychain rehearsal, or promise that
changing signing identity causes no macOS authorization prompts. Copies from 0.1.x still need the manual update already
documented below because their update keys were replaced before this bridge.

## Update signatures (Ed25519)

GitHub and TLS alone aren't enough: whoever got the project's GitHub token or account could otherwise ship code to
every installed copy (the SHA-512 in `latest*.yml` comes from the same place as the installer, the ad-hoc macOS
signature can be made by anyone, and Windows builds have no Authenticode). So every update carries Aula's **own
signature**:

- **Private keys** (PEM, permissions `0600`, **never** in the repository):
  - the **main** key `~/.aula-signing/update-ed25519.key`, the one every release is signed with;
  - the **backup** key `update-ed25519-backup.key`, generated with the main one on 11-11-2026 and meant to live **only offline** (see
    [Keeping the keys](#keeping-the-keys)). It's never used unless the main one is lost or leaks.
  The `.pub` files next to them are their public halves.
- **Public keys**: both are embedded in the app, `src/main/services/updates/signature.ts → UPDATE_PUBLIC_KEYS`
  (main first). A signature by **either** is valid.
- **Signing**: `scripts/release-local.sh` runs `node scripts/release-sign.mjs release/<version>` right after building. For
  every file listed in the supported channel YAML files (`latest*.yml` and `developer-id-mac.yml`) it checks the SHA-512 and adds `aulaSignature`, an Ed25519 signature of
  `aula-update-v1\n<file name>\n<version>\n<sha512>`. It also signs each `latest*.yml`'s release notes
  (`aulaNotesSignature`, over `aula-notes-v1\n<version>\n<sha512 of the notes>`): the app paints the notes as Markdown
  with links, so unsigned notes are never shown. It refuses a key that isn't the pair of one of the embedded public keys
  or that other users can read. `--upload` checks the signatures again (`release-sign.mjs --verify`). In CI, pass the
  key's PEM in `AULA_UPDATE_SIGNING_KEY` instead of the file; to sign with another key file, `--key <file>`.
- **Checking**: before installing, the app computes the downloaded file's SHA-512 and requires a valid signature for
  (name, version, that SHA-512): on macOS in `mac-install.ts` (before unzipping), on Windows and Linux before the update
  is marked ready (nothing is installed on quit until it passes). Unsigned, badly signed, re-used (other version) or
  altered files are refused with *invalid signature* and that version isn't retried automatically.
- **Signing by hand** (e.g. a draft built by Actions): download the draft's channel metadata and the files it lists into
  one folder, run `node scripts/release-sign.mjs <folder>`, then upload the verified metadata, including
  `developer-id-mac.yml` when present. Do not replace an existing release's metadata with a different build or re-sign
  the immutable legacy bridge. Rehearsals with `scripts/dev/fake-github-releases.mjs` need signatures on each version.

### Keeping the keys

> **This already happened once.** The keys and the macOS certificate of the 0.1.x releases were lost with the computer
> they were published from, with no copy anywhere. 0.2.0 carries two new keys and a new certificate, so every 0.1.x
> copy had to be updated by hand once. The copies below are what keeps that from happening again.

- Keep **two offline copies** of both private keys (and of the macOS certificate and the Android release keystore with
  its `.pass`, see [Signing](#signing)): a password manager entry (each PEM is 119 bytes of text; the keystore is a
  small binary file, attach it) and an encrypted USB drive. Never in the repository, a cloud folder synced in clear
  text, an email or a chat.
- Check each copy: `node scripts/release-sign.mjs --check-key --key <copy>` → *main* or *backup (n.º 1)*. For the
  Android keystore, `keytool -list -v -keystore <copy> -storepass:file <its .pass> | grep SHA256:` must show the
  fingerprint in `native/android/release-cert.sha256`.
- Then **remove the backup key from this Mac** (`rm -P ~/.aula-signing/update-ed25519-backup.key`): a backup that sits
  next to the main key is lost or stolen with it. Keep `update-ed25519-backup.pub`.

**If the main key is lost**: sign the next releases with the backup one
(`AULA_UPDATE_SIGNING_KEY="$(cat /Volumes/<usb>/update-ed25519-backup.key)" scripts/release-local.sh`, or
`release-sign.mjs --key <copy>`): every installed copy accepts it. In that release, make a new backup pair (below), put
its public key in `UPDATE_PUBLIC_KEYS` in place of the lost one, and keep using the former backup as the main key.

**If a key leaks**: publish **right away** a release signed with the *other* key that removes the leaked one from
`UPDATE_PUBLIC_KEYS` (and adds a new backup). Copies that install it stop trusting the leaked key. Never sign anything
else with it.

**If both are lost**: installed copies can't verify any future update — they show *invalid signature* and don't offer
the download (that's the point). Publish a version with two new keys and tell students to **download and install it by
hand** once.

A new pair, without printing the private key:

```bash
cd ~/.aula-signing && umask 077 && node -e '
const { generateKeyPairSync } = require("node:crypto"); const fs = require("node:fs");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
fs.writeFileSync("update-ed25519-new.key", privateKey.export({ type: "pkcs8", format: "pem" }), { flag: "wx" });
fs.writeFileSync("update-ed25519-new.pub", publicKey.export({ type: "spki", format: "pem" }), { flag: "wx" });
console.log(publicKey.export({ type: "spki", format: "der" }).toString("base64"));   // → UPDATE_PUBLIC_KEYS'
```

The printed line (SPKI DER in base64) is the public key for `UPDATE_PUBLIC_KEYS`.

## What's hardened in the package

- The installed app refuses Chromium's `--remote-debugging-port` / `--remote-debugging-pipe` (it quits before reading
  any data: `src/main/electron/debug-guard.ts`), so no other program can drive its interface or read the decrypted
  cookies of the study-platform browser over CDP. Audit builds (`AULA_AUDIT_BUILD=1 npm run build`) allow it.
- Electron fuses (`electron-builder.yml → electronFuses`): no `NODE_OPTIONS`, no `--inspect`, the app only loads from
  its integrity-checked `app.asar`, cookies are encrypted with the system key. `runAsNode` stays on because the MCP
  bridge (`out/main/aula-mcp.js`) is started by the terminal agents with `ELECTRON_RUN_AS_NODE`.
- macOS (from 0.2.6): Developer ID signature with the **hardened runtime** on every executable and library
  (entitlements: `allow-jit` and `allow-unsigned-executable-memory`, which Electron needs, and `network.client`; never
  `get-task-allow`), Apple's secure timestamp, and **notarization** stapled to the app and, from 0.2.7, to the DMG
  ([The Developer ID release](#the-developer-id-release-026-and-later)).
- The renderer runs with `contextIsolation`, `sandbox` and a strict CSP; IPC only answers the app's own page
  (`src/main/electron/rpc.ts`).
- API keys and private calendar links are encrypted with `safeStorage` (`secrets.enc`: Keychain on macOS, DPAPI on
  Windows, libsecret/KWallet on Linux). On Linux without a keyring they're stored unencrypted with `0600` permissions,
  and Settings → About tells the user.
- Updates: HTTPS from this repository's releases only, SHA-512 checked, **Aula's own Ed25519 signature required** on
  every system ([Update signatures](#update-signatures-ed25519)), and on macOS the new app's code signature is also
  verified before it replaces the old one (see [How updates work](#how-updates-work)).
- The interface is served from its own `app://aula` scheme (never `file://`) and the `grantFileProtocolExtraPrivileges`
  fuse is off, so a page can't read files from the disk with `fetch('file://…')`.

## Licenses in the package

`npm run build` writes `out/THIRD_PARTY_LICENSES.txt` (`scripts/build/third-party-licenses.ts`, a Vite plugin in
`electron.vite.config.ts`): every package bundled into the main process, the preload or the interface, the fonts and
styles imported by `styles.css`, and every production dependency copied into `app.asar`, each with its full license
text (from its `LICENSE*`/`NOTICE*` files, else from its README, else the standard text of its license). The build warns
about any package left with only a license identifier. `electron-builder.yml → extraResources` puts it, `LICENSE.md` and
`THIRD_PARTY_NOTICES.md` in the app's resources folder, and the `files` filter keeps each dependency's own `LICENSE*`
files inside `app.asar`. When you add a dependency, check its license is permissive and, if it ships fonts, data or
logos, add it to `THIRD_PARTY_NOTICES.md`.

## Smoke-testing a package locally

```bash
npm run dist:linux            # or dist:mac / dist:win on that system
./release/Aula-0.1.0-linux-x86_64.AppImage --no-sandbox
```

On a Mac, `npm run dist:mac` signs with the Developer ID identity it finds, and notarizes if `APPLE_KEYCHAIN_PROFILE`
or another Apple credential is set. For a local smoke build, make it ad hoc instead:
`npm run dist:mac -- -c.mac.identity=- -c.mac.hardenedRuntime=false -c.mac.notarize=false -c.mac.forceCodeSigning=false`.

Playwright cannot drive the packaged app (the fuses disable the inspector): test it by hand or with screenshots
(`scripts/dev/packaged-shot.sh`). A copy built with `electron-builder --dir` has no `app-update.yml`; it still checks
the GitHub releases (Aula falls back to the `publish` settings).
