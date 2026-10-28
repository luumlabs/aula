# Security

Aula runs on your computer, keeps your courses and keys there and can browse your study platforms for you. If you find
a way to abuse any of that, please tell me privately.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately on GitHub:
[**Report a vulnerability**](https://github.com/luumlabs/aula/security/advisories/new) (the *Security* tab of this
repository). Include what you found, how to reproduce it, the Aula version and your operating system, and what an
attacker could do with it.

I'll reply as soon as I can, keep you posted while I work on a fix, and credit you in the release notes if you'd like.
Please allow a reasonable amount of time for the fix to ship before you talk about it publicly.

## Supported versions

Only the [latest release](https://github.com/luumlabs/aula/releases/latest) gets security fixes. Aula updates itself;
you can also check in *Settings → About → Check for updates*.

## In scope

Aula and the tools in this repository. For example: API keys or platform sessions leaking from the system keychain
(`safeStorage`) or the data folder, a web page or a course file running code in the app, the app's own browser acting on
a study platform without your approval, the MCP bridge used by terminal agents doing more than its tools allow, or
installing an update that didn't come from this repository's releases. Problems in AI providers, study platforms or
other third-party services should go to their owners.
