import Foundation
import Network

// MARK: - Shared OAuth loopback callback server
//
// One-shot local HTTP listener on `127.0.0.1` that catches an OAuth
// provider's redirect for a sign-in flow. `nil` port means an ephemeral
// port; a non-nil port binds that fixed `127.0.0.1` port (useful for test
// stubs). The waiter receives the `code` plus the `state` for CSRF
// validation, or the provider's `error` short code — never anything secret
// beyond the single-use code itself, and nothing is ever logged.
//
// `stop()` also fails the pending `waitForCallback()` waiter: sign-in
// cancel/restart must unblock a waiter that may never get its redirect —
// otherwise every cancel leaks a suspended task.

/// One loopback redirect: the single-use `code` plus the echoed `state`
/// for CSRF validation, or the provider's `error` short code on denial.
/// All fields optional so favicon probes (neither) can be told apart from
/// real callbacks — the server never delivers those.
public struct OAuthLoopbackCallback: Sendable, Equatable {
    public var code: String?
    public var state: String?
    public var providerError: String?

    public init(code: String? = nil, state: String? = nil, providerError: String? = nil) {
        self.code = code
        self.state = state
        self.providerError = providerError
    }
}

/// One-shot loopback listener contract. Production uses
/// `OAuthLoopbackServer`; tests inject a stub. `start(port:)` with
/// `nil` binds an ephemeral port and returns it; a non-nil port binds
/// that fixed `127.0.0.1` port and returns it.
public protocol OAuthLoopbackServing: Sendable {
    func start(port: Int?) async throws -> Int
    func waitForCallback() async throws -> OAuthLoopbackCallback
    func stop()
}

/// Internal loopback plumbing errors. Never surfaced verbatim — services
/// map these to one-line poll messages with no secret material.
public enum OAuthLoopbackError: Error, Sendable, Equatable {
    case cancelled
}

/// Production loopback server. See the module header for the contract.
public final class OAuthLoopbackServer: OAuthLoopbackServing, @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.moki.helper.oauth.loopback")
    private var listener: NWListener?
    private var connections: [NWConnection] = []

    private var waiter: CheckedContinuation<OAuthLoopbackCallback, Error>?
    private var buffered: Result<OAuthLoopbackCallback, Error>?
    private var stopped = false

    public init() {}

    /// Binds the loopback port and returns it once listening. `nil`
    /// binds an ephemeral port; non-nil binds that fixed `127.0.0.1`
    /// port (the registered Notion redirect URI).
    public func start(port: Int? = nil) async throws -> Int {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        if let port {
            params.requiredLocalEndpoint = .hostPort(
                host: "127.0.0.1", port: NWEndpoint.Port(rawValue: UInt16(port))!)
        } else {
            params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        }
        let listener = try NWListener(using: params)
        self.listener = listener
        listener.newConnectionHandler = { [weak self] in self?.handle($0) }

        return try await withCheckedThrowingContinuation { continuation in
            // Clearing the handler after the first transition prevents a double
            // resume and breaks the listener→handler→listener retain cycle.
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    listener.stateUpdateHandler = nil
                    continuation.resume(returning: Int(listener.port?.rawValue ?? 0))
                case .failed(let error):
                    listener.stateUpdateHandler = nil
                    continuation.resume(throwing: error)
                default:
                    break
                }
            }
            listener.start(queue: queue)
        }
    }

    /// Suspends until the redirect carrying `code`/`state` (or an `error`)
    /// arrives, or `stop()` fails it. A result that arrives before anyone
    /// waits is buffered for the next call. A call after `stop()` fails at
    /// once instead of suspending forever — stop and registration race
    /// across actor/RPC lines, so the loser must error, never hang.
    public func waitForCallback() async throws -> OAuthLoopbackCallback {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                if self.stopped {
                    continuation.resume(throwing: OAuthLoopbackError.cancelled)
                } else if let buffered = self.buffered {
                    self.buffered = nil
                    continuation.resume(with: buffered)
                } else {
                    self.waiter = continuation
                }
            }
        }
    }

    public func stop() {
        queue.async {
            // Latch: a waiter registering after this fails instead of
            // hanging, and any redirect buffered before the stop is dropped —
            // it belongs to a dead attempt and must never surface.
            self.stopped = true
            self.buffered = nil
            self.listener?.cancel()
            self.connections.forEach { $0.cancel() }
            self.connections.removeAll()
            // Unblock a waiter whose redirect will now never arrive (cancel /
            // restart / expiry). Without this the completion task suspends
            // forever.
            if let waiter = self.waiter {
                self.waiter = nil
                waiter.resume(throwing: OAuthLoopbackError.cancelled)
            }
        }
    }

    // MARK: - Connection handling

    private func handle(_ connection: NWConnection) {
        connections.append(connection)
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, _ in
            guard let self, let data, let request = String(data: data, encoding: .utf8) else { return }

            let code = Self.queryValue(in: request, name: "code")
            let state = Self.queryValue(in: request, name: "state")
            let errorParam = Self.queryValue(in: request, name: "error")

            guard code != nil || errorParam != nil else {
                // No code and no error (e.g. a /favicon.ico probe) — ignore
                // and keep waiting. Drop the idle connection so probes do
                // not pile up; the waiter is untouched.
                connection.cancel()
                return
            }

            let body =
                code != nil
                ? "<h2>signed in ✓</h2><p>you can close this tab and return to moki.</p>"
                : "<h2>sign-in failed</h2><p>you can close this tab.</p>"
            self.respond(on: connection, html: body)
            self.finish(
                .success(OAuthLoopbackCallback(code: code, state: state, providerError: errorParam)))
        }
    }

    private func respond(on connection: NWConnection, html: String) {
        let response = """
            HTTP/1.1 200 OK\r
            Content-Type: text/html; charset=utf-8\r
            Content-Length: \(html.utf8.count)\r
            Connection: close\r
            \r
            \(html)
            """
        connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func finish(_ result: Result<OAuthLoopbackCallback, Error>) {
        // A redirect landing after the stop belongs to a dead attempt:
        // drop it rather than buffering a stale code for the next caller.
        guard !stopped else { return }
        if let waiter {
            self.waiter = nil
            waiter.resume(with: result)
        } else {
            buffered = result
        }
    }

    private static func queryValue(in request: String, name: String) -> String? {
        // First line looks like: `GET /oauth/notion?code=...&state=... HTTP/1.1`
        guard let requestLine = request.split(separator: "\r\n").first else { return nil }
        let fields = requestLine.split(separator: " ")
        guard fields.count >= 2 else { return nil }
        let target = String(fields[1])
        guard let components = URLComponents(string: "http://127.0.0.1\(target)") else { return nil }
        return components.queryItems?.first { $0.name == name }?.value
    }
}
