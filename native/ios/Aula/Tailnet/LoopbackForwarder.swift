// LoopbackForwarder.swift — Aula for iPhone and iPad (ported from Faro's FaroTailscale plugin).
//
// A TCP listener on 127.0.0.1 whose accepted connections are each piped, byte
// for byte and in both directions, to a stream socket obtained from a
// `StreamDialer` (in the plugin: a TCP connection dialed through the tailnet
// with TailscaleKit's tailscale_dial).
//
// Every app on the phone can reach 127.0.0.1, so the forwarder trusts nobody
// by default (docs/jueces/20-auditoria-seguridad.md):
//
//  * Each listener has its own random secret. A connection is dialed through
//    the tailnet only once its first HTTP request carries it: as the cookie
//    `aula_gate` (the web view: the app sets that cookie for 127.0.0.1 before
//    loading anything, so pages, scripts, fetches and media all carry it) or as
//    `_ft` in the request target ("GET /health?_ft=<secret> HTTP/1.1", the
//    app's own native requests). Anything else is closed without dialing:
//    another app can neither use the tunnel nor spend the Mac's pairing attempts.
//  * A port is never bound twice. iOS can reclaim a suspended app's listening
//    socket and hand the port to another app, so after a possible suspension
//    (`markStale()` on foreground, or a gap in the heartbeat) the next
//    `endpoint()` binds a fresh ephemeral port with a fresh secret. The app asks
//    for the endpoint when it comes back and reloads the web view on the new one.
//    No SO_REUSEADDR: the port is never shared with another socket either.
//  * Connections are capped: `maxPending` may wait for their first request
//    line (the oldest is dropped first, so another app cannot crowd out Aula's
//    own), `maxConnections` in all; a pending one has `authTimeout` to identify
//    itself, and an idle one is closed after `idleTimeout`.
//
// This file deliberately depends only on Foundation + Network so the piping
// logic can be exercised on macOS without TailscaleKit (see _verify/).
//
// Threading: every LoopbackForwarder and every PipedConnection confines its
// mutable state to its own serial DispatchQueue, which is also the queue
// all Network.framework and dispatch-source callbacks are delivered on.

import Foundation
import Network
import os

/// Opens a byte-stream connection to `host:port` and returns a connected
/// stream-socket file descriptor; the caller takes ownership of it.
/// May block (it is always invoked on a dedicated background thread).
typealias StreamDialer = @Sendable (_ host: String, _ port: UInt16) throws -> Int32

enum ForwarderError: Error, LocalizedError {
    case listenFailed(String)
    case stopped

    var errorDescription: String? {
        switch self {
        case .listenFailed(let why): return "could not listen on 127.0.0.1: \(why)"
        case .stopped: return "forwarder stopped"
        }
    }
}

/// Knobs of the forwarder's defenses (tests shorten the timeouts).
struct ForwarderLimits: Sendable {
    /// Connections that have not sent their first request line yet.
    var maxPending = 16
    /// Every open connection, pending or piped.
    var maxConnections = 80
    /// Seconds a new connection has to send its first request line.
    var authTimeout: TimeInterval = 10
    /// Seconds without a byte in either direction before a piped connection is closed.
    var idleTimeout: TimeInterval = 300
    /// Seconds an old listener keeps accepting after a rotation (requests already given its port).
    var retireGrace: TimeInterval = 3
    /// A heartbeat gap this long means the app was suspended: the port may be gone.
    var suspendGap: TimeInterval = 5
    /// Heartbeat period.
    var heartbeat: TimeInterval = 1

    static let standard = ForwarderLimits()
}

/// The tunnel check on the first bytes of a connection: its first HTTP request
/// (the request line, and the headers when the secret travels as a cookie).
enum TunnelGate {
    static let maxHead = 16 * 1024
    static let parameter = "_ft"
    static let cookie = "aula_gate"

    enum Verdict: Equatable { case allow, deny, needMore }

    static func verdict(_ head: Data, secret: String) -> Verdict {
        guard let nl = head.firstIndex(of: 0x0A) else {
            return head.count >= maxHead ? .deny : .needMore
        }
        var lineBytes = head[head.startIndex..<nl]
        if lineBytes.last == 0x0D { lineBytes = lineBytes.dropLast() }
        let line = String(decoding: lineBytes, as: UTF8.self)
        let parts = line.split(separator: " ", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[2].hasPrefix("HTTP/") else { return .deny }
        if let value = secretParameter(in: parts[1]) {
            return constantTimeEqual(value, secret) ? .allow : .deny
        }
        // No parameter: the web view sends the secret as a cookie, so the whole header block is needed.
        let rest = head[head.index(after: nl)...]
        guard let end = headerEnd(rest) else {
            return head.count >= maxHead ? .deny : .needMore
        }
        guard let value = secretCookie(in: rest[rest.startIndex..<end]) else { return .deny }
        return constantTimeEqual(value, secret) ? .allow : .deny
    }

    /// Where the header block ends (the index of the empty line's line feed), if it is complete.
    static func headerEnd(_ headers: Data) -> Data.Index? {
        var lineStart = headers.startIndex
        var i = headers.startIndex
        while i < headers.endIndex {
            if headers[i] == 0x0A {
                let len = i - lineStart
                if len == 0 || (len == 1 && headers[lineStart] == 0x0D) { return i }
                lineStart = i + 1
            }
            i += 1
        }
        return nil
    }

    /// The `aula_gate` value of the request's Cookie header(s), if any.
    static func secretCookie(in headers: Data) -> Substring? {
        let text = String(decoding: headers, as: UTF8.self)
        // ("\r\n" is a single Character in Swift: split on any newline, not on "\n")
        for line in text.split(whereSeparator: \.isNewline) {
            guard let colon = line.firstIndex(of: ":"), line[..<colon].lowercased() == "cookie" else { continue }
            for pair in line[line.index(after: colon)...].split(separator: ";") {
                let kv = pair.drop(while: { $0 == " " }).split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
                if kv.count == 2, kv[0] == cookie { return kv[1] }
            }
        }
        return nil
    }

    /// The `_ft` value of a request target ("/path?a=1&_ft=…"), if any.
    static func secretParameter(in target: Substring) -> Substring? {
        guard let q = target.firstIndex(of: "?") else { return nil }
        var query = target[target.index(after: q)...]
        if let hash = query.firstIndex(of: "#") { query = query[..<hash] }
        for pair in query.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            if kv.count == 2, kv[0] == parameter { return kv[1] }
        }
        return nil
    }

    static func constantTimeEqual(_ a: Substring, _ b: String) -> Bool {
        let x = Array(a.utf8), y = Array(b.utf8)
        guard x.count == y.count, !y.isEmpty else { return false }
        var diff: UInt8 = 0
        for i in 0..<x.count { diff |= x[i] ^ y[i] }
        return diff == 0
    }

    /// 32 random bytes as hex (URL-safe as is).
    static func newSecret() -> String {
        var rng = SystemRandomNumberGenerator()
        return (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255, using: &rng)) }.joined()
    }
}

/// Runs blocking dials on dedicated threads. A dial through the tailnet can
/// block for a long time (e.g. peer offline); parking GCD workers or the
/// Swift concurrency pool on it could starve the whole app.
enum DialThreads {
    static let maxConcurrent = 64
    private static let inFlight = OSAllocatedUnfairLock(initialState: 0)

    /// Returns false (and does not run `work`) if too many dials are pending.
    static func run(_ work: @escaping @Sendable () -> Void) -> Bool {
        let admitted = inFlight.withLock { n -> Bool in
            guard n < maxConcurrent else { return false }
            n += 1
            return true
        }
        guard admitted else { return false }
        let t = Thread {
            work()
            inFlight.withLock { $0 -= 1 }
        }
        t.name = "aula.tailscale.dial"
        t.qualityOfService = .userInitiated
        t.start()
        return true
    }
}

final class LoopbackForwarder: @unchecked Sendable {
    let remoteHost: String
    let remotePort: UInt16

    private let dial: StreamDialer
    private let log: Logger
    private let onFatal: @Sendable (String) -> Void
    private let queue: DispatchQueue
    private let limits: ForwarderLimits

    /// Per-connection serial queues target this, so connections run in parallel.
    private static let connectionTarget = DispatchQueue(label: "aula.tailscale.conns", qos: .userInitiated, attributes: .concurrent)

    /// One bound listener and the secret its connections must present.
    /// Confined to the forwarder's queue.
    private final class Slot: @unchecked Sendable {
        let listener: NWListener
        let secret: String
        var port: UInt16 = 0
        var completion: ((Result<UInt16, Error>) -> Void)?

        init(listener: NWListener, secret: String) {
            self.listener = listener
            self.secret = secret
        }
    }

    // --- state confined to `queue` ---
    private var current: Slot?
    private var starting: Slot?
    private var retiring: [Slot] = []
    private var waiters: [(Result<(port: UInt16, secret: String), Error>) -> Void] = []
    private var stale = false
    private var lastBeat = ContinuousClock.now
    private var heartbeat: DispatchSourceTimer?
    private var connections: [Int: PipedConnection] = [:]
    /// Connections still waiting for their first request line, oldest first.
    private var pending: [Int] = []
    private var nextConnectionID = 0
    private var stopped = false
    private var bindAttempts = 0

    /// - Parameters:
    ///   - onFatal: called if no listener can be created after a few tries.
    init(remoteHost: String,
         remotePort: UInt16,
         dial: @escaping StreamDialer,
         limits: ForwarderLimits = .standard,
         onFatal: @escaping @Sendable (String) -> Void = { _ in }) {
        self.remoteHost = remoteHost
        self.remotePort = remotePort
        self.dial = dial
        self.limits = limits
        self.onFatal = onFatal
        self.log = Logger(subsystem: "aula.tailscale", category: "forwarder")
        self.queue = DispatchQueue(label: "aula.tailscale.forwarder.\(remoteHost):\(remotePort)", qos: .userInitiated)
        queue.async { self.startHeartbeat() }
    }

    /// Starts listening on 127.0.0.1 and returns the chosen local port. A
    /// non-zero `port` is only honoured here (tests); rotations always take a
    /// fresh ephemeral one.
    func start(port requested: UInt16 = 0) async throws -> UInt16 {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<UInt16, Error>) in
            queue.async {
                guard !self.stopped else {
                    cont.resume(throwing: ForwarderError.stopped)
                    return
                }
                self.waiters.append { cont.resume(with: $0.map { $0.port }) }
                if self.starting == nil { self.rotate(requestedPort: requested) }
            }
        }
    }

    /// The port and secret to use right now. Binds a fresh port (and secret)
    /// first when the current one may have been lost: never started, failed,
    /// or the app may have been suspended since it was bound.
    func endpoint() async throws -> (port: UInt16, secret: String) {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<(port: UInt16, secret: String), Error>) in
            queue.async {
                guard !self.stopped else {
                    cont.resume(throwing: ForwarderError.stopped)
                    return
                }
                self.beat()
                if !self.stale, let slot = self.current, slot.port != 0, case .ready = slot.listener.state {
                    cont.resume(returning: (slot.port, slot.secret))
                    return
                }
                self.waiters.append { cont.resume(with: $0) }
                if self.starting == nil { self.rotate() }
            }
        }
    }

    /// The app may have been suspended (it is coming back to the foreground):
    /// the next `endpoint()` gets a fresh port.
    func markStale() {
        queue.async { self.stale = true }
    }

    /// The local port (0 until started).
    var localPort: UInt16 { queue.sync { current?.port ?? 0 } }

    var isListening: Bool {
        queue.sync {
            guard !stopped else { return false }
            return current != nil || starting != nil
        }
    }

    var activeConnections: Int { queue.sync { connections.count } }

    /// Stops listening and closes every forwarded connection.
    func stop() {
        queue.sync {
            guard !stopped else { return }
            stopped = true
            heartbeat?.cancel()
            heartbeat = nil
            for slot in [current, starting].compactMap({ $0 }) + retiring { slot.listener.cancel() }
            current = nil
            starting = nil
            retiring.removeAll()
            let conns = Array(connections.values)
            connections.removeAll()
            pending.removeAll()
            for c in conns { c.closeAsync() }
            let ws = waiters
            waiters.removeAll()
            for w in ws { w(.failure(ForwarderError.stopped)) }
        }
    }

    // MARK: - Heartbeat (on queue)

    private func startHeartbeat() {
        guard !stopped, heartbeat == nil else { return }
        let t = DispatchSource.makeTimerSource(queue: queue)
        let period = DispatchTimeInterval.milliseconds(Int(limits.heartbeat * 1000))
        t.schedule(deadline: .now() + period, repeating: period, leeway: .milliseconds(250))
        t.setEventHandler { [weak self] in self?.beat() }
        heartbeat = t
        t.activate()
    }

    /// While the app runs the timer fires every `heartbeat`; a longer gap means
    /// the process was suspended and iOS may have reclaimed the port.
    private func beat() {
        let now = ContinuousClock.now
        if now - lastBeat > .milliseconds(Int(limits.suspendGap * 1000)) {
            stale = true
        }
        lastBeat = now
    }

    // MARK: - Listener (on queue)

    /// Retires the current listener (it keeps accepting for a short grace)
    /// and binds a new one on a fresh port with a fresh secret.
    private func rotate(requestedPort: UInt16 = 0) {
        stale = false
        if let old = current {
            current = nil
            retire(old)
        }
        bindAttempts = 0
        bind(requestedPort: requestedPort)
    }

    private func retire(_ slot: Slot) {
        retiring.append(slot)
        queue.asyncAfter(deadline: .now() + limits.retireGrace) { [weak self] in
            slot.listener.cancel()
            self?.retiring.removeAll { $0 === slot }
        }
    }

    private func bind(requestedPort: UInt16 = 0) {
        guard !stopped, starting == nil else { return }
        bindAttempts += 1
        let attempt = bindAttempts
        startListener(port: requestedPort) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let port):
                self.log.info("listening on 127.0.0.1:\(port, privacy: .public)")
                let secret = self.current?.secret ?? ""
                let ws = self.waiters
                self.waiters.removeAll()
                for w in ws { w(.success((port, secret))) }
            case .failure(let err):
                if attempt < 5 && !self.stopped {
                    self.queue.asyncAfter(deadline: .now() + .milliseconds(300 * attempt)) { self.bind() }
                    return
                }
                self.log.error("giving up listening on 127.0.0.1: \(err.localizedDescription, privacy: .public)")
                let ws = self.waiters
                self.waiters.removeAll()
                for w in ws { w(.failure(err)) }
                if !self.stopped {
                    self.onFatal("loopback forwarder for \(self.remoteHost):\(self.remotePort) stopped: \(err.localizedDescription)")
                }
            }
        }
    }

    private func startListener(port requested: UInt16, completion: @escaping (Result<UInt16, Error>) -> Void) {
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        let params = NWParameters(tls: nil, tcp: tcp)
        params.requiredInterfaceType = .loopback
        // No allowLocalEndpointReuse: the port is never shared with another
        // socket, and a port this app lost is never taken back.
        let nwPort: NWEndpoint.Port = requested == 0 ? .any : (NWEndpoint.Port(rawValue: requested) ?? .any)
        params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: nwPort)

        let l: NWListener
        do {
            l = try NWListener(using: params)
        } catch {
            completion(.failure(ForwarderError.listenFailed("\(error)")))
            return
        }
        let slot = Slot(listener: l, secret: TunnelGate.newSecret())
        slot.completion = completion
        starting = slot
        l.stateUpdateHandler = { [weak self, weak slot] state in
            guard let self, let slot else { return }
            self.listenerStateChanged(slot, state)
        }
        l.newConnectionHandler = { [weak self, weak slot] conn in
            guard let self, let slot else {
                conn.cancel()
                return
            }
            self.accept(conn, on: slot)
        }
        l.start(queue: queue)
    }

    private func listenerStateChanged(_ slot: Slot, _ state: NWListener.State) {
        switch state {
        case .ready:
            guard slot === starting else { return }
            slot.port = slot.listener.port?.rawValue ?? 0
            starting = nil
            current = slot
            let c = slot.completion
            slot.completion = nil
            c?(.success(slot.port))
        case .failed(let err), .waiting(let err):
            slot.listener.cancel()
            if slot === starting {
                starting = nil
                let c = slot.completion
                slot.completion = nil
                c?(.failure(ForwarderError.listenFailed("\(err)")))
            } else if slot === current {
                // Lost (e.g. reclaimed by iOS): a fresh port now, never this one again.
                current = nil
                log.error("listener on 127.0.0.1:\(slot.port, privacy: .public) failed: \(String(describing: err), privacy: .public)")
                if !stopped && starting == nil { rotate() }
            }
        default:
            break
        }
    }

    private func accept(_ conn: NWConnection, on slot: Slot) {
        guard !stopped, slot === current || retiring.contains(where: { $0 === slot }) else {
            conn.cancel()
            return
        }
        // Waiting room full: the oldest unidentified connection makes room.
        if pending.count >= limits.maxPending, let oldest = pending.first {
            pending.removeFirst()
            connections.removeValue(forKey: oldest)?.closeAsync()
        }
        if connections.count >= limits.maxConnections {
            if let oldest = pending.first {
                pending.removeFirst()
                connections.removeValue(forKey: oldest)?.closeAsync()
            } else {
                log.error("too many connections; refusing a new one")
                conn.cancel()
                return
            }
        }
        let id = nextConnectionID
        nextConnectionID += 1
        let pc = PipedConnection(
            id: id,
            connection: conn,
            host: remoteHost,
            port: remotePort,
            secret: slot.secret,
            limits: limits,
            dial: dial,
            queue: DispatchQueue(label: "aula.tailscale.conn.\(id)", target: Self.connectionTarget),
            log: log,
            onAuthorized: { [weak self] id in
                guard let self else { return }
                self.queue.async { self.pending.removeAll { $0 == id } }
            },
            onClose: { [weak self] id in
                guard let self else { return }
                self.queue.async {
                    self.connections[id] = nil
                    self.pending.removeAll { $0 == id }
                }
            })
        connections[id] = pc
        pending.append(id)
        pc.start()
    }
}

/// One accepted loopback connection piped to one dialed remote socket.
///
/// Before anything is dialed, the connection must identify itself: its first
/// request line has to carry the listener's secret (see TunnelGate). Those
/// first bytes are then sent to the remote ahead of everything else.
///
/// Data flow (each direction has at most one chunk in flight, so a slow
/// reader on either side applies backpressure to the other):
///
///   local --NWConnection.receive--> pending --write(fd)--> remote
///   remote --DispatchSourceRead/read(fd)--> NWConnection.send --> local
///
/// Half-close: a FIN from the local client becomes shutdown(fd, SHUT_WR);
/// EOF from the remote becomes a FIN (final message) to the local client.
/// The connection is torn down once both directions finished, or on any
/// error.
final class PipedConnection: @unchecked Sendable {
    static let chunkSize = 64 * 1024

    private let id: Int
    private let conn: NWConnection
    private let host: String
    private let port: UInt16
    private let secret: String
    private let limits: ForwarderLimits
    private let dial: StreamDialer
    private let queue: DispatchQueue
    private let log: Logger
    private let onAuthorized: @Sendable (Int) -> Void
    private let onClose: @Sendable (Int) -> Void

    // --- state confined to `queue` ---
    private var head = Data()
    private var authorized = false
    private var fd: Int32 = -1
    private var readSource: DispatchSourceRead?
    private var readSuspended = false
    private var writeSource: DispatchSourceWrite?
    private var idleTimer: DispatchSourceTimer?
    private var lastActivity = ContinuousClock.now
    private var liveSources = 0
    private var closeFDWhenSourcesGone = false
    private var pending = Data()
    private var pendingOffset = 0
    private var localEOF = false            // local client sent FIN
    private var remoteShutdownSent = false  // we did shutdown(fd, SHUT_WR)
    private var localFinSent = false        // we sent FIN to the local client
    private var closed = false
    private let buffer: UnsafeMutableRawBufferPointer

    init(id: Int, connection: NWConnection, host: String, port: UInt16,
         secret: String, limits: ForwarderLimits,
         dial: @escaping StreamDialer, queue: DispatchQueue,
         log: Logger,
         onAuthorized: @escaping @Sendable (Int) -> Void,
         onClose: @escaping @Sendable (Int) -> Void) {
        self.id = id
        self.conn = connection
        self.host = host
        self.port = port
        self.secret = secret
        self.limits = limits
        self.dial = dial
        self.queue = queue
        self.log = log
        self.onAuthorized = onAuthorized
        self.onClose = onClose
        self.buffer = UnsafeMutableRawBufferPointer.allocate(byteCount: Self.chunkSize, alignment: 16)
    }

    deinit {
        if fd >= 0 { Darwin.close(fd) }
        buffer.deallocate()
    }

    func start() {
        // Callbacks are delivered on `queue`, so the handler may touch state.
        conn.stateUpdateHandler = { [weak self] state in self?.connectionStateChanged(state) }
        conn.start(queue: queue)
        queue.asyncAfter(deadline: .now() + limits.authTimeout) { [weak self] in
            guard let self, !self.authorized, !self.closed else { return }
            self.log.debug("conn \(self.id): no request line in time")
            self.close()
        }
        queue.async { [weak self] in self?.receiveHead() }
    }

    func closeAsync() {
        queue.async { self.close() }
    }

    // MARK: - on queue

    private func connectionStateChanged(_ state: NWConnection.State) {
        switch state {
        case .failed(let err), .waiting(let err):
            log.debug("conn \(self.id): local side \(String(describing: err), privacy: .public)")
            close()
        case .cancelled:
            close()
        default:
            break
        }
    }

    /// Reads until the first request can be judged (its line, or its headers), then decides.
    private func receiveHead() {
        guard !closed else { return }
        conn.receive(minimumIncompleteLength: 1, maximumLength: max(1, TunnelGate.maxHead - head.count)) { [self] data, _, isComplete, error in
            guard !closed else { return }
            if let data, !data.isEmpty { head.append(data) }
            switch TunnelGate.verdict(head, secret: secret) {
            case .allow:
                authorized = true
                onAuthorized(id)
                if isComplete { localEOF = true }
                startDial()
            case .deny:
                log.debug("conn \(self.id): refused (no tunnel secret)")
                close()
            case .needMore:
                if isComplete || error != nil {
                    close()
                } else {
                    receiveHead()
                }
            }
        }
    }

    private func startDial() {
        let started = DialThreads.run {
            let result = Result { try self.dial(self.host, self.port) }
            self.queue.async { self.dialFinished(result) }
        }
        if !started {
            log.error("too many pending dials; dropping connection \(self.id)")
            close()
        }
    }

    private func dialFinished(_ result: Result<Int32, Error>) {
        switch result {
        case .failure(let err):
            log.error("dial \(self.host, privacy: .public):\(self.port, privacy: .public) failed: \(err.localizedDescription, privacy: .public)")
            close()
        case .success(let s):
            guard !closed else {
                Darwin.close(s)
                return
            }
            fd = s
            var on: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
            let flags = fcntl(fd, F_GETFL)
            _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)

            let rs = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
            rs.setEventHandler { [self] in readRemote() }
            rs.setCancelHandler { [self] in sourceCancelled() }
            liveSources += 1
            readSource = rs
            rs.activate()
            startIdleTimer()
            // What arrived while identifying the connection goes first.
            pending = head
            pendingOffset = 0
            head = Data()
            flushToRemote()
        }
    }

    private func startIdleTimer() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        let period = DispatchTimeInterval.milliseconds(Int(max(0.05, min(60, limits.idleTimeout / 4)) * 1000))
        t.schedule(deadline: .now() + period, repeating: period, leeway: .milliseconds(500))
        t.setEventHandler { [weak self] in
            guard let self, !self.closed else { return }
            if ContinuousClock.now - self.lastActivity > .milliseconds(Int(self.limits.idleTimeout * 1000)) {
                self.log.debug("conn \(self.id): idle")
                self.close()
            }
        }
        idleTimer = t
        t.activate()
    }

    // local -> remote

    private func receiveLocal() {
        guard !closed, !localEOF else { return }
        conn.receive(minimumIncompleteLength: 1, maximumLength: Self.chunkSize) { [self] data, _, isComplete, error in
            guard !closed else { return }
            if let error {
                log.debug("conn \(self.id): local receive: \(String(describing: error), privacy: .public)")
                close()
                return
            }
            if let data, !data.isEmpty {
                pending = data
                pendingOffset = 0
                lastActivity = .now
            }
            if isComplete {
                localEOF = true
            }
            flushToRemote()
        }
    }

    private func flushToRemote() {
        guard !closed, fd >= 0 else { return }
        while pendingOffset < pending.count {
            let n = pending.withUnsafeBytes { raw in
                Darwin.write(fd, raw.baseAddress! + pendingOffset, raw.count - pendingOffset)
            }
            if n > 0 {
                pendingOffset += n
                continue
            }
            let e = errno
            if n < 0 && e == EINTR { continue }
            if n < 0 && (e == EAGAIN || e == EWOULDBLOCK) {
                armWriteSource()
                return
            }
            log.debug("conn \(self.id): remote write: \(String(cString: strerror(e)), privacy: .public)")
            close()
            return
        }
        pending = Data()
        pendingOffset = 0
        disarmWriteSource()
        if localEOF {
            if !remoteShutdownSent {
                remoteShutdownSent = true
                Darwin.shutdown(fd, SHUT_WR)
            }
            finishIfDone()
        } else {
            receiveLocal()
        }
    }

    private func armWriteSource() {
        guard writeSource == nil else { return }
        let ws = DispatchSource.makeWriteSource(fileDescriptor: fd, queue: queue)
        ws.setEventHandler { [self] in flushToRemote() }
        ws.setCancelHandler { [self] in sourceCancelled() }
        liveSources += 1
        writeSource = ws
        ws.activate()
    }

    private func disarmWriteSource() {
        guard let ws = writeSource else { return }
        writeSource = nil
        ws.cancel()
    }

    // remote -> local

    private func readRemote() {
        guard !closed, fd >= 0, !readSuspended else { return }
        let n = Darwin.read(fd, buffer.baseAddress, buffer.count)
        if n > 0 {
            let data = Data(bytes: buffer.baseAddress!, count: n)
            lastActivity = .now
            suspendRead()
            conn.send(content: data, completion: .contentProcessed { [self] error in
                guard !closed else { return }
                if let error {
                    log.debug("conn \(self.id): local send: \(String(describing: error), privacy: .public)")
                    close()
                    return
                }
                resumeRead()
            })
        } else if n == 0 {
            // Remote finished sending: half-close towards the local client.
            cancelReadSource()
            conn.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [self] error in
                guard !closed else { return }
                localFinSent = true
                if error != nil {
                    close()
                    return
                }
                finishIfDone()
            })
        } else {
            let e = errno
            if e == EAGAIN || e == EWOULDBLOCK || e == EINTR { return }
            log.debug("conn \(self.id): remote read: \(String(cString: strerror(e)), privacy: .public)")
            close()
        }
    }

    private func suspendRead() {
        guard let rs = readSource, !readSuspended else { return }
        readSuspended = true
        rs.suspend()
    }

    private func resumeRead() {
        guard let rs = readSource, readSuspended else { return }
        readSuspended = false
        rs.resume()
    }

    private func cancelReadSource() {
        guard let rs = readSource else { return }
        readSource = nil
        if readSuspended {
            readSuspended = false
            rs.resume() // a suspended source must not be released
        }
        rs.cancel()
    }

    private func sourceCancelled() {
        liveSources -= 1
        if liveSources == 0 && closeFDWhenSourcesGone && fd >= 0 {
            Darwin.close(fd)
            fd = -1
        }
    }

    private func finishIfDone() {
        if remoteShutdownSent && localFinSent {
            close()
        }
    }

    private func close() {
        guard !closed else { return }
        closed = true
        idleTimer?.cancel()
        idleTimer = nil
        cancelReadSource()
        disarmWriteSource()
        // The fd may only be closed after every dispatch source on it is gone.
        closeFDWhenSourcesGone = true
        if liveSources == 0 && fd >= 0 {
            Darwin.close(fd)
            fd = -1
        }
        conn.cancel()
        onClose(id)
    }
}
