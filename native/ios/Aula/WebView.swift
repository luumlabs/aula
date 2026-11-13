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
    /// «Abrir otra Aula» desde la interfaz (Ajustes): la app vuelve a la lista de Aulas de la red.
    var onSwitch: () -> Void = {}

    func makeCoordinator() -> Coordinator { Coordinator(onFailure: onFailure, onSwitch: onSwitch) }

    /// Lo que la interfaz sabe de la app que la abre: puede pedir abrir otra Aula (`window.aulaApp.switchAula()`).
    private static let appBridge = """
    window.aulaApp = { switchAula: function () { window.webkit.messageHandlers.aulaApp.postMessage('switch') } };
    """

    #if canImport(UIKit)
    /// Que se sienta una app y no una página: sin zoom (ni con dos dedos ni con doble toque), sin el menú de mantener
    /// pulsado sobre enlaces e imágenes, sin el destello gris al tocar y sin seleccionar el texto de los botones. El
    /// texto que se lee (lecciones, chat) y el que se escribe sí se pueden seleccionar.
    private static let solid = """
    (() => {
      const meta = document.querySelector('meta[name="viewport"]') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'viewport' }));
      meta.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
      const style = document.createElement('style');
      style.textContent = `
        html { -webkit-text-size-adjust: 100%; touch-action: manipulation; overscroll-behavior: none; }
        body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
        * { -webkit-tap-highlight-color: transparent; }
        a, img, svg { -webkit-user-drag: none; }
        input, textarea, [contenteditable], p, li, td, th, pre, code, blockquote, .katex { -webkit-user-select: text; user-select: text; }
      `;
      document.head.appendChild(style);
    })();
    """
    #endif

    private func makeView(_ context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        #if canImport(UIKit)
        // las grabaciones de clase se ven dentro de la página, no a pantalla completa por la fuerza
        config.allowsInlineMediaPlayback = true
        #endif
        config.userContentController.addUserScript(WKUserScript(source: Self.appBridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(WeakMessageHandler(context.coordinator), name: "aulaApp")
        #if canImport(UIKit)
        config.userContentController.addUserScript(WKUserScript(source: Self.solid, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let view = AulaWebView(frame: .zero, configuration: config)
        #else
        let view = WKWebView(frame: .zero, configuration: config)
        #endif
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
        // una app, no una página: sin vista previa al mantener pulsado un enlace y sin zoom con los dedos
        view.allowsLinkPreview = false
        view.scrollView.delegate = context.coordinator
        // iOS 26 difumina lo que pasa por debajo de la hora y la batería: la interfaz ya deja ese hueco limpio
        if #available(iOS 26.0, *) {
            view.scrollView.topEdgeEffect.isHidden = true
            view.scrollView.bottomEdgeEffect.isHidden = true
            view.scrollView.leftEdgeEffect.isHidden = true
            view.scrollView.rightEdgeEffect.isHidden = true
        }
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

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        private let onFailure: () -> Void
        private let onSwitch: () -> Void
        private var shown: URL?

        init(onFailure: @escaping () -> Void, onSwitch: @escaping () -> Void) {
            self.onFailure = onFailure
            self.onSwitch = onSwitch
        }

        /// Un mensaje de la interfaz: solo «switch» (abrir otra Aula), y solo de la página de Aula por el túnel.
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "aulaApp", message.body as? String == "switch", message.frameInfo.isMainFrame,
                  message.frameInfo.request.url?.host == "127.0.0.1" else { return }
            onSwitch()
        }

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

#if canImport(UIKit)
extension WebView.Coordinator: UIScrollViewDelegate {
    /// La página ya pide que no haya zoom; por si WebKit lo deja pasar, el gesto de dos dedos se apaga aquí.
    func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) {
        scrollView.pinchGestureRecognizer?.isEnabled = false
    }
}

/// La vista web a toda pantalla. SwiftUI le quita los márgenes seguros a una vista que los ignora, y la página, que deja
/// sitio a la hora y la batería con env(safe-area-inset-*), se quedaba debajo. Aquí se le dicen los de verdad: los de la
/// ventana, descontando lo que ya tapa otra cosa (la barra de la demostración).
final class AulaWebView: WKWebView {
    private var told: UIEdgeInsets = .zero

    override var safeAreaInsets: UIEdgeInsets {
        guard let window else { return super.safeAreaInsets }
        let frame = convert(bounds, to: window)
        let safe = window.safeAreaInsets
        return UIEdgeInsets(
            top: max(0, safe.top - frame.minY),
            left: max(0, safe.left - frame.minX),
            bottom: max(0, safe.bottom - (window.bounds.maxY - frame.maxY)),
            right: max(0, safe.right - (window.bounds.maxX - frame.maxX))
        )
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        retell()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        retell()
    }

    /// WebKit vuelve a leer los márgenes cuando se le avisa de que cambiaron.
    private func retell() {
        let now = safeAreaInsets
        guard now != told else { return }
        told = now
        safeAreaInsetsDidChange()
    }
}
#endif

/// El controlador de contenido guarda su manejador con fuerza: este intermediario evita que la vista web y su coordinador se
/// sujeten el uno al otro para siempre.
final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
