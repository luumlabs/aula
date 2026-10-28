# Third-party notices

Aula's own code and assets are licensed under the GNU Affero General Public License v3.0 only (see `LICENSE.md`), with
the additional terms of its section 7 in [`NOTICE.md`](NOTICE.md): a modified version needs its own name and icon. The
components below are bundled into Aula, or downloaded by it when you ask, and keep their own licenses. Trademarks and
logos belong to their owners and are used only to identify the corresponding product, model or platform.

**The full license texts travel with the app.** Every installed copy of Aula carries this file, Aula's `LICENSE.md` and
`NOTICE.md`, and `THIRD_PARTY_LICENSES.txt` — the name, version, license and complete license text of each of the ~230 open-source
packages inside that copy, generated when the app is built (`scripts/build/third-party-licenses.ts`). You'll find them
in `Aula.app/Contents/Resources/` on macOS and in the `resources` folder next to `Aula.exe` or inside the AppImage/`.deb`
on Windows and Linux. Electron adds `LICENSE.electron.txt` and `LICENSES.chromium.html` (Chromium, Node.js and their
dependencies) next to the app.

## Bundled in the app

| Component | How Aula uses it | License |
|---|---|---|
| [Electron](https://www.electronjs.org) (includes Chromium and Node.js, with their own notices in `LICENSES.chromium.html` inside the app) | The application shell | MIT |
| [React](https://react.dev), React DOM | The interface | MIT |
| [Motion](https://motion.dev) | Animations | MIT |
| [three.js](https://threejs.org), [@react-three/fiber](https://github.com/pmndrs/react-three-fiber), [@react-three/drei](https://github.com/pmndrs/drei) | 3D molecules, lattices and solids | MIT |
| [KaTeX](https://katex.org) (with the mhchem extension) and its fonts | Math and chemistry typesetting | MIT (fonts: SIL OFL 1.1) |
| [react-markdown](https://github.com/remarkjs/react-markdown), [remark-gfm](https://github.com/remarkjs/remark-gfm), [remark-math](https://github.com/remarkjs/remark-math), [rehype-katex](https://github.com/remarkjs/remark-math) | Rendering Markdown in lessons and the chat | MIT |
| [highlight.js](https://highlightjs.org) | Code highlighting | BSD-3-Clause |
| [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`), with its standard fonts (Foxit, Liberation), CMaps (Adobe) and ICC profiles | Reading and rendering PDFs | Apache-2.0 (Foxit fonts: BSD-3-Clause · Liberation fonts: SIL OFL 1.1 · CMaps: BSD-3-Clause, Adobe) |
| [Tesseract.js](https://github.com/naptha/tesseract.js) and `tesseract.js-core` (the [Tesseract](https://github.com/tesseract-ocr/tesseract) OCR engine and [Leptonica](http://www.leptonica.org), compiled to WebAssembly together with libjpeg, libtiff, libwebp, giflib, libpng and zlib) | OCR of photos and scanned pages | Apache-2.0 (Leptonica: BSD-2-Clause · libjpeg: IJG · libtiff: libtiff license · libwebp: BSD-3-Clause · giflib: MIT · libpng and zlib: their own permissive licenses; full notices in `THIRD_PARTY_LICENSES.txt`) |
| [Mammoth](https://github.com/mwilliamson/mammoth.js) | Reading Word documents | BSD-2-Clause |
| [docx](https://docx.js.org) | Exporting Word documents | MIT |
| [JSZip](https://stuk.github.io/jszip/) | Course archives, Office and EPUB files | MIT (dual MIT / GPL-3.0; used under MIT) |
| [Readability](https://github.com/mozilla/readability) | Extracting the text of web pages | Apache-2.0 |
| [d3-geo](https://d3js.org/d3-geo), [topojson-client](https://github.com/topojson/topojson-client), [world-atlas](https://github.com/topojson/world-atlas) (data from [Natural Earth](https://www.naturalearthdata.com), public domain) | Offline world map for map blocks | ISC (data: public domain) |
| [dagre](https://github.com/dagrejs/dagre) | Laying out diagrams and flowcharts | MIT |
| [cmdk](https://cmdk.paco.me) and the [Radix UI](https://www.radix-ui.com) primitives it uses (dialog, focus scope, portal…) | The ⌘K palette | MIT |
| [clsx](https://github.com/lukeed/clsx) | Composing class names | MIT |
| [Lucide](https://lucide.dev) (`lucide-react`) | Some interface icons | ISC |
| [i18next](https://www.i18next.com), [react-i18next](https://react.i18next.com) | Interface languages | MIT |
| [Zustand](https://zustand.docs.pmnd.rs) | Interface state | MIT |
| [date-fns](https://date-fns.org) | Dates | MIT |
| [electron-updater](https://www.electron.build/docs/features/auto-update), [electron-log](https://github.com/megahertz/electron-log) | Automatic updates and logs | MIT |
| [Tailwind CSS](https://tailwindcss.com) (generated styles) | Styles | MIT |
| [Inter](https://rsms.me/inter/) and [Newsreader](https://github.com/productiontype/Newsreader) (variable fonts via [Fontsource](https://fontsource.org)) | Typography | SIL Open Font License 1.1 |
| [Periodic-Table-JSON](https://github.com/Bowserinator/Periodic-Table-JSON) by Bowserinator (values from Wikipedia/IUPAC), adapted in `src/engine/chem/element-physical.ts` | Periodic table and chemistry tools | The project is CC BY-SA 3.0; Aula takes only numeric facts from it (densities, melting and boiling points), which aren't copyrightable, and credits it as a courtesy |
| Luna (by the same author): interface icons (`src/renderer/src/design/icons`), the 44 pixel-art companions (`src/renderer/src/design/pixel/companions.ts`) and parts of the memory and file-saving code | Icons, agent companions, memory and saving files | AGPL-3.0-only, like the rest of Aula |
| The [FSRS-4.5](https://github.com/open-spaced-repetition) algorithm (Free Spaced Repetition Scheduler), implemented in `src/engine/learn/fsrs.ts`; its tests compare it with outputs of [py-fsrs](https://github.com/open-spaced-repetition/py-fsrs) 2.5.1 | Flashcard scheduling | Aula's own implementation (AGPL-3.0-only); py-fsrs is MIT, credited with thanks |
| Linux AppImage (x64): the [AppImage](https://github.com/AppImage/AppImageKit) runtime and the libraries electron-builder copies into its `usr/lib` — `libappindicator`, `libindicator`, `libnotify`, `libgconf-2`, `libXss`, `libXtst` | Starting Aula on Linux (tray, notifications) | Runtime: MIT. Libraries, as packaged by Ubuntu: LGPL-2.1/LGPL-3.0 (libappindicator), GPL-3.0 (libindicator), LGPL-2.1+ (libnotify), LGPL-2.0+ (GConf), MIT/X11 (libXss, libXtst); their source is in the Ubuntu source packages of the same names (<https://packages.ubuntu.com>) |

## AI provider logos

The logos in *Settings → Your AI*, the welcome screen, the model picker, the course-creation monitor and the README
(`src/renderer/src/design/providers/logos.ts`, `docs/media/v2/providers-*.svg`) are **trademarks of their owners**. Aula
shows them only to identify the service you connect to; it is not affiliated with or endorsed by any of them. Only the
shapes are copied (paths, no styles or scripts); Aula draws them in its own ink and uses the brand colour for the one in use.
**These logo drawings are not covered by Aula's license**: they remain their owners' property and are used only to
identify their services.

| Logo | Source | License of the drawing |
|---|---|---|
| Anthropic, Claude, DeepSeek, Google Gemini, Mistral AI, Ollama, LM Studio, OpenRouter, OpenCode, Xiaomi (for Xiaomi MiMo), Qwen, Kimi, Meta (Llama), Z.ai (GLM) | [Simple Icons](https://simpleicons.org) 16.35.0 (`icons/<slug>.svg`; each brand's own source is listed in its `data/simple-icons.json`) | CC0 1.0 (the trademark stays with its owner) |
| OpenAI (logomark) and ChatGPT (blossom) | OpenAI's own repository [openai/openai-cookbook](https://github.com/openai/openai-cookbook) (`openai-logomark.svg`, `chatgpt-blossom-black.svg`) | The repository is MIT (notice [below](#openai-cookbook-mit)); the logos are OpenAI trademarks, used only to refer to OpenAI and ChatGPT |
| Groq (the bolt of its icon) | groq.com's official icon (`groq.com/favicon.svg`) | Groq trademark, used only to refer to Groq |
| xAI Grok (the Grok symbol) | The logo in grok.com's header | xAI trademark, used only to refer to Grok |
| Aula's own model (arch and sun) and «OpenAI-compatible» (plug) | Aula's own icons | Aula |

## Downloaded only when you ask

| Component | When | License |
|---|---|---|
| [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` (pinned official release, checked against its SHA-256; stored in Aula's data folder) | When you choose *Free on this computer* | MIT |
| Local AI models from Hugging Face (checked against their SHA-256) | When you choose one | Each model's own license, shown in the app before downloading |
| [OpenAI Codex CLI](https://github.com/openai/codex) (official binary from a pinned GitHub release, checked against its SHA-256) | When you press *Connect with ChatGPT* and no Codex is installed | Apache-2.0 — NOTICE: «OpenAI Codex, Copyright 2025 OpenAI» |
| Tesseract language data ([tessdata](https://github.com/tesseract-ocr/tessdata)) | The first time Aula reads a photo or a scanned page | Apache-2.0 |
| Images from [Wikimedia Commons](https://commons.wikimedia.org) | When a lesson or an answer needs one | Each file's own license (e.g. CC BY-SA 4.0); Aula shows the author and license under every image |

## Used only to build and test

electron-vite, Vite, TypeScript, Vitest, Playwright, electron-builder and the type definitions (`@types/*`) are used to
build and test Aula and are not part of the installed app (MIT or Apache-2.0).

## OpenAI Cookbook (MIT)

The OpenAI and ChatGPT logo drawings come from [openai/openai-cookbook](https://github.com/openai/openai-cookbook),
published under this license:

```
MIT License

Copyright (c) 2023 OpenAI

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

The license covers the drawings as files; it grants no rights to OpenAI's trademarks.
