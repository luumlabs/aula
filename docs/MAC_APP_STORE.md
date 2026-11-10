# Mac App Store readiness

Status on 2026-11-08: **not ready for submission; no Mac App Store build has been submitted.**

This is a source audit of desktop Aula, based on public version 0.1.3 (`708e302878d6433f3ca9d4f1c8c0d0bede633c3a`) and the 0.1.4 release preparation. It is not a sandbox runtime test or an App Review approval. The Apple Developer portal confirms an individual program membership. Xcode displayed an Admin role and rejected a Developer ID request, but the signed-in account holder subsequently authorized creation through Apple's portal. The matching Developer ID Application identity is installed in the local login keychain. Notarization and a signed release still need validation. iPhone, iPad and Tailscale work are outside this audit and are deferred.

The 0.1.4 Developer ID work supports direct distribution. It does not turn that build into a Mac App Store (MAS) app. No features have been removed or disabled for MAS by this document.

## Prototype work on `store/aula-mac`

This branch adds an **incomplete, unsubmitted prototype**. In an Electron MAS runtime, the prototype prevents GitHub
update checks and replacement, prevents external CLI/MCP processes and the managed local-engine download/start paths,
and removes those options from the AI picker. API-based AI remains intended to work; connections to existing local
servers remain exploratory and need a real sandbox test. The direct-download edition keeps its existing behavior.
The included MAS entitlements are an initial least-privilege hypothesis, not a tested signing configuration. The
direct-distribution build hook still refuses to package an MAS app, so this branch cannot be submitted as-is.

The prototype also adds a session-only, revocable prompt before OpenAI-compatible and Anthropic chat requests,
including automatic requests. It displays the destination origin, defaults to declining, requires a visible app window,
and blocks automatic redirects. Consent is rechecked before retries and denied if the prompt is unavailable; a
revocation during a pending prompt cannot grant access. The prompt only ever appears on Aula's main window; a request
waits at most two minutes for an answer and can be cancelled meanwhile (the prompt then closes itself); "Not now" is
remembered for ten minutes per destination; and resetting permissions in Settings also stops requests already in
flight. Provider model-list and availability checks carry no study content, so they do not prompt, but in this edition
they refuse redirects too, so a key never follows one to another origin. These controls have unit and transport tests
but no real MAS sandbox or accessibility testing. They do not yet establish complete coverage of every network/data
path: web/research requests, platform connections and all third-party disclosures still need review before submission.

What the store edition may do is decided in one module, `src/main/services/edition.ts` (`selfUpdates`,
`externalTools`, `aiConsent`); nothing else reads `process.mas`. `edition.test.ts` fails if a new file checks
`process.mas` directly or launches a process outside the modules that already honour the edition, so a new feature
cannot slip past the boundary unnoticed. The interface reads the edition synchronously from the preload bridge
(`api.appStore`), so store-only restrictions never depend on a call that could fail.

`docs/PRIVACY-DRAFT.md` is a draft only. A store candidate still needs complete validation of consent and every data
flow, a final published policy matching the shipped features, profiles and
distribution identities, a reproducible review demonstration, accurate App Store privacy/age declarations, migration
decisions, and signed sandbox tests. The restrictions on CLI and the managed engine are a store prototype, not a
decision to remove these features from the existing GitHub edition.

**License compatibility remains unresolved.** Aula is `AGPL-3.0-only`; the App Store record currently has Apple's
[standard EULA](https://www.apple.com/legal/internet-services/itunes/dev/stdeula/), which includes distribution and
usage restrictions as well as an exception for certain open-source terms. The FSF has published an
[analysis of potential App Store/GPL and AGPL conflicts](https://www.fsf.org/blogs/licensing/more-about-the-app-store-gpl-enforcement),
although that historical analysis concerns an older Apple agreement and an iPhone app. Review the current terms, the
actual Mac distribution and every dependency before submitting; do not assume that a link to source code or a custom
EULA alone resolves the question. Apple permits a [custom EULA](https://developer.apple.com/help/app-store-connect/manage-app-information/provide-a-custom-license-agreement),
subject to its minimum requirements. This prototype does not change Aula's license or choose new terms on its owner's
behalf.

### Preserving a free local AI option

The existing pinned llama.cpp `b11429` macOS archives for arm64 and x64 were downloaded for inspection and matched the
SHA-256 values already in `src/main/services/local-ai/engine.ts`. Each contains a separate `llama-server` and dynamic
libraries; the arm64 executable inspected was ad-hoc signed upstream, not signed by Aula's team. Bundling a fixed,
re-signed server and its required libraries may preserve local inference without downloading executable code at run
time, but it still needs packaging work, licenses, sandbox entitlements, both architectures and a real signed sandbox
test. Model weights are separate data downloads. This observation does not establish that the bundled engine works or
that Apple will approve it.

## Distribution requirements

Electron's [MAS guide](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide) distinguishes the normal macOS build from its MAS build. MAS requires the latter, App Sandbox, suitable entitlements and provisioning. Use an Apple Development identity/profile for a locally runnable test build, and Apple Distribution for store submission. A Developer ID signature is for distribution outside the store. Electron's MAS build disables `autoUpdater`; local socket listeners need the server entitlement, and file pickers need user-selected file access. An upload is followed by review, not automatic approval.

Apple's [review guidelines](https://developer.apple.com/app-store/review/guidelines/) require MAS apps to be sandboxed, self-contained, and updated through the store. The current executable download behavior must be resolved against 2.4.5(iv); checksums do not grant an exception. Background/login behavior needs consent. Section 5.1 requires an accessible privacy policy and explicit permission before sharing personal data with third-party AI. Reviewers need a working way to exercise the app, accurate metadata and an appropriate age rating. These are submission requirements, not confirmation that Aula currently satisfies them.

## Findings in Aula

| Area | Evidence in the current implementation | Work needed before a MAS candidate |
| --- | --- | --- |
| Package | `electron-builder.yml` targets a normal macOS DMG/ZIP. `build/entitlements.mac.plist` is not an App Sandbox configuration. | Add a separate MAS configuration, parent and helper entitlements, Team ID, profiles and a signed store package. Keep direct-distribution packaging separate. |
| Updates | `src/main/electron/updates.ts` checks GitHub, downloads updates and launches the Mac replacement script. `src/main/electron/handlers/updates.ts` exposes that workflow. | Introduce a MAS distribution capability that prevents **all** GitHub update checks, downloads and installation, including handlers and startup paths. Store builds must use store updates. Preserve the existing direct-distribution updater. |
| Managed AI executables | `src/main/services/local-ai/engine.ts` downloads llama.cpp, makes its server executable and spawns it. `src/main/services/agents/codex-installer.ts` downloads and installs the Codex executable. | Decide the supported MAS AI architecture before implementation. Bundling a fixed, signed engine is a candidate; downloading new executable code at runtime is not an acceptable assumption. Model-weight downloads require a separate review of content, size disclosure and consent. |
| External agents and MCP | `src/main/services/agents/engine.ts` spawns configured CLI tools. `src/main/mcp/transport.ts` starts arbitrary configured stdio MCP commands. The helper uses `ELECTRON_RUN_AS_NODE`; CLI discovery/account access reaches outside Aula's container. | Prototype the actual retained flows under App Sandbox. Do not assume a network entitlement permits external executable or credential access. Preserve API-based tutoring while deciding whether CLI/stdio integrations can be supported legitimately in the MAS edition. |
| Local networking | `src/main/services/agents/relay.ts` listens on authenticated loopback. The local inference engine also uses loopback. `src/main/services/local-ai/servers.ts` discovers existing local servers. | If retained, add only the needed client/server entitlements and test the parent/helper network access, authentication, cancellation and shutdown under the sandbox. Loopback remains network access. |
| Files and storage | `src/main/index.ts` derives the data directory from `app.getPath('appData')`. Imports/exports use system dialogs; `src/main/services/userFiles.ts` keeps an application-level allowlist of paths. No security-scoped bookmark implementation was found. | Verify the actual MAS container path. Test picker and drag/drop imports, copying into the container, PDF/Word export, backup/restore and reopening after relaunch. A path allowlist is not a sandbox permission. Add security-scoped bookmarks only where access outside the container must persist. Plan explicit import/migration of existing direct-build data and keychain access. |
| Background operation | `src/main/electron/background.ts` keeps the app running after closing its window when enabled and configures login items. The engine includes a detached watchdog. | Verify opt-in, visible state, login behavior, wake/resume and complete shutdown of app/engine/helpers after Quit. Retain the distinction between closing a window and quitting. |
| Notifications | `src/main/electron/notifications.ts` sends Electron local notifications and handles clicks/actions. The release work adds a notification test. | Test a signed MAS development build with permission allowed and denied, Focus on/off, window hidden, and after relaunch. Confirm clicks and action buttons route correctly. These are local notifications; APNs registration is not required merely because the app uses notifications. |
| Privacy | README documents local data, chosen AI providers, web search, platform sessions and optional downloads. Settings support export/deletion. A dedicated published privacy-policy URL and a complete store declaration are not established by this audit. | Map actual data flows for the retained MAS features. Publish and link a policy; verify consent before sending personal learning/platform context to third-party AI. Complete the App Store privacy answers from those flows rather than assuming that local storage means no data leaves the device. |

Electron specifically documents that macOS notification events require code signing. Signing does not override the user's notification permission or Focus settings. See [Electron notifications](https://www.electronjs.org/docs/latest/tutorial/notifications#macos). Do not mark notifications as working until the signed application has been tested.

## Decisions needed from the maintainer

1. **AI support in the store edition.** Choose which workflows must remain: API providers, bundled local inference, connections to an already running local server, external CLI subscriptions, and stdio MCP. The audit has not authorized or implemented a reduced feature set. A sandbox prototype should establish feasibility before advertising any of these as supported.
2. **Existing-user migration.** Decide how the store edition imports courses, documents and progress from the direct edition, and whether both may coexist. Do not silently move or delete an existing data directory. Credentials may need to be entered again if keychain access cannot be migrated safely.
3. **Store presentation and review access.** Confirm developer identity, support/privacy URLs, intended age group, territories and a reproducible demonstration that does not depend on the reviewer's private school account or a paid AI subscription. Any claims about local models must match the selected implementation.

## Implementation and release sequence

1. Verify that the direct Developer ID identity and notarization credentials work in an actual release build. Obtain the separate store distribution certificates and profiles when the MAS target is ready.
2. Resolve the AI-support and migration decisions above. Make a feature matrix for direct and MAS distribution; expose unavailable choices clearly rather than letting them fail at runtime.
3. Implement the separate MAS target and runtime capability boundary. Package the MAS Electron runtime, signed helpers and approved resources. Audit every executable/process entry point, not only the settings controls.
4. Build a MAS development package using its profile. Run automated tests plus real sandbox smoke tests on supported Macs: launch, course creation, local/cloud AI as retained, import/export, Canvas sign-in/read-only access, background work, notifications, keychain use, restart and Quit. Check sandbox denials. Verify that GitHub updates and executable installers cannot run in this edition.
5. Audit all outbound data paths and test the consent UI in the signed sandbox; prepare the App Store Connect record, screenshots, description, support/privacy pages, privacy answers, age rating, encryption answers and review instructions from the final tested build. Assess applicable privacy-manifest/required-reason-API declarations for the packaged Electron version and dependencies.
6. Produce the distribution package and validate/upload it with Apple's supported tooling. Record the exact source commit, build number, signing identities and validation result. TestFlight/App Review are subsequent stages; report processing, review and approval separately.

Completion means a tested MAS artifact with the necessary metadata and a recorded submission result. A certificate, a successful build or a Developer ID notarization ticket alone does not meet that condition.
