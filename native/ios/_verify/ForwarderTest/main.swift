// Runtime test for Aula/Tailnet/LoopbackForwarder.swift, run on macOS (ported from Faro).
//
// The tailnet dial is replaced by a fake that returns one end of an
// AF_UNIX socketpair (exactly what libtailscale's tailscale_dial returns)
// with a peer thread on the other end. Exercises: bidirectional piping,
// large payloads/backpressure, half-close in both directions, many
// concurrent connections, dial failure, loopback-only binding, cleanup;
// and the defenses: no dial without the listener's secret in the first
// request (as the web view's cookie or in the request line), the auth deadline, the pending cap, idle timeout, and moving
// to a fresh port and secret after a (simulated) suspension.
//
// Built and run by ../verify.sh:
//   swiftc -swift-version 6 ../Aula/Tailnet/LoopbackForwarder.swift ForwarderTest/main.swift -o forwarder-test

import Darwin
import Foundation
import os

enum PeerMode: Sendable {
    case echo           // echo everything; on EOF shut down write side
    case greetAndClose  // send a greeting, then EOF, then drain
    case refuse         // dial fails
}

struct DialRefused: Error {}

/// Every dial the forwarder makes (it must make none for refused connections).
let dials = OSAllocatedUnfairLock(initialState: 0)

func makeDialer(_ mode: PeerMode) -> StreamDialer {
    return { host, port in
        dials.withLock { $0 += 1 }
        if mode == .refuse { throw DialRefused() }
        var fds: [Int32] = [0, 0]
        guard socketpair(AF_UNIX, SOCK_STREAM, 0, &fds) == 0 else { throw POSIXError(.EIO) }
        let peer = fds[1]
        var on: Int32 = 1
        setsockopt(peer, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
        Thread.detachNewThread {
            var buf = [UInt8](repeating: 0, count: 32 * 1024)
            switch mode {
            case .echo:
                outer: while true {
                    let n = read(peer, &buf, buf.count)
                    if n <= 0 { break }
                    var off = 0
                    while off < n {
                        let w = buf.withUnsafeBytes { write(peer, $0.baseAddress! + off, n - off) }
                        if w <= 0 { break outer }
                        off += w
                    }
                }
                shutdown(peer, SHUT_WR)
                close(peer)
            case .greetAndClose:
                let msg = Array("hello from \(host):\(port)\n".utf8)
                _ = write(peer, msg, msg.count)
                shutdown(peer, SHUT_WR)
                while read(peer, &buf, buf.count) > 0 {}
                close(peer)
            case .refuse:
                close(peer)
            }
        }
        return fds[0]
    }
}

func connectLoopback(_ port: UInt16) -> Int32 {
    let s = socket(AF_INET, SOCK_STREAM, 0)
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    let rc = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.connect(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    precondition(rc == 0, "connect failed: \(String(cString: strerror(errno)))")
    var on: Int32 = 1
    setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
    var tv = timeval(tv_sec: 20, tv_usec: 0)
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    return s
}

func readAll(_ s: Int32) -> (Data, Int32) {
    var out = Data()
    var buf = [UInt8](repeating: 0, count: 64 * 1024)
    while true {
        let n = read(s, &buf, buf.count)
        if n > 0 { out.append(buf, count: n); continue }
        return (out, n == 0 ? 0 : errno)
    }
}

/// Sends payload, half-closes, reads the echo until EOF.
func echoRoundTrip(port: UInt16, payload: Data) -> Bool {
    let s = connectLoopback(port)
    defer { close(s) }
    let writer = Thread {
        payload.withUnsafeBytes { raw in
            var off = 0
            while off < raw.count {
                let w = write(s, raw.baseAddress! + off, min(raw.count - off, 128 * 1024))
                if w <= 0 { break }
                off += w
            }
        }
        shutdown(s, SHUT_WR)
    }
    writer.start()
    let (got, err) = readAll(s)
    return err == 0 && got == payload
}

func randomData(_ n: Int) -> Data {
    var d = Data(count: n)
    d.withUnsafeMutableBytes { arc4random_buf($0.baseAddress!, n) }
    return d
}

/// Runs blocking client I/O on its own thread (not GCD, so 100 blocked
/// clients cannot starve the dispatch pool the forwarder runs on).
func background<T: Sendable>(_ body: @escaping @Sendable () -> T) async -> T {
    await withCheckedContinuation { cont in
        Thread.detachNewThread { cont.resume(returning: body()) }
    }
}

nonisolated(unsafe) var failures = 0
func check(_ ok: Bool, _ name: String) {
    print("\(ok ? "PASS" : "FAIL")  \(name)")
    if !ok { failures += 1 }
}

func waitUntil(_ timeout: TimeInterval, _ cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if cond() { return true }
        usleep(20_000)
    }
    return cond()
}

func lsofListen(_ port: UInt16) -> String {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    p.arguments = ["-nP", "-a", "-p", "\(getpid())", "-iTCP:\(port)", "-sTCP:LISTEN"]
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = FileHandle.nullDevice
    try? p.run()
    p.waitUntilExit()
    return String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
}

signal(SIGPIPE, SIG_IGN)

/// The first request line the WebView sends, with the tunnel secret.
func head(_ secret: String, path: String = "/api/state") -> Data {
    Data("GET \(path)?_ft=\(secret) HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".utf8)
}

/// Connects, sends `bytes` (no half-close), and returns whether the forwarder
/// closed the connection on its own within `timeout` seconds.
func closedByForwarder(port: UInt16, bytes: Data, timeout: Int = 5) -> Bool {
    let s = connectLoopback(port)
    defer { close(s) }
    var tv = timeval(tv_sec: timeout, tv_usec: 0)
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    if !bytes.isEmpty {
        _ = bytes.withUnsafeBytes { write(s, $0.baseAddress!, bytes.count) }
    }
    var buf = [UInt8](repeating: 0, count: 1024)
    while true {
        let n = read(s, &buf, buf.count)
        if n == 0 { return true }                 // EOF: closed
        if n < 0 { return errno == ECONNRESET }   // reset: closed; timeout: not closed
    }
}

func canConnect(_ port: UInt16) -> Bool {
    let s = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(s) }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    let rc = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
    }
    return rc == 0
}

// 1. echo forwarder (roomy limits: this part is about piping at scale)
var roomy = ForwarderLimits()
roomy.maxPending = 128
roomy.maxConnections = 128
let echoFwd = LoopbackForwarder(remoteHost: "aula-mac", remotePort: 80, dial: makeDialer(.echo), limits: roomy)
let ep = try await echoFwd.endpoint()
let port = ep.port
check(port > 0 && ep.secret.count == 64, "listener started on 127.0.0.1:\(port) with a 32-byte secret")

let listen = lsofListen(port)
check(listen.contains("127.0.0.1:\(port)") && !listen.contains("*:\(port)"), "bound to loopback only")

let again = try await echoFwd.endpoint()
check(again.port == port && again.secret == ep.secret, "endpoint() is stable while nothing happened")

let small = head(ep.secret)
check(await background { echoRoundTrip(port: port, payload: small) }, "small request echoed, half-close propagated both ways")

let big = head(ep.secret) + randomData(8 * 1024 * 1024)
let t0 = Date()
check(await background { echoRoundTrip(port: port, payload: big) },
      "8 MiB echoed intact (\(String(format: "%.2f", Date().timeIntervalSince(t0)))s)")

let concurrent = 100
let t1 = Date()
let secret = ep.secret
let results = await withTaskGroup(of: Bool.self) { group in
    for _ in 0..<concurrent {
        group.addTask { await background { echoRoundTrip(port: port, payload: head(secret) + randomData(256 * 1024)) } }
    }
    var ok = 0
    for await r in group where r { ok += 1 }
    return ok
}
check(results == concurrent, "\(results)/\(concurrent) concurrent 256 KiB connections echoed (\(String(format: "%.2f", Date().timeIntervalSince(t1)))s)")

// Keep-alive style: the secret only in the first request; no half-close.
let keepAlive = await background { () -> Bool in
    let s = connectLoopback(port)
    defer { close(s) }
    for i in 0..<20 {
        let msg = Array((i == 0 ? head(secret) : Data("ping \(i)\n".utf8)))
        guard write(s, msg, msg.count) == msg.count else { return false }
        var buf = [UInt8](repeating: 0, count: msg.count)
        var got = 0
        while got < msg.count {
            let n = buf.withUnsafeMutableBytes { read(s, $0.baseAddress! + got, msg.count - got) }
            if n <= 0 { return false }
            got += n
        }
        if buf != msg { return false }
    }
    return true
}
check(keepAlive, "20 request/response round trips on one connection")

check(waitUntil(3) { echoFwd.activeConnections == 0 }, "all piped connections cleaned up (active=\(echoFwd.activeConnections))")

// 2. who may use the tunnel: the secret in the first request line, nothing else
let before = dials.withLock { $0 }
check(await background { closedByForwarder(port: port, bytes: Data("GET /api/state HTTP/1.1\r\nHost: x\r\n\r\n".utf8)) }, "no secret: closed")
check(await background { closedByForwarder(port: port, bytes: head(String(repeating: "0", count: 64))) }, "wrong secret: closed")
check(await background { closedByForwarder(port: port, bytes: Data("GET /api/state HTTP/1.1\r\nX-Ft: \(secret)\r\n\r\n".utf8)) }, "secret in a header, not the request line: closed")
check(await background { closedByForwarder(port: port, bytes: Data("\(secret)\r\n".utf8)) }, "not HTTP: closed")

// 2b. the web view cannot add a parameter to every URL: it carries the secret as the cookie the app set
func cookieHead(_ value: String, name: String = "aula_gate", before: String = "") -> Data {
    Data("GET /assets/app.js HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: */*\r\nCookie: \(before)\(name)=\(value); aula_device=abc\r\n\r\n".utf8)
}
check(await background { echoRoundTrip(port: port, payload: cookieHead(secret)) }, "secret as the aula_gate cookie: goes through")
check(await background { echoRoundTrip(port: port, payload: cookieHead(secret, before: "theme=dark; ") + randomData(64 * 1024)) }, "…among other cookies, with a body behind")
check(await background { closedByForwarder(port: port, bytes: cookieHead(String(repeating: "0", count: 64))) }, "wrong cookie value: closed")
check(await background { closedByForwarder(port: port, bytes: cookieHead(secret, name: "xaula_gate")) }, "cookie with another name: closed")
check(await background { closedByForwarder(port: port, bytes: Data("POST /rpc HTTP/1.1\r\nHost: x\r\n\r\nCookie: aula_gate=\(secret)\r\n\r\n".utf8)) }, "cookie in the body, not the headers: closed")
check(await background { () -> Bool in
    // the request arrives in pieces: the line first, the headers later
    let s = connectLoopback(port)
    defer { close(s) }
    let all = Array(cookieHead(secret))
    _ = write(s, all, 20)
    usleep(150_000)
    _ = all[20...].withUnsafeBytes { write(s, $0.baseAddress!, $0.count) }
    shutdown(s, SHUT_WR)
    let (got, err) = readAll(s)
    return err == 0 && got == Data(all)
}, "headers split across packets: waits for them, then goes through")
let dialsBeforeFlood = dials.withLock { $0 }
check(await background { closedByForwarder(port: port, bytes: Data("GET / HTTP/1.1\r\n".utf8) + Data(repeating: 0x41, count: 20 * 1024)) } && dials.withLock({ $0 }) == dialsBeforeFlood, "headers that never end: closed without dialing")
check(await background { closedByForwarder(port: port, bytes: Data(repeating: 0x41, count: TunnelGate.maxHead + 1000)) }, "no line end within the limit: closed")
check(dials.withLock { $0 } == before + 3, "only the three with the right cookie were dialed through the tailnet")

// 3. remote closes first: client must see data then EOF while its write side is still open
let greetFwd = LoopbackForwarder(remoteHost: "aula-mac", remotePort: 8080, dial: makeDialer(.greetAndClose))
let gep = try await greetFwd.endpoint()
let greeting = await background { () -> (Data, Int32) in
    let s = connectLoopback(gep.port)
    defer { close(s) }
    let h = head(gep.secret)
    _ = h.withUnsafeBytes { write(s, $0.baseAddress!, h.count) }
    let r = readAll(s)
    // Our write side is still open: the forwarder must accept it without error.
    let msg = Array("bye".utf8)
    _ = write(s, msg, msg.count)
    return r
}
check(greeting.1 == 0 && String(decoding: greeting.0, as: UTF8.self) == "hello from aula-mac:8080\n",
      "remote EOF delivered as FIN to local client")
check(waitUntil(3) { greetFwd.activeConnections == 0 }, "greet connections cleaned up")

// 4. dial failure: local client gets EOF/reset quickly
let refuseFwd = LoopbackForwarder(remoteHost: "nowhere", remotePort: 1, dial: makeDialer(.refuse))
let rep = try await refuseFwd.endpoint()
let t2 = Date()
check(await background { closedByForwarder(port: rep.port, bytes: head(rep.secret)) } && Date().timeIntervalSince(t2) < 3, "dial failure closes the local connection")

// 5. deadlines and caps
var tight = ForwarderLimits()
tight.authTimeout = 0.3
tight.maxPending = 4
tight.idleTimeout = 0.4
tight.retireGrace = 0.3
let tightFwd = LoopbackForwarder(remoteHost: "aula-mac", remotePort: 80, dial: makeDialer(.echo), limits: tight)
let tep = try await tightFwd.endpoint()
let t3 = Date()
check(await background { closedByForwarder(port: tep.port, bytes: Data()) } && Date().timeIntervalSince(t3) < 2, "a connection that says nothing is closed after the auth deadline")

// Five silent connections against a waiting room of four: the oldest goes first, and Aula's own still gets in.
let silent = (0..<5).map { _ in connectLoopback(tep.port) }
usleep(100_000)
var eof = [UInt8](repeating: 0, count: 1)
var tv = timeval(tv_sec: 0, tv_usec: 100_000)
setsockopt(silent[0], SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
check(read(silent[0], &eof, 1) == 0, "pending cap: the oldest unidentified connection is dropped")
let tsecret = tep.secret
check(await background { echoRoundTrip(port: tep.port, payload: head(tsecret)) }, "…and an identified one still goes through")
silent.forEach { close($0) }

// Idle: identified, then quiet.
let idle = await background { () -> Bool in
    let s = connectLoopback(tep.port)
    defer { close(s) }
    let h = head(tsecret)
    _ = h.withUnsafeBytes { write(s, $0.baseAddress!, h.count) }
    var buf = [UInt8](repeating: 0, count: 4096)
    var got = 0
    while got < h.count {
        let n = read(s, &buf, buf.count)
        if n <= 0 { return false }
        got += n
    }
    let start = Date()
    let n = read(s, &buf, buf.count) // nothing more: the forwarder closes it
    return n == 0 && Date().timeIntervalSince(start) < 3
}
check(idle, "an idle connection is closed")

// 6. after a possible suspension: a fresh port and a fresh secret, never the old ones
tightFwd.markStale()
let moved = try await tightFwd.endpoint()
check(moved.port != tep.port && moved.secret != tep.secret, "markStale(): endpoint() moves to a new port \(moved.port) with a new secret")
check(await background { closedByForwarder(port: moved.port, bytes: head(tsecret)) }, "the old secret does not open the new port")
let msecret = moved.secret
check(await background { echoRoundTrip(port: moved.port, payload: head(msecret)) }, "the new pair works")
let oldPort = tep.port
check(waitUntil(3) { !canConnect(oldPort) }, "the old port stops listening after the grace period")

// A real suspension (SIGSTOP, then SIGCONT from a helper): the heartbeat sees the gap.
var hb = ForwarderLimits()
hb.heartbeat = 0.1
hb.suspendGap = 0.5
let hbFwd = LoopbackForwarder(remoteHost: "aula-mac", remotePort: 80, dial: makeDialer(.echo), limits: hb)
let hbBefore = try await hbFwd.endpoint()
usleep(300_000)
check((try await hbFwd.endpoint()).port == hbBefore.port, "no gap: same port")
let waker = Process()
waker.executableURL = URL(fileURLWithPath: "/bin/sh")
waker.arguments = ["-c", "sleep 1.2; kill -CONT \(getpid())"]
try waker.run()
kill(getpid(), SIGSTOP)
waker.waitUntilExit()
let hbAfter = try await hbFwd.endpoint()
check(hbAfter.port != hbBefore.port && hbAfter.secret != hbBefore.secret, "after being stopped 1.2 s: a fresh port and secret")

// 7. stop() refuses new connections
echoFwd.stop()
check(!canConnect(port), "stopped forwarder refuses connections")
do {
    _ = try await echoFwd.endpoint()
    check(false, "endpoint() after stop() fails")
} catch {
    check(true, "endpoint() after stop() fails")
}
greetFwd.stop()
refuseFwd.stop()
tightFwd.stop()
hbFwd.stop()

print(failures == 0 ? "ALL PASSED" : "\(failures) FAILED")
exit(failures == 0 ? 0 : 1)
