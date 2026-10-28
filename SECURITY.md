# Security

Aula runs on your computer, keeps your courses and keys locally and can browse your study platforms on your behalf,
so security reports matter a lot to us.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately on GitHub:
[**Report a vulnerability**](https://github.com/luumlabs/aula/security/advisories/new) (the *Security* tab of this
repository). Include what you found, how to reproduce it, the Aula version and your operating system, and what an
attacker could do with it.

We'll acknowledge your report as soon as we can, keep you posted while we work on a fix, and credit you in the release
notes if you'd like. Please give us a reasonable time to ship the fix before you talk about it publicly.

## Supported versions

Only the [latest release](https://github.com/luumlabs/aula/releases/latest) gets security fixes. Aula updates itself;
you can also check in *Settings → About → Check for updates*.

## In scope

Aula and the tools in this repository — for example: API keys or platform sessions leaking from the system keychain
(`safeStorage`) or the data folder, a web page or a course file running code in the app, the app's own browser acting on
a study platform without your approval, the MCP bridge used by terminal agents doing more than its tools allow, or
installing an update that didn't come from this repository's releases. Problems in AI providers, study platforms or
other third-party services should go to their owners.
