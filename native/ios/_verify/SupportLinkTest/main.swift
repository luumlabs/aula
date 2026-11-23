// Prueba cuándo deja la app enseñar «Apoya a Aula» y qué cuenta como una página para donar (Aula/SupportLink.swift): solo
// con la tienda de EE. UU. y, sin ella, la app no abre GitHub Sponsors aunque la interfaz del Mac lo pida (WebView.swift).
// Lo compila y lanza ../verify.sh.
import Foundation

setvbuf(stdout, nil, _IONBF, 0)
var failures = 0
@MainActor func check(_ ok: Bool, _ what: String) {
    print("\(ok ? "PASS" : "FAIL")  \(what)")
    if !ok { failures += 1 }
}

// MARK: La tienda (ISO 3166-1 alfa-3, como la da StoreKit)
for (code, want) in [("USA", true), ("ESP", false), ("MEX", false), ("GBR", false), ("US", false), ("", false)] {
    check(SupportLink.allowed(code) == want, "allowed(\(code.debugDescription)) = \(want)")
}
check(!SupportLink.allowed(nil), "allowed(nil) = false: si StoreKit no lo sabe, no")

// MARK: Una página para donar
let donations = [
    "https://github.com/sponsors/luumlabs", "https://GitHub.com/Sponsors/luumlabs?frequency=one-time",
    "https://www.github.com/sponsors/luumlabs", "http://github.com/sponsors", "https://github.com:443/sponsors/luumlabs/button",
]
let others = [
    "https://github.com/luumlabs/aula", "https://github.com/luumlabs/aula/blob/main/docs/PRIVACY.md",
    "https://github.com/sponsorship", "https://github.com/luumlabs/sponsors", "https://gist.github.com/sponsors/luumlabs",
    "https://github.com.example.net/sponsors/luumlabs", "https://example.com/sponsors/luumlabs",
]
for text in donations { check(URL(string: text).map(SupportLink.isDonation) == true, "isDonation(\(text)) = true") }
for text in others { check(URL(string: text).map(SupportLink.isDonation) == false, "isDonation(\(text)) = false") }

if failures > 0 {
    print("\(failures) FALLOS")
    exit(1)
}
