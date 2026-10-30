# Changelog

All notable changes to Aula. Versions follow `MAJOR.MINOR.PATCH`; each one is a
[GitHub release](https://github.com/luumlabs/aula/releases) with installers for macOS, Windows and Linux, and installed copies update themselves (except the Linux `.deb`). Release notes in English and Spanish: [`docs/release-notes/`](docs/release-notes).

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

[0.1.1]: https://github.com/luumlabs/aula/releases/tag/v0.1.1
[0.1.0]: https://github.com/luumlabs/aula/releases/tag/v0.1.0
