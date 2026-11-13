// Qué equipos de la red privada son una Aula de esta persona. Lógica pura (sin TailscaleKit), para probarla sola
// (native/ios/_verify/HostsTest). La regla de los nombres es la misma en el escritorio
// (src/main/services/remote/server-mode.ts) y en la app de Android (native/tsnet/client/main.go).
import Foundation

/// Lo que la app lee del estado del nodo (el JSON de ipnstate.Status).
struct IPNStatus: Decodable {
    struct PeerStatus: Decodable {
        var DNSName: String?
        var HostName: String?
        var Online: Bool?
        var TailscaleIPs: [String]?
        /// El usuario de Tailscale dueño del equipo.
        var UserID: Int64?
        /// Quien lo compartió desde otra red, si no es su dueño (0 o nada si no es compartido).
        var AltSharerUserID: Int64?
        var Tags: [String]?
        /// Equipo de alguien con quien se compartió este nodo: está en la red solo para poder llegar aquí.
        var ShareeNode: Bool?

        init(DNSName: String? = nil, HostName: String? = nil, Online: Bool? = nil, TailscaleIPs: [String]? = nil,
             UserID: Int64? = nil, AltSharerUserID: Int64? = nil, Tags: [String]? = nil, ShareeNode: Bool? = nil) {
            self.DNSName = DNSName
            self.HostName = HostName
            self.Online = Online
            self.TailscaleIPs = TailscaleIPs
            self.UserID = UserID
            self.AltSharerUserID = AltSharerUserID
            self.Tags = Tags
            self.ShareeNode = ShareeNode
        }

        private enum CodingKeys: String, CodingKey {
            case DNSName, HostName, Online, TailscaleIPs, UserID, AltSharerUserID, Tags, ShareeNode
        }

        // Campo a campo: si uno no viene como se espera, ese equipo no cuenta (y el estado entero se sigue leyendo).
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            DNSName = try? c.decodeIfPresent(String.self, forKey: .DNSName)
            HostName = try? c.decodeIfPresent(String.self, forKey: .HostName)
            Online = try? c.decodeIfPresent(Bool.self, forKey: .Online)
            TailscaleIPs = try? c.decodeIfPresent([String].self, forKey: .TailscaleIPs)
            UserID = try? c.decodeIfPresent(Int64.self, forKey: .UserID)
            AltSharerUserID = try? c.decodeIfPresent(Int64.self, forKey: .AltSharerUserID)
            // unas etiquetas ilegibles cuentan como etiquetas: ese equipo no es de nadie
            if c.contains(.Tags), (try? c.decodeNil(forKey: .Tags)) != true {
                Tags = (try? c.decode([String].self, forKey: .Tags)) ?? ["?"]
            }
            ShareeNode = try? c.decodeIfPresent(Bool.self, forKey: .ShareeNode)
        }
    }
    var BackendState: String
    var AuthURL: String?
    var TailscaleIPs: [String]?
    var `Self`: PeerStatus?
    var Peer: [String: PeerStatus]?
}

/// Una Aula tal como se ve en la red.
struct AulaPeer: Sendable, Equatable, Hashable {
    let host: String
    let online: Bool
}

/// Lo que va antes del primer punto, tal cual.
private func firstLabel(_ name: String) -> Substring.UTF8View {
    let bytes = name.utf8
    return bytes[bytes.startIndex..<(bytes.firstIndex(of: UInt8(ascii: ".")) ?? bytes.endIndex)]
}

/// La primera etiqueta DNS del nombre en minúsculas ASCII, o "" si lleva algo que no es ASCII (`lowercased()` convertiría,
/// p. ej., el signo de Kelvin en «k» y dejaría pasar un nombre que lo imita).
func hostLabel(_ name: String) -> String {
    var out: [UInt8] = []
    for b in firstLabel(name) {
        guard b < 0x80 else { return "" }
        out.append(b >= UInt8(ascii: "A") && b <= UInt8(ascii: "Z") ? b + 32 : b)
    }
    return String(decoding: out, as: UTF8.self)
}

/// ¿El equipo que se llama así (nombre corto o MagicDNS completo) es una Aula? Su primera etiqueta es «aula-» y una
/// etiqueta DNS (63 caracteres como mucho, sin guion en los extremos), y no es el nombre de un dispositivo («aula-ipad»,
/// «aula-iphone-2»…): «aula-mac», «aula-server», «aula-casa»…
func isAulaHost(_ name: String) -> Bool {
    let l = hostLabel(name)
    guard l.utf8.count <= 63, l.wholeMatch(of: /aula-[a-z0-9]([a-z0-9-]*[a-z0-9])?/) != nil else { return false }
    return l.wholeMatch(of: /aula-(ipad|iphone|android|device)(-[0-9]+)?/) == nil
}

/// El nombre del equipo en la red: la primera etiqueta de su nombre MagicDNS (p. ej. aula-mac-1) o, si no tiene, la de su
/// nombre de equipo; en minúsculas ASCII.
func machineName(dns: String?, host: String?) -> String {
    if let dns, !firstLabel(dns).isEmpty { return hostLabel(dns) }
    return hostLabel(host ?? "")
}

/// ¿El equipo es del usuario de Tailscale `owner`, como este dispositivo? La misma regla que aplica la Aula
/// (native/tsnet/proxy.go, ownerGate): los demás usuarios de una red compartida, los equipos compartidos desde otra red y
/// los equipos con etiquetas nunca son una Aula de esta persona.
func isOwned(_ peer: IPNStatus.PeerStatus, by owner: Int64) -> Bool {
    owner > 0 && peer.UserID == owner && (peer.AltSharerUserID ?? 0) == 0 && peer.ShareeNode != true && (peer.Tags ?? []).isEmpty
}

/// Las Aulas de quien inició sesión en este dispositivo (`me`) entre los equipos de la red, primero las que están en línea
/// y luego por nombre, y la dirección de cada una (se marca a esa, nunca al nombre). Sin saber de quién es este
/// dispositivo, ninguna. Si dos equipos responden al mismo nombre no sale ninguno: no se adivina cuál es.
func findAulas(_ peers: [String: IPNStatus.PeerStatus]?, me: IPNStatus.PeerStatus?) -> (aulas: [AulaPeer], addrs: [String: String]) {
    guard let owner = me?.UserID, owner > 0 else { return ([], [:]) }
    var found: [String: (aula: AulaPeer, addr: String)] = [:]
    var twice: Set<String> = []
    for peer in (peers ?? [:]).values {
        guard let addr = peer.TailscaleIPs?.first, !addr.isEmpty, isOwned(peer, by: owner) else { continue }
        let name = machineName(dns: peer.DNSName, host: peer.HostName)
        guard isAulaHost(name) else { continue }
        if found[name] != nil {
            twice.insert(name)
            continue
        }
        found[name] = (AulaPeer(host: name, online: peer.Online ?? false), addr)
    }
    for name in twice { found[name] = nil }
    let aulas = found.values.map { $0.aula }.sorted { ($0.online ? 0 : 1, $0.host) < ($1.online ? 0 : 1, $1.host) }
    return (aulas, found.mapValues { $0.addr })
}
