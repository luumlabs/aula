# Aula · developer notes

Aula is a study app: it turns notes, slides, past exams or just a topic into a **course** (interactive lessons,
exercises checked instantly, flashcards with spaced repetition, mock exams, a tutor) and studies it with the student.
It's built with **Electron + React + TypeScript** for macOS, Windows and Linux. Code comments are in Spanish.

## Stack
- Electron 44 · electron-vite 6 (vite 7) · React 19 · TypeScript 5.9 (strict) · Tailwind CSS 4 (configured in CSS with `@theme`)
- Animation: `motion` (`import { motion, AnimatePresence } from 'motion/react'`) · 3D: three + @react-three/fiber 9 + drei 10
- Math: KaTeX (+ mhchem) · Markdown: react-markdown + remark-gfm + remark-math + rehype-katex
- Interface state: zustand · Icons: lucide-react · i18n: i18next (Spanish base, English) · Tests: vitest · e2e: Playwright `_electron`
- `npm install` needs `legacy-peer-deps` (already in `.npmrc`). **Don't add dependencies without discussing it first in an issue.**

## Layout
```
src/shared/      Isomorphic (no Node, no DOM): course model types (schema/), IPC contracts (ipc/), settings, texts
src/engine/      Isomorphic and PURE: base (tolerant JSON, ids), math, learn (FSRS…), chem, content (validator), grading,
                 calendar-core, platforms-core. Used by the main process AND the interface. No `node:*` or `electron` here.
src/main/services/<domain>/    Node services WITHOUT `electron`: store, settings, ai, agents (CLIs), tools, pipeline,
                 assistant, memory, automations, ingest, search, documents, costs, canvas, ics… Tested with vitest.
src/main/electron/             The ONLY code that imports 'electron': app, windows, rpc, the aula-asset:// protocol, secrets
                 (safeStorage), the study-platform browser (persistent session), notifications, tray, updates.
src/main/mcp/aula-mcp.ts       stdio MCP bridge for CLI agents (claude, codex, opencode)
src/preload/     contextBridge → `window.aula`
src/renderer/src/              React interface (design/, app/, screens/, blocks/, exercises/, tools/, lib/)
tests/e2e/       Playwright with the real Electron app (simulated AI)
tests/fixtures/  Test data (an example course in the real on-disk format)
scripts/         release-local.sh (build and upload a draft release), release-verify.mjs, check-secrets.py,
                 build/third-party-licenses.ts (license notices in the package), dev/ (screenshots, fake servers, icons)
```
Aliases: `@shared/*`, `@engine/*`, `@main/*`, `@renderer/*`.

## IPC (interface ↔ main process)
- One generic channel. Each domain declares its methods and events in `src/shared/ipc/<domain>.ts`, extending the
  `RpcMethods` / `RpcEvents` interfaces of `src/shared/ipc/contract.ts` with `declare module './contract'`.
- Main process: `rpc.handle('domain.method', async (args) => …)` and `rpc.emit('domain.event', payload)` (from `@main/electron/rpc`).
  Each domain exposes `register()` in `src/main/electron/handlers/<domain>.ts`, added (one line) to `src/main/electron/handlers/index.ts`.
- Interface: `api.invoke('domain.method', args)` / `api.on('domain.event', cb)` (from `@renderer/lib/api`).
- Errors reach the interface as `AulaError { message, code }`. Keys and secrets NEVER leave the main process.

## Data on disk
`<data>` = `~/Library/Application Support/Aula` (macOS), `%APPDATA%/Aula` (Windows), `~/.config/Aula` (Linux) or `$AULA_HOME`.
```
settings.json   secrets.enc (safeStorage)   Packs/<id>/{pack.json, skills/<id>.json, progress.json, sources/, assets/, runs/, chats/}
Assistant/  Memory/  Automations/  calendar.json   Browser Data/ (Chromium profile: study-platform cookies)
```
The course JSON format is stable (types in `src/shared/schema`): don't change or rename keys, so existing courses keep
opening. Writes are atomic and durable (`writeFileAtomic`: temporary file + fsync + rename, with an optional backup copy).

## Rules
- Strict TypeScript, no `any` except at boundaries with external JSON (validated there). Small functions with clear names.
- Short code comments, in Spanish. Interface texts ALWAYS through i18n (`t('key')`), Spanish and English.
- Pure logic with vitest tests next to it (`*.test.ts`).
- Electron security: contextIsolation, sandbox, no nodeIntegration, CSP, validate IPC arguments, open external links
  with `shell.openExternal` only for http(s).
- Design: see `src/renderer/src/design/README.md`. «Papel y luz»: warm paper, brick red as the only light, serif for
  titles and numbers, NO color gradients; bubble cards that fill the screen and animated details (hand-drawn brush
  illustrations that come alive, a floating calendar, numbers that count up). Respect `prefers-reduced-motion`.
- Check: `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json`, `npx vitest run <path>`,
  `npm run build`. To see the app: `npx electron .` after `npm run build` (on Linux without a display, `xvfb-run -a`),
  always with `AULA_HOME=$(mktemp -d)` so your real data isn't touched; or the screenshot script `scripts/shot.mjs`.
- Releases: `docs/PUBLISHING.md`.
