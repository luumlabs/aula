# Privacy policy · Política de privacidad

*Aula, by Luum Labs. Last updated: 16 November 2026.*

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

- **No account in the app, and nothing reaches Luum Labs.** The app itself does not ask for your name or email (only
  Tailscale's sign-in does, below), has no ads, analytics or tracking, and sends nothing to Luum Labs.
- **How it reaches your Mac, and what Tailscale keeps.** The app carries Tailscale's open-source component
  (TailscaleKit). You sign in to **your** Tailscale account (a third party, with its own
  [privacy policy](https://tailscale.com/privacy-policy)), on Tailscale's own page shown inside the app. Tailscale's
  sign-in sees the email address of the account you choose (Apple, Google, Microsoft, GitHub…) and keeps it with your
  Tailscale account; the app does not read it. To connect this device, Tailscale's coordination service adds it to
  your private network and keeps, while the device is in it, your Tailscale user and this device's identity: its name
  (`aula-iphone` or `aula-ipad`), its keys, its operating system and version, and its network addresses. This is the
  *Email Address*, *User ID* and *Device ID* of the app's App Store privacy label: linked to you, used only to make
  the connection work, never for tracking or advertising. What you study travels between your device and your Mac
  encrypted end to end (WireGuard) and is not readable by Tailscale or by Luum Labs. The component's log uploads to
  Tailscale are turned off.
- **What is stored on the device.** The Tailscale sign-in of this app, which Aula it opens and the link with your Mac
  (made once with a 6-digit code). Your courses stay on the Mac.
- **Third parties.** Luum Labs shares no data with anyone. Only two third parties receive data, and only for what you
  set up: Tailscale, to connect this device to your Mac (above), and the AI provider you chose in Aula on your Mac,
  which gets what the AI needs for each task **from your Mac**, never from this app (the questions and materials you
  send from the device go to your Mac first). Each one handles that data under its own privacy policy, with the same
  or equal protection as this policy. Before the first question, answer or material sent from this device, the app
  shows which AI provider your Mac will send it to and sends nothing unless you continue; your Mac remembers it for this
  device and asks again if the provider changes (removing the device in *Settings → Aula on your devices* forgets it).
- **Removing it, or changing your mind.** *Sign out of Tailscale*, on the app's connect screens (on a connected
  device, *Settings → Open another Aula* takes you there), signs this device out of your network and deletes its
  Tailscale state and what the interface saved on the device; deleting the app deletes everything it stored. To remove
  the device from your network for good, delete it in Tailscale's admin console (*Machines*); to delete your Tailscale
  account, follow [Tailscale's instructions](https://tailscale.com/docs/account/delete-tailnet), also linked from
  *Sign out of Tailscale* in the app. You can turn off the camera, microphone or local network at any time in
  the system's *Settings → Aula*, and change or remove your AI provider in Aula on your Mac (or use a model that runs
  on the Mac itself).
- **Permissions, only when you use them.** The camera, to photograph your notes or the whiteboard as course material;
  the microphone, to record a class as course material; the local network, to reach your Mac directly when both are on
  the same network. Photos and recordings go to your Mac, nowhere else.
- **The demo** (*Try it with an example course*) runs entirely inside the app: nothing leaves the device and nothing is
  saved.

## Children

Luum Labs does not collect personal data from anyone, including children. On iPhone and iPad, Tailscale keeps what is
described above under the Tailscale account the student signs in with.

## Changes and contact

Changes to this policy are published in this file, with their date. Questions: <luumlabs@proton.me> or
<https://github.com/luumlabs/aula/issues> (more in [Support](SUPPORT.md)).

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

- **Sin cuenta en la app, y nada llega a Luum Labs.** La app en sí no pide tu nombre ni tu correo (solo lo pide el
  inicio de sesión de Tailscale, abajo), no tiene anuncios, analíticas ni rastreo, y no envía nada a Luum Labs.
- **Cómo llega a tu Mac, y qué guarda Tailscale.** La app lleva el componente de código abierto de Tailscale
  (TailscaleKit). Inicias sesión en **tu** cuenta de Tailscale (un tercero, con su propia
  [política de privacidad](https://tailscale.com/privacy-policy)), en la página de Tailscale, que se abre dentro de la
  app. El inicio de sesión de Tailscale ve el correo de la cuenta que eliges (Apple, Google, Microsoft, GitHub…) y lo
  guarda con tu cuenta de Tailscale; la app no lo lee. Para conectar este dispositivo, el servicio de coordinación de
  Tailscale lo añade a tu red privada y guarda, mientras el dispositivo esté en ella, tu usuario de Tailscale y la
  identidad del dispositivo: su nombre (`aula-iphone` o `aula-ipad`), sus claves, su sistema y versión, y sus
  direcciones de red. Es el *Email Address*, el *User ID* y el *Device ID* de la etiqueta de privacidad de la app en
  el App Store: vinculados a ti, solo para que la conexión funcione, nunca para rastrear ni para publicidad. Lo que
  estudias viaja entre tu dispositivo y tu Mac cifrado de extremo a extremo (WireGuard) y no lo pueden leer ni
  Tailscale ni Luum Labs. El envío de registros del componente a Tailscale está desactivado.
- **Qué se guarda en el dispositivo.** El inicio de sesión de Tailscale de esta app, qué Aula abre y el vínculo con tu
  Mac (hecho una vez con un código de 6 cifras). Tus cursos se quedan en el Mac.
- **Terceros.** Luum Labs no comparte datos con nadie. Solo dos terceros reciben datos, y solo para lo que tú
  configuraste: Tailscale, para conectar este dispositivo con tu Mac (arriba), y el proveedor de IA que elegiste en
  Aula en tu Mac, que recibe lo que la IA necesita para cada tarea **desde tu Mac**, nunca desde esta app (las
  preguntas y los materiales que mandas desde el dispositivo van primero a tu Mac). Cada uno trata esos datos con su
  propia política de privacidad, con una protección igual o equivalente a la de esta política. Antes de la primera
  pregunta, respuesta o material que mandes desde este dispositivo, la app te dice a qué proveedor de IA lo mandará tu
  Mac y no manda nada si no continúas; tu Mac lo recuerda para este dispositivo y te lo vuelve a preguntar si cambia el
  proveedor (al quitar el dispositivo en *Ajustes → Aula en tus dispositivos* se olvida).
- **Quitarlo, o cambiar de opinión.** *Cerrar sesión de Tailscale*, en las pantallas de conexión de la app (con el
  dispositivo conectado, *Ajustes → Abrir otra Aula* te lleva a ellas), saca este dispositivo de tu red y borra su
  estado de Tailscale y lo que la interfaz guardó en el dispositivo; al borrar la app se borra todo lo que guardó. Para
  quitar el dispositivo de tu red del todo, bórralo en el panel de administración de Tailscale (*Machines*); para
  borrar tu cuenta de Tailscale, sigue [las instrucciones de Tailscale](https://tailscale.com/docs/account/delete-tailnet),
  que también enlaza *Cerrar sesión de Tailscale* en la app. Puedes apagar la cámara, el micrófono o la red
  local cuando quieras en *Ajustes → Aula* del sistema, y cambiar o quitar tu proveedor de IA en Aula en tu Mac (o
  usar un modelo que funciona en el propio Mac).
- **Permisos, solo cuando los usas.** La cámara, para fotografiar tus apuntes o la pizarra como material del curso; el
  micrófono, para grabar una clase como material del curso; la red local, para llegar a tu Mac directamente cuando
  los dos están en la misma red. Las fotos y grabaciones van a tu Mac, a ningún otro sitio.
- **La demostración** (*Probar con un curso de ejemplo*) funciona entera dentro de la app: nada sale del dispositivo
  y nada se guarda.

### Menores

Luum Labs no recoge datos personales de nadie, tampoco de menores. En iPhone y iPad, Tailscale guarda lo que se
explica arriba, con la cuenta de Tailscale con la que inicia sesión el estudiante.

### Cambios y contacto

Los cambios de esta política se publican en este archivo, con su fecha. Dudas: <luumlabs@proton.me> o
<https://github.com/luumlabs/aula/issues> (más en [Soporte](SUPPORT.md#español)).
