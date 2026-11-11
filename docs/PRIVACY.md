# Privacy policy · Política de privacidad

*Aula, by Luum Labs. Last updated: 11 November 2026.*

**English** · [Español](#español)

Aula is a study app that runs on your own computer. There is no Aula account and no Aula server: Luum Labs does not
receive, store or sell any of your data, shows no ads and uses no analytics or tracking, in the desktop app or in the
iPhone and iPad app.

## Aula for Mac, Windows and Linux

- **Where your data lives.** Your courses, progress, calendar, chats, documents, notes and memory are files on your
  computer (`~/Library/Application Support/Aula` on macOS, `%APPDATA%\Aula` on Windows, `~/.config/Aula` on Linux). You
  can study offline, export everything or delete everything from *Settings → Privacy and data*.
- **What leaves your computer, and only when it is needed:**
  - what the AI needs for each task goes to the AI provider **you** chose and configured (nothing does with a local
    model). That provider's own privacy policy applies to it;
  - web searches go to DuckDuckGo and the pages the AI reads are fetched from their sites, only while web search is on;
  - pictures come from Wikimedia Commons; the pages of your study platform come from that platform;
  - calendar links you subscribe to and links you add as course materials are fetched from those sites;
  - downloads you ask for (a local AI model, language data for reading photos) come from GitHub, Hugging Face or the
    jsDelivr CDN;
  - the update check asks GitHub for the latest version without sending any identifier (GitHub sees your IP address,
    as with any download).
- **Keys and sessions.** API keys, study-platform sessions and private calendar links are encrypted with your system's
  keychain and never leave the app's main process.

## Aula for iPhone and iPad

The app is a window to the Aula on your own Mac. It has no content of its own except an example course for the demo.

- **No account in the app and no data collected.** The app does not ask for your name, email or any identifier, and
  sends nothing to Luum Labs.
- **How it reaches your Mac.** The app carries its own Tailscale component. You sign in to **your** Tailscale account
  (a third party, with its own [privacy policy](https://tailscale.com/privacy-policy)); Tailscale's coordination
  service learns that the device joined your private network, as with any Tailscale client. What you study travels
  between your device and your Mac encrypted end to end (WireGuard) and is not readable by Tailscale or by Luum Labs.
  The component's log uploads to Tailscale are turned off.
- **What is stored on the device.** The Tailscale sign-in of this app and the link with your Mac (made once with a
  6-digit code). Your courses stay on the Mac. Deleting the app removes both.
- **Permissions, only when you use them.** The camera, to photograph your notes or the whiteboard as course material;
  the microphone, to record a class as course material; the local network, to reach your Mac directly when both are on
  the same network. Photos and recordings go to your Mac, nowhere else.
- **The demo** (*Try it with an example course*) runs entirely inside the app: nothing leaves the device and nothing is
  saved.

## Children

Aula does not collect personal data from anyone, including children.

## Changes and contact

Changes to this policy are published in this file, with their date. Questions:
<https://github.com/luumlabs/aula/issues>.

---

## Español

Aula es una app de estudio que funciona en tu propio ordenador. No hay cuenta de Aula ni servidor de Aula: Luum Labs
no recibe, guarda ni vende ningún dato tuyo, no muestra anuncios y no usa analíticas ni rastreo, ni en la app de
escritorio ni en la de iPhone y iPad.

### Aula para Mac, Windows y Linux

- **Dónde están tus datos.** Tus cursos, progreso, calendario, conversaciones, documentos, notas y memoria son archivos
  en tu ordenador (`~/Library/Application Support/Aula` en macOS, `%APPDATA%\Aula` en Windows, `~/.config/Aula` en
  Linux). Puedes estudiar sin conexión, exportarlo todo o borrarlo todo desde *Ajustes → Privacidad y datos*.
- **Qué sale de tu ordenador, y solo cuando hace falta:**
  - lo que la IA necesita para cada tarea va al proveedor de IA que **tú** elegiste y configuraste (con un modelo
    local no sale nada). A eso se le aplica la política de privacidad de ese proveedor;
  - las búsquedas web van a DuckDuckGo y las páginas que lee la IA se piden a sus sitios, solo con la búsqueda web
    activada;
  - las imágenes vienen de Wikimedia Commons; las páginas de tu plataforma de estudio, de esa plataforma;
  - los calendarios a los que te suscribes y los enlaces que añades como material se piden a esos sitios;
  - las descargas que pides (un modelo de IA local, los datos de idioma para leer fotos) vienen de GitHub, Hugging
    Face o la CDN jsDelivr;
  - la comprobación de actualizaciones pregunta a GitHub por la última versión sin enviar ningún identificador
    (GitHub ve tu dirección IP, como en cualquier descarga).
- **Claves y sesiones.** Las claves de API, las sesiones de tus plataformas y los enlaces privados de calendario se
  cifran con el llavero del sistema y nunca salen del proceso principal de la app.

### Aula para iPhone y iPad

La app es la ventana a la Aula de tu propio Mac. No tiene contenido propio salvo un curso de ejemplo para la
demostración.

- **Sin cuenta en la app y sin recoger datos.** La app no pide tu nombre, correo ni ningún identificador, y no envía
  nada a Luum Labs.
- **Cómo llega a tu Mac.** La app lleva su propio componente de Tailscale. Inicias sesión en **tu** cuenta de
  Tailscale (un tercero, con su propia [política de privacidad](https://tailscale.com/privacy-policy)); el servicio
  de coordinación de Tailscale sabe que el dispositivo se unió a tu red privada, como con cualquier cliente de
  Tailscale. Lo que estudias viaja entre tu dispositivo y tu Mac cifrado de extremo a extremo (WireGuard) y no lo
  pueden leer ni Tailscale ni Luum Labs. El envío de registros del componente a Tailscale está desactivado.
- **Qué se guarda en el dispositivo.** El inicio de sesión de Tailscale de esta app y el vínculo con tu Mac (hecho una
  vez con un código de 6 cifras). Tus cursos se quedan en el Mac. Al borrar la app se borran los dos.
- **Permisos, solo cuando los usas.** La cámara, para fotografiar tus apuntes o la pizarra como material del curso; el
  micrófono, para grabar una clase como material del curso; la red local, para llegar a tu Mac directamente cuando
  los dos están en la misma red. Las fotos y grabaciones van a tu Mac, a ningún otro sitio.
- **La demostración** (*Probar con un curso de ejemplo*) funciona entera dentro de la app: nada sale del dispositivo
  y nada se guarda.

### Menores

Aula no recoge datos personales de nadie, tampoco de menores.

### Cambios y contacto

Los cambios de esta política se publican en este archivo, con su fecha. Dudas:
<https://github.com/luumlabs/aula/issues>.
