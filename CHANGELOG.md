# Changelog

All notable changes to Aula. Versions follow `MAJOR.MINOR.PATCH`; each one is a
[GitHub release](https://github.com/luumlabs/aula/releases) with installers for macOS, Windows and Linux, and installed
copies update themselves. Release notes in English and Spanish: [`docs/release-notes/`](docs/release-notes).

## [0.1.0] — early access

The first public version of Aula, a study companion for **macOS, Windows and Linux**, built with Electron, React and
TypeScript. Free and open source under the **AGPL-3.0**.

### Study anything
- **Create a course** from a topic, an exam or your materials — PDF, Word, PowerPoint, Excel, EPUB, web pages, Markdown,
  text and code, photos of notes (OCR), links or pasted text — or let Aula fetch them from your study platform. Quick,
  Standard or In depth; the lesson style and the course language you want (12 languages).
- **A team of agents** builds it while you watch, each with its own hand-drawn companion: readers, a planner that maps the
  skills by prerequisite and exam weight, authors working in parallel, a verifier that solves every exercise without the
  answer key and a referee that fixes it. A course that hits a usage limit waits with **Resume**; one that fails says why
  in plain words and offers *Try again*. *Ask Aula for changes* extends or corrects a course, with undo.
- **Lessons** step by step, to explore or just to read, with typeset math and chemistry, graphs with sliders, labeled
  diagrams, 3D molecules and solids, simulations, maps, flowcharts and slides; read aloud with your system's voices.
- **Practice** checked exactly across 16 answer types, which recognizes typical mistakes and tells you why; language
  courses grade accents and spelling; a mistakes notebook brings misses back on a schedule.
- **Flashcards** with FSRS spaced repetition, **mock exams** shaped like the real one, and **Today**: one plan across
  your courses, sorted by what raises your grade most, with a daily goal and a streak.

### Talk to Aula
- **A live chat**: Aula shows that it's thinking the moment you send, then every step as it happens — looking at your
  courses, searching your materials, preparing a quiz, adding an event — each with its own small animation, and a
  summary of what it did when it's done.
- Quizzes and flashcards inside the conversation, answers that cite your materials (click to open the page), @mentions,
  attachments, messages that wait their turn, and **Continue** for an answer cut off midway.
- A **tutor** beside every exercise that sees the exercise and your answer and gives hints without giving it away.
- Anything that changes something waits for your OK on a card.

### Made with care
- **Papel y luz**: warm paper, one brick-red light, serif titles and numbers; light and dark modes. Animations respect
  *reduce motion*.
- **Light behind the glass**: instead of colored stripes, a soft, matte light of each card's color drifts behind the
  card and leans toward your pointer.
- **Hand-drawn illustrations that act out their subject**: 58 course icons and 44 companions drawn with a brush, each
  with its own story when you hover —
  the chemistry flask pours from side to side, the heart beats faster, gets a shock and laughs — plus small gestures at
  rest and a celebration when you open a course. Sixteen hand-drawn **achievements**, and small hand-drawn touches across the app (the greeting underlined, today circled, ticks on your plan).
- **A new app icon**: Aula's arch in a single brush stroke, with the sun rising on the horizon.
- A floating calendar of your week, numbers that count up, cards that fill the screen, and a floating button that opens
  Aula from anywhere.

### Your study platform
- Canvas, Moodle, Blackboard, Google Classroom, Brightspace, Schoology, Microsoft Teams, Sakai, itslearning, Open edX or
  any class website. **Sign in once** in Aula's own browser and it keeps you signed in (cookies encrypted on disk),
  refreshed in the background.
- Sign-in is detected reliably, including school single sign-on in a pop-up window and pages that finish loading late;
  if Aula can't tell, *I’ve already signed in* confirms it.
- Read-only: before anything that could submit work, start a quiz, delete, pay or log you out, Aula stops and asks — and
  it never types your password.

### Your AI
- Your **Claude** (Pro or Max) or **ChatGPT** (Plus or Pro) subscription; a **free model on your computer** chosen for
  your memory (the official `llama.cpp` server and a verified model, downloaded on demand), Ollama or LM Studio; or an
  **API key** from Anthropic, OpenAI, Google Gemini, OpenRouter, DeepSeek, Mistral, Groq, xAI, Xiaomi MiMo, OpenCode Zen
  or any OpenAI-compatible service — with a daily spending cap.
- **Every provider shows its logo** in Settings, the welcome screen, the model picker and the course-creation monitor.
- Works behind a school or company proxy.

### Everything else
- **Calendar** in month, week and agenda views: add events in plain words (with repeats), edit or delete any event,
  subscribe to an `.ics` link or import a file, and *Prepare this exam*.
- **Twelve tools** (calculator, grapher, periodic table, chemistry, 3D molecules, units, Pomodoro timer, statistics,
  matrices, geometry, physics simulations, formulas and constants); three can float over your work.
- **Statistics**: consistency heatmap, weekly rhythm, mastery by week, accuracy by topic and estimated grade over time.
- **Documents** to print or export (study guide, summary, cheat sheet, cut-out flashcards, practice exam, slides) as PDF,
  Word or Markdown, and a **reader** for PDFs and photos with highlights and notes.
- **Aula always on**: a morning brief, platform checks, reminders and weekly summaries in **Updates**, from the system
  tray, with a daily budget.
- **Memory** you can see, search, correct, pause and export in *Settings → Memory*.
- **⌘K / Ctrl+K** searches screens, courses, tools, actions and the content of your courses.
- **Your data**: export everything as a `.zip` (without keys or platform sessions) or delete it all from Settings.

### Reliability
- **Saving you can trust**: every file is written atomically (temporary file, flush to disk, rename) with a backup copy;
  a damaged settings, progress, memory or course file is read from its backup and kept aside instead of being replaced
  with an empty one; fields written by a newer version are preserved; memory stays consistent across processes.
- Heavy work (reading PDFs, OCR) runs in a background process so the window never freezes; if the interface crashes, the
  window reloads itself.
- **Updates on every system**: Aula checks GitHub releases, downloads in the background, verifies the SHA-512 and
  installs when you restart or quit. On macOS it uses its own installer, which verifies the new app's signature first
  and rolls back automatically if the new version doesn't start. A version that fails isn't retried in a loop, and
  *Settings → About* explains what happened.

### Security
- Sandboxed, context-isolated renderer with a strict CSP; IPC answers only the app's own page; navigation and new
  windows are locked to the app; external links open in your browser (http/https only).
- Electron fuses: no `NODE_OPTIONS` or `--inspect`, the app loads only from its integrity-checked archive, cookies are
  encrypted on disk.
- API keys, platform sessions and private calendar links are encrypted with the system keychain; the app ships with no
  keys inside.
- Course archives are imported with size limits, and course files are served only from their own folders.

### Not yet
Running SQL and JavaScript answers to check them, search by meaning (search is by keywords), dictation, a second grading
opinion for open answers, and interface languages other than English and Spanish.

### Known limitations
- The macOS build isn't notarized and the Windows installer isn't code-signed yet: the first launch needs *Open Anyway*
  (macOS) or *Run anyway* (Windows).
- The Linux `.deb` doesn't update itself (Settings offers the download); the AppImage does.
- On Linux without a keyring (GNOME Keyring or KWallet), keys are stored unencrypted (permissions `0600`); Settings →
  About says so.
- AI-generated content can contain mistakes even after verification — check what matters against your teacher's
  materials.

[0.1.0]: https://github.com/luumlabs/aula/releases/tag/v0.1.0
