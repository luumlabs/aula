// Los textos de las pantallas propias de la app (el resto es la interfaz de Aula, que ya viene en su idioma).
import Foundation

enum Texts {
    static let spanish = Locale.preferredLanguages.first?.hasPrefix("es") ?? false
    static func t(_ es: String, _ en: String) -> String { spanish ? es : en }

    static var starting: String { t("Preparando tu red privada…", "Setting up your private network…") }
    static var signInTitle: String { t("Conecta con tu Aula", "Connect to your Aula") }
    static var signInBody: String { t("Aula vive en tu Mac. Para llegar a ella desde aquí, inicia sesión en Tailscale con la misma cuenta que usaste en el Mac. Solo se hace una vez.", "Aula lives on your Mac. To reach it from here, sign in to Tailscale with the same account you used on the Mac. You only do this once.") }
    static var signInAction: String { t("Iniciar sesión en Tailscale", "Sign in to Tailscale") }
    static var signInAfter: String { t("Cuando termines, vuelve a Aula: sigue sola.", "When you’re done, come back to Aula: it carries on by itself.") }
    static var approvalTitle: String { t("Falta aprobar este dispositivo", "This device needs approval") }
    static var approvalBody: String { t("Tu red de Tailscale pide aprobar los dispositivos nuevos. Quien la administra puede hacerlo en su panel; en cuanto lo haga, Aula sigue sola.", "Your Tailscale network asks for new devices to be approved. Whoever manages it can do so in the admin panel; Aula carries on by itself once they do.") }
    static var lookingTitle: String { t("No encuentro tu Mac", "I can’t find your Mac") }
    static var lookingBody: String { t("En tu Mac, abre Aula → Ajustes → «Aula en tus dispositivos», enciéndelo e inicia sesión en Tailscale con esta misma cuenta.", "On your Mac, open Aula → Settings → “Aula on your devices”, turn it on and sign in to Tailscale with this same account.") }
    static var unreachableTitle: String { t("Tu Mac no responde", "Your Mac isn’t answering") }
    static func unreachableBody(_ mac: String?) -> String {
        let name = mac ?? "aula-mac"
        return t("Encontré «\(name)» en tu red, pero Aula no contesta. Comprueba que el Mac está encendido y despierto y que Aula sigue abierta. Lo vuelvo a intentar cada pocos segundos.", "I found “\(name)” on your network, but Aula isn’t answering. Check that the Mac is on and awake and that Aula is still open. I’ll keep trying every few seconds.")
    }
    static var failedTitle: String { t("La red privada no arranca", "The private network won’t start") }
    static var retry: String { t("Reintentar", "Try again") }
    static var signOut: String { t("Cerrar sesión de Tailscale", "Sign out of Tailscale") }
    static var signOutConfirm: String { t("Este dispositivo dejará de estar en tu red privada. Tus cursos siguen en tu Mac.", "This device will leave your private network. Your courses stay on your Mac.") }
    static var cancel: String { t("Cancelar", "Cancel") }

    // Aula para Mac: esta app es la ventana; Aula vive en el Mac.
    static var macLink: String { t("¿Aún no tienes Aula en tu Mac?", "Don’t have Aula on your Mac yet?") }
    static var macTitle: String { t("Aula para Mac", "Aula for Mac") }
    static var macBody: String { t("Esta app es la ventana a tu Aula: tus cursos, la IA y tus datos viven en tu Mac. Aula para Mac es gratis y de código abierto. Descárgala en tu Mac, ábrela y enciende «Aula en tus dispositivos» en Ajustes.", "This app is the window to your Aula: your courses, the AI and your data live on your Mac. Aula for Mac is free and open source. Download it on your Mac, open it and turn on “Aula on your devices” in Settings.") }
    static var macOpen: String { t("Abrir la página de descarga", "Open the download page") }
    static var macShare: String { t("Enviar el enlace a mi Mac", "Send the link to my Mac") }
    static var macAddress: String { "github.com/luumlabs/aula" }
    static var done: String { t("Hecho", "Done") }

    /// Los tres pasos de la conexión (1…3).
    static func step(_ n: Int) -> String {
        switch n {
        case 1: return t("Inicia sesión", "Sign in")
        case 2: return t("Encuentra tu Mac", "Find your Mac")
        default: return t("Escribe el código", "Type the code")
        }
    }
    static func stepsLabel(_ current: Int) -> String { t("Paso \(current) de 3: \(step(current))", "Step \(current) of 3: \(step(current))") }
}
