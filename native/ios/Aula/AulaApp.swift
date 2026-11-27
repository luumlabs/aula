// Aula para iPhone y iPad. La app no guarda cursos ni habla con ninguna IA: es la puerta a la Aula del Mac del
// estudiante. Lleva dentro un nodo de Tailscale (no hace falta la app de Tailscale), encuentra el Mac en su red privada
// y enseña la misma interfaz que el Mac: completa en el iPad, centrada en el asistente en el iPhone.
import SwiftUI

@main
struct AulaApp: App {
    /// Uno para toda la app (la app se crea una sola vez); las vistas lo observan.
    private let model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .task { await model.start() }
                .onChange(of: phase) { old, now in
                    // Solo al volver desde segundo plano (no al bajar el Centro de Control, Face ID ni en el arranque inicial):
                    // evita recargar toda la vista web innecesariamente cuando iOS nunca suspendió la app.
                    if old == .background, now == .active { Task { await model.cameToForeground() } }
                }
        }
    }
}
