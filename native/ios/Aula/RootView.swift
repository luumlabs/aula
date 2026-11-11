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
                WebView(base: base) { Task { await model.webFailed() } }
                    .ignoresSafeArea()
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

/// La hoja de espera: la marca de Aula, qué pasa y qué hacer.
struct ConnectView: View {
    let model: AppModel
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            Image("Mark")
                .resizable()
                .scaledToFit()
                .frame(width: 96, height: 96)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .shadow(color: .black.opacity(0.08), radius: 14, y: 6)
                .accessibilityHidden(true)
            content
                .padding(.top, 28)
                .frame(maxWidth: 440)
            Spacer(minLength: 24)
            if canSignOut {
                Button(Texts.signOut) { model.askingSignOut = true }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 18)
            }
        }
        .padding(.horizontal, 28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
        case .lookingForMac, .macUnreachable, .waitingApproval: return true
        default: return false
        }
    }

    @ViewBuilder private var content: some View {
        switch model.stage {
        case .starting, .ready:
            VStack(spacing: 14) {
                ProgressView()
                Text(Texts.starting).font(.callout).foregroundStyle(.secondary)
            }
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
                Button(Texts.retry) { Task { await model.tryAgain() } }.buttonStyle(BrickButton())
            }
        case .failed(let why):
            Message(title: Texts.failedTitle, text: why, footnote: nil) {
                Button(Texts.retry) { Task { await model.tryAgain() } }.buttonStyle(BrickButton())
            }
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
            Text(text)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            action().padding(.top, 14)
            if let footnote {
                Text(footnote).font(.footnote).foregroundStyle(.tertiary).multilineTextAlignment(.center).padding(.top, 4)
            }
        }
    }
}

/// El botón principal: ladrillo, texto claro (oscuro en modo oscuro, donde el ladrillo es más claro).
private struct BrickButton: ButtonStyle {
    @Environment(\.colorScheme) private var scheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(scheme == .dark ? Color(red: 0.17, green: 0.09, blue: 0.04) : .white)
            .padding(.horizontal, 22)
            .frame(minHeight: 50)
            .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}
