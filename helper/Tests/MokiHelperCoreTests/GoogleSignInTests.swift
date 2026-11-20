import Foundation
import Testing

@testable import MokiHelperCore

// MARK: - Stubs

/// Routes requests to per-test answers. Lock-guarded like the other suites'
/// stubs; the sign-in suite runs serialized.
private final class SignInStubURLProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler:
        (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    static func setHandler(_ handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)) {
        lock.withLock { self.handler = handler }
    }

    static func clear() {
        lock.withLock { self.handler = nil }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let handler = Self.lock.withLock { Self.handler }
        do {
            guard let handler else { throw URLError(.badServerResponse) }
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private func makeSignInStubSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [SignInStubURLProtocol.self]
    return URLSession(configuration: config)
}

private func signInHTTPResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func signInJSON(_ object: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
}

/// Controllable loopback stand-in: the test delivers the redirect code (or
/// failure) by hand instead of performing real HTTP to 127.0.0.1.
private final class StubLoopbackServer: GoogleSignInLoopbackServer, @unchecked Sendable {
    private let lock = NSLock()
    private var waiter: CheckedContinuation<String, Error>?
    private var delivered: Result<String, Error>?
    private var stopped = false
    private(set) var startCount = 0
    private(set) var stopCount = 0
    let port: Int

    init(port: Int) {
        self.port = port
    }

    func start() async throws -> Int {
        lock.withLock { startCount += 1 }
        return port
    }

    func waitForCode() async throws -> String {
        // One atomic decision under the lock: a call after `stop()` fails
        // at once (never hangs), a buffered redirect is consumed, otherwise
        // the caller parks. Checking all three without the lock lets a
        // `deliver` slip between the buffer check and the registration and
        // park a waiter nobody will ever resume.
        try await withCheckedThrowingContinuation { continuation in
            let terminal: Result<String, Error>? = lock.withLock {
                if stopped {
                    return .failure(GoogleSignInError.cancelled)
                }
                if let delivered {
                    self.delivered = nil
                    return delivered
                }
                waiter = continuation
                return nil
            }
            if let terminal {
                continuation.resume(with: terminal)
            }
        }
    }

    func stop() {
        let pending: CheckedContinuation<String, Error>? = lock.withLock {
            stopCount += 1
            stopped = true
            delivered = nil
            defer { waiter = nil }
            return waiter
        }
        pending?.resume(throwing: GoogleSignInError.cancelled)
    }

    func deliver(code: String) {
        let pending: CheckedContinuation<String, Error>? = lock.withLock {
            guard !stopped else { return nil }
            if let waiter {
                self.waiter = nil
                return waiter
            }
            delivered = .success(code)
            return nil
        }
        pending?.resume(returning: code)
    }

    func deliver(error: Error) {
        let pending: CheckedContinuation<String, Error>? = lock.withLock {
            guard !stopped else { return nil }
            if let waiter {
                self.waiter = nil
                return waiter
            }
            delivered = .failure(error)
            return nil
        }
        if let pending {
            pending.resume(throwing: error)
        }
    }
}

private final class OpenedURLs: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var urls: [URL] = []

    func record(_ url: URL) {
        lock.withLock { urls.append(url) }
    }
}

/// Locked box for values a test mutates from inside `@Sendable` closures
/// (Swift 6 forbids capturing a mutable `var` there).
private final class TestBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    init(_ value: Value) {
        self.value = value
    }

    func read() -> Value {
        lock.withLock { value }
    }

    func write(_ next: Value) {
        lock.withLock { value = next }
    }

    func modify(_ transform: (inout Value) -> Void) {
        lock.withLock { transform(&value) }
    }
}

private func makeSignInTempHome() throws -> (home: URL, scratch: URL) {
    let scratch = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString)
    let home = scratch.appendingPathComponent("home")
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    return (home, scratch)
}

private func readSignInTokens(at url: URL) -> [String: String] {
    (try? JSONDecoder().decode([String: String].self, from: Data(contentsOf: url))) ?? [:]
}

/// Successful script: exchange mints a refresh token, userinfo yields an
/// address, the Drive probe passes.
private func succeedSignIn(
    address: String = "signed@example.com", refreshToken: String = "fresh-refresh"
) {
    SignInStubURLProtocol.setHandler { request in
        let url = request.url!
        if url.host == "oauth2.googleapis.com" {
            return (
                signInHTTPResponse(url: url, status: 200),
                signInJSON([
                    "access_token": "fresh-access", "refresh_token": refreshToken,
                    "expires_in": 3600,
                ]))
        }
        if url.host == "www.googleapis.com" && url.path.hasPrefix("/oauth2/") {
            return (
                signInHTTPResponse(url: url, status: 200),
                signInJSON(["email": address, "name": "Signed User"]))
        }
        // Drive probe.
        return (signInHTTPResponse(url: url, status: 200), signInJSON(["files": []]))
    }
}

/// Poll until the flow leaves `pending` (or the budget runs out).
private func awaitSettled(
    _ service: GoogleSignInService, budget: Duration = .seconds(5)
) async -> GoogleSignInPollResult {
    let deadline = Date().addingTimeInterval(5)
    _ = budget
    while Date() < deadline {
        let result = await service.poll()
        if result.status != .pending { return result }
        try? await Task.sleep(for: .milliseconds(20))
    }
    return await service.poll()
}

private let signInTestEnv = [
    "MOKI_GOOGLE_CLIENT_ID": "test-client-id.apps.googleusercontent.com",
    "MOKI_GOOGLE_CLIENT_SECRET": "test-client-secret",
]

@Suite(.serialized)
struct GoogleSignInTests {
    // MARK: - PKCE + auth URL

    @Test func pkceChallengeMatchesRFC7636Vector() {
        // RFC 7636 §B: verifier → challenge is a fixed transform.
        #expect(
            googleSignInChallenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
                == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func authURLCarriesDriveAndIdentityScopes() {
        let url = googleSignInAuthURL(
            redirectURI: "http://127.0.0.1:51234", codeChallenge: "challenge",
            clientID: "test-client-id")
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        let query = Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        #expect(components.host == "accounts.google.com")
        #expect(query["client_id"] == "test-client-id")
        #expect(query["redirect_uri"] == "http://127.0.0.1:51234")
        #expect(query["response_type"] == "code")
        #expect(query["code_challenge_method"] == "S256")
        #expect(query["code_challenge"] == "challenge")
        #expect(query["access_type"] == "offline")
        #expect(query["prompt"] == "consent")
        let scopes = (query["scope"] ?? "").split(separator: " ").map(String.init)
        #expect(scopes.contains("https://www.googleapis.com/auth/drive.readonly"))
        #expect(scopes.contains("https://www.googleapis.com/auth/userinfo.email"))
    }

    // MARK: - Full flow over a real loopback port

    @Test func fullFlowMergesRefreshTokenAndReportsAddress() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer {
            try? FileManager.default.removeItem(at: scratch)
            SignInStubURLProtocol.clear()
        }
        succeedSignIn()
        let locations = GoogleLocations(homeDirectoryURL: home)
        let opened = OpenedURLs()
        let service = GoogleSignInService(
            locations: locations,
            environment: signInTestEnv,
            session: makeSignInStubSession(),
            clock: Date.init,
            openBrowser: { opened.record($0) },
            makeServer: { LoopbackSignInServer() })

        let started = try await service.start()
        #expect(started.ok == true)
        // Returns at once: the consent wait is still outstanding.
        #expect(await service.poll().status == .pending)
        #expect(opened.urls.count == 1)
        let browserURL = try #require(opened.urls.first)
        #expect(browserURL.host == "accounts.google.com")

        // The browser redirect lands on the ephemeral loopback port.
        let redirect = URL(
            string: "\(browserURL.queryValue(named: "redirect_uri") ?? "")/?code=auth-code&scope=x")!
        Task { _ = try? await URLSession.shared.data(from: redirect) }

        let settled = await awaitSettled(service)
        #expect(settled.status == .done)
        #expect(settled.account == "signed@example.com")
        #expect(settled.message == nil)

        // Merged into Moki's own 0600 token map, keyed by address.
        #expect(readSignInTokens(at: locations.mokiTokensURL) == ["signed@example.com": "fresh-refresh"])

        // No token material in the poll result.
        let encoded = String(data: try JSONEncoder().encode(settled), encoding: .utf8)!
        #expect(!encoded.contains("fresh-refresh"))
        #expect(!encoded.contains("fresh-access"))
    }

    // MARK: - Restart / cancel / expiry

    @Test func restartSupersedesInFlightAttempt() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer {
            try? FileManager.default.removeItem(at: scratch)
            SignInStubURLProtocol.clear()
        }
        succeedSignIn()
        let first = StubLoopbackServer(port: 51111)
        let second = StubLoopbackServer(port: 52222)
        let servers = TestBox([first, second])
        let opened = OpenedURLs()
        let service = GoogleSignInService(
            locations: GoogleLocations(homeDirectoryURL: home),
            environment: signInTestEnv,
            session: makeSignInStubSession(),
            clock: Date.init,
            openBrowser: { opened.record($0) },
            makeServer: {
                var next: StubLoopbackServer!
                servers.modify { next = $0.removeFirst() }
                return next
            })

        _ = try await service.start()
        _ = try await service.start()
        #expect(first.stopCount == 1)
        #expect(opened.urls.count == 2)
        // Redirect URIs differ per attempt (ephemeral ports).
        #expect(opened.urls[0] != opened.urls[1])

        // The orphaned first attempt can no longer complete the flow.
        first.deliver(code: "stale-code")
        try? await Task.sleep(for: .milliseconds(100))
        #expect(await service.poll().status == .pending)

        second.deliver(code: "fresh-code")
        let settled = await awaitSettled(service)
        #expect(settled == GoogleSignInPollResult(status: .done, account: "signed@example.com"))
    }

    @Test func cancelStopsServerAndSticks() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer {
            try? FileManager.default.removeItem(at: scratch)
            SignInStubURLProtocol.clear()
        }
        succeedSignIn()
        let server = StubLoopbackServer(port: 53333)
        let service = GoogleSignInService(
            locations: GoogleLocations(homeDirectoryURL: home),
            environment: signInTestEnv,
            session: makeSignInStubSession(),
            clock: Date.init,
            openBrowser: { _ in },
            makeServer: { server })

        _ = try await service.start()
        let cancelled = await service.cancel()
        #expect(cancelled.ok == true)
        #expect(server.stopCount >= 1)
        let polled = await service.poll()
        #expect(polled.status == .error)
        #expect((polled.message ?? "").contains("cancelled"))

        // A late redirect after cancel cannot resurrect the flow.
        server.deliver(code: "late-code")
        try? await Task.sleep(for: .milliseconds(100))
        let again = await service.poll()
        #expect(again.status == .error)
        #expect((again.message ?? "").contains("cancelled"))
    }

    @Test func supersededAttemptWritesNothing() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer {
            try? FileManager.default.removeItem(at: scratch)
            SignInStubURLProtocol.clear()
        }
        succeedSignIn()
        let locations = GoogleLocations(homeDirectoryURL: home)
        let first = StubLoopbackServer(port: 51121)
        let second = StubLoopbackServer(port: 52221)
        let servers = TestBox([first, second])
        let service = GoogleSignInService(
            locations: locations,
            environment: signInTestEnv,
            session: makeSignInStubSession(),
            clock: Date.init,
            openBrowser: { _ in },
            makeServer: {
                var next: StubLoopbackServer!
                servers.modify { next = $0.removeFirst() }
                return next
            })

        _ = try await service.start()
        _ = try await service.start()
        // The orphaned first attempt delivers its redirect late. The
        // generation guard fires before any network, so a fully healthy
        // script still persists nothing for the dead attempt.
        first.deliver(code: "stale-code")
        try? await Task.sleep(for: .milliseconds(300))
        #expect(await service.poll().status == .pending)
        #expect(readSignInTokens(at: locations.mokiTokensURL).isEmpty)

        second.deliver(code: "fresh-code")
        let settled = await awaitSettled(service)
        #expect(settled == GoogleSignInPollResult(status: .done, account: "signed@example.com"))
    }

    @Test func cancelDuringExchangeWritesNothing() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer {
            try? FileManager.default.removeItem(at: scratch)
            SignInStubURLProtocol.clear()
        }
        let locations = GoogleLocations(homeDirectoryURL: home)
        SignInStubURLProtocol.setHandler { request in
            let url = request.url!
            if url.host == "oauth2.googleapis.com" {
                // Slow exchange: the cancel below lands mid-flight, after
                // the code arrived but before any token exists to save.
                Thread.sleep(forTimeInterval: 0.3)
                return (
                    signInHTTPResponse(url: url, status: 200),
                    signInJSON([
                        "access_token": "fresh-access", "refresh_token": "fresh-refresh",
                        "expires_in": 3600,
                    ]))
            }
            if url.host == "www.googleapis.com" && url.path.hasPrefix("/oauth2/") {
                return (
                    signInHTTPResponse(url: url, status: 200),
                    signInJSON(["email": "signed@example.com"]))
            }
            return (signInHTTPResponse(url: url, status: 200), signInJSON(["files": []]))
        }
        let server = StubLoopbackServer(port: 53331)
        let service = GoogleSignInService(
            locations: locations,
            environment: signInTestEnv,
            session: makeSignInStubSession(),
            clock: Date.init,
            openBrowser: { _ in },
            makeServer: { server })

        _ = try await service.start()
        server.deliver(code: "code")
        // Let the completion task pick up the code and enter the exchange.
        try? await Task.sleep(for: .milliseconds(50))
        let cancelled = await service.cancel()
        #expect(cancelled.ok == true)
        // Past the exchange: the orphaned task must not persist for its
        // dead attempt even though every leg would have succeeded.
        try? await Task.sleep(for: .milliseconds(500))
        let polled = await service.poll()
        #expect(polled.status == .error)
        #expect((polled.message ?? "").contains("cancelled"))
        #expect(readSignInTokens(at: locations.mokiTokensURL).isEmpty)
    }

    @Test func waiterRegisteredAfterStopErrorsInsteadOfHanging() async throws {
        let server = StubLoopbackServer(port: 54441)
        server.stop()
        do {
            _ = try await server.waitForCode()
            Issue.record("a waiter registering after stop must throw, not hang")
        } catch let error as GoogleSignInError {
            guard case .cancelled = error else {
                Issue.record("wrong sign-in error: \(error)")
                return
            }
        } catch {
            Issue.record("wrong error type: \(error)")
        }
    }

    @Test func stopDropsBufferedCode() async throws {
        let server = StubLoopbackServer(port: 54442)
        server.deliver(code: "stale-code")
        server.stop()
        do {
            _ = try await server.waitForCode()
            Issue.record("a stopped server must not serve its stale buffered code")
        } catch let error as GoogleSignInError {
            guard case .cancelled = error else {
                Issue.record("wrong sign-in error: \(error)")
                return
            }
        } catch {
            Issue.record("wrong error type: \(error)")
        }
    }

    @Test func realLoopbackWaitAfterStopErrorsInsteadOfHanging() async throws {
        let server = LoopbackSignInServer()
        _ = try await server.start()
        server.stop()
        do {
            _ = try await server.waitForCode()
            Issue.record("a waiter registering after stop must throw, not hang")
        } catch is GoogleSignInError {
        } catch {
            Issue.record("wrong error type: \(error)")
        }
    }

    @Test func pendingAttemptExpiresAfterFiveMinutes() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        var now = Date()
        let clockBox = TestBox(now)
        let server = StubLoopbackServer(port: 54444)
        let service = GoogleSignInService(
            locations: GoogleLocations(homeDirectoryURL: home),
            environment: signInTestEnv,
            session: makeSignInStubSession(),
            clock: { clockBox.read() },
            openBrowser: { _ in },
            makeServer: { server })

        _ = try await service.start()
        #expect(await service.poll().status == .pending)
        now.addTimeInterval(301)
        clockBox.write(now)
        let expired = await service.poll()
        #expect(expired.status == .error)
        #expect((expired.message ?? "").contains("timed out"))
        #expect(server.stopCount >= 1)
    }

    @Test func providerDenialReadsAsDeclined() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let server = StubLoopbackServer(port: 55555)
        let service = GoogleSignInService(
            locations: GoogleLocations(homeDirectoryURL: home),
            environment: signInTestEnv,
            session: makeSignInStubSession(),
            clock: Date.init,
            openBrowser: { _ in },
            makeServer: { server })

        _ = try await service.start()
        server.deliver(error: GoogleSignInError.providerDenied("access_denied"))
        let settled = await awaitSettled(service)
        #expect(settled.status == .error)
        #expect((settled.message ?? "").contains("declined"))
        #expect(!(settled.message ?? "").contains("refresh"))
    }

    // MARK: - Fixtures

    @Test func fixturesModeStartIsUnavailable() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        var env = signInTestEnv
        env["MOKI_FIXTURES"] = "1"
        let service = GoogleSignInService(
            locations: GoogleLocations(homeDirectoryURL: home),
            environment: env,
            session: makeSignInStubSession(),
            clock: Date.init,
            openBrowser: { _ in Issue.record("browser must not open in fixtures") },
            makeServer: {
                Issue.record("loopback server must not bind in fixtures")
                return StubLoopbackServer(port: 1)
            })
        do {
            _ = try await service.start()
            Issue.record("expected unavailable, got ok")
        } catch let error as AppError {
            #expect(error.code == "unavailable")
            #expect(error.message.contains("unavailable in fixtures"))
        }
    }

    @Test func fixturesRegistrationAnswersUnavailable() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let transport = InMemoryTransport(lines: [
            #"{"jsonrpc":"2.0","id":1,"method":"google.signInStart"}"#,
            #"{"jsonrpc":"2.0","id":2,"method":"google.signInPoll"}"#,
            #"{"jsonrpc":"2.0","id":3,"method":"google.signInCancel"}"#,
        ])
        let server = RPCServer(transport: transport)
        await server.registerGoogleSignInMethods(
            locations: GoogleLocations(homeDirectoryURL: home),
            environment: ["MOKI_FIXTURES": "1"],
            session: makeSignInStubSession())
        await server.run()
        let output = await transport.collectedOutput()
        #expect(output.count == 3)
        let decoded = try output.map {
            try JSONDecoder().decode(JSONValue.self, from: Data($0.utf8))
        }
        // signInStart: AppError unavailable.
        guard case .object(let start) = decoded[0],
            case .object(let startError) = start["error"],
            case .int(let startCode) = startError["code"],
            case .object(let startData) = startError["data"],
            case .string(let appCode) = startData["code"],
            case .string(let startMessage) = startError["message"]
        else {
            Issue.record("start response had unexpected shape: \(output)")
            return
        }
        #expect(startCode == -32000)
        #expect(appCode == "unavailable")
        #expect(startMessage.contains("unavailable in fixtures"))
        // signInPoll: error status, no browser, no network.
        guard case .object(let poll) = decoded[1],
            case .object(let pollResult) = poll["result"],
            case .string(let status) = pollResult["status"]
        else {
            Issue.record("poll response had unexpected shape: \(output)")
            return
        }
        #expect(status == "error")
        // signInCancel: ok.
        guard case .object(let cancel) = decoded[2],
            case .object(let cancelResult) = cancel["result"],
            case .bool(let ok) = cancelResult["ok"]
        else {
            Issue.record("cancel response had unexpected shape: \(output)")
            return
        }
        #expect(ok == true)
    }

    // MARK: - Stale-grant handling (psymail's lesson: name reconnect)

    @Test func userinfo401NamesReconnectAndPersistsNothing() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer {
            try? FileManager.default.removeItem(at: scratch)
            SignInStubURLProtocol.clear()
        }
        let locations = GoogleLocations(homeDirectoryURL: home)
        SignInStubURLProtocol.setHandler { request in
            let url = request.url!
            if url.host == "oauth2.googleapis.com" {
                return (
                    signInHTTPResponse(url: url, status: 200),
                    signInJSON(["access_token": "a", "refresh_token": "r", "expires_in": 3600]))
            }
            return (signInHTTPResponse(url: url, status: 401), Data())
        }
        let server = StubLoopbackServer(port: 56666)
        let service = GoogleSignInService(
            locations: locations,
            environment: signInTestEnv,
            session: makeSignInStubSession(),
            clock: Date.init,
            openBrowser: { _ in },
            makeServer: { server })

        _ = try await service.start()
        server.deliver(code: "code")
        let settled = await awaitSettled(service)
        #expect(settled.status == .error)
        #expect((settled.message ?? "").contains("reconnect"))
        #expect(readSignInTokens(at: locations.mokiTokensURL).isEmpty)
    }

    @Test func userinfoWithoutEmailNeverPersists() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer {
            try? FileManager.default.removeItem(at: scratch)
            SignInStubURLProtocol.clear()
        }
        let locations = GoogleLocations(homeDirectoryURL: home)
        SignInStubURLProtocol.setHandler { request in
            let url = request.url!
            if url.host == "oauth2.googleapis.com" {
                return (
                    signInHTTPResponse(url: url, status: 200),
                    signInJSON(["access_token": "a", "refresh_token": "r", "expires_in": 3600]))
            }
            if url.path.hasPrefix("/oauth2/") {
                // 200 but no email claim (grant without an identity scope):
                // an error naming reconnect, never a silent empty persist.
                return (signInHTTPResponse(url: url, status: 200), signInJSON(["name": "No Mail"]))
            }
            return (signInHTTPResponse(url: url, status: 200), signInJSON(["files": []]))
        }
        let server = StubLoopbackServer(port: 57777)
        let service = GoogleSignInService(
            locations: locations,
            environment: signInTestEnv,
            session: makeSignInStubSession(),
            clock: Date.init,
            openBrowser: { _ in },
            makeServer: { server })

        _ = try await service.start()
        server.deliver(code: "code")
        let settled = await awaitSettled(service)
        #expect(settled.status == .error)
        #expect((settled.message ?? "").contains("reconnect"))
        #expect(readSignInTokens(at: locations.mokiTokensURL).isEmpty)
    }

    @Test func drive403OnFreshTokenNamesReconnect() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer {
            try? FileManager.default.removeItem(at: scratch)
            SignInStubURLProtocol.clear()
        }
        let locations = GoogleLocations(homeDirectoryURL: home)
        SignInStubURLProtocol.setHandler { request in
            let url = request.url!
            if url.host == "oauth2.googleapis.com" {
                return (
                    signInHTTPResponse(url: url, status: 200),
                    signInJSON(["access_token": "a", "refresh_token": "r", "expires_in": 3600]))
            }
            if url.path.hasPrefix("/oauth2/") {
                return (
                    signInHTTPResponse(url: url, status: 200),
                    signInJSON(["email": "narrow@example.com"]))
            }
            // The probe runs before the merge: a 403 blocks the persist.
            return (signInHTTPResponse(url: url, status: 403), Data("forbidden".utf8))
        }
        let server = StubLoopbackServer(port: 58888)
        let service = GoogleSignInService(
            locations: locations,
            environment: signInTestEnv,
            session: makeSignInStubSession(),
            clock: Date.init,
            openBrowser: { _ in },
            makeServer: { server })

        _ = try await service.start()
        server.deliver(code: "code")
        let settled = await awaitSettled(service)
        #expect(settled.status == .error)
        #expect((settled.message ?? "").contains("reconnect"))
        #expect(readSignInTokens(at: locations.mokiTokensURL).isEmpty)
    }

    @Test func missingRefreshTokenIsAnError() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer {
            try? FileManager.default.removeItem(at: scratch)
            SignInStubURLProtocol.clear()
        }
        let locations = GoogleLocations(homeDirectoryURL: home)
        SignInStubURLProtocol.setHandler { request in
            let url = request.url!
            if url.host == "oauth2.googleapis.com" {
                // No refresh_token: nothing to merge, so fail loudly.
                return (
                    signInHTTPResponse(url: url, status: 200),
                    signInJSON(["access_token": "a", "expires_in": 3600]))
            }
            return (signInHTTPResponse(url: url, status: 200), signInJSON(["email": "x@y.z"]))
        }
        let server = StubLoopbackServer(port: 59999)
        let service = GoogleSignInService(
            locations: locations,
            environment: signInTestEnv,
            session: makeSignInStubSession(),
            clock: Date.init,
            openBrowser: { _ in },
            makeServer: { server })

        _ = try await service.start()
        server.deliver(code: "code")
        let settled = await awaitSettled(service)
        #expect(settled.status == .error)
        #expect(readSignInTokens(at: locations.mokiTokensURL).isEmpty)
    }

    // MARK: - Token merge (additive read path for DriveService)

    @Test func freshTokenOverwritesAndDriveReadPathSeesIt() async throws {
        let (home, scratch) = try makeSignInTempHome()
        defer {
            try? FileManager.default.removeItem(at: scratch)
            SignInStubURLProtocol.clear()
        }
        let locations = GoogleLocations(homeDirectoryURL: home)
        let store = GoogleTokenStore(locations: locations)
        // A narrow imported grant already sits in Moki's file.
        store.saveRefreshToken("old-narrow-refresh", for: "signed@example.com")
        // Re-auth replaces it (the import merge would NOT overwrite).
        store.saveRefreshToken("fresh-wide-refresh", for: "signed@example.com")
        // Unrelated addresses are untouched.
        store.saveRefreshToken("other-refresh", for: "other@example.com")
        let map = readSignInTokens(at: locations.mokiTokensURL)
        #expect(map["signed@example.com"] == "fresh-wide-refresh")
        #expect(map["other@example.com"] == "other-refresh")

        // The token lookup `DriveService` goes through (via
        // `GoogleAccountsService.accessToken(for:)`, which reads Moki's file
        // fresh on every call) mints from the NEW token.
        let seenBodies = TestBox<[String]>([])
        SignInStubURLProtocol.setHandler { request in
            let url = request.url!
            var body = request.httpBody ?? Data()
            if body.isEmpty, let stream = request.httpBodyStream {
                stream.open()
                defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable {
                    let read = stream.read(&buffer, maxLength: buffer.count)
                    if read <= 0 { break }
                    body.append(buffer, count: read)
                }
            }
            seenBodies.modify { $0.append(String(decoding: body, as: UTF8.self)) }
            return (
                signInHTTPResponse(url: url, status: 200),
                signInJSON(["access_token": "minted-access", "expires_in": 3600]))
        }
        let accounts = GoogleAccountsService(
            locations: locations, environment: signInTestEnv,
            session: makeSignInStubSession())
        let token = try await accounts.accessToken(for: "signed@example.com")
        #expect(token == "minted-access")
        let bodies = seenBodies.read()
        #expect(bodies.count == 1)
        #expect((bodies.first ?? "").contains("refresh_token=fresh-wide-refresh"))
    }

    // MARK: - Wire shape

    @Test func pollResultEncodesToProtocolShape() throws {
        let done = GoogleSignInPollResult(status: .done, account: "a@example.com")
        let doneJSON = String(data: try JSONEncoder().encode(done), encoding: .utf8)!
        #expect(doneJSON.contains("\"status\":\"done\""))
        #expect(doneJSON.contains("\"account\":\"a@example.com\""))

        let pending = GoogleSignInPollResult(status: .pending)
        let pendingObject = try JSONDecoder().decode(
            [String: String].self, from: JSONEncoder().encode(pending))
        #expect(pendingObject["status"] == "pending")
    }
}

// MARK: - Test-only URL helpers

private extension URL {
    /// Single query value, for asserting on the browser URL the flow opened.
    func queryValue(named name: String) -> String? {
        URLComponents(url: self, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == name }?.value
    }
}
