# App Store listing · Aula for iPhone and iPad

Everything to paste into App Store Connect, in English (primary) and Spanish (Spain), and the answers to its
questionnaires. Before archiving, `node scripts/dev/app-store-check.mjs` checks the texts against Apple's limits (bytes
where Apple counts bytes), the version, both privacy manifests, the license notices and the demo recording
(`--texts` checks only the texts). The screenshots are made from the app's demo (see [Screenshots](#screenshots)).

## App information

| Field | Value |
| --- | --- |
| Name | See [English](#english-us) and [Spanish](#español-españa) below. Under the icon the app is still called *Aula* (`CFBundleDisplayName`) |
| Bundle ID | `com.luumlabs.aula.ios` |
| SKU | `aula-ios` |
| Primary language | English (U.S.); localization Spanish (Spain) |
| Category | Education (secondary: Productivity). Not *Made for Kids* |
| Content rights | *Yes, it contains, shows, or accesses third-party content* and *I have the necessary rights* (the student's own materials, Wikimedia Commons images with their licenses, pages of the student's study platform) |
| Price | Free, no in-app purchases |
| Age rating | **13+** (see [Age rating](#age-rating)) |
| Copyright | 2026 Luum Labs |
| Support URL | https://github.com/luumlabs/aula/blob/main/docs/SUPPORT.md |
| Marketing URL | https://github.com/luumlabs/aula (optional) |
| Privacy policy URL | https://github.com/luumlabs/aula/blob/main/docs/PRIVACY.md |
| Availability | Every country and region **except China mainland** (it needs an ICP filing and approval for AI chat) and **France** (it needs the French encryption declaration; add it later). Not available on Apple silicon Macs nor on Apple Vision Pro: untick both in *Pricing and Availability* (the project also says so: `SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD` and `SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD` are `NO`) |
| EU Digital Services Act | Not a trader |
| Version | **0.2.7** (App Store Connect creates "1.0": change it), build 6 (the next one is 7). See [Version and build](#version-and-build) |
| Release | *Manually release this version*: publish it once the notarized Mac 0.2.7 is the latest release, where *Aula for Mac* sends people |

**App privacy** (the questionnaire): *Do you or your third-party partners collect data from this app?* **Yes**. Types
**Contact Info → Email Address**, **Identifiers → User ID** and **Identifiers → Device ID**, each one: purpose *App
Functionality*, linked to the user **Yes**, used for tracking **No**. Nothing else (no usage data or diagnostics: the
Tailscale component's log uploads are off). This is what Tailscale, the third-party component inside the app, keeps
to connect the device to the student's private network: the email address comes from Tailscale's sign-in, which the
app shows inside itself (`SFSafariViewController` on login.tailscale.com) and which sees the email of the account the
student chooses; the user and the device are the node Tailscale registers. Luum Labs receives nothing. It matches
`native/ios/Aula/PrivacyInfo.xcprivacy` and the iPhone and iPad part of [docs/PRIVACY.md](../PRIVACY.md).

**Export compliance** (asked on each build until `ITSAppUsesNonExemptEncryption` is in the Info.plist):

1. *Does your app use encryption?* **Yes**.
2. Type: **Standard encryption algorithms instead of, or in addition to, using or accessing the encryption within
   Apple's operating system**. The app carries Tailscale's Go code: TLS to Tailscale, and WireGuard (Curve25519,
   ChaCha20-Poly1305, BLAKE2s) with Noise for the private network. All are standard, published algorithms. It is a
   free, mass-market app with publicly available source code.
3. *Available in France?* **No** in this submission (see Availability).

Once App Store Connect has the answers, the next build gets `ITSAppUsesNonExemptEncryption` (`NO` if it asks for no
documents, or `YES` plus the code Apple gives) so it stops asking.

### Age rating

| Question | Answer |
| --- | --- |
| Parental controls, age assurance | No |
| Unrestricted web access | No. From a device, Aula's browser only opens the student's own study platforms and their sign-in pages (`src/engine/live/reach.ts`); other pages are not opened or shown on the device (what a platform page embeds itself, such as a video or a course tool, shows inside that page) |
| User-generated content, social media, messaging and chat, advertising | No (what the student creates is private to them; the chat is with the AI tutor) |
| Shared location, dating and relationships | No |
| Medical or treatment information | **Infrequent** |
| Alcohol, tobacco or drug use or references | **Infrequent** |
| Realistic violence | **Infrequent** |
| Everything else (profanity, horror, health topics, sexuality and nudity, other violence, gambling, contests, loot boxes) | None / No |

The three *Infrequent* answers are there because the AI tutor answers about whatever the student studies
(pharmacology, history, chemistry…). With them Apple gives **13+**.

## English (U.S.)

<!-- name:en -->
Aula: Study with Your Mac
<!-- /name -->

If the name is taken, or App Review objects to *Mac* in the name (guideline 5.2.5), use this one (it is metadata only:
no new build):

<!-- name-alt:en -->
Aula Study Companion
<!-- /name-alt -->

<!-- subtitle:en -->
AI tutor, flashcards & exams
<!-- /subtitle -->

<!-- promo:en -->
Study the courses Aula builds on your Mac from your own notes, slides and past exams, now on your iPhone and iPad. Your courses and your AI stay on your Mac.
<!-- /promo -->

<!-- keywords:en -->
courses,spaced repetition,notes,quiz,homework,learning,school,university,lessons,test prep,planner
<!-- /keywords -->

<!-- description:en -->
Aula for iPhone and iPad is the companion of Aula for Mac, the free and open-source study app that turns your notes, slides, past exams or just a topic into a course and studies it with you.

Your courses, your progress and your AI stay on your Mac (or on your own server). This app opens them on your iPhone or iPad over your own private Tailscale network, so you can study on the sofa, on the bus or in the library with everything exactly where you left it.

WHAT YOU CAN DO
• Follow today's plan: what to study now, sorted by what raises your grade most.
• Learn with interactive lessons: figures, graphs, 3D, real pictures and worked examples before the first exercise.
• Practice with exercises that are checked instantly, and go over your mistakes.
• Review flashcards with spaced repetition.
• Take mock exams and see your estimated grade.
• Ask Aula, your tutor, about anything in your courses.
• Keep your exams and deadlines in the calendar.
• Take a photo of your notes or a video of a class and add it to a course.

HOW IT WORKS
1. Install Aula on your Mac (free, from github.com/luumlabs/aula) and turn on "Aula on your devices" in Settings.
2. In this app, sign in to Tailscale with the same account you used on the Mac. You only do this once.
3. Type the 6-digit code your Mac shows. That's it.

Your Mac has to be on, with Aula open. The tutor and new courses use the AI you set up in Aula on your Mac: your own account with an AI provider, or a model that runs on the Mac itself. Instead of a Mac, Aula can also run on a Linux computer or on your own server.

No Mac yet? Tap "Try it with an example course" to explore a complete sample course inside the app.

PRIVATE BY DESIGN
• No Aula account, no ads, no analytics: nothing you study ever reaches us.
• What you study travels between your device and your Mac encrypted end to end.
• A linked device never sees your API keys and can't erase or export all your data.

Aula is free and open source (AGPL-3.0).
<!-- /description -->

*What's New* is not available for the first version (App Store Connect doesn't show the field).

## Español (España)

<!-- name:es -->
Aula: estudia con tu Mac
<!-- /name -->

<!-- name-alt:es -->
Aula: compañera de estudio
<!-- /name-alt -->

<!-- subtitle:es -->
Tutor IA, tarjetas y exámenes
<!-- /subtitle -->

<!-- promo:es -->
Estudia en tu iPhone y tu iPad los cursos que Aula crea en tu Mac con tus apuntes, diapositivas y exámenes anteriores. Tus cursos y tu IA se quedan en el Mac.
<!-- /promo -->

<!-- keywords:es -->
estudiar,cursos,repaso espaciado,apuntes,ejercicios,deberes,universidad,oposiciones,examen,test
<!-- /keywords -->

<!-- description:es -->
Aula para iPhone y iPad es la compañera de Aula para Mac, la app de estudio gratuita y de código abierto que convierte tus apuntes, diapositivas, exámenes anteriores o solo un tema en un curso, y lo estudia contigo.

Tus cursos, tu progreso y tu IA se quedan en tu Mac (o en tu propio servidor). Esta app los abre en tu iPhone o tu iPad por tu propia red privada de Tailscale, para que estudies en el sofá, en el autobús o en la biblioteca con todo tal como lo dejaste.

QUÉ PUEDES HACER
• Seguir el plan de hoy: qué estudiar ahora, ordenado por lo que más sube tu nota.
• Aprender con lecciones interactivas: figuras, gráficas, 3D, imágenes reales y ejemplos resueltos antes del primer ejercicio.
• Practicar con ejercicios que se corrigen al momento y repasar tus errores.
• Repasar tarjetas con repetición espaciada.
• Hacer simulacros de examen y ver tu nota estimada.
• Preguntar a Aula, tu tutora, cualquier cosa de tus cursos.
• Llevar tus exámenes y entregas en el calendario.
• Hacer una foto de tus apuntes o un vídeo de una clase y añadirlo a un curso.

CÓMO FUNCIONA
1. Instala Aula en tu Mac (gratis, en github.com/luumlabs/aula) y activa «Aula en tus dispositivos» en Ajustes.
2. En esta app, inicia sesión en Tailscale con la misma cuenta que usaste en el Mac. Se hace una vez.
3. Escribe el código de 6 cifras que te enseña el Mac. Ya está.

El Mac tiene que estar encendido y con Aula abierta. La tutora y los cursos nuevos usan la IA que configuraste en Aula en tu Mac: tu propia cuenta de un servicio de IA o un modelo que funciona en el propio Mac. En lugar de un Mac, Aula también puede funcionar en un ordenador con Linux o en tu propio servidor.

¿Aún no tienes Mac? Toca «Probar con un curso de ejemplo» para explorar un curso de ejemplo completo dentro de la app.

PRIVADA POR DISEÑO
• Sin cuenta de Aula, sin anuncios y sin analíticas: nada de lo que estudias nos llega.
• Lo que estudias viaja entre tu dispositivo y tu Mac cifrado de extremo a extremo.
• Un dispositivo vinculado nunca ve tus claves de API ni puede borrar o exportar todos tus datos.

Aula es gratuita y de código abierto (AGPL-3.0).
<!-- /description -->

The keywords don't repeat words of the name or the subtitle (Apple already indexes those). A copy for Spanish
(Mexico) is optional: the same texts, without «oposiciones».

## App Review

- **Sign-in required:** no (leave the demo account fields empty; the notes explain the built-in demo).
- **Contact:** the account owner's name, e-mail and phone number in international format (`+34 …`). They are entered
  in App Store Connect only, never in this repository.
- **Attachment:** a 1–2 minute video recorded on a real iPhone or iPad connected to a real Mac: signing in to
  Tailscale, the app finding `aula-mac`, the 6-digit code, Today, a lesson and the chat. If there is no video, drop
  the sentence about it from the notes.

**Notes** (at most 4000 bytes):

<!-- reviewnotes:en -->
Aula for iPhone and iPad is the client of Aula, a free and open-source study app (https://github.com/luumlabs/aula) that the student runs on their own Mac (or Linux computer or home server). The student's courses, progress and AI live on that computer. This app connects to it over the student's own private Tailscale network and shows the Aula interface served by that computer.

HOW TO REVIEW WITHOUT A MAC (DEMO MODE)
On the first screen, tap "Try it with an example course". The full interface opens with a sample course (Trigonometry, six weeks of simulated study) stored inside the app. Nothing is sent anywhere and nothing is saved. A bar at the top reads "Demo · nothing is saved" and has "Exit". Things to try:
- Today: the day's plan, the streak and the exam countdown.
- The course: estimated grade, a lesson with figures, exercises graded instantly, flashcards (flip and rate), the mock exam and the mistakes.
- The calendar (and, on iPad, statistics and tools in the sidebar).
- The chat with Aula (the "Aula" tab on iPhone): the sample quiz is graded, and any new question gets a short reply saying this is the demo.
Creating a course and adding files need the student's computer, so in the demo they answer "This isn't part of the demo". The attached video shows the app connected to a real Mac.

THE REAL CONNECTION
"Sign in to Tailscale" shows Tailscale's own sign-in page in a Safari view inside the app. Tailscale is a third-party service the student signs in to with their own account (Apple, Google, Microsoft, GitHub or a passkey). Tailscale accounts are created and managed at tailscale.com, not in this app. The app embeds Tailscale's open-source client library only to reach the student's own computer: it does not install a VPN configuration, does not use Network Extension and does not route any other traffic of the device. The app then finds the student's Aula and asks for the 6-digit code that Aula shows on that computer. "Sign out of Tailscale" removes this device from the network and deletes its state; its confirmation also links to Tailscale's instructions to delete the account.

ACCOUNTS, DATA AND AI
- There is no Aula account and no Aula server. The developer receives no data. No ads, analytics or tracking.
- The tutor's answers are produced by Aula on the student's own computer, with the AI provider the student chose and set up there (or a local model). This app never contacts an AI provider.
- Before the first question, answer or course material sent from the device to the AI, the app names the AI provider the student's computer will send it to (for example Anthropic or OpenAI) with Continue and Cancel; nothing is sent until they continue, and it asks again if the provider changes. The demo shows a demo version of the notice: it says the demo sends nothing, names example providers (Anthropic, OpenAI or Google) and has the same privacy policy link.
- Everything the student creates is private to them. There is no sharing between users and no social feature.
- Camera and microphone: requested only when the student picks "Take Photo or Video" in the system file picker to add their notes or a class to a course. The file goes to their own computer. Local network: to reach that computer directly when both are on the same network.
- The privacy policy is linked at the foot of every connection screen and in Settings → About Aula, and is at https://github.com/luumlabs/aula/blob/main/docs/PRIVACY.md
- On the United States storefront only, Settings → About Aula ends with a "Support Aula" section: a short note and a "Donate on GitHub Sponsors" button that opens in Safari; nothing in the app is unlocked or paid. Other storefronts don't show it.
- Links to outside pages open in Safari.
<!-- /reviewnotes -->

The notes are true only if, in the build sent for review: the demo was recorded again with the current interface, the
camera and microphone were tried on a real device, and the video is attached. Don't call Tailscale a "VPN" anywhere
(guideline 5.4).

**Donations.** *Support Aula* (Settings → About Aula, a button to GitHub Sponsors) shows in the iPhone and iPad app
only when StoreKit says the device's App Store is the United States one (`native/ios/Aula/SupportLink.swift`, read by
the page as `window.aulaApp.supportLink()`): outside it, guideline 3.1.1(a) allows no buttons or links to other ways of
paying. The interface comes from the student's Mac, which updates without App Review, so the app itself also refuses
to open GitHub Sponsors outside the United States storefront (`SupportLink.isDonation`). If App Review objects, make
`SupportLink.allowed` return `false` and ship an update; the interface needs no change. App Store metadata is the same
on every storefront, so **never mention donations or GitHub Sponsors in it** (description, What's New, promotional
text, screenshots). **GitHub Sponsors tiers must never unlock or promise anything in Aula** (early access, features,
priority support): the review note above and guideline 3.1.1 would stop being true. Check the tiers before each
submission.

## Version and build

- **Version** (`MARKETING_VERSION` in `native/ios/Aula.xcodeproj`, the `CFBundleShortVersionString`): the version of
  Aula for Mac the app ships with. While that Mac version is being prepared, `package.json` may still have the previous
  one; `app-store-check.mjs` accepts the same version or the next one.
- **Build** (`CURRENT_PROJECT_VERSION`, the `CFBundleVersion`): a whole number that only goes up with each upload (1, 2,
  3…) and is never reset when the version changes. If an upload has to be repeated, raise only the build.
- The team is passed on the command line (`DEVELOPMENT_TEAM=<team>`), so the project stays neutral for anyone who
  clones it.

## Screenshots

Apple asks for iPhone with Dynamic Island, medium display (6.3", 1206 × 2622), and iPad 13" (2064 × 2752), without
transparency; upload the 6.9" set (1320 × 2868) too. They go in `docs/app-store/screenshots/` (`iphone-6.9/`,
`iphone-6.3/` and `ipad-13/`, five each, JPEG; git does not keep them), taken from the app's demo in the simulators, in
English, after recording the demo with the current interface:

| | iPhone | iPad |
| --- | --- | --- |
| 1 | Today: the plan of the day, the streak and the exam countdown | Today |
| 2 | The course: estimated grade and topics | The course |
| 3 | Flashcards | A lesson, with its figure and table |
| 4 | The calendar | The calendar |
| 5 | The chat with Aula, with a quiz | The chat with Aula, with a quiz |

To take them again (after recording the demo, see `docs/DEVICES.md`): build the app for the simulator in Debug, install
it on *iPhone 18 Pro Max*, *iPhone 18 Pro* and *iPad Pro 13-inch (M5)*, and launch it with the argument
`-AulaStoreShots`, which shows the demo without its bar, as Aula looks when connected to the Mac (Debug builds only):

```bash
xcrun simctl status_bar <device> override --time "9:41" --batteryState charged --batteryLevel 100
xcrun simctl launch <device> com.luumlabs.aula.ios -AulaStoreShots
xcrun simctl io <device> screenshot shot.png
sips -s format jpeg -s formatOptions 92 shot.png --out shot.jpg     # Apple refuses images with transparency
```

## What only the account owner can do

1. Register the App ID `com.luumlabs.aula.ios` (explicit, no capabilities) and check that the latest Apple Developer
   Program License Agreement is accepted and the DSA trader status is declared.
2. Create the app in App Store Connect (*Apps → +*): iOS, the name above, English (U.S.), the bundle ID and the SKU.
   Change the version to 0.2.7.
3. Fill in App Information, Pricing and Availability and App Privacy with the answers above.
4. Upload the build (Xcode *Organizer → Distribute App*, or Transporter), answer export compliance on it and try it in
   TestFlight.
5. Fill in the version page (screenshots, texts, App Review information) and submit it for review.
