import Foundation
import Network

/// One-shot local HTTP listener on `127.0.0.1` that catches Google's OAuth
/// redirect for the sign-in flow. Ported from psymail-mini's
/// `LoopbackAuthServer` (same ephemeral-port + `code` query-item contract):
/// Google Desktop clients only support the loopback redirect method, so we
/// bind an ephemeral port, send the user to the consent page in their
/// browser, and read the `code` from the redirect back to us.
///
/// One deliberate deviation from psymail: `stop()` also fails the pending
/// `waitForCode()` waiter. psymail stops its server only after the code
/// arrives, but sign-in cancel/restart must unblock a waiter that may never
/// get its redirect — otherwise every cancel leaks a suspended task.
final class LoopbackSignInServer: GoogleSignInLoopbackServer, @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.moki.helper.oauth.loopback")
    private var listener: NWListener?
    private var connections: [NWConnection] = []

    private var waiter: CheckedContinuation<String, Error>?
    private var buffered: Result<String, Error>?
    private var stopped = false

    /// Binds an ephemeral loopback port and returns it once listening.
    func start() async throws -> Int {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
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

    /// Suspends until the redirect carrying `code` (or an `error`) arrives,
    /// or `stop()` fails it. A result that arrives before anyone waits is
    /// buffered for the next call. A call after `stop()` fails at once
    /// instead of suspending forever — stop and registration race across
    /// actor/RPC lines, so the loser must error, never hang.
    func waitForCode() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                if self.stopped {
                    continuation.resume(throwing: GoogleSignInError.cancelled)
                } else if let buffered = self.buffered {
                    self.buffered = nil
                    continuation.resume(with: buffered)
                } else {
                    self.waiter = continuation
                }
            }
        }
    }

    func stop() {
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
                waiter.resume(throwing: GoogleSignInError.cancelled)
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
            let errorParam = Self.queryValue(in: request, name: "error")

            let body = code != nil
                ? "<h2>signed in ✓</h2><p>you can close this tab and return to moki.</p>"
                : "<h2>sign-in failed</h2><p>you can close this tab.</p>"
            self.respond(on: connection, html: body)

            if let code {
                self.finish(.success(code))
            } else if let errorParam {
                self.finish(.failure(GoogleSignInError.providerDenied(errorParam)))
            }
            // No code and no error (e.g. a /favicon.ico probe) — ignore and keep waiting.
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

    private func finish(_ result: Result<String, Error>) {
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
        // First line looks like: `GET /?code=...&scope=... HTTP/1.1`
        guard let requestLine = request.split(separator: "\r\n").first else { return nil }
        let fields = requestLine.split(separator: " ")
        guard fields.count >= 2 else { return nil }
        let target = String(fields[1])
        guard let components = URLComponents(string: "http://127.0.0.1\(target)") else { return nil }
        return components.queryItems?.first { $0.name == name }?.value
    }
}
