# Instalar Aula

<p align="right"><a href="INSTALL.md">English</a> · <b>Español</b></p>

Descarga el archivo de tu sistema desde la [última versión](https://github.com/luumlabs/aula/releases/latest):

| Sistema | Archivo | La primera vez |
| --- | --- | --- |
| macOS 13 o posterior (Apple Silicon e Intel) | `Aula-<versión>-mac.dmg` | Abre el .dmg, arrastra Aula a *Aplicaciones* y ábrela. Desde la 0.2.6 Aula va firmada con un Developer ID de Apple y notarizada, así que macOS la abre sin pasos extra. Si sustituyes Aula 0.2.5 o anterior, macOS te pide una vez la contraseña de tu Mac para «Aula Safe Storage» (mira [Actualizaciones](#actualizaciones)). |
| Windows 10 y 11 (x64 y ARM, un solo instalador) | `Aula-Setup-<versión>.exe` | Ejecuta el instalador (no pide permisos de administrador). Si aparece SmartScreen, pulsa *Más información → Ejecutar de todas formas*. En Windows, Aula aún no está firmada. |
| Linux x64 | `Aula-<versión>-linux-x86_64.AppImage` o `Aula-<versión>-linux-amd64.deb` | AppImage: hazla ejecutable (`chmod +x Aula-*.AppImage`) y ábrela. Debian o Ubuntu: `sudo apt install ./Aula-<versión>-linux-amd64.deb`. |
| Linux ARM64 | `Aula-<versión>-linux-arm64.AppImage` | Hazla ejecutable (`chmod +x`) y ábrela. |
| Android 8 o posterior (teléfonos y tabletas) | `Aula-<versión>-android.apk` | Ábrela en el teléfono y permite instalar desde esa app cuando Android lo pregunte. Es una ventana a Aula en tu Mac o en [un servidor tuyo](SERVER.md): mira [Dispositivos](DEVICES.md). |

En un Mac, la página de la versión también lista unos archivos de Mac de la 0.2.5: solo están para que las copias
antiguas se actualicen pasando por la 0.2.5. Para instalar a mano, usa el `.dmg` que lleva la versión de esa página.

> **Si vienes de la 0.1.x:** instala la versión actual a mano esta única vez (descárgala aquí e instálala encima de tu
> copia; tus cursos y ajustes se quedan). Aula 0.1.x dirá que la firma de la versión nueva no es válida: desde la 0.2.0
> Aula va firmada con claves nuevas, porque las anteriores se perdieron. A partir de la 0.2.0, Aula vuelve a
> actualizarse sola. En un Mac, macOS vuelve a pedir una vez permiso para usar las claves guardadas de Aula.

En Linux necesitas una distribución de 64 bits con glibc. Instala también GNOME Keyring o KWallet; si no, Aula tiene
que guardar tus claves sin cifrar.

La primera vez que abres Aula te pregunta tu nombre, te ayuda a [elegir una IA](../README.es.md#elige-una-ia) y, si
quieres, conecta tu plataforma de estudio. Tu biblioteca empieza con dos cursos de ejemplo para que lo pruebes todo
antes de crear los tuyos.

## Actualizaciones

Aula busca una versión nueva al arrancar y cada seis horas. La descarga en segundo plano, comprueba su firma y la
instala al salir (o al pulsar *Reiniciar para actualizar* en la barra lateral). En macOS, deja Aula en *Aplicaciones*
para que funcione; si una versión nueva no arranca, Aula vuelve a la anterior. La AppImage también se actualiza sola.
El `.deb` no: Aula te avisa cuando sale una versión nueva, y
descarga su `.deb` de las [versiones publicadas](https://github.com/luumlabs/aula/releases) e instálalo igual.

**En un Mac, la primera actualización a la 0.2.6 o posterior** cambia cómo va firmada Aula (ahora con un Developer
ID de Apple). La primera vez que se abre la versión nueva, macOS te pide una vez la contraseña de tu Mac para que Aula
pueda usar «Aula Safe Storage», donde se guardan tus claves y tus sesiones de las plataformas: escríbela y elige
*Permitir siempre*. Las copias de la 0.2.0 a la 0.2.4 se actualizan primero a la 0.2.5 y luego a la última versión.

## Si algo no funciona

| Problema | Qué hacer |
|---|---|
| macOS no puede verificar al desarrollador, o no aparece *Abrir* | Descarga el último `Aula-<versión>-mac.dmg`: desde la 0.2.6 Aula está notarizada y se abre sin más. Hasta la 0.2.5 no lo estaba: en macOS 15 o posterior, intenta abrir Aula una vez, ve a *Ajustes del Sistema → Privacidad y seguridad* y pulsa *Abrir igualmente*; en macOS 13 y 14, haz clic derecho en Aula y elige *Abrir*. |
| *Aula no puede abrir el llavero* en la barra lateral (Mac) | Normalmente es que elegiste *Denegar* cuando macOS preguntó por «Aula Safe Storage». No se pierde nada: tus claves guardadas quedan bloqueadas hasta que lo permitas. Pulsa el aviso y luego *Reabrir Aula*; cuando macOS vuelva a preguntar, escribe la contraseña de tu Mac y elige *Permitir siempre*. |
| macOS dice que la app está dañada | Mueve Aula a *Aplicaciones* e inténtalo otra vez. Si sigue sin abrir, ejecuta `xattr -dr com.apple.quarantine /Applications/Aula.app` en el Terminal. |
| macOS no instala una actualización | Comprueba que Aula está en *Aplicaciones* y no en *Descargas* ni abierta desde el .dmg. *Ajustes → Acerca de* explica qué pasó y te deja reintentarlo o descargar la actualización. |
| La AppImage no arranca | Hazla ejecutable (`chmod +x`). Necesita FUSE 2: `sudo apt install libfuse2` (en Ubuntu 24.04 y posteriores, `libfuse2t64`). |
| Ubuntu 23.10 o posterior, con la AppImage | Ubuntu restringe los espacios de nombres de usuario que necesita el aislamiento (*sandbox*) de Chromium, así que la AppImage arranca con ese aislamiento apagado. Aula funciona igual, pero las páginas que abre (tu plataforma de estudio, por ejemplo) quedan menos aisladas. En x64, mejor instala el `.deb`: mantiene el aislamiento porque instala el perfil de AppArmor que Ubuntu necesita. |
| Aula no encuentra `claude` o `codex` | Instala la herramienta y ábrela una vez en un terminal para iniciar sesión. Después, *Ajustes → Tu IA* la encuentra. Para ChatGPT, *Conectar con ChatGPT* también puede descargar el Codex oficial por ti. |
| Crear un curso con ChatGPT se para con *Code Mode is unavailable* | A Codex le falta `codex-code-mode-host`, un programa que va junto a él. Actualiza Aula: completa sola el Codex que instaló, la próxima vez que lo usa. Si instalaste Codex tú, reinstálalo o actualízalo (`npm install -g @openai/codex@latest`). Si el archivo está y sigue fallando, comprueba que el antivirus no lo bloquea. |
| Un curso se paró por un límite de uso | No se pierde nada. Ábrelo y pulsa *Reanudar* cuando se renueve tu límite, o quédate con lo que ya hay. |
| *Ajustes → Acerca de* dice que tus claves no están cifradas | En Linux sin GNOME Keyring ni KWallet el sistema no puede cifrarlas. Instala uno y vuelve a iniciar sesión. |
| Otra cosa | [Abre una incidencia](https://github.com/luumlabs/aula/issues/new/choose), en español o en inglés. |
