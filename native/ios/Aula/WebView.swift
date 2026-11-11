// La interfaz de Aula: una vista web que habla con el Mac por el túnel local (http://127.0.0.1:<puerto>). Las cookies
// (la del dispositivo vinculado y la llave del túnel) viven en el almacén de la app; nada sale de 127.0.0.1.
import SwiftUI
import WebKit

#if canImport(UIKit)
typealias PlatformViewRepresentable = UIViewRepresentable
#else
typealias PlatformViewRepresentable = NSViewRepresentable
#endif

struct WebView: PlatformViewRepresentable {
    /// El túnel de ahora: http://127.0.0.1:<puerto>. Si cambia (al volver de segundo plano), se recarga en el nuevo.
    let base: URL
    let onFailure: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFailure: onFailure) }

    private func makeView(_ context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        #if canImport(UIKit)
        // las grabaciones de clase se ven dentro de la página, no a pantalla completa por la fuerza
        config.allowsInlineMediaPlayback = true
        #endif
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        #if canImport(UIKit)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        // la interfaz ya deja sitio a la muesca y a la barra de inicio (env(safe-area-inset-*)) y se desplaza por dentro
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        #endif
        context.coordinator.show(base, in: view)
        return view
    }

    #if canImport(UIKit)
    func makeUIView(context: Context) -> WKWebView { makeView(context) }
    func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.show(base, in: view) }
    #else
    func makeNSView(context: Context) -> WKWebView { makeView(context) }
    func updateNSView(_ view: WKWebView, context: Context) { context.coordinator.show(base, in: view) }
    #endif

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let onFailure: () -> Void
        private var shown: URL?

        init(onFailure: @escaping () -> Void) { self.onFailure = onFailure }

        /// Carga la interfaz en el túnel `base` (una sola vez por túnel), en la pantalla en la que estaba: la interfaz
        /// apunta su pantalla en el fragmento de la dirección («#…»).
        func show(_ base: URL, in view: WKWebView) {
            guard shown != base, var parts = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return }
            shown = base
            // la consulta de la dirección se conserva («?demo=1» en la demostración)
            parts.path = "/"
            parts.percentEncodedFragment = view.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.percentEncodedFragment }
            if let url = parts.url { view.load(URLRequest(url: url)) }
        }

        /// ¿Es una dirección del túnel? (lo único que se abre dentro de la app).
        private func isTunnel(_ url: URL) -> Bool {
            url.scheme == "http" && url.host == "127.0.0.1" && url.port == shown?.port
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.cancel) }
            if isTunnel(url) || url.scheme == "about" || url.scheme == "blob" { return decisionHandler(.allow) }
            // un enlace de fuera (una fuente citada, una página): en el navegador del sistema, y solo si es web
            if action.targetFrame?.isMainFrame != false, url.scheme == "https" || url.scheme == "http" { openOutside(url) }
            decisionHandler(.cancel)
        }

        /// Enlaces que piden ventana nueva: fuera, no dentro.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url {
                if isTunnel(url) { webView.load(action.request) } else if url.scheme == "https" || url.scheme == "http" { openOutside(url) }
            }
            return nil
        }

        private func openOutside(_ url: URL) {
            #if canImport(UIKit)
            UIApplication.shared.open(url)
            #else
            NSWorkspace.shared.open(url)
            #endif
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            failed(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            failed(error)
        }

        private func failed(_ error: Error) {
            // cancelar una carga para empezar otra no es un fallo
            if (error as NSError).domain == NSURLErrorDomain, (error as NSError).code == NSURLErrorCancelled { return }
            shown = nil
            onFailure()
        }

        /// iOS cerró el proceso de la página (memoria): se vuelve a cargar.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }
    }
}
