# Contributing to Aula

Thanks for helping out. Aula is free and open source under the [AGPL-3.0](LICENSE.md), and pull requests are welcome.
Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bugs and ideas** go in an [issue](https://github.com/luumlabs/aula/issues/new/choose) first, so we can agree on the
  approach before you write code. Small fixes (typos, an obvious bug) can go straight to a pull request.
- **Security problems** never go in a public issue or pull request: see [`SECURITY.md`](SECURITY.md).
- **Never** paste API keys, passwords, private calendar links or anything personal from your courses in issues, pull
  requests, tests or screenshots.

## Working on the code

Setup and commands are in the README ([Build from source](README.md#build-from-source)); how the code is organized, the
IPC contracts, the data formats and the rules for the code are in [`CLAUDE.md`](CLAUDE.md). The essentials:

- **TypeScript strict**, no `any` except at boundaries with external JSON (and then it's validated). Small functions
  with clear names.
- **Every interface text goes through i18n** (`t('key')`), in both Spanish and English.
- **Pure logic gets vitest tests** next to it (`*.test.ts`).
- **Electron security stays on**: `contextIsolation`, sandbox, no `nodeIntegration`, the CSP, validated IPC arguments.
  Keys and secrets never leave the main process.
- **Design**: follow [`src/renderer/src/design/README.md`](src/renderer/src/design/README.md) ("Papel y luz", paper and light: warm paper, brick as the only light, no color gradients) and respect `prefers-reduced-motion`.
- **No new dependencies** without asking first in the issue. Prefer permissive licenses (MIT, BSD, ISC, Apache-2.0,
  MPL-2.0 at file level); copyleft dependencies (GPL, LGPL, AGPL) only after discussing it in the issue, because they
  would limit point 3 below.

Before opening the pull request, run:

```bash
npm run typecheck
npm test
npm run build
npm run e2e        # on Linux: xvfb-run -a npm run e2e
```

Keep each pull request to one change, explain what it does and why, and add screenshots for anything you can see.

## License of your contribution

By sending a contribution (a pull request, a patch or a suggested change) you agree that:

1. it's your own work, or you have the right to submit it, and it doesn't include code or assets under licenses
   incompatible with the AGPL-3.0;
2. it's licensed under the [AGPL-3.0](LICENSE.md), like the rest of Aula; and
3. you also grant Luum Labs (and any successor or assignee that maintains Aula) a perpetual, worldwide, non-exclusive,
   royalty-free and irrevocable license to use, copy, modify, sublicense and distribute your contribution under other
   license terms as well, including commercial ones.

You keep the copyright of your work. Point 3 keeps Aula's licensing flexible, for example to offer it to a school or
a company under other terms, without having to ask every contributor again.

A fork or any other modified version needs its own name and icon: see the additional terms under section 7 of the
license in [`NOTICE.md`](NOTICE.md).
