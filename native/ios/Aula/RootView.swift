// Lo que se ve: la interfaz de Aula cuando hay conexión con el Mac y, mientras no, una hoja de papel que dice qué falta
// y ofrece el único botón que toca. «Papel y luz»: papel cálido, ladrillo como única luz, serif en los títulos.
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct RootView: View {
    let model: AppModel

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color("Paper").ignoresSafeArea()
                switch model.stage {
                case .ready(let base):
                    VStack(spacing: 0) {
                        if model.showsDemoBar {
                            DemoBar(tint: Color(hex: model.pageTop) ?? Color("Paper"), safeTop: geo.safeAreaInsets.top) { Task { await model.exitDemo() } }
                        }
                        // solo la zona del sistema (muesca, barra de inicio), no la del teclado: con el teclado abierto la
                        // vista web acaba encima de él y la página no tiene que moverse para enseñar el campo
                        WebView(base: base, events: events, supportLink: model.supportLink)
                            .ignoresSafeArea(.container, edges: model.showsDemoBar ? [.horizontal, .bottom] : .all)
                    }
                    .transition(.opacity)
                default:
                    ConnectView(model: model)
                        .transition(.opacity)
                }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: isReady)
        // lo nativo, como la página: la hora y la batería se leen sobre ella y la franja es de su mismo papel. Va en la
        // ventana y no en la escena (preferredColorScheme): así la escena sigue diciendo el tema del sistema y la vista
        // web se entera cuando cambia, aunque Aula tenga impuesto el suyo
        #if canImport(UIKit)
        .background(WindowStyle(dark: model.chromeDark))
        #else
        .preferredColorScheme(model.chromeDark.map { $0 ? .dark : .light })
        #endif
        .sheet(isPresented: Binding(get: { model.showingLicenses }, set: { model.showingLicenses = $0 })) {
            LicensesView { model.showingLicenses = false }
        }
    }

    /// Lo que la interfaz le pide a la app.
    private var events: WebEvents {
        let model = model
        return WebEvents(
            failed: { Task { await model.webFailed() } },
            switchAula: { model.chooseAnother() },
            look: { look, systemDark in model.pageLook(look, systemDark: systemDark) },
            licenses: { model.showingLicenses = true },
            exitDemo: { Task { await model.exitDemo() } },
            demoNotice: { model.demoNotice($0) }
        )
    }

    private var isReady: Bool {
        if case .ready = model.stage { return true }
        return false
    }
}

/// La hoja de espera: el dibujo de Aula (el arco con la luz de la hora, o el flexo mientras busca el Mac), qué pasa, el
/// único botón que toca y por qué paso va la conexión.
struct ConnectView: View {
    let model: AppModel
    @Environment(\.openURL) private var openURL
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 12)
            Image(art)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: sizeClass == .regular ? 360 : 280)
                .id(art)
                .transition(.opacity)
                .accessibilityHidden(true)
            content
                .padding(.top, 2)
                .frame(maxWidth: 460)
            if model.demoArchive != nil {
                // sin Mac a mano (o antes de instalar nada): Aula de verdad, con un curso de ejemplo
                Button(Texts.demoAction) { Task { await model.startDemo() } }
                    .buttonStyle(QuietButton())
                    .padding(.top, 16)
            }
            Spacer(minLength: 20)
            Steps(current: step)
                .frame(maxWidth: 420)
                .padding(.bottom, 14)
            if canSignOut {
                Button(Texts.signOut) { model.askingSignOut = true }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 8)
            } else {
                // quien llega sin Aula en el Mac: dónde se descarga
                Button(Texts.macLink) { model.showingMacInfo = true }
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color.accentColor)
                    .padding(.bottom, 8)
            }
            LegalLinks(model: model)
                .padding(.bottom, 12)
        }
        .sheet(isPresented: Binding(get: { model.showingMacInfo }, set: { model.showingMacInfo = $0 })) {
            MacInfo { model.showingMacInfo = false }
        }
        #if canImport(UIKit)
        .sheet(isPresented: Binding(get: { model.signInPage != nil }, set: { if !$0 { model.signInPage = nil } })) {
            if let page = model.signInPage {
                SafariView(url: page) { model.signInPage = nil }
                    .ignoresSafeArea()
            }
        }
        #endif
        .padding(.horizontal, 28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.45), value: art)
        .confirmationDialog(Texts.signOut, isPresented: Binding(get: { model.askingSignOut }, set: { model.askingSignOut = $0 }), titleVisibility: .visible) {
            Button(Texts.signOut, role: .destructive) { Task { await model.signOut() } }
            // la cuenta la crea Tailscale al iniciar sesión: cómo borrarla del todo (App Store 5.1.1(v))
            Button(Texts.deleteTailscale) { openURL(Legal.deleteTailscale) }
            Button(Texts.cancel, role: .cancel) {}
        } message: {
            Text(Texts.signOutConfirm)
        }
    }

    /// Inicia sesión en Tailscale en una hoja dentro de la app (en macOS, en el navegador).
    private func signIn(_ url: URL) {
        #if canImport(UIKit)
        model.signInPage = url
        #else
        openURL(url)
        #endif
    }

    /// Con sesión de Tailscale iniciada (todo lo que no sea arrancar o pedirla) se puede cerrar.
    private var canSignOut: Bool {
        switch model.stage {
        case .lookingForMac, .macUnreachable, .waitingApproval, .choosing: return true
        default: return false
        }
    }

    /// El dibujo: mientras se busca el Mac, el flexo; si no, el arco con la luz de la hora que es (como en el Mac).
    private var art: String {
        switch model.stage {
        case .lookingForMac, .macUnreachable, .failed: return "SpotLamp"
        default: return ArchLight.asset(hour: Calendar.current.component(.hour, from: Date()))
        }
    }

    /// Por qué paso va: 1 iniciar sesión, 2 encontrar el Mac, 3 escribir el código (ya dentro de Aula).
    private var step: Int {
        switch model.stage {
        case .starting, .signIn, .waitingApproval, .failed: return 1
        case .lookingForMac, .macUnreachable, .choosing: return 2
        case .ready: return 3
        }
    }

    @ViewBuilder private var content: some View {
        switch model.stage {
        case .starting, .ready:
            VStack(spacing: 14) {
                ProgressView()
                Text(Texts.starting).font(.callout).foregroundStyle(.secondary)
            }
            .padding(.top, 10)
        case .signIn(let url):
            Message(title: Texts.signInTitle, text: Texts.signInBody, footnote: Texts.signInAfter) {
                Button(Texts.signInAction) { signIn(url) }.buttonStyle(BrickButton())
            }
        case .waitingApproval:
            Message(title: Texts.approvalTitle, text: Texts.approvalBody, footnote: nil) { ProgressView() }
        case .lookingForMac:
            Message(title: Texts.lookingTitle, text: Texts.lookingBody, footnote: nil) {
                Button(Texts.retry) { Task { await model.tryAgain() } }.buttonStyle(BrickButton())
            }
        case .macUnreachable:
            Message(title: Texts.unreachableTitle, text: Texts.unreachableBody(model.macName), footnote: nil) {
                VStack(spacing: 6) {
                    Button(Texts.retry) { Task { await model.tryAgain() } }.buttonStyle(BrickButton())
                    Button(Texts.chooseAnother) { model.chooseAnother() }.buttonStyle(QuietButton())
                }
            }
        case .choosing(let aulas):
            Message(title: Texts.chooseTitle, text: Texts.chooseBody(aulas.count), footnote: nil) {
                VStack(spacing: 10) {
                    ForEach(aulas, id: \.host) { aula in
                        Button { Task { await model.choose(aula.host) } } label: {
                            HStack(spacing: 10) {
                                Circle().fill(aula.online ? Color.accentColor : Color.secondary.opacity(0.35)).frame(width: 8, height: 8)
                                Text(aula.host).font(.body.weight(.medium))
                                Spacer(minLength: 8)
                                if !aula.online { Text(Texts.chooseOffline).font(.footnote).foregroundStyle(.secondary) }
                            }
                            .padding(.horizontal, 16)
                            .frame(maxWidth: 360, minHeight: 48)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.primary.opacity(0.06)))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(aula.online ? aula.host : "\(aula.host), \(Texts.chooseOffline)")
                    }
                }
            }
        case .failed(let why):
            Message(title: Texts.failedTitle, text: why, footnote: nil) {
                Button(Texts.retry) { Task { await model.tryAgain() } }.buttonStyle(BrickButton())
            }
        }
    }
}

/// Dónde se descarga Aula para Mac: qué es, la dirección y cómo llevar el enlace al Mac.
struct MacInfo: View {
    /// La página de descarga (la última versión publicada).
    static let download = URL(string: "https://github.com/luumlabs/aula/releases/latest")!
    let close: () -> Void
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button(Texts.done, action: close).font(.body.weight(.medium))
            }
            .padding(.top, 18)
            Spacer(minLength: 8)
            Image("SpotLamp")
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 210)
                .accessibilityHidden(true)
            VStack(spacing: 12) {
                Text(Texts.macTitle)
                    .font(.system(.title, design: .serif).weight(.medium))
                Text(Texts.macBody)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Text(Texts.macAddress)
                    .font(.system(.callout, design: .monospaced))
                    .foregroundStyle(.primary)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.primary.opacity(0.06), in: Capsule())
                    .padding(.top, 4)
                ShareLink(item: MacInfo.download) {
                    Label(Texts.macShare, systemImage: "square.and.arrow.up")
                }
                .buttonStyle(BrickButton())
                .padding(.top, 12)
                Button(Texts.macOpen) { openURL(MacInfo.download) }
                    .font(.callout.weight(.medium))
                    .foregroundStyle(Color.accentColor)
                    .padding(.top, 6)
            }
            .frame(maxWidth: 460)
            Spacer(minLength: 20)
        }
        .padding(.horizontal, 28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("Paper").ignoresSafeArea())
    }
}

/// La política de privacidad (en la web) y las licencias (en la app), discretas al pie de las pantallas de espera.
private struct LegalLinks: View {
    let model: AppModel
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(spacing: 6) {
            Button(Texts.privacyLink) { openURL(Legal.privacy) }
            Text("·").accessibilityHidden(true)
            Button(Texts.licensesLink) { model.showingLicenses = true }
        }
        .buttonStyle(.plain)
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(minHeight: 28)
    }
}

/// El arco de Aula según la hora: los mismos cuatro momentos que en el Mac (design/InkArt.tsx → archLightFor).
enum ArchLight {
    static func asset(hour: Int) -> String {
        switch hour {
        case 6..<11: return "ArchDawn"
        case 11..<17: return "ArchNoon"
        case 17..<21: return "ArchDusk"
        default: return "ArchNight"
        }
    }
}

private struct Message<Action: View>: View {
    let title: String
    let text: String
    let footnote: String?
    @ViewBuilder let action: () -> Action

    var body: some View {
        VStack(spacing: 12) {
            Text(title)
                .font(.system(.largeTitle, design: .serif).weight(.medium))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                // el título, subrayado a pincel como el saludo de Aula
                .padding(.bottom, 9)
                .background(alignment: .bottom) {
                    BrushStroke()
                        .fill(Color.accentColor.opacity(0.85))
                        .frame(width: 196, height: 8)
                }
            Text(text)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            action().padding(.top, 14)
            if let footnote {
                // entera también en pantallas bajas (iPhone SE): encoge el dibujo, no la frase
                Text(footnote)
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
            }
        }
    }
}

/// Una pasada de pincel: entra fina, engorda en el medio y sale en punta, con un pulso leve.
private struct BrushStroke: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        let h = r.height
        p.move(to: CGPoint(x: r.minX, y: r.midY + h * 0.1))
        p.addQuadCurve(to: CGPoint(x: r.maxX, y: r.midY - h * 0.15), control: CGPoint(x: r.midX * 0.9, y: r.minY - h * 0.35))
        p.addQuadCurve(to: CGPoint(x: r.minX, y: r.midY + h * 0.1), control: CGPoint(x: r.midX * 1.05, y: r.maxY + h * 0.2))
        p.closeSubpath()
        return p
    }
}

/// Los tres pasos de la conexión, con el de ahora en ladrillo y los hechos marcados.
private struct Steps: View {
    let current: Int

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(1...3, id: \.self) { n in
                VStack(spacing: 6) {
                    ZStack {
                        if n < current {
                            Circle().fill(Color.accentColor)
                            Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Color("Paper"))
                        } else {
                            Circle().strokeBorder(n == current ? Color.accentColor : Color.primary.opacity(0.22), lineWidth: n == current ? 1.6 : 1)
                            Text("\(n)")
                                .font(.system(.footnote, design: .serif).weight(.medium))
                                .foregroundStyle(n == current ? Color.accentColor : Color.primary.opacity(0.45))
                        }
                    }
                    .frame(width: 26, height: 26)
                    Text(Texts.step(n))
                        .font(.caption)
                        .foregroundStyle(n == current ? Color.primary : Color.primary.opacity(0.5))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)
                .overlay(alignment: .top) {
                    // la línea hacia el paso siguiente, a la altura de los círculos
                    if n < 3 {
                        GeometryReader { g in
                            Rectangle()
                                .fill(n < current ? Color.accentColor.opacity(0.55) : Color.primary.opacity(0.16))
                                .frame(width: max(0, g.size.width - 38), height: 1)
                                .offset(x: g.size.width / 2 + 19, y: 12.5)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Texts.stepsLabel(current))
    }
}

/// La franja de la demostración: dice que lo es y deja salir. Es del mismo papel que lo de arriba de la página (con su
/// grano y su velo, si un diálogo lo tapa) y sigue por debajo de la hora y la batería: la única luz, el punto de ladrillo.
private struct DemoBar: View {
    let tint: Color
    /// El margen seguro de arriba de la ventana: si la barra de estado mide más (el iPad apaisado a pantalla completa), la
    /// franja baja lo que falte para no pisar la hora.
    let safeTop: CGFloat
    let exit: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(Color.accentColor).frame(width: 7, height: 7)
            Text(Texts.demoBar)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            Spacer(minLength: 8)
            Button(action: exit) {
                Text(Texts.demoExit)
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .padding(.horizontal, 12)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.leading, 18)
        .padding(.trailing, 6)
        .padding(.top, gap)
        // crece con el texto del sistema como la página (que llega hasta 1,3): sin pasar de ahí, no queda más grande que ella
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .background(alignment: .top) { tint.ignoresSafeArea(edges: .top) }
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.primary.opacity(0.1)).frame(height: 0.5)
        }
    }

    private var gap: CGFloat {
        #if canImport(UIKit)
        return max(0, StatusBar.height - safeTop)
        #else
        return 0
        #endif
    }
}

#if canImport(UIKit)
/// Pone el tema (claro, oscuro o el del sistema) en la ventana que la contiene: lo nativo y la hora y la batería lo siguen.
private struct WindowStyle: UIViewRepresentable {
    let dark: Bool?

    func makeUIView(context: Context) -> Probe { Probe() }

    func updateUIView(_ view: Probe, context: Context) {
        view.style = dark.map { $0 ? .dark : .light } ?? .unspecified
    }

    final class Probe: UIView {
        var style: UIUserInterfaceStyle = .unspecified {
            didSet { apply() }
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            apply()
        }

        private func apply() {
            guard let window, window.overrideUserInterfaceStyle != style else { return }
            window.overrideUserInterfaceStyle = style
        }
    }
}
#endif

extension Color {
    /// «#rrggbb» (lo que dice Shell.js) → color; nil si no lo es.
    init?(hex: String?) {
        guard let hex, hex.count == 7, hex.hasPrefix("#"), let v = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

/// El botón secundario: una píldora de papel con borde fino.
private struct QuietButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.medium))
            .foregroundStyle(.primary)
            .padding(.horizontal, 20)
            .frame(minHeight: 42)
            .background(Color.primary.opacity(configuration.isPressed ? 0.1 : 0.05), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.primary.opacity(0.14), lineWidth: 1))
    }
}

/// El botón principal: una píldora de ladrillo, texto claro (oscuro en modo oscuro, donde el ladrillo es más claro).
private struct BrickButton: ButtonStyle {
    @Environment(\.colorScheme) private var scheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(scheme == .dark ? Color(red: 0.17, green: 0.09, blue: 0.04) : .white)
            .padding(.horizontal, 26)
            .frame(minHeight: 50)
            .background(Color.accentColor, in: Capsule())
            .shadow(color: Color.accentColor.opacity(scheme == .dark ? 0.18 : 0.3), radius: 9, y: 4)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}
