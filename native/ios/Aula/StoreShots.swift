// Capturas y vídeo del App Store (solo en depuración: en Release este archivo está vacío y la app no tiene ningún gancho).
//   -AulaStoreShots YES   abre la demostración sola, sin su barra y sin arrancar Tailscale
//   -AulaRoute <json>     la abre en esa pantalla (la ruta de la interfaz, como la lee routeHash.ts)
//   -AulaDemo <archivo>   usa otra grabación, de Documents/ del contenedor (o una ruta absoluta), en vez de la de la app
// Los argumentos van por parejas: un «-AulaStoreShots» suelto se comería el valor del siguiente.
#if DEBUG
import Foundation

enum StoreShots {
    static var on: Bool { ProcessInfo.processInfo.arguments.contains("-AulaStoreShots") }

    /// El fragmento de la dirección con la ruta («#…», ya codificado como encodeURIComponent), si se pidió una.
    static var routeFragment: String? {
        guard let json = value(after: "-AulaRoute"), !json.isEmpty else { return nil }
        if (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] == nil {
            NSLog("[Aula] -AulaRoute no es un objeto JSON: %@", json)
        }
        return json.addingPercentEncoding(withAllowedCharacters: unreserved)
    }

    /// La grabación de la demostración que se usa en lugar de la de la app.
    static var archive: URL? {
        guard let name = value(after: "-AulaDemo"), !name.isEmpty else { return nil }
        if name.hasPrefix("/") { return URL(fileURLWithPath: name) }
        return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent(name)
    }

    /// Lo que encodeURIComponent deja sin codificar.
    private static let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

    /// El valor que sigue a un argumento («-AulaRoute '{…}'»). Se lee de los argumentos y no de UserDefaults, que
    /// intentaría leer el JSON como una lista de propiedades.
    private static func value(after flag: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
}
#endif
