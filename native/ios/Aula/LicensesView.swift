// Lo legal de la app: la dirección de la política de privacidad y la pantalla «Licencias», con la de Aula y las de lo
// que la app lleva dentro (el componente de Tailscale, Go y sus módulos). Los textos salen de Licenses.json, que
// escribe native/ios/scripts/licenses.mjs al compilar TailscaleKit.
import SwiftUI

enum Legal {
    /// La política de privacidad; en español, su mitad en español.
    static var privacy: URL {
        URL(string: "https://github.com/luumlabs/aula/blob/main/docs/PRIVACY.md" + (Texts.spanish ? "#espa%C3%B1ol" : ""))!
    }
    /// El código de Aula (AGPL).
    static let source = URL(string: "https://github.com/luumlabs/aula")!
    /// Cómo borrar la cuenta de Tailscale (la única cuenta que se crea al usar la app; App Store 5.1.1(v)).
    static let deleteTailscale = URL(string: "https://tailscale.com/docs/account/delete-tailnet")!
}

/// Un componente con su licencia y el texto entero de sus avisos.
struct LicensedComponent: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let version: String?
    let license: String
    let text: String

    // basta el id para compararlos (el texto puede ser largo)
    static func == (a: Self, b: Self) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    /// Los que trae esta copia de la app (ninguno si le falta Licenses.json). Se leen una vez.
    static let bundled: [LicensedComponent] = {
        struct Catalog: Decodable { let components: [LicensedComponent] }
        guard let url = Bundle.main.url(forResource: "Licenses", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let catalog = try? JSONDecoder().decode(Catalog.self, from: data) else { return [] }
        return catalog.components
    }()
}

struct LicensesView: View {
    let close: () -> Void
    private let components = LicensedComponent.bundled
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(Texts.licensesIntro)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Button(Texts.licensesSource) { openURL(Legal.source) }
                        .font(.callout.weight(.medium))
                }
                Section {
                    ForEach(components) { component in
                        NavigationLink(value: component) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(component.name).font(.body)
                                Text([component.license, component.version].compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                } footer: {
                    if components.isEmpty { Text(Texts.licensesMissing) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color("Paper").ignoresSafeArea())
            .navigationTitle(Texts.licensesTitle)
            .navigationDestination(for: LicensedComponent.self) { LicenseText(component: $0) }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(Texts.done, action: close) }
            }
        }
    }
}

/// El texto de una licencia, en párrafos que se leen a cualquier ancho y se pueden seleccionar.
private struct LicenseText: View {
    let component: LicensedComponent
    private let paragraphs: [String]

    init(component: LicensedComponent) {
        self.component = component
        paragraphs = Self.reflow(component.text)
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                ForEach(paragraphs.indices, id: \.self) { i in
                    Text(paragraphs[i])
                        .font(.footnote)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: 680)
            .padding(20)
            .frame(maxWidth: .infinity)
        }
        .background(Color("Paper").ignoresSafeArea())
        .navigationTitle(component.name)
        #if canImport(UIKit)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    /// Los avisos vienen cortados a unas 80 columnas: se juntan las líneas de cada párrafo, menos las que empiezan
    /// algo propio (un punto de una lista, un copyright, un título), que siguen en su línea.
    static func reflow(_ text: String) -> [String] {
        var out: [String] = []
        var current = ""
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty {
                if !current.isEmpty { out.append(current) }
                current = ""
            } else if current.isEmpty {
                current = line
            } else {
                current += (startsItem(line) ? "\n" : " ") + line
            }
        }
        if !current.isEmpty { out.append(current) }
        return out
    }

    private static func startsItem(_ line: String) -> Bool {
        for prefix in ["* ", "- ", "• ", "#", "---", "|", "Copyright"] where line.hasPrefix(prefix) { return true }
        // «1.», «(a)», «b)», «iv.»
        return line.range(of: #"^\(?([0-9]{1,2}|[a-zA-Z]|[ivxIVX]{2,4})[.)]\s"#, options: .regularExpression) != nil
    }
}
