// TailnetController.swift — Aula for iPhone and iPad (ported from the Tailscale plugin of Faro).
//
// Owns the embedded TailscaleKit node: starts it, tracks its state (by
// polling TailscaleNode.statusJSON(), which keeps working across iOS
// suspension, unlike the loopback LocalAPI), finds the student's Aulas in the
// tailnet (AulaHosts.swift: their Mac, "aula-mac", or their server) and manages
// the loopback forwarders that tunnel the web view's TCP connections to them.

import Foundation
import os
import TailscaleKit

/// State of the embedded node.
enum TailnetState: String, Sendable {
    case stopped
    case starting
    case needsLogin
    case needsMachineAuth
    case running
    case error
}

struct TailnetSnapshot: Sendable, Equatable {
    var state: TailnetState
    var authURL: String?
    var ips: [String] = []
    var dnsName: String?
    var hostname: String?
    var message: String?
    /// The best Aula in the tailnet (online first): a Mac ("aula-mac", or "aula-mac-1" if the name was taken) or an Aula
    /// server ("aula-server"). The app opens the one the student chose if there are several (`aulas`).
    var macHost: String?
    /// Whether that Aula is reachable right now (Aula open, Mac awake).
    var macOnline = false
    /// Every Aula in the tailnet, online first.
    var aulas: [AulaPeer] = []

    static let stopped = TailnetSnapshot(state: .stopped)
}

enum ControllerEvent: Sendable {
    /// Node state changed.
    case status(TailnetSnapshot)
    /// A loopback forwarder died and could not be re-created.
    case forwarderClosed(host: String, port: UInt16, localPort: UInt16, message: String)
}

struct ForwarderInfo: Sendable {
    let host: String
    let port: UInt16
    let localPort: UInt16
    let activeConnections: Int
}

struct StartOptions: Sendable {
    var hostname: String
    var authKey: String?
    var controlURL: String?
    var verbose: Bool
}

enum AulaTailscaleError: Error, LocalizedError {
    case notStarted
    case timeout(TailnetState)
    case tailscale(String)
    case stopped
    case invalidArgument(String)

    var code: String {
        switch self {
        case .notStarted: return "NOT_STARTED"
        case .timeout: return "TIMEOUT"
        case .tailscale: return "TAILSCALE_ERROR"
        case .stopped: return "STOPPED"
        case .invalidArgument: return "INVALID_ARGUMENT"
        }
    }

    var errorDescription: String? {
        switch self {
        case .notStarted: return "Tailscale is not started; call start() first"
        case .timeout(let s): return "timed out waiting for Tailscale (state: \(s.rawValue))"
        case .tailscale(let m): return m
        case .stopped: return "Tailscale was stopped"
        case .invalidArgument(let m): return m
        }
    }
}

/// Human-readable text for TailscaleKit's TailscaleError (its default
/// localizedDescription is just "error N").
func describeTailscaleError(_ error: Error) -> String {
    guard let e = error as? TailscaleError else {
        return (error as? LocalizedError)?.errorDescription ?? "\(error)"
    }
    switch e {
    case .badInterfaceHandle: return "invalid Tailscale handle"
    case .listenerClosed: return "listener closed"
    case .invalidTimeout: return "invalid timeout"
    case .connectionClosed: return "connection closed"
    case .readFailed: return "read failed"
    case .shortWrite: return "short write"
    case .invalidProxyAddress: return "invalid proxy address"
    case .invalidControlURL: return "invalid control URL"
    case .cannotFetchIps(let d): return "cannot fetch IPs" + (d.map { ": \($0)" } ?? "")
    case .posixError(let p, let d): return "\(p.code)" + (d.map { ": \($0)" } ?? "")
    case .unknownPosixError(let c, let d): return "error \(c)" + (d.map { ": \($0)" } ?? "")
    case .internalError(let d): return d ?? "internal Tailscale error"
    @unknown default: return "\(e)"
    }
}

/// LogSink for TailscaleKit. Go-side logs are discarded unless verbose.
struct AulaLogSink: LogSink {
    let logFileHandle: Int32?
    let verbose: Bool
    private static let logger = Logger(subsystem: "aula.tailscale", category: "tailscalekit")

    init(verbose: Bool) {
        self.verbose = verbose
        // -1 = discard Go logs. For verbose, hand Go a dup of stderr: libtailscale
        // wraps the fd in an os.File whose finalizer may close it later.
        self.logFileHandle = verbose ? dup(STDERR_FILENO) : -1
    }

    func log(_ message: String) {
        if verbose { Self.logger.debug("\(message, privacy: .public)") }
    }
}

/// Thread-safe state the (synchronous, background-queue) dialer can check.
/// Lleva también la dirección en la red de cada Aula de esta persona: los únicos equipos a los que se marca.
final class RunningGate: Sendable {
    private let lock = OSAllocatedUnfairLock<(handle: TailscaleHandle?, running: Bool, aulas: [String: String])>(initialState: (nil, false, [:]))

    func set(handle: TailscaleHandle?, running: Bool, aulas: [String: String] = [:]) {
        lock.withLock { $0 = (handle, running, running ? aulas : [:]) }
    }

    var current: (handle: TailscaleHandle?, running: Bool, aulas: [String: String]) {
        lock.withLock { $0 }
    }
}

/// Dials host:port over the tailnet with TailscaleKit and returns the
/// connection's file descriptor (one end of a socketpair that libtailscale
/// pipes to the tailnet TCP connection; supports read/write/shutdown).
///
/// TailscaleKit's OutgoingConnection actor only exposes send(), so the C
/// entry point exported by TailscaleKit.framework (tailscale_dial) is used
/// directly to get a bidirectional socket.
func tailnetDial(gate: RunningGate, host: String, port: UInt16) throws -> Int32 {
    let (handle, running, aulas) = gate.current
    guard let handle else { throw AulaTailscaleError.notStarted }
    // tsnet's Dial blocks until the node is Running; never park a thread on
    // that (e.g. while waiting for the user to log in).
    guard running else { throw AulaTailscaleError.tailscale("Tailscale is not connected yet") }
    // solo a una Aula de esta persona y a la dirección que dio la red (como Android): el nombre lo podría llevar luego
    // otro equipo de la red
    guard let ip = aulas[hostLabel(host)] else { throw AulaTailscaleError.tailscale("\(host) is not one of your Aulas on the tailnet") }

    let address: String
    if ip.contains(":") && !ip.hasPrefix("[") {
        address = "[\(ip)]:\(port)" // IPv6 literal
    } else {
        address = "\(ip):\(port)"
    }
    var conn: tailscale_conn = 0
    let rc = tailscale_dial(handle, "tcp", address, &conn)
    guard rc == 0 else {
        var buf = [CChar](repeating: 0, count: 256)
        let msg: String
        if tailscale_errmsg(handle, &buf, buf.count) == 0 {
            msg = String(decoding: buf.prefix(while: { $0 != 0 }).map { UInt8(bitPattern: $0) }, as: UTF8.self)
        } else {
            msg = "error \(rc)"
        }
        throw AulaTailscaleError.tailscale("dial \(address): \(msg)")
    }
    return conn
}

/// The machine name Aula's Mac app asks for in the tailnet (src/main/electron/remote/tailnet.ts).
let aulaMacHostname = "aula-mac"

// IPNStatus, AulaPeer y la regla que distingue las Aulas de esta persona de todo lo demás (dueño, etiquetas, nombre)
// están en AulaHosts.swift: lógica pura, que native/ios/_verify/HostsTest prueba sola.

/// Where the node's events go: the app's model once it is listening.
final class TailnetEvents: @unchecked Sendable {
    static let shared = TailnetEvents()
    private let lock = NSLock()
    private var sink: (@Sendable (ControllerEvent) -> Void)?

    func set(_ sink: (@Sendable (ControllerEvent) -> Void)?) {
        lock.lock()
        self.sink = sink
        lock.unlock()
    }

    func deliver(_ event: ControllerEvent) {
        lock.lock()
        let sink = self.sink
        lock.unlock()
        sink?(event)
    }
}

actor TailnetController {
    /// The app's one node.
    static let shared = TailnetController(emit: { TailnetEvents.shared.deliver($0) })

    private let emit: @Sendable (ControllerEvent) -> Void
    private let log = Logger(subsystem: "aula.tailscale", category: "controller")
    private let gate = RunningGate()

    private var node: TailscaleNode?
    private var handle: TailscaleHandle?
    private var logSink: AulaLogSink?
    private var options: StartOptions?
    private var snapshot = TailnetSnapshot.stopped
    private var generation = 0
    private var pollTask: Task<Void, Never>?
    private var upTask: Task<Void, Never>?
    private var waiters: [CheckedContinuation<TailnetSnapshot, Error>] = []
    private var forwarders: [String: LoopbackForwarder] = [:]
    private var needsLoginSince: Date?
    private var kickedLogin = false

    /// How long start() waits for running / needsLogin before rejecting.
    static let startTimeout: Duration = .seconds(60)

    init(emit: @escaping @Sendable (ControllerEvent) -> Void) {
        self.emit = emit
    }

    var current: TailnetSnapshot { snapshot }

    var forwarderInfo: [ForwarderInfo] {
        forwarders.values.map {
            ForwarderInfo(host: $0.remoteHost, port: $0.remotePort, localPort: $0.localPort, activeConnections: $0.activeConnections)
        }
    }

    /// Starts the node (or returns the current state if already started) and
    /// waits until it is running or needs login.
    func start(_ opts: StartOptions) async throws -> TailnetSnapshot {
        if node != nil && snapshot.state == .error {
            await stop() // a failed node is not reusable; start over
        }
        if node == nil {
            try await startNode(opts)
        }
        if let settled = settledResult() {
            return try settled.get()
        }
        let gen = generation
        let timeout = Task { [weak self] in
            try? await Task.sleep(for: Self.startTimeout)
            await self?.timeoutWaiters(generation: gen)
        }
        defer { timeout.cancel() }
        return try await withCheckedThrowingContinuation { cont in
            waiters.append(cont)
        }
    }

    /// The forwarder to host:port, created on first use: its current port and
    /// the secret every connection must present. The app asks again whenever
    /// it comes back to the foreground, so a port that moved (after a possible
    /// suspension) is never used stale.
    func connect(host: String, port: UInt16) async throws -> (port: UInt16, secret: String) {
        guard node != nil else { throw AulaTailscaleError.notStarted }
        let key = "\(host.lowercased()):\(port)"
        if let existing = forwarders[key], existing.isListening {
            return try await existing.endpoint()
        }
        forwarders[key]?.stop()
        forwarders[key] = nil

        let gate = self.gate
        let fwd = LoopbackForwarder(
            remoteHost: host,
            remotePort: port,
            dial: { h, p in try tailnetDial(gate: gate, host: h, port: p) },
            onFatal: { [weak self] message in
                Task { await self?.forwarderDied(key: key, message: message) }
            })
        // Installed before the first await, so a concurrent connect() reuses it.
        forwarders[key] = fwd
        do {
            let ep = try await fwd.endpoint()
            log.info("forwarding 127.0.0.1:\(ep.port, privacy: .public) -> \(host, privacy: .public):\(port, privacy: .public)")
            return ep
        } catch {
            if forwarders[key] === fwd { forwarders[key] = nil }
            fwd.stop()
            throw error
        }
    }

    func stop() async {
        generation += 1
        pollTask?.cancel()
        pollTask = nil
        upTask?.cancel()
        upTask = nil
        gate.set(handle: nil, running: false)
        for f in forwarders.values { f.stop() }
        forwarders.removeAll()
        handle = nil
        if let node {
            self.node = nil
            do {
                try await node.close()
            } catch {
                log.error("close: \(describeTailscaleError(error), privacy: .public)")
            }
        }
        logSink = nil
        options = nil
        needsLoginSince = nil
        kickedLogin = false
        failWaiters(AulaTailscaleError.stopped)
        update(.stopped)
    }

    /// Call when the app returns to the foreground: it may have been
    /// suspended, and iOS may have given the forwarders' ports to another app,
    /// so each one moves to a fresh port before it is used again.
    func applicationWillEnterForeground() async {
        for f in forwarders.values { f.markStale() }
        if node != nil { await refresh() }
    }

    /// The student signs this device out: sign its node out of the tailnet
    /// (best effort, a few seconds at most), stop it, and delete its state, so
    /// the device no longer holds a key to the person's tailnet.
    func logout() async {
        if let node, snapshot.state == .running {
            let client = LocalAPIClient(localNode: node, logger: logSink)
            await Self.bounded(seconds: 5) {
                do {
                    try await client.resetAuth()
                } catch {
                    Logger(subsystem: "aula.tailscale", category: "controller").error("resetAuth: \(describeTailscaleError(error), privacy: .public)")
                }
            }
        }
        await stop()
        if let dir = try? Self.stateDirectory() {
            do {
                try FileManager.default.removeItem(at: dir)
            } catch {
                log.error("removing Tailscale state: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    /// Runs `work` but returns after `seconds` even if it has not finished.
    private static func bounded(seconds: Double, _ work: @escaping @Sendable () async -> Void) async {
        let once = OSAllocatedUnfairLock(initialState: false)
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            let finish: @Sendable () -> Void = {
                if once.withLock({ done in
                    defer { done = true }
                    return !done
                }) { cont.resume() }
            }
            Task.detached {
                await work()
                finish()
            }
            Task.detached {
                try? await Task.sleep(for: .seconds(seconds))
                finish()
            }
        }
    }

    // MARK: - internals

    private func startNode(_ opts: StartOptions) async throws {
        let dir = try Self.stateDirectory()
        let sink = AulaLogSink(verbose: opts.verbose)
        let config = Configuration(
            hostName: opts.hostname,
            path: dir.path,
            authKey: opts.authKey,
            controlURL: opts.controlURL ?? kDefaultControlURL,
            ephemeral: false)
        update(TailnetSnapshot(state: .starting, hostname: opts.hostname))
        let newNode: TailscaleNode
        do {
            newNode = try TailscaleNode(config: config, logger: sink)
        } catch {
            let msg = describeTailscaleError(error)
            update(TailnetSnapshot(state: .error, message: msg))
            throw AulaTailscaleError.tailscale(msg)
        }
        generation += 1
        let gen = generation
        node = newNode
        handle = await newNode.tailscale
        logSink = sink
        options = opts
        needsLoginSince = nil
        kickedLogin = false

        // up() blocks (in a detached task inside TailscaleKit) until the node
        // is Running, or fails on a backend error (e.g. an invalid auth key).
        upTask = Task { [weak self] in
            do {
                try await newNode.up()
                await self?.upFinished(generation: gen, error: nil)
            } catch {
                await self?.upFinished(generation: gen, error: error)
            }
        }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let interval = await self.pollOnce(generation: gen)
                guard let interval else { return }
                try? await Task.sleep(for: interval)
            }
        }
    }

    /// Returns the next poll interval, or nil when this generation is over.
    private func pollOnce(generation gen: Int) async -> Duration? {
        guard gen == generation, node != nil else { return nil }
        await refresh()
        return snapshot.state == .running ? .seconds(5) : .seconds(1)
    }

    private func upFinished(generation gen: Int, error: Error?) async {
        guard gen == generation else { return } // stopped meanwhile
        if let error {
            let msg = describeTailscaleError(error)
            log.error("up: \(msg, privacy: .public)")
            update(TailnetSnapshot(state: .error, hostname: options?.hostname, message: msg))
        } else {
            await refresh()
        }
    }

    private func refresh() async {
        guard let node else { return }
        let gen = generation
        let data: Data
        do {
            data = try await node.statusJSON()
        } catch {
            log.debug("statusJSON: \(describeTailscaleError(error), privacy: .public)")
            return
        }
        guard gen == generation else { return }
        guard let st = try? JSONDecoder().decode(IPNStatus.self, from: data) else {
            log.error("could not decode status JSON")
            return
        }
        if snapshot.state == .error && st.BackendState != "Running" {
            return // keep the error visible until a stop()/start()
        }
        let requested = options?.hostname
        var next = TailnetSnapshot(state: .starting, hostname: requested)
        var aulaAddrs: [String: String] = [:]
        switch st.BackendState {
        case "Running":
            let ips = st.TailscaleIPs ?? []
            guard !ips.isEmpty else { break }
            let dns = st.Self?.DNSName.map { $0.hasSuffix(".") ? String($0.dropLast()) : $0 }
            var host = requested
            if let dns, let first = dns.split(separator: ".").first, !first.isEmpty {
                host = String(first)
            } else if let h = st.Self?.HostName, !h.isEmpty {
                host = h
            }
            let found = findAulas(st.Peer, me: st.Self)
            aulaAddrs = found.addrs
            let aulas = found.aulas
            next = TailnetSnapshot(state: .running, ips: ips, dnsName: dns, hostname: host, macHost: aulas.first?.host, macOnline: aulas.first?.online ?? false, aulas: aulas)
        case "NeedsLogin":
            if let url = st.AuthURL, !url.isEmpty {
                next = TailnetSnapshot(state: .needsLogin, authURL: url, hostname: requested)
            }
            await kickLoginIfStuck(hasURL: !(st.AuthURL ?? "").isEmpty)
        case "NeedsMachineAuth":
            next = TailnetSnapshot(state: .needsMachineAuth, hostname: requested,
                                   message: "this device must be approved in the Tailscale admin console")
        case "InUseOtherUser":
            next = TailnetSnapshot(state: .error, hostname: requested, message: "Tailscale is in use by another user")
        default:
            break // NoState, Starting, Stopped: transitional
        }
        if st.BackendState != "NeedsLogin" {
            needsLoginSince = nil
            kickedLogin = false
        }
        guard gen == generation else { return }
        update(next, aulas: aulaAddrs)
    }

    /// tsnet requests an auth URL itself at startup; after a later logout or
    /// key expiry nobody does, so ask for one if none shows up.
    private func kickLoginIfStuck(hasURL: Bool) async {
        guard !hasURL, !kickedLogin, let node else { return }
        guard let since = needsLoginSince else {
            needsLoginSince = Date()
            return
        }
        guard Date().timeIntervalSince(since) > 8 else { return }
        kickedLogin = true
        log.info("no auth URL yet; requesting interactive login")
        do {
            try await LocalAPIClient(localNode: node, logger: logSink).startLoginInteractive()
        } catch {
            log.error("startLoginInteractive: \(describeTailscaleError(error), privacy: .public)")
        }
    }

    private func update(_ next: TailnetSnapshot, aulas: [String: String] = [:]) {
        let changed = next != snapshot
        snapshot = next
        // Keep the dial gate in sync (read synchronously by forwarders).
        gate.set(handle: handle, running: handle != nil && next.state == .running, aulas: aulas)
        if changed {
            emit(.status(next))
        }
        if let settled = settledResult() {
            let ws = waiters
            waiters.removeAll()
            for w in ws { w.resume(with: settled) }
        }
    }

    private func settledResult() -> Result<TailnetSnapshot, Error>? {
        switch snapshot.state {
        case .running, .needsMachineAuth:
            return .success(snapshot)
        case .needsLogin where snapshot.authURL != nil:
            return .success(snapshot)
        case .error:
            return .failure(AulaTailscaleError.tailscale(snapshot.message ?? "Tailscale error"))
        default:
            return nil
        }
    }

    private func timeoutWaiters(generation gen: Int) {
        guard gen == generation, !waiters.isEmpty else { return }
        failWaiters(AulaTailscaleError.timeout(snapshot.state))
    }

    private func failWaiters(_ error: Error) {
        let ws = waiters
        waiters.removeAll()
        for w in ws { w.resume(throwing: error) }
    }

    private func forwarderDied(key: String, message: String) {
        guard let f = forwarders[key], !f.isListening else { return }
        forwarders[key] = nil
        f.stop()
        log.error("\(message, privacy: .public)")
        emit(.forwarderClosed(host: f.remoteHost, port: f.remotePort, localPort: f.localPort, message: message))
    }

    /// <Application Support>/AulaTailscale, excluded from backups (the node
    /// key must not be restored onto another device).
    static func stateDirectory() throws -> URL {
        let fm = FileManager.default
        #if os(macOS)
        // Only the verification harness runs this on a Mac (native/ios/_verify): it keeps the node's state out of the home.
        if let custom = ProcessInfo.processInfo.environment["AULA_TAILSCALE_DIR"], !custom.isEmpty {
            let dir = URL(fileURLWithPath: custom, isDirectory: true)
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            return dir
        }
        #endif
        let base = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        var dir = base.appendingPathComponent("AulaTailscale", isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
        return dir
    }
}
