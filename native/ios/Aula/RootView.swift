// Lo que se ve: la interfaz de Aula cuando hay conexión con el Mac y, mientras no, una hoja de papel que dice qué falta
// y ofrece el único botón que toca. «Papel y luz»: papel cálido, ladrillo como única luz, serif en los títulos.
import SwiftUI

struct RootView: View {
    let model: AppModel

    var body: some View {
        ZStack {
            Color("Paper").ignoresSafeArea()
            switch model.stage {
            case .ready(let base):
                VStack(spacing: 0) {
                    if model.showsDemoBar { DemoBar { Task { await model.exitDemo() } } }
                    WebView(base: base, onFailure: { Task { await model.webFailed() } }, onSwitch: { model.chooseAnother() })
                        .ignoresSafeArea(edges: model.showsDemoBar ? [.horizontal, .bottom] : .all)
                }
                .transition(.opacity)
            default:
                ConnectView(model: model)
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: isReady)
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
                    .padding(.bottom, 18)
            } else {
                // quien llega sin Aula en el Mac: dónde se descarga
                Button(Texts.macLink) { model.showingMacInfo = true }
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color.accentColor)
                    .padding(.bottom, 18)
            }
        }
        .sheet(isPresented: Binding(get: { model.showingMacInfo }, set: { model.showingMacInfo = $0 })) {
            MacInfo { model.showingMacInfo = false }
        }
        .padding(.horizontal, 28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.45), value: art)
        .confirmationDialog(Texts.signOut, isPresented: Binding(get: { model.askingSignOut }, set: { model.askingSignOut = $0 }), titleVisibility: .visible) {
            Button(Texts.signOut, role: .destructive) { Task { await model.signOut() } }
            Button(Texts.cancel, role: .cancel) {}
        } message: {
            Text(Texts.signOutConfirm)
        }
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
                Button(Texts.signInAction) { openURL(url) }.buttonStyle(BrickButton())
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
                Text(footnote).font(.footnote).foregroundStyle(.tertiary).multilineTextAlignment(.center).padding(.top, 4)
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

/// La franja de la demostración: dice que lo es y deja salir.
private struct DemoBar: View {
    let exit: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(Color.accentColor).frame(width: 7, height: 7)
            Text(Texts.demoBar)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.primary)
            Spacer(minLength: 8)
            Button(Texts.demoExit, action: exit)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color.accentColor)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 7)
        .background(Color.accentColor.opacity(0.1))
        .background(Color("Paper"))
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
