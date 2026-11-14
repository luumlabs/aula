# Changelog

All notable changes to Aula. Versions follow `MAJOR.MINOR.PATCH`; each one is a
[GitHub release](https://github.com/luumlabs/aula/releases) with installers for macOS, Windows and Linux, and installed copies update themselves (except the Linux `.deb`). Release notes in English and Spanish: [`docs/release-notes/`](docs/release-notes).

## [Unreleased]

### Added
- **New figures, adapted from [Sketchy](https://github.com/ddkbs/sketchy)** (MIT, by ddkbs; credited in
  `THIRD_PARTY_NOTICES.md`):
  - Diagram shapes: pyramid, funnel, Venn diagrams with 2 or 3 sets and two-sided mind maps. With `build`, the steps
    build the figure up one part at a time. Each step of a walkthrough circles its parts with a red pen, and ← → and Esc
    move through the steps. Comparisons can mark the key difference and what both sides share, and there is an
    analogy mode («es como»).
  - Molecules drawn from SMILES (the new `structure` block): rings, chains, double and triple bonds, cis/trans,
    functional groups detected and shaded, an expanded style, reactions and guided steps. The chemistry tool can draw
    them too.
  - Drawings that move: ready-made objects (block, pulley, car, flask, sun…), geometry marks (angles with the right-angle
    square, measures, braces, axes), smooth curves, hatching, sliders and a clock that move and turn things, and
    step-by-step constructions.
  - **Mark and ask the tutor:** on a diagram, drawing, labeled figure, map or molecule, circle or highlight a part, add a
    note and ask; the tutor gets the names of the parts you marked. Labeled figures also get a guided tour.
  - Maps colour real countries by name (or by a value per country), frame a named region, draw journeys with arrows,
    keep labels from overlapping, and «Where is…?» can ask for countries. Charts handle long category names, highlight
    the bar or point the lesson is about, and label scatter points.

### Fixed
- **The screen no longer flickers** when the window comes back into view.
- **You can select and copy text** in lessons, exercises and the chat, and right-click it: Copy, Look Up, Translate,
  Search (in a mock exam, only Copy). Answer fields don't offer spelling suggestions.
- **Running out of AI credit or hitting a limit while a course is being created no longer loses it:** the message says
  which limit it is and when it renews, the creation pauses and can be resumed, and you can study the topics that are
  already written in the meantime.
- **Choose the language of a new course** next to its level (or let Aula pick it from your system languages); the
  default is in Settings → General.
- **The system cursor** option is easier to find (Settings → Appearance, and from ⌘K).

## [0.2.4] - 2026-11-13

### Fixed
- **Signing in to Moodle with your university's Microsoft account no longer gets stuck or loops**
  ([#25](https://github.com/luumlabs/aula/issues/25)). It had several causes, all fixed:
  - When Microsoft asked for a passkey (or a security key, face or fingerprint), the sign-in window waited forever:
    Electron has no passkey window on macOS or Linux. Now that step gives up after a few seconds, Microsoft goes back
    to its list of methods, and the window tells you to choose *Other ways to sign in* (an Authenticator code, a text
    message or your password). On Windows, Windows Hello keeps working.
  - When Moodle asked you to accept its site policy or complete your profile right after signing in, Aula closed the
    window two seconds later, and every new attempt closed it again. Now the window stays open until you finish (Aula
    never accepts anything for you). If a step is still pending later, the platform card says so and *Sign in* takes
    you there.
  - A session check that was already running when you opened the window could start a second sign-in behind your back
    and spoil yours. Checks now stop before the sign-in page, never reach Microsoft, and opening the window cancels them.
  - The window now starts at your Moodle's home page. A Moodle saved with its sign-in page used to open on Moodle's
    *You are already logged in* page and never close.
  - Aula recognises your Moodle when it lives on another address of the same university, moves accounts saved with
    `http://` to `https://`, and no longer takes a Moodle guest session for a signed-in one.
  - An error from Moodle right after signing in no longer asks you to sign in again straight away: Aula checks first.
  - When something stops the sign-in, the window says what: a VPN or proxy that sends Microsoft to a private address
    (Aula keeps blocking those, and now names the host), a university that only lets registered devices in, Microsoft's
    loop protection, a step that wants to open another app, or Moodle sending you back to sign in again and again.

### New
- **Aula as a server.** Run Aula without a window on a computer that is always on (a home server, a NAS, a Linux
  container: `ghcr.io/luumlabs/aula-server`, x64 and ARM64) and use it only from your iPad, iPhone or Android phone. It
  joins **your own** Tailscale network (everyone uses their own account) as `aula-server`. The first device you link
  with the code it prints becomes its owner, and sets up the AI, your platform and more devices from there. What only
  makes sense on the server itself (its files, deleting all data, turning remote access off) stays on the server, with
  `aula-server status` and `aula-server link` in its console. See [docs/SERVER.md](docs/SERVER.md).
- **Aula for Android** (`Aula-0.2.4-android.apk`, Android 8 or later, phones and tablets): the same window to your Aula
  as on the iPad and iPhone. It has Tailscale built in (no Tailscale app needed): sign in with your account and it
  finds your Aula, on your Mac or on your server.

### Security
- A device you remove from *Your devices* is cut off at once, also from live updates. Before, a connection it already
  had open kept receiving them, linking codes included.

### The iPhone and iPad app (`native/ios`, source only; it isn't on the App Store yet)
- It finds every Aula on your Tailscale account (your Mac and your server) and lets you choose; *Open another Aula*
  switches. It only lists Aulas of your own Tailscale user.

### Updating
- From 0.2.0 or later, Aula updates itself. From 0.1.x, install this version by hand once (see 0.2.0 below).

## [0.2.3] - 2026-11-11

### New
- **The arch on Today moves in slow motion under the mouse.** The big ink-and-wash arch in Today's greeting stood
  still. While the mouse is over it, its four sheets (the loose wash, the colour, the light and the ink line) drift
  apart, each at its own depth, following the pointer with a long delay, and the light inside does what that hour's
  light does: the dawn sun grows from the ground, the noon sun and the moon rise, the evening sun sinks. When the mouse
  leaves, it settles back just as slowly. No loops; with *Reduce motion* it stays still, and touch doesn't trigger it.

### The project
- **A new short film** at the top of the README, *Nine days.* (1 min 50 s), painted frame by frame by code
  (`scripts/film`), and a README that says what Aula does at a glance.

### Updating
- From 0.2.0, 0.2.1 or 0.2.2, Aula updates itself. From 0.1.x, install this version by hand once (see 0.2.0 below).

## [0.2.2] - 2026-11-11

### New
- **Settings on your iPad and iPhone.** A linked device can now open Settings with the daily-use part: choose among
  the AIs already set up on the Mac (and their model and reasoning level), appearance, language and reminders, *Aula
  always on* with its quiet hours, and what Aula remembers (add, correct, pause, forget one item). They are the
  settings of the Aula on the Mac: a change made on the device changes Aula everywhere. On the iPad the gear is in
  the sidebar; on the iPhone, at the top of Today. API keys and new services, platforms, devices, privacy and data,
  updates and clearing the whole memory stay on the Mac, and the Mac refuses them if a device asks.
- **The icon follows the system's look.** On macOS 26 or later the app icon has its light, dark and tinted looks
  (before, it stayed light in dark mode). Older macOS, Windows and Linux keep the light icon.

### The iPhone and iPad app (`native/ios`, source only; it isn't on the App Store yet)
- The app icon has its light, dark and tinted looks on the Home Screen.
- For the App Store: the listing in English and Spanish (`docs/app-store/listing.md`), the privacy policy
  (`docs/PRIVACY.md`) and a way to take the screenshots from the demo.

### Updating
- From 0.2.0 or 0.2.1, Aula updates itself. From 0.1.x, install this version by hand once (see 0.2.0 below).

## [0.2.1] - 2026-11-11

### Fixed
- Today: the tools at the bottom are drawn on the same hand-painted tiles, each with its own colour, as on the Tools
  screen (they were grey icons on flat tiles).
- Aula on your phone: on Today, the small arch no longer sits on top of the *Ask Aula* button; it is now next to the
  date.

### The iPhone and iPad app (`native/ios`, source only; it isn't on the App Store yet)
- **Try it without a Mac.** The first screen offers *Try it with an example course*: the real interface with the
  example course, served by the app itself from a recording of the real app. Nothing leaves the device and nothing is
  saved.
- The first screen says where to get Aula for Mac, with a button to send the link to the Mac.
- Ready to be sent to the App Store: privacy manifest, permission texts in English and Spanish. `docs/DEVICES.md`
  says what is left for the owner of the Apple account.
- The interface no longer sits under the time and the battery (it was also blurred there on iPadOS 27), and it
  behaves like an app instead of a web page: no zoom with two fingers or a double tap, no long-press menus on links
  and images, and the text of buttons can't be selected.
- Tried on a real iPad from sign-in to studying.

### Updating
- From 0.2.0, Aula updates itself. From 0.1.x, install this version by hand once (see 0.2.0 below).

## [0.2.0] - 2026-11-11

### New
- **Aula on your iPad and iPhone (from a Mac).** *Settings → Aula on your devices*: use Aula from your own iPad or
  iPhone while your courses, the AI and your data stay on the Mac. Aula carries its own Tailscale component (sign in
  once) and each device is linked once with a 6-digit code. On the device, with the Tailscale app connected, open
  `http://aula-mac` in Safari and add it to the Home Screen. The iPad shows the whole app; the iPhone gets bottom tabs
  (Inbox, Aula, Calendar, Today). A device can never read keys, change settings, export or delete. Off by default.
  The source of a native iPhone and iPad app is in `native/ios` (to build with Xcode; it isn't on the App Store).
- **Aula's browser, live.** When a study platform asks you to sign in again, or you want Aula to look at your work,
  Aula shows its browser inside the app, also on the iPad or iPhone. You take control to sign in or do your assignment,
  hand it to Aula so it reads what is on the page and explains your mistakes, and take it back to finish and submit.
  Aula only reads there: it never fills in, submits or takes a test for you, and it never reads password fields.
- **Recordings as course materials.** Audio and video recordings (a lecture, for example) can be materials of a course
  and attachments in the chat. Aula transcribes them from the subtitles next to the file (`.vtt` / `.srt`) or with the
  transcription service of an API key you have added (Groq, OpenAI or Mistral), and a citation opens the recording at
  the minute where it was said, in a player with the transcript beside it.
- **Courses that show things and teach first.** While a course is written, a lesson that is only text is no longer
  accepted: it needs figures (plots, diagrams, charts, drawings, 3D…), no long runs of paragraphs, and the idea
  explained before the first example or question. Courses about real things, with web search on, get real pictures
  from Wikimedia Commons with their author and license. Lessons on functions of two variables get a 3D graph: the 3D
  block now draws surfaces z = f(x, y), curves, points and vectors on axes. Lessons refer to each other by title, and
  the tutor explains a concept before handing over exercises.
- **Aula gets ahead on its own.** With *Aula always on*, when an exam or an assignment is close Aula prepares a short
  review inside the course, or a guide for the assignment, and leaves it in the Inbox. It never does the assignment.
  *Always on* is now one switch; the rest is under *More options*.
- **A simpler Inbox:** All · Unread · Needs you, with what needs you first.
- **Aula's own drawings and a new icon.** Ink-and-wash drawings painted by code: the arch with the light of the hour
  on Today and on the welcome screen, and study objects on empty screens and in the empty chat. The app icon is drawn
  in the same hand. The drifting light behind the cards is gone; the selected row is a brush pass; slides, tables and
  charts are restyled.

### Fixed
- Google Gemini: an API key that isn't valid is now reported as a problem with the key (Google answers it with a
  generic error). Gemini works with an API key; its help says why there is no sign-in with a Google account.
- Windows: saving no longer fails now and then when another program (an antivirus, another Aula process) has the file
  open for an instant, or when two Aula processes (the app and an AI agent's helper) reach for the same course at once.

### Updating from 0.1.x
- **Install 0.2.0 by hand once.** The keys that signed the 0.1.x updates, and the macOS signing certificate, were lost.
  0.2.0 is signed with new ones, so a 0.1.x copy refuses it as an update ("invalid signature"): download 0.2.0 and
  install it over your copy; courses and settings stay. From 0.2.0 on, updates install themselves again. On macOS the
  system asks once more for access to Aula's saved keys.

### Packaging
- The macOS package includes the Tailscale component for *Aula on your devices* (`scripts/release-local.sh` builds it
  and refuses to continue without it).

## [0.1.3] - 2026-11-03

### New
- Settings → Your AI: your own OpenAI-compatible service (for example Venice) lists its models to choose from, with
  *Update the list of models*, so you no longer type the model's exact name (it's optional when adding the service).
  Venice's models come with their name, context, tools, price and reasoning levels; Aula leaves out models that are
  offline or not for text and turns off the system prompt Venice adds by default.
- A *Reasoning* picker under the model for every AI that publishes its levels (Claude Code, ChatGPT, API keys and your
  own service). *Automatic* sends nothing and lets the service decide.

### Fixed
- A course that is still being created but already has topics no longer looks finished: the sidebar says
  "Being created · you can start", the course shows a banner with the progress and *See progress*, and Today uses the
  same words. They go away when the course is done.

## [0.1.2] - 2026-10-30

### Fixed
- Windows: checking for updates no longer writes an electron-updater warning ("disableWebInstaller is set to false…")
  to Aula's log every time. Aula only publishes the full installer.

### Tests
- Unit and end-to-end tests run in GitHub Actions on Linux and Windows, x64 and arm64, for every change to `main` and every pull request, and a manual
  *Platforms* workflow installs the published Windows and Linux installers and checks that they update themselves.

## [0.1.1] - 2026-10-30

### New
- A sun cursor, the same as in the videos: Aula's sun leaves a short comet tail as it moves and a brick ripple when you
  click, with a ring over anything you can press. Settings → Appearance → Cursor switches back to the system pointer.

### Fixed
- "Create document" greys out the kinds a course can't produce yet (no flashcards, exercises or formulas) and says
  why, instead of failing with "Couldn't prepare the document".
- The reader's Aula panel no longer gets stuck on "Reading the document…" when the answer arrives very fast.
- Page citations in the reader's answers, like (p. 2), are real links again and jump to that page.
- The floating Aula button steps aside when a switch sits half under its edge.

## [0.1.0] - 2026-10-28 (early access)

First public version. Aula is a study app for macOS, Windows and Linux, built with Electron, React and TypeScript, and
released under the AGPL-3.0.

### Courses
- Create a course from a topic, an exam or your own materials: PDF, Word, PowerPoint, Excel, EPUB, web pages,
  Markdown, text and code files, photos of notes (OCR), links or pasted text. Aula can also fetch materials from your
  study platform. Three sizes (Quick, Standard, In depth), a choice of lesson style and 12 course languages.
- Courses are built by a team of agents you can watch: readers, a planner that orders topics by prerequisites and exam
  weight, authors working in parallel, a verifier that solves the checkable exercises again without the answer key, and a referee for disagreements.
- A course that hits a usage limit is saved and can be resumed. One that fails explains why and offers *Try again*.
- *Ask Aula for changes* extends or corrects a course, and changes can be undone.

### Studying
- Lessons step by step, free to explore or just to read, with typeset math and chemistry, graphs with sliders, labeled
  diagrams, 3D molecules and solids, simulations, maps, flowcharts and slides. Lessons can be read aloud.
- Practice with 16 answer types, most of them checked exactly by Aula's own engine (open answers are graded against a
  rubric), with explanations for common mistakes. Language courses check
  accents and spelling. Missed exercises come back on a schedule from a mistakes notebook.
- Flashcards with FSRS spaced repetition, timed mock exams shaped like the real one, and a *Today* plan across all
  courses, ordered by what raises your grade most.

### Chat and tutor
- A chat that knows your courses and calendar, shows each step as it works and asks before changing anything.
- Quizzes and flashcards inside the chat, answers that cite your materials, @mentions, attachments, queued messages and
  *Continue* for answers cut off midway.
- A tutor next to every exercise that gives hints without giving the answer away.

### Study platforms
- Canvas, Moodle, Blackboard, Google Classroom, Brightspace, Schoology, Microsoft Teams, Sakai, itslearning, Open edX
  or any class website, signed in once in Aula's own browser (cookies encrypted on disk). School single sign-on in a
  pop-up window works.
- Read-only: Aula blocks anything that could submit work, start a quiz, delete, pay or log you out, and never types
  your password.

### AI providers
- A Claude (Pro or Max) or ChatGPT (Plus or Pro) subscription, a free model on your computer (the official `llama.cpp`
  server and a verified model, downloaded on demand), Ollama, LM Studio, or an API key from Anthropic, OpenAI, Google
  Gemini, OpenRouter, DeepSeek, Mistral, Groq, xAI, Xiaomi MiMo, OpenCode Zen or any OpenAI-compatible service.
- Daily spending cap for API keys. Works behind a school or company proxy.

### Everything else
- Calendar with month, week and agenda views, events typed in plain words (with repeats), `.ics` subscriptions, import and export, and *Prepare for this exam*.
- 12 tools (calculator, grapher, periodic table, chemistry, 3D molecules, units, Pomodoro timer, statistics,
  matrices, geometry, physics simulations, formulas and constants).
- Statistics, 16 achievements, printable documents (study guide, summary, cheat sheet, flashcards, practice exam,
  slides) as PDF, Word or Markdown, and a reader for PDFs and photos with highlights and notes.
- *Aula always on*: morning summary, platform checks, reminders and a weekly summary in the Inbox, with a daily budget.
- Memory you can see and edit in *Settings → What Aula remembers*, search with Ctrl/⌘ K, and export or delete all your data from
  Settings.
- Interface in English and Spanish, light and dark mode, hand-drawn illustrations and a brush-painted app icon.

### Reliability
- Files are written atomically (temporary file, flush, rename) with a backup copy. A damaged settings, progress,
  memory or course file is read from its backup and set aside instead of being replaced with an empty one.
- PDF reading and OCR run in a background process, and the window reloads itself if the interface crashes.
- Automatic updates on macOS, Windows and the Linux AppImage: Aula checks GitHub releases, downloads in the background, verifies the update's signature
  and SHA-512, and installs when you restart or quit. On macOS it uses its own installer, which checks the new app's
  signature and rolls back if the new version doesn't start. A failed version isn't retried in a loop.

### Security
- Sandboxed, context-isolated renderer with a strict CSP. IPC only answers the app's own page, navigation and new
  windows are locked to the app, and external links open in your browser (http and https only).
- Electron fuses: no `NODE_OPTIONS` or `--inspect`, the app only loads from its integrity-checked archive, and cookies
  are encrypted on disk.
- API keys, platform sessions and private calendar links are encrypted with the system keychain. The app ships with
  no keys inside.
- Course archives are imported with size limits, and course files are only served from their own folders.

### Not yet
Running SQL and JavaScript answers to check them, search by meaning (search is by keywords), dictation, a second
grading opinion for open answers, and interface languages other than English and Spanish.

### Known limitations
- The macOS build isn't notarized and the Windows installer isn't code-signed yet, so the first launch needs *Open
  Anyway* (macOS) or *Run anyway* (Windows).
- The Linux `.deb` doesn't update itself: download the new `.deb` from the releases. The AppImage does update itself.
- On Linux without a keyring (GNOME Keyring or KWallet), keys are stored unencrypted with `0600` permissions, and
  *Settings → About* says so.
- AI-written content can contain mistakes even after it's verified. Check what matters against your teacher's
  materials.

[0.1.3]: https://github.com/luumlabs/aula/releases/tag/v0.1.3
[0.1.2]: https://github.com/luumlabs/aula/releases/tag/v0.1.2
[0.1.1]: https://github.com/luumlabs/aula/releases/tag/v0.1.1
[0.1.0]: https://github.com/luumlabs/aula/releases/tag/v0.1.0
