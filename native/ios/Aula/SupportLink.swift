// ¿La interfaz puede enseñar «Apoya a Aula» (Ajustes → Acerca de, con su botón a GitHub Sponsors)? Solo con la tienda de
// Estados Unidos: fuera de ella, la guía 3.1.1(a) del App Store no deja botones ni enlaces a otras formas de pago. Lo dice
// StoreKit (el país de la cuenta del App Store del dispositivo); si no lo sabe, no. Se pregunta en el dispositivo y no sale
// de él. La interfaz lo lee con window.aulaApp.supportLink() (WebView.swift; src/renderer/src/lib/supportLink.ts).
import Foundation
import StoreKit

enum SupportLink {
    /// ¿Con esta tienda? (ISO 3166-1 alfa-3, como lo da StoreKit.)
    static func allowed(_ countryCode: String?) -> Bool {
        countryCode == "USA"
    }

    /// ¿Es una página para donar (GitHub Sponsors)? La interfaz llega del Mac, que se actualiza sin pasar por la revisión
    /// del App Store: sin la tienda de EE. UU., la app no la abre aunque una interfaz la enseñe por error (WebView.swift).
    static func isDonation(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased(), host == "github.com" || host == "www.github.com" else { return false }
        let path = url.path.lowercased()
        return path == "/sponsors" || path.hasPrefix("/sponsors/")
    }

    /// La tienda de ahora y cada cambio después (el estudiante cambia el país de su cuenta), a `apply` en el hilo principal.
    /// Fuera del hilo principal: StoreKit contesta cuando puede.
    static func follow(_ apply: @escaping @MainActor @Sendable (Bool) -> Void) -> Task<Void, Never> {
        Task.detached(priority: .utility) {
            await apply(allowed(await Storefront.current?.countryCode))
            for await storefront in Storefront.updates {
                await apply(allowed(storefront.countryCode))
            }
        }
    }
}
