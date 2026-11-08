# Aula privacy policy — draft for review

This draft is based on the current desktop implementation. Before publishing it for a Mac App Store build, compare
every statement with the features actually included in that build, its sandbox behavior and the App Store privacy
answers. It is not yet the published privacy policy.

## Your study data

Aula is a free, open-source study application developed by Luum Labs. Your courses, documents, notes, conversations,
calendar, progress and study settings are stored on your computer. Aula does not require an Aula account, show ads or
send usage analytics to Luum Labs.

When you connect a supported learning platform, Aula can access the course information you authorize, such as
assignments, announcements and communications within that platform. The information available depends on the
platform and your account. Aula does not connect to your personal email merely because you connect a class platform.

## Information sent to other services

The following connections depend on the features and settings available in your edition of Aula and on what you choose
to use:

- **AI providers.** When you use an AI provider, Aula sends the information needed for the requested task to the
  provider you selected. This may include your prompts, conversation, documents, course material and relevant content
  from a connected learning platform. The provider processes it under its own terms and privacy policy. A model running
  locally on your computer does not send its AI requests to a cloud provider.
- **Learning platforms.** Aula connects to platforms you choose in order to sign in and retrieve your course content.
  If you enable background checks, these connections may happen while Aula is running in the background.
- **Web and linked materials.** When web search is enabled and used for a task, search queries go to DuckDuckGo and
  pages are requested from their websites. Images may be retrieved from Wikimedia Commons. Calendar subscriptions
  and materials supplied as links are retrieved from their respective hosts.
- **Optional components.** Depending on the edition and the features you request, Aula may download OCR language data
  from jsDelivr, AI models from Hugging Face or software components from GitHub. On Linux, a spell-check dictionary may
  be downloaded from Google. Direct-download builds may check GitHub for updates. These services can receive network
  information such as your IP address when your computer connects to them.

An AI provider or learning platform may require its own account, and a provider may charge for its services. Luum Labs
does not control how those services retain or use information; consult their privacy policies and settings.

## Security, retention and your choices

Aula uses your operating system's protected storage for sensitive values such as provider keys, platform sessions and
private calendar links when system-provided protection is available. Platform browsing uses Aula's own browser profile.

Your locally stored data remains on your device until you remove it. In **Settings → Privacy and data**, you can open
the data folder, export data or request deletion. Exporting data does not include provider keys or platform sessions.
Copies you have exported or backed up, and information sent to another service, are subject to the retention settings
of the place where those copies are kept or the service that received them.

## Contact

For questions about Aula, use [the project's issue tracker](https://github.com/luumlabs/aula/issues). Issues there are
public, so do not include passwords, API keys, private school materials or other sensitive information in an issue.
