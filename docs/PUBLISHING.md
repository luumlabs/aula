# Publishing a release

Aula ships as a GitHub release with one installer per system. Installed copies look for new versions there, download
them in the background and install them when the student restarts (or quits) Aula.

- [How updates work](#how-updates-work)
- [Checklist](#checklist)
- [Publishing from your computer](#publishing-from-your-computer-no-github-actions) (while GitHub Actions is off)
- [Publishing with GitHub Actions](#publishing-with-github-actions)
- [Test, then publish](#test-then-publish)
- [Testing the published installers on Windows and Linux](#testing-the-published-installers-on-windows-and-linux)
- [Rehearsing an update locally](#rehearsing-an-update-locally)
- [Signing](#signing)
- [Update signatures (Ed25519)](#update-signatures-ed25519)

## How updates work

Code: `src/main/electron/updates.ts`, `src/main/services/updates/`, `electron-builder.yml → publish`.

1. About 45 s after launch and then every 6 hours (if *Settings → About → Update automatically* is on, or when the
   student presses *Check for updates*), Aula asks GitHub for the **latest published release**:
   `releases.atom` + `releases/latest`, then that release's `latest-mac.yml`, `latest.yml` (Windows) or
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
   certificate (*Aula Local Signing* or a Developer ID, see [Signing](#signing)), the same designated requirement Squirrel
   would check;
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

1. **Version.** Bump `"version"` in `package.json` and `VERSION` — `MAJOR.MINOR.PATCH`.
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
   npm ci
   npm run typecheck
   npm test
   npm run build
   npx playwright test -c tests/e2e/playwright.config.ts   # Linux: xvfb-run -a npx playwright …
   ```
   CI (`.github/workflows/ci.yml`) runs the same on Linux and Windows, x64 and arm64. On a Linux machine without a
   desktop, the e2e tests need a window manager and libnotify like a real desktop has (`sudo apt install openbox
   libnotify4`, then `xvfb-run -a sh -c 'openbox & npx playwright test -c tests/e2e/playwright.config.ts'`).
5. Commit and push to `main`.

## Publishing from your computer (no GitHub Actions)

While GitHub Actions can't run (billing), build on a Mac — it's the only system that can build all three:

```bash
scripts/release-local.sh            # checks + macOS, Windows and Linux installers in release/<version>/
```

It refuses to start if `VERSION`, `CHANGELOG.md`, the release notes or `releaseInfo` don't match `package.json`, or the
tag already exists. It runs `npm run typecheck`, `npm test` and `npm run build`, then `electron-builder --publish never`
once per system (nothing is uploaded), and finally `scripts/release-verify.mjs`, which checks that every `latest*.yml`
is for this version and that the SHA-512 of each file matches. Options: `--only mac|win|linux` (repeatable; it
rebuilds only that system and leaves the files of the others as they are — only **before** the version is released:
once the tag `v<version>` exists the script stops, see [Adding a `.deb` to a published release](#adding-a-deb-to-a-published-release)),
`--skip-checks`. It also writes `release/<version>/BUILD_INFO.<system>` (the commit and tree each system was built from,
and whether there were uncommitted changes).

What you get in `release/<version>/`:

| System | Files |
| --- | --- |
| macOS (universal) | `Aula-<v>-mac.dmg`, `Aula-<v>-mac.zip` (+ `.blockmap`s) and `latest-mac.yml` — **updates download the zip** |
| Windows (x64 + arm64 in one installer) | `Aula-Setup-<v>.exe` (+ `.blockmap`) and `latest.yml` |
| Linux | `Aula-<v>-linux-x86_64.AppImage`, `Aula-<v>-linux-arm64.AppImage` (+ `latest-linux.yml`, `latest-linux-arm64.yml`) and `Aula-<v>-linux-amd64.deb` |

Notes for building on a Mac:
- Windows needs nothing else (no Wine): the installer is unsigned.
- The Linux `.deb` needs GNU tar on the `PATH` as `gtar` (`brew install gnu-tar`, or the `gtar` that electron-builder
  keeps in `~/Library/Caches/electron-builder/linux-tools-mac*`). Without it the script builds only the AppImages (the
  ones that update themselves) and says so.
- Native modules: Aula's production dependencies are plain JavaScript/WebAssembly; the "missing optional dependencies"
  line about `@napi-rs/canvas-*` is expected and harmless (pdf.js only uses it to draw in Node, and Aula draws pages in a
  hidden window).

**Smoke-test** the files: open `release/<version>/mac-universal/Aula.app` (or the `.dmg`), and on a Windows / Linux
machine run the `.exe` / AppImage. To try the actual update, see [Rehearsing an update locally](#rehearsing-an-update-locally).

**Upload** (you run this; it never publishes):

```bash
gh auth login                                          # once
scripts/release-local.sh --upload --repo luumlabs/aula # asks you to type «yes» before uploading
```

The repository is always given explicitly (it's never guessed from `origin`) and must be the one in
`electron-builder.yml → publish`, the one installed copies check. **Upload from a clone of the public repository**: the
release points at your current commit, which must already be on `luumlabs/aula`. The script re-verifies
`release/<version>/`, requires a clean tree, refuses files built from other content or from uncommitted changes
(`BUILD_INFO.<system>`; a copy with the same tree, like the public repository's clean commit, is fine), warns if the repository isn't public, and creates a **draft** release `v<version>` (title:
`releaseInfo.releaseName`; description: the English part of `docs/release-notes/<version>.md`) with the installers,
zips, `.blockmap`s and `latest*.yml` from that folder — exactly the files you tested. The tag is created by GitHub when
you publish. Without the script:

```bash
awk '/<!-- *lang:es *-->/ { exit } { print }' docs/release-notes/0.1.1.md > /tmp/notes.md
shopt -s nullglob   # bash: a kind of file that wasn't built (e.g. no .deb) is skipped instead of failing
files=(release/0.1.1/latest*.yml release/0.1.1/*.{dmg,zip,exe,AppImage,deb,blockmap})
gh release create v0.1.1 -R luumlabs/aula --draft --target "$(git rev-parse HEAD)" --title "Aula 0.1.1" \
  --notes-file /tmp/notes.md "${files[@]}"
```

Upload each `latest*.yml` **together with** the files it lists (same build): if you rebuild one system, upload its
installer and its `latest*.yml` again, never one without the other — otherwise the SHA-512 won't match and copies will
report a damaged download (and won't retry that version on their own).

### Adding a `.deb` to a published release

A `.deb` doesn't update itself, so it can be added to a release that's already out without touching any `latest*.yml` —
as long as it's built from **the tag's code** and uploaded **alone**. (Built together with the AppImages, as
`release-local.sh` does, it's also listed and signed in `latest-linux.yml`, as in v0.1.0; the AppImage updater ignores
it.) From a clone of the public repository:

```bash
git worktree add /tmp/aula-v0.1.0 v0.1.0                      # the exact tree of the release
cd /tmp/aula-v0.1.0 && npm ci                                  # or symlink the clone's node_modules
npm run build
npx electron-builder --linux deb --x64 --publish never -c.directories.output=/tmp/aula-deb
gh release upload v0.1.0 /tmp/aula-deb/Aula-0.1.0-linux-amd64.deb -R luumlabs/aula   # ONLY the .deb
```

Never upload the `latest-linux.yml` electron-builder leaves next to it: it would replace the signed one of the
AppImages. Don't use `scripts/release-local.sh --only linux` for this: it stops because the tag exists, and it would
rebuild the AppImages with other SHA-512s.

## Publishing with GitHub Actions

> **Update signatures.** The private key that signs updates lives only on the maintainer's computer, so installers
> built by Actions are **unsigned** and installed copies will refuse them. After the builds, download the draft's
> `latest*.yml` and installers, sign them locally and replace the `.yml` files (see
> [Update signatures](#update-signatures-ed25519)), or store the key as the `AULA_UPDATE_SIGNING_KEY` secret and add a
> signing step before the upload.
>
> **No macOS in Actions.** The Mac app must be signed with the project's own certificate (see [Signing](#signing)),
> which only exists on the maintainer's Mac, so the workflow builds Windows and Linux only. Add the Mac files to the
> same draft from your Mac with `scripts/release-local.sh --only mac` and `--upload`.

When Actions is available: *Actions → Release → Run workflow* on `main`. The **Release** workflow
(`.github/workflows/release.yml`) is **manual only** — it never runs when a tag is pushed, because publishing the draft
creates the tag and a tag-triggered build would upload untested installers over the tested ones. It:

1. **prepare**: checks `VERSION`, `CHANGELOG.md`, the notes and `releaseInfo`; stops if `v<version>` is already
   published or if its draft already has files (it never replaces installers); otherwise creates the empty draft
   (English notes, title from `releaseInfo`), so the three builds don't race to create it;
2. **build** on macOS, Windows and Linux and uploads each system's files to that draft (`releaseType: draft`);
3. **verify**: downloads the draft and runs `scripts/release-verify.mjs` on it (every `latest*.yml` against the SHA-512
   of its files).

Then [test and publish](#test-then-publish).

## Test, then publish

Nobody sees a draft and installed copies aren't offered it. Check that the draft points at the commit the installers
were built from (`BUILD_INFO.<system>`): its tag and *Source code* archives are the source the AGPL promises. Download
the installers from the draft, try them on each system, then press **Publish release** on GitHub: from then on copies find it within 6 hours (or at their next launch).
Each system has its own `latest*.yml`, so a system is never offered a version whose build isn't there. Pre-releases are
never offered as updates; use them for testers who download by hand.

**Private repository.** While `luumlabs/aula` is private, only its members can download the files and installed copies
can't check for updates (they'd quietly report "no published version"). Make the repository public (or publish the
releases elsewhere) before announcing.

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

Build every version of a rehearsal the same way (all signed with *Aula Local Signing*, or all with `AULA_MAC_ADHOC=1`):
a copy signed with the certificate rejects an ad-hoc update, as it should.

**Quick rehearsal** (your own builds). `scripts/dev/fake-github-releases.mjs` imitates GitHub's releases on `127.0.0.1`
(drafts hidden, pre-releases not "latest", ranges for differential downloads). Build two versions that look for updates
there, into a temporary folder:

```bash
T=$(mktemp -d); npm run build
for V in 0.1.0 0.1.1; do
  npx electron-builder --mac zip --arm64 --publish never -c.extraMetadata.version=$V -c.directories.output=$T/rel-$V \
    -c.publish.host=127.0.0.1:8765 -c.publish.protocol=http
  mkdir -p $T/R/v$V && cp $T/rel-$V/{*.zip,*.blockmap,latest-mac.yml} $T/R/v$V/
done
echo '[{"tag":"v0.1.1"},{"tag":"v0.1.0"}]' > $T/R/releases.json        # add "draft": true to hide one
node scripts/dev/fake-github-releases.mjs $T/R 8765 &
mkdir -p $T/inst && ditto $T/rel-0.1.0/mac-arm64/Aula.app $T/inst/Aula.app
AULA_HOME=$(mktemp -d) AULA_UPDATE_CHECK_DELAY_MS=3000 AULA_UPDATE_AUTO_INSTALL=1 $T/inst/Aula.app/Contents/MacOS/Aula
```

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
npx electron-builder --mac zip --universal --publish never -c.extraMetadata.version=0.1.1 -c.directories.output=$T/rel-0.1.1
node scripts/release-sign.mjs $T/rel-0.1.1                                                 # the real key: delete these files after
mkdir -p $T/R/v0.1.1 && cp $T/rel-0.1.1/{*.zip,*.blockmap,latest-mac.yml} $T/R/v0.1.1/
echo '[{"tag":"v0.1.1"},{"tag":"v0.1.0"}]' > $T/R/releases.json
node scripts/dev/fake-github-com.mjs $T/R 18443 $T/cert.pem $T/key.pem &
ditto <the published Aula.app> $T/inst/Aula.app                                           # from the release's .zip or .dmg
HOME=$T/home AULA_HOME=$T/data AULA_HIDDEN=1 AULA_UPDATE_CHECK_DELAY_MS=3000 AULA_UPDATE_AUTO_INSTALL=1 \
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
`/Applications/Aula.app` or with your own `HOME`, and delete the signed rehearsal files and the TLS key afterwards.
The installed app refuses `--remote-debugging-port` (see [What's hardened](#whats-hardened-in-the-package)): to drive a
packaged build with CDP (`scripts/dev/security-check.mjs`, measurements), build it with `AULA_AUDIT_BUILD=1 npm run build`
(`release-local.sh` refuses that).

## Signing

| System | Without certificates (now) | With certificates |
| --- | --- | --- |
| macOS | Signed with the project's own self-signed certificate **Aula Local Signing** (`scripts/build/mac-sign.cjs`, from the keychain `~/.aula-signing/aula-signing.keychain-db`; ad hoc if it isn't there). Gatekeeper treats it like ad hoc: the first launch needs *Open* / *Open Anyway*. Its designated requirement (`identifier "com.luumlabs.aula" and certificate root = H"3b5c…"`) is the same for every version, so after one *Always Allow* macOS stops asking for the «Aula Safe Storage» keychain item on each update, and Aula's installer requires every new version to satisfy it. **So every later macOS release must be signed with this certificate**: `release-local.sh` refuses to build or upload macOS without it (`AULA_MAC_ADHOC=1` only for tests). Automatic updates **work** (Aula's own installer, above). | Set `MAC_CERT_P12_BASE64` + `MAC_CERT_PASSWORD` (a *Developer ID Application* certificate) and `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` to notarize (repository secrets for Actions, or `CSC_LINK`/`CSC_KEY_PASSWORD` + the Apple variables in your shell for a local build). Then, in `electron-builder.yml`, remove `identity: "-"` and set `hardenedRuntime: true`. From that version on, updates must be signed by the same team (the installer checks it). |
| Windows | Unsigned: SmartScreen shows *More info → Run anyway* the first time. Updates work. | `CSC_LINK`/`CSC_KEY_PASSWORD` (or Azure Trusted Signing). electron-updater then requires updates signed by the same publisher. |
| Linux | AppImage and .deb are not signed (normal for Linux). | — |

Never commit certificates, `.p12` files or keys: `.gitignore` already blocks the usual names.

**Back up the macOS certificate** together with the update keys (same offline places): `~/.aula-signing/aula-signing.p12`
and its password `p12.pass` (or the keychain `aula-signing.keychain-db` and `keychain.pass`); `cert.pem` is public. If
it's lost, copies signed with it reject every later macOS update (*invalid signature*) and Mac users would have to
install by hand once. To restore it on a new Mac: `security create-keychain -p "$(cat keychain.pass)"
~/.aula-signing/aula-signing.keychain-db`, then `security import aula-signing.p12 -k ~/.aula-signing/aula-signing.keychain-db
-P "$(cat p12.pass)" -T /usr/bin/codesign` and `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k
"$(cat keychain.pass)" ~/.aula-signing/aula-signing.keychain-db` (so `codesign` uses it without a dialog).

## Update signatures (Ed25519)

GitHub and TLS alone aren't enough: whoever got the project's GitHub token or account could otherwise ship code to
every installed copy (the SHA-512 in `latest*.yml` comes from the same place as the installer, the ad-hoc macOS
signature can be made by anyone, and Windows builds have no Authenticode). So every update carries Aula's **own
signature**:

- **Private keys** (PEM, permissions `0600`, **never** in the repository):
  - the **main** key `~/.aula-signing/update-ed25519.key`, the one every release is signed with;
  - the **backup** key `update-ed25519-backup.key`, generated on 27-10-2026 and meant to live **only offline** (see
    [Keeping the keys](#keeping-the-keys)). It's never used unless the main one is lost or leaks.
  The `.pub` files next to them are their public halves.
- **Public keys**: both are embedded in the app, `src/main/services/updates/signature.ts → UPDATE_PUBLIC_KEYS`
  (main first). A signature by **either** is valid.
- **Signing**: `scripts/release-local.sh` runs `node scripts/release-sign.mjs release/<version>` right after building. For
  every file listed in every `latest*.yml` it checks the SHA-512 and adds `aulaSignature`, an Ed25519 signature of
  `aula-update-v1\n<file name>\n<version>\n<sha512>`. It also signs each `latest*.yml`'s release notes
  (`aulaNotesSignature`, over `aula-notes-v1\n<version>\n<sha512 of the notes>`): the app paints the notes as Markdown
  with links, so unsigned notes are never shown. It refuses a key that isn't the pair of one of the embedded public keys
  or that other users can read. `--upload` checks the signatures again (`release-sign.mjs --verify`). In CI, pass the
  key's PEM in `AULA_UPDATE_SIGNING_KEY` instead of the file; to sign with another key file, `--key <file>`.
- **Checking**: before installing, the app computes the downloaded file's SHA-512 and requires a valid signature for
  (name, version, that SHA-512): on macOS in `mac-install.ts` (before unzipping), on Windows and Linux before the update
  is marked ready (nothing is installed on quit until it passes). Unsigned, badly signed, re-used (other version) or
  altered files are refused with *invalid signature* and that version isn't retried automatically.
- **Signing by hand** (e.g. a draft built by Actions): download the draft's `latest*.yml` and the files they list into
  one folder, run `node scripts/release-sign.mjs <folder>`, then `gh release upload v<version> <folder>/latest*.yml
  --clobber`. Rehearsals with `scripts/dev/fake-github-releases.mjs` need the same step on each `rel-<version>` folder.

### Keeping the keys

- Keep **two offline copies** of both private keys (and of the macOS certificate, see [Signing](#signing)): a password
  manager entry (each PEM is 119 bytes of text) and an encrypted USB drive. Never in the repository, a cloud folder
  synced in clear text, an email or a chat.
- Check each copy: `node scripts/release-sign.mjs --check-key --key <copy>` → *main* or *backup (n.º 1)*.
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

Playwright cannot drive the packaged app (the fuses disable the inspector): test it by hand or with screenshots
(`scripts/dev/packaged-shot.sh`). A copy built with `electron-builder --dir` has no `app-update.yml`; it still checks
the GitHub releases (Aula falls back to the `publish` settings).
