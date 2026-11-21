import Foundation
import Testing

@testable import MokiHelperCore

// MARK: - Stubs

/// Routes requests to per-test answers. Private to this file.
private final class NotionMCPStubURLProtocol: URLProtocol {
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

private func makeNotionMCPStubSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [NotionMCPStubURLProtocol.self]
    return URLSession(configuration: config)
}

private func notionMCPHTTPResponse(url: URL, status: Int, headers: [String: String]? = nil) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: headers)!
}

private func notionMCPJSON(_ object: Any) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
}

private func notionMCPFormField(_ request: URLRequest, name: String) -> String? {
    guard let text = String(data: notionMCPStubBody(request), encoding: .utf8) else { return nil }
    return text.split(separator: "&").compactMap { pair -> String? in
        let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
        guard parts.count == 2, parts[0] == name else { return nil }
        return parts[1].removingPercentEncoding
    }.first
}

/// Controllable loopback stand-in delivering full callbacks by hand.
private final class StubOAuthLoopback: OAuthLoopbackServing, @unchecked Sendable {
    private let lock = NSLock()
    private var waiter: CheckedContinuation<OAuthLoopbackCallback, Error>?
    private var delivered: Result<OAuthLoopbackCallback, Error>?
    private var stopped = false
    private(set) var startCount = 0
    private(set) var stopCount = 0
    let requestedPorts: LockedBox<[Int?]>
    let boundPort: Int

    init(boundPort: Int) {
        self.boundPort = boundPort
        self.requestedPorts = LockedBox([])
    }

    func start(port: Int?) async throws -> Int {
        lock.withLock { startCount += 1 }
        requestedPorts.modify { $0.append(port) }
        return boundPort
    }

    func waitForCallback() async throws -> OAuthLoopbackCallback {
        try await withCheckedThrowingContinuation { continuation in
            let terminal: Result<OAuthLoopbackCallback, Error>? = lock.withLock {
                if stopped {
                    return .failure(OAuthLoopbackError.cancelled)
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
        let pending: CheckedContinuation<OAuthLoopbackCallback, Error>? = lock.withLock {
            stopCount += 1
            stopped = true
            delivered = nil
            defer { waiter = nil }
            return waiter
        }
        pending?.resume(throwing: OAuthLoopbackError.cancelled)
    }

    func deliver(_ callback: OAuthLoopbackCallback) {
        let pending: CheckedContinuation<OAuthLoopbackCallback, Error>? = lock.withLock {
            guard !stopped else { return nil }
            if let waiter {
                self.waiter = nil
                return waiter
            }
            delivered = .success(callback)
            return nil
        }
        pending?.resume(returning: callback)
    }

    func deliver(error: Error) {
        let pending: CheckedContinuation<OAuthLoopbackCallback, Error>? = lock.withLock {
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

private final class LockedBox<Value>: @unchecked Sendable {
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

private func readGrant(from store: InMemorySecretStore) -> NotionMCPGrant? {
    guard let raw = store.read(
        service: MokiKeychainIDs.service,
        account: MokiKeychainIDs.notionMCPGrantAccount),
        let data = raw.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(NotionMCPGrant.self, from: data)
}

private func seedGrant(
    _ store: InMemorySecretStore, refreshToken: String = "refresh-1",
    accessToken: String? = "access-1", expiresIn: TimeInterval = 3600
) throws {
    let grant = NotionMCPGrant(
        clientID: "client-1", refreshToken: refreshToken,
        accessToken: accessToken,
        expiresAt: accessToken == nil ? nil : Date().addingTimeInterval(expiresIn))
    let raw = String(data: try JSONEncoder().encode(grant), encoding: .utf8)!
    try store.write(
        raw, service: MokiKeychainIDs.service,
        account: MokiKeychainIDs.notionMCPGrantAccount)
}

/// Reads and deletes delegate to an in-memory store; writes always fail,
/// so persistence-failure paths can be exercised without the Keychain.
private final class FailingWriteSecretStore: SecretStoring, @unchecked Sendable {
    private let backing = InMemorySecretStore()

    func seedGrant(
        refreshToken: String = "refresh-1", accessToken: String? = "access-1",
        expiresIn: TimeInterval = 3600
    ) throws {
        let grant = NotionMCPGrant(
            clientID: "client-1", refreshToken: refreshToken,
            accessToken: accessToken,
            expiresAt: accessToken == nil ? nil : Date().addingTimeInterval(expiresIn))
        let raw = String(data: try JSONEncoder().encode(grant), encoding: .utf8)!
        try backing.write(
            raw, service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionMCPGrantAccount)
    }

    func storedGrant() -> NotionMCPGrant? {
        guard let raw = backing.read(
            service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionMCPGrantAccount),
            let data = raw.data(using: .utf8)
        else { return nil }
        return try? JSONDecoder().decode(NotionMCPGrant.self, from: data)
    }

    func read(service: String, account: String) -> String? {
        backing.read(service: service, account: account)
    }

    func write(_ secret: String, service: String, account: String) throws {
        throw KeychainError("failing store cannot persist")
    }

    func delete(service: String, account: String) throws {
        try backing.delete(service: service, account: account)
    }
}

/// Stub the two discovery documents with the production endpoint
/// values, so flow tests exercise live-shaped discovery + DCR +
/// exchange. Returns nil for non-metadata URLs.
private func notionMCPDiscoveryResponse(for url: URL) -> (HTTPURLResponse, Data)? {
    switch url.path {
    case "/.well-known/oauth-protected-resource/mcp":
        return (
            notionMCPHTTPResponse(url: url, status: 200),
            notionMCPJSON([
                "resource": "https://mcp.notion.com/mcp",
                "authorization_servers": ["https://mcp.notion.com"],
            ]))
    case "/.well-known/oauth-authorization-server":
        return (
            notionMCPHTTPResponse(url: url, status: 200),
            notionMCPJSON([
                "authorization_endpoint": "https://mcp.notion.com/authorize",
                "token_endpoint": "https://mcp.notion.com/token",
                "registration_endpoint": "https://mcp.notion.com/register",
                "revocation_endpoint": "https://mcp.notion.com/token",
                "code_challenge_methods_supported": ["S256"],
            ]))
    default:
        return nil
    }
}

/// DCR + exchange script: discovery, registration mints a client id, the
/// code exchange mints access + refresh tokens.
private func succeedDCRAndExchange(clientID: String = "client-abc") {
    NotionMCPStubURLProtocol.setHandler { request in
        let url = request.url!
        if let hit = notionMCPDiscoveryResponse(for: url) { return hit }
        if url.path == "/register" {
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
            return (
                notionMCPHTTPResponse(url: url, status: 200),
                notionMCPJSON(["client_id": clientID]))
        }
        if url.path == "/token" {
            let grantType = notionMCPFormField(request, name: "grant_type")
            #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
            if grantType == "authorization_code" {
                #expect((notionMCPFormField(request, name: "resource") ?? "") == notionMCPResource)
                #expect((notionMCPFormField(request, name: "code_verifier") ?? "").isEmpty == false)
                return (
                    notionMCPHTTPResponse(url: url, status: 200),
                    notionMCPJSON([
                        "access_token": "mcp-access", "refresh_token": "mcp-refresh",
                        "expires_in": 3600, "token_type": "Bearer",
                    ]))
            }
            if grantType == "refresh_token" {
                return (
                    notionMCPHTTPResponse(url: url, status: 200),
                    notionMCPJSON([
                        "access_token": "mcp-access-2", "refresh_token": "mcp-refresh-2",
                        "expires_in": 3600,
                    ]))
            }
        }
        return (notionMCPHTTPResponse(url: url, status: 500), Data())
    }
}

/// Poll until the flow leaves `pending` (or the budget runs out).
private func awaitSettled(
    _ service: NotionMCPAuthService, budget: Duration = .seconds(5)
) async -> DocsSignInPollResult {
    let deadline = Date().addingTimeInterval(5)
    _ = budget
    while Date() < deadline {
        let result = await service.poll()
        if result.status != .pending { return result }
        try? await Task.sleep(for: .milliseconds(20))
    }
    return await service.poll()
}

private func makeService(
    store: InMemorySecretStore = InMemorySecretStore(),
    server: StubOAuthLoopback,
    opened: OpenedURLs = OpenedURLs(),
    clock: (@Sendable () -> Date)? = nil,
    now: LockedBox<Date>? = nil
) -> NotionMCPAuthService {
    NotionMCPAuthService(
        secrets: store,
        session: makeNotionMCPStubSession(),
        clock: clock ?? { now?.read() ?? Date() },
        openBrowser: { opened.record($0) },
        makeServer: { server })
}

@Suite(.serialized)
struct NotionMCPOAuthTests {
    // MARK: - DCR + auth URL

    @Test func registerBodyIsPublicClient() throws {
        let body = notionMCPRegisterBody(redirectURI: "http://127.0.0.1:51234/oauth/notion")
        let data = try JSONEncoder().encode(body)
        let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        #expect(object["client_name"] as? String == "Moki")
        #expect(object["redirect_uris"] as? [String] == ["http://127.0.0.1:51234/oauth/notion"])
        #expect(object["response_types"] as? [String] == ["code"])
        #expect(
            object["grant_types"] as? [String] == ["authorization_code", "refresh_token"])
        #expect(object["token_endpoint_auth_method"] as? String == "none")
    }

    @Test func authURLCarriesStatePKCEResourceAndScope() {
        let url = notionMCPAuthURL(
            authorizeEndpoint: URL(string: "https://mcp.notion.com/authorize")!,
            clientID: "client-abc", redirectURI: "http://127.0.0.1:51234/oauth/notion",
            state: "csrf-state", challenge: "challenge")
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        let query = Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        #expect(components.host == "mcp.notion.com")
        #expect(query["response_type"] == "code")
        #expect(query["client_id"] == "client-abc")
        #expect(query["redirect_uri"] == "http://127.0.0.1:51234/oauth/notion")
        #expect(query["scope"] == "default")
        #expect(query["resource"] == "https://mcp.notion.com/mcp")
        #expect(query["state"] == "csrf-state")
        #expect(query["code_challenge"] == "challenge")
        #expect(query["code_challenge_method"] == "S256")
    }

    // MARK: - Discovery (RFC 9728 + RFC 8414)

    @Test func authorizationServerMetadataURLHelper() {
        #expect(
            notionMCPAuthorizationServerMetadataURL(
                for: URL(string: "https://mcp.notion.com")!
            ).absoluteString
                == "https://mcp.notion.com/.well-known/oauth-authorization-server")
        #expect(
            notionMCPAuthorizationServerMetadataURL(
                for: URL(string: "https://example.com/base/auth")!
            ).absoluteString
                == "https://example.com/.well-known/oauth-authorization-server/base/auth")
    }

    @Test func discoveryFailuresFailBeforeBrowser() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        let goodServer: [String: Any] = [
            "authorization_endpoint": "https://mcp.notion.com/authorize",
            "token_endpoint": "https://mcp.notion.com/token",
            "registration_endpoint": "https://mcp.notion.com/register",
            "code_challenge_methods_supported": ["S256"],
        ]
        let goodResource: [String: Any] = [
            "resource": "https://mcp.notion.com/mcp",
            "authorization_servers": ["https://mcp.notion.com"],
        ]
        // Pre-encode: `[String: Any]` is not `Sendable` and cannot be
        // captured by the stub closure.
        func encoded(_ object: [String: Any]) throws -> Data {
            try JSONSerialization.data(withJSONObject: object)
        }
        let cases: [(String, Data, Data)] = try [
            (
                "mismatched resource",
                encoded([
                    "resource": "https://other.example/mcp",
                    "authorization_servers": ["https://mcp.notion.com"],
                ]), encoded(goodServer)
            ),
            (
                "empty authorization servers",
                encoded([
                    "resource": "https://mcp.notion.com/mcp",
                    "authorization_servers": [] as [String],
                ]), encoded(goodServer)
            ),
            (
                "missing token endpoint",
                encoded(goodResource),
                encoded([
                    "authorization_endpoint": "https://mcp.notion.com/authorize",
                    "registration_endpoint": "https://mcp.notion.com/register",
                ])
            ),
            (
                "non-https token endpoint",
                encoded(goodResource),
                encoded([
                    "authorization_endpoint": "https://mcp.notion.com/authorize",
                    "token_endpoint": "http://mcp.notion.com/token",
                    "registration_endpoint": "https://mcp.notion.com/register",
                ])
            ),
            (
                "no S256 support",
                encoded(goodResource),
                encoded([
                    "authorization_endpoint": "https://mcp.notion.com/authorize",
                    "token_endpoint": "https://mcp.notion.com/token",
                    "registration_endpoint": "https://mcp.notion.com/register",
                    "code_challenge_methods_supported": ["plain"],
                ])
            ),
        ]
        for (name, resourceData, serverData) in cases {
            NotionMCPStubURLProtocol.setHandler { request in
                let url = request.url!
                switch url.path {
                case "/.well-known/oauth-protected-resource/mcp":
                    return (notionMCPHTTPResponse(url: url, status: 200), resourceData)
                case "/.well-known/oauth-authorization-server":
                    return (notionMCPHTTPResponse(url: url, status: 200), serverData)
                default:
                    Issue.record("no DCR/browser traffic expected for \(name)")
                    return (notionMCPHTTPResponse(url: url, status: 500), Data())
                }
            }
            let opened = OpenedURLs()
            let service = NotionMCPAuthService(
                secrets: InMemorySecretStore(), session: makeNotionMCPStubSession(),
                clock: Date.init,
                openBrowser: { opened.record($0) },
                makeServer: { StubOAuthLoopback(boundPort: 1) })
            do {
                _ = try await service.start()
                Issue.record("expected discovery failure for \(name)")
            } catch let error as AppError {
                #expect(error.code == "unreachable", "\(name)")
                #expect(!error.message.contains("other.example"), "\(name)")
            }
            #expect(opened.urls.isEmpty, "\(name)")
            let polled = await service.poll()
            #expect(polled.status == .error, "\(name)")
            #expect(!(polled.message ?? "").contains("other.example"), "\(name)")
        }
    }

    // MARK: - Full flow

    @Test func fullFlowPersistsGrantAndReportsDone() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        succeedDCRAndExchange()
        let store = InMemorySecretStore()
        let server = StubOAuthLoopback(boundPort: 51234)
        let opened = OpenedURLs()
        let service = makeService(store: store, server: server, opened: opened)

        let started = try await service.start()
        #expect(started == DocsSignInOK())
        #expect(await service.poll().status == .pending)
        #expect(opened.urls.count == 1)
        let browserURL = try #require(opened.urls.first)
        #expect(browserURL.host == "mcp.notion.com")
        // Ephemeral loopback: the redirect URI carries the bound port.
        let redirectURI = URLComponents(url: browserURL, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "redirect_uri" }?.value
        #expect(redirectURI == "http://127.0.0.1:51234/oauth/notion")
        #expect(server.requestedPorts.read() == [nil])
        // State round-trips from the opened URL into the callback.
        let state = URLComponents(url: browserURL, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "state" }?.value
        let echoedState = try #require(state)

        server.deliver(OAuthLoopbackCallback(code: "auth-code", state: echoedState))
        let settled = await awaitSettled(service)
        #expect(settled == DocsSignInPollResult(status: .done, account: "Notion"))
        #expect(settled.message == nil)

        let grant = try #require(readGrant(from: store))
        #expect(grant.clientID == "client-abc")
        #expect(grant.refreshToken == "mcp-refresh")
        #expect(grant.accessToken == "mcp-access")

        // No token material in the poll result.
        let encoded = String(data: try JSONEncoder().encode(settled), encoding: .utf8)!
        #expect(!encoded.contains("mcp-refresh"))
        #expect(!encoded.contains("mcp-access"))
    }

    // MARK: - Denial / mismatch / cancel / restart / expiry

    @Test func stateMismatchReadsAsError() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        succeedDCRAndExchange()
        let server = StubOAuthLoopback(boundPort: 52345)
        let service = makeService(server: server)

        _ = try await service.start()
        server.deliver(OAuthLoopbackCallback(code: "auth-code", state: "wrong-state"))
        let settled = await awaitSettled(service)
        #expect(settled.status == .error)
        #expect((settled.message ?? "").contains("match"))
    }

    @Test func providerDenialReadsAsDeclined() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        succeedDCRAndExchange()
        let server = StubOAuthLoopback(boundPort: 53345)
        let service = makeService(server: server)

        _ = try await service.start()
        server.deliver(OAuthLoopbackCallback(providerError: "access_denied"))
        let settled = await awaitSettled(service)
        #expect(settled.status == .error)
        #expect((settled.message ?? "").contains("declined"))
        #expect(!(settled.message ?? "").contains("refresh"))
    }

    @Test func restartSupersedesInFlightAttempt() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        succeedDCRAndExchange()
        let first = StubOAuthLoopback(boundPort: 51111)
        let second = StubOAuthLoopback(boundPort: 52222)
        let servers = LockedBox([first, second])
        let opened = OpenedURLs()
        let service = NotionMCPAuthService(
            secrets: InMemorySecretStore(),
            session: makeNotionMCPStubSession(),
            clock: Date.init,
            openBrowser: { opened.record($0) },
            makeServer: {
                var next: StubOAuthLoopback!
                servers.modify { next = $0.removeFirst() }
                return next
            })

        _ = try await service.start()
        _ = try await service.start()
        // The orphaned attempt's server is stopped (its completion task's
        // deferred stop may have already run a second one).
        #expect(first.stopCount >= 1)
        #expect(opened.urls.count == 2)

        first.deliver(OAuthLoopbackCallback(code: "stale-code", state: "stale"))
        try? await Task.sleep(for: .milliseconds(100))
        #expect(await service.poll().status == .pending)

        let state = URLComponents(url: opened.urls[1], resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "state" }?.value
        second.deliver(OAuthLoopbackCallback(code: "fresh-code", state: state))
        let settled = await awaitSettled(service)
        #expect(settled == DocsSignInPollResult(status: .done, account: "Notion"))
    }

    @Test func cancelStopsServerAndSticks() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        succeedDCRAndExchange()
        let store = InMemorySecretStore()
        let server = StubOAuthLoopback(boundPort: 53333)
        let service = makeService(store: store, server: server)

        _ = try await service.start()
        let cancelled = await service.cancel()
        #expect(cancelled == DocsSignInOK())
        #expect(server.stopCount >= 1)
        let polled = await service.poll()
        #expect(polled.status == .error)
        #expect((polled.message ?? "").contains("cancelled"))

        server.deliver(OAuthLoopbackCallback(code: "late-code", state: "late"))
        try? await Task.sleep(for: .milliseconds(100))
        let again = await service.poll()
        #expect(again.status == .error)
        #expect(readGrant(from: store) == nil)
    }

    @Test func cancelDuringStartNeverOpensBrowser() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        let registrationGate = DispatchSemaphore(value: 0)
        NotionMCPStubURLProtocol.setHandler { request in
            let url = request.url!
            if let hit = notionMCPDiscoveryResponse(for: url) { return hit }
            if url.path == "/register" {
                registrationGate.wait()
                return (
                    notionMCPHTTPResponse(url: url, status: 200),
                    notionMCPJSON(["client_id": "client-1"]))
            }
            Issue.record("unexpected request: \(url)")
            throw URLError(.badServerResponse)
        }
        let server = StubOAuthLoopback(boundPort: 51112)
        let opened = OpenedURLs()
        let service = makeService(server: server, opened: opened)

        let starting = Task { try await service.start() }
        try? await Task.sleep(for: .milliseconds(100))
        _ = await service.cancel()
        registrationGate.signal()
        do {
            _ = try await starting.value
            Issue.record("a cancelled start must throw")
        } catch {}

        #expect(opened.urls.isEmpty, "no browser tab for a flow the UI already cancelled")
        #expect(server.stopCount >= 1)
        let polled = await service.poll()
        #expect(polled.status == .error)
        #expect((polled.message ?? "").contains("cancelled"))
    }

    @Test func signInPersistenceFailureReadsAsErrorNeverDone() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        succeedDCRAndExchange()
        let store = FailingWriteSecretStore()
        let server = StubOAuthLoopback(boundPort: 53334)
        let opened = OpenedURLs()
        let service = NotionMCPAuthService(
            secrets: store, session: makeNotionMCPStubSession(), clock: Date.init,
            openBrowser: { opened.record($0) }, makeServer: { server })

        _ = try await service.start()
        let browserURL = try #require(opened.urls.first)
        let state = try #require(
            URLComponents(url: browserURL, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "state" }?.value)
        server.deliver(OAuthLoopbackCallback(code: "auth-code", state: state))
        let settled = await awaitSettled(service)
        // The exchange succeeded but the grant could not be persisted:
        // failure, never done, nothing stored.
        #expect(settled.status == .error)
        #expect((settled.message ?? "").contains("Could not save"))
        #expect(!(settled.message ?? "").contains("mcp-access"))
        #expect(!(settled.message ?? "").contains("mcp-refresh"))
        #expect(store.storedGrant() == nil)
        let encoded = String(data: try JSONEncoder().encode(settled), encoding: .utf8)!
        #expect(!encoded.contains("mcp-access"))
        #expect(!encoded.contains("mcp-refresh"))
    }

    @Test func refreshPersistenceFailureThrowsWithoutClaimingSuccess() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        let store = FailingWriteSecretStore()
        try store.seedGrant(refreshToken: "refresh-1", accessToken: "access-1", expiresIn: -10)
        NotionMCPStubURLProtocol.setHandler { request in
            let url = request.url!
            if let hit = notionMCPDiscoveryResponse(for: url) { return hit }
            #expect(url.path == "/token")
            return (
                notionMCPHTTPResponse(url: url, status: 200),
                notionMCPJSON([
                    "access_token": "access-2", "refresh_token": "refresh-2", "expires_in": 3600
                ]))
        }
        let auth = NotionMCPAuthService(
            secrets: store, session: makeNotionMCPStubSession(), clock: Date.init,
            openBrowser: { _ in }, makeServer: { StubOAuthLoopback(boundPort: 1) })
        do {
            _ = try await auth.freshAccessToken()
            Issue.record("expected a persistence failure")
        } catch let error as AppError {
            #expect(error.code == "unreachable")
            #expect(error.message.contains("Could not save"))
            #expect(!error.message.contains("refresh"))
            #expect(!error.message.contains("access"))
        }
        // The rotation was not persisted and no token was handed out: the
        // stored grant is untouched.
        #expect(store.storedGrant()?.refreshToken == "refresh-1")
        #expect(store.storedGrant()?.accessToken == "access-1")

        // Listing does not claim success either — it throws for the
        // partial path instead of serving rows.
        let service = NotionService(
            secrets: store, session: makeNotionMCPStubSession(),
            rateLimiter: NotionRateLimiter(minInterval: 0), fixtures: false,
            mcpAuth: auth)
        do {
            _ = try await service.listRecents()
            Issue.record("expected unreachable")
        } catch let error as AppError {
            #expect(error.code == "unreachable")
        }
    }

    @Test func pendingAttemptExpiresAfterFiveMinutes() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        succeedDCRAndExchange()
        var now = Date()
        let clockBox = LockedBox(now)
        let server = StubOAuthLoopback(boundPort: 54444)
        let service = makeService(server: server, clock: { clockBox.read() })

        _ = try await service.start()
        #expect(await service.poll().status == .pending)
        now.addTimeInterval(301)
        clockBox.write(now)
        let expired = await service.poll()
        #expect(expired.status == .error)
        #expect((expired.message ?? "").contains("timed out"))
        #expect(server.stopCount >= 1)
    }

    // MARK: - Refresh

    @Test func freshAccessTokenSkipsNetwork() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        let store = InMemorySecretStore()
        try seedGrant(store)
        NotionMCPStubURLProtocol.setHandler { _ in
            Issue.record("a fresh grant must not touch the network")
            throw URLError(.badServerResponse)
        }
        let service = NotionMCPAuthService(
            secrets: store, session: makeNotionMCPStubSession(), clock: Date.init,
            openBrowser: { _ in }, makeServer: { StubOAuthLoopback(boundPort: 1) })
        #expect(try await service.freshAccessToken() == "access-1")
    }

    @Test func expiredGrantRefreshesAndRotates() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        let store = InMemorySecretStore()
        try seedGrant(store, expiresIn: -10)
        NotionMCPStubURLProtocol.setHandler { request in
            let url = request.url!
            if let hit = notionMCPDiscoveryResponse(for: url) { return hit }
            #expect(url.path == "/token")
            #expect(notionMCPFormField(request, name: "grant_type") == "refresh_token")
            #expect(notionMCPFormField(request, name: "resource") == notionMCPResource)
            return (
                notionMCPHTTPResponse(url: url, status: 200),
                notionMCPJSON([
                    "access_token": "access-2", "refresh_token": "refresh-2", "expires_in": 3600
                ]))
        }
        let service = NotionMCPAuthService(
            secrets: store, session: makeNotionMCPStubSession(), clock: Date.init,
            openBrowser: { _ in }, makeServer: { StubOAuthLoopback(boundPort: 1) })
        #expect(try await service.freshAccessToken() == "access-2")
        let grant = try #require(readGrant(from: store))
        #expect(grant.refreshToken == "refresh-2")
        #expect(grant.accessToken == "access-2")
    }

    @Test func invalidGrantClearsGrantAndNamesReconnect() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        let store = InMemorySecretStore()
        try seedGrant(store, expiresIn: -10)
        NotionMCPStubURLProtocol.setHandler { request in
            let url = request.url!
            if let hit = notionMCPDiscoveryResponse(for: url) { return hit }
            return (
                notionMCPHTTPResponse(url: url, status: 400),
                notionMCPJSON(["error": "invalid_grant"]))
        }
        let service = NotionMCPAuthService(
            secrets: store, session: makeNotionMCPStubSession(), clock: Date.init,
            openBrowser: { _ in }, makeServer: { StubOAuthLoopback(boundPort: 1) })
        do {
            _ = try await service.freshAccessToken()
            Issue.record("expected auth_expired")
        } catch let error as AppError {
            #expect(error.code == "auth_expired")
            #expect(error.message.contains("reconnect"))
            #expect(!error.message.contains("refresh-1"))
        }
        #expect(readGrant(from: store) == nil)
    }

    @Test func noGrantReadsAsNilForLegacyFallback() async throws {
        let service = NotionMCPAuthService(
            secrets: InMemorySecretStore(), session: makeNotionMCPStubSession(), clock: Date.init,
            openBrowser: { _ in }, makeServer: { StubOAuthLoopback(boundPort: 1) })
        #expect(try await service.freshAccessToken() == nil)
    }

    // MARK: - Listing branches

    @Test func mcpRecentsMapPagesWithoutInventingDates() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        let store = InMemorySecretStore()
        try seedGrant(store)
        NotionMCPStubURLProtocol.setHandler { request in
            let url = request.url!
            if url.path == "/mcp" {
                switch mcpBodyMethod(request) {
                case "initialize":
                    return (
                        notionMCPHTTPResponse(url: url, status: 200),
                        notionMCPJSON([
                            "jsonrpc": "2.0", "id": 1,
                            "result": ["capabilities": [:]] as [String: Any],
                        ]))
                case "notifications/initialized":
                    return (notionMCPHTTPResponse(url: url, status: 202), Data())
                default:
                    return (
                        notionMCPHTTPResponse(url: url, status: 200),
                        notionMCPJSON([
                            "jsonrpc": "2.0", "id": 1,
                            "result": [
                                "structuredContent": [
                                    "pages": [
                                        [
                                            "id": "page-1", "type": "page",
                                            "title": "Roadmap",
                                            "url": "https://www.notion.so/roadmap-1",
                                            "last_edited_time": "2026-11-20T10:00:00.000Z",
                                        ],
                                        [
                                            "type": "database",
                                            "title": "Tasks",
                                            "url": "https://www.notion.so/Tasks-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                                        ],
                                        ["title": "No id", "type": "page"],
                                    ]
                                ]
                            ],
                        ]))
                }
            }
            Issue.record("unexpected request: \(url)")
            throw URLError(.badServerResponse)
        }
        let service = NotionService(
            secrets: store, session: makeNotionMCPStubSession(),
            rateLimiter: NotionRateLimiter(minInterval: 0), fixtures: false,
            mcpAuth: makeService(store: store, server: StubOAuthLoopback(boundPort: 1)))
        let result = try await service.listRecents()
        #expect(result.status == .ok)
        #expect(result.items.count == 2)
        #expect(result.items[0].title == "Roadmap")
        #expect(result.items[0].object == "page")
        #expect(result.items[0].lastEditedTime == "2026-11-20T10:00:00.000Z")
        #expect(result.items[1].title == "Tasks")
        #expect(result.items[1].object == "database")
        // Documented Notion rows may omit id; the URL UUID keys the row.
        #expect(result.items[1].id == "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        // The tool returns no timestamps; never invent one.
        #expect(result.items[1].lastEditedTime.isEmpty)
    }

    @Test func mcpAuthFailureReadsAsAuthExpiredEnvelope() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        let store = InMemorySecretStore()
        try seedGrant(store)
        NotionMCPStubURLProtocol.setHandler { request in
            let url = request.url!
            if url.path == "/mcp" {
                if mcpBodyMethod(request) == "initialize" {
                    return (
                        notionMCPHTTPResponse(url: url, status: 200),
                        notionMCPJSON([
                            "jsonrpc": "2.0", "id": 1,
                            "result": ["capabilities": [:]] as [String: Any],
                        ]))
                }
                if mcpBodyMethod(request) == nil {
                    return (notionMCPHTTPResponse(url: url, status: 202), Data())
                }
                return (notionMCPHTTPResponse(url: url, status: 401), Data())
            }
            Issue.record("unexpected request: \(url)")
            throw URLError(.badServerResponse)
        }
        let service = NotionService(
            secrets: store, session: makeNotionMCPStubSession(),
            rateLimiter: NotionRateLimiter(minInterval: 0), fixtures: false,
            mcpAuth: makeService(store: store, server: StubOAuthLoopback(boundPort: 1)))
        let result = try await service.listRecents()
        #expect(result.status == .authExpired)
        #expect(result.items.isEmpty)
    }

    @Test func legacyTokenFallbackSurvivesWithoutGrant() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        let store = InMemorySecretStore()
        try store.write(
            "ntn_live", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        NotionMCPStubURLProtocol.setHandler { request in
            #expect(request.url?.host == "api.notion.com")
            return (
                notionMCPHTTPResponse(url: request.url!, status: 200),
                notionMCPJSON([
                    "object": "list", "results": [[
                        "object": "page",
                        "id": "11111111-1111-4111-8111-111111111111",
                        "last_edited_time": "2026-11-20T10:00:00.000Z",
                        "url": "https://www.notion.so/roadmap-111",
                        "properties": [
                            "title": [
                                "id": "title", "type": "title",
                                "title": [["plain_text": "Roadmap"]],
                            ]
                        ],
                    ]], "has_more": false,
                ]))
        }
        let service = NotionService(
            secrets: store, session: makeNotionMCPStubSession(),
            rateLimiter: NotionRateLimiter(minInterval: 0), fixtures: false,
            mcpAuth: makeService(store: store, server: StubOAuthLoopback(boundPort: 1)))
        let result = try await service.listRecents()
        #expect(result.status == .ok)
        #expect(result.items.count == 1)
        #expect(result.items[0].title == "Roadmap")
    }

    @Test func tokenNeverAppearsInResult() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        let store = InMemorySecretStore()
        try seedGrant(
            store, refreshToken: "super_secret_refresh", accessToken: "super_secret_access")
        NotionMCPStubURLProtocol.setHandler { request in
            let url = request.url!
            if mcpBodyMethod(request) == "initialize" {
                return (
                    notionMCPHTTPResponse(url: url, status: 200),
                    notionMCPJSON([
                        "jsonrpc": "2.0", "id": 1,
                        "result": ["capabilities": [:]] as [String: Any],
                    ]))
            }
            if mcpBodyMethod(request) == nil {
                return (notionMCPHTTPResponse(url: url, status: 202), Data())
            }
            return (
                notionMCPHTTPResponse(url: url, status: 200),
                notionMCPJSON([
                    "jsonrpc": "2.0", "id": 1,
                    "result": [
                        "structuredContent": [
                            "pages": [["id": "page-1", "title": "Roadmap"]]
                        ]
                    ],
                ]))
        }
        let service = NotionService(
            secrets: store, session: makeNotionMCPStubSession(),
            rateLimiter: NotionRateLimiter(minInterval: 0), fixtures: false,
            mcpAuth: makeService(store: store, server: StubOAuthLoopback(boundPort: 1)))
        let result = try await service.listRecents()
        let encoded = String(data: try JSONEncoder().encode(result), encoding: .utf8) ?? ""
        #expect(!encoded.contains("super_secret_refresh"))
        #expect(!encoded.contains("super_secret_access"))
    }

    // MARK: - Sign-out clears both credentials

    @Test func signOutRevokesStoredGrantBestEffort() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        let store = InMemorySecretStore()
        try seedGrant(store)
        let revoked = LockedBox<[String: String]?>(nil)
        NotionMCPStubURLProtocol.setHandler { request in
            let url = request.url!
            if let hit = notionMCPDiscoveryResponse(for: url) { return hit }
            if url.path == "/token" {
                revoked.write([
                    "token": notionMCPFormField(request, name: "token") ?? "",
                    "hint": notionMCPFormField(request, name: "token_type_hint") ?? "",
                    "client": notionMCPFormField(request, name: "client_id") ?? "",
                ])
                return (notionMCPHTTPResponse(url: url, status: 200), Data())
            }
            Issue.record("unexpected request: \(url)")
            throw URLError(.badServerResponse)
        }
        let service = NotionService(
            secrets: store, session: makeNotionMCPStubSession(),
            rateLimiter: NotionRateLimiter(minInterval: 0), fixtures: false,
            mcpAuth: makeService(store: store, server: StubOAuthLoopback(boundPort: 1)))

        _ = try await service.signOut()
        #expect(revoked.read()?["token"] == "refresh-1")
        #expect(revoked.read()?["hint"] == "refresh_token")
        #expect(revoked.read()?["client"] == "client-1")
        #expect(readGrant(from: store) == nil)
    }

    @Test func signOutDeletesGrantAndLegacyToken() async throws {
        let store = InMemorySecretStore()
        try seedGrant(store)
        try store.write(
            "ntn_legacy", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        let service = NotionService(
            secrets: store, session: makeNotionMCPStubSession(),
            rateLimiter: NotionRateLimiter(minInterval: 0), fixtures: false)
        let out = try await service.signOut()
        #expect(out == NotionOK())
        #expect(
            store.read(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionMCPGrantAccount) == nil)
        #expect(
            store.read(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionTokenAccount) == nil)
        _ = try await service.signOut()
        let after = try await service.listRecents()
        #expect(after.status == .signedOut)
    }

    // MARK: - RPC wiring

    @Test func notionSignInMethodsOverRPC() async throws {
        defer { NotionMCPStubURLProtocol.clear() }
        succeedDCRAndExchange()
        let store = InMemorySecretStore()
        let transport = InMemoryTransport()
        let server = RPCServer(transport: transport)
        // Injected browser + stub loopback: no real browser opens and no
        // real port binds (the production registration would do both).
        let opened = OpenedURLs()
        let loopback = StubOAuthLoopback(boundPort: 59991)
        await server.registerNotionMethods(
            session: makeNotionMCPStubSession(), secrets: store, environment: [:],
            openBrowser: { opened.record($0) }, makeServer: { loopback })
        let startReply = await server.handleLine(
            #"{"jsonrpc":"2.0","id":1,"method":"notion.signInStart"}"#)
        let start = try #require(startReply)
        #expect(start.contains("\"ok\":true"))
        #expect(opened.urls.count == 1)
        let pollReply = await server.handleLine(
            #"{"jsonrpc":"2.0","id":2,"method":"notion.signInPoll"}"#)
        #expect((try #require(pollReply)).contains("\"status\":\"pending\""))
        let cancelReply = await server.handleLine(
            #"{"jsonrpc":"2.0","id":3,"method":"notion.signInCancel"}"#)
        #expect((try #require(cancelReply)).contains("\"ok\":true"))
    }

    @Test func fixturesRegistrationAnswersUnavailable() async throws {
        let transport = InMemoryTransport(lines: [
            #"{"jsonrpc":"2.0","id":1,"method":"notion.signInStart"}"#,
            #"{"jsonrpc":"2.0","id":2,"method":"notion.signInPoll"}"#,
            #"{"jsonrpc":"2.0","id":3,"method":"notion.signInCancel"}"#,
        ])
        let server = RPCServer(transport: transport)
        await server.registerNotionMethods(
            session: makeNotionMCPStubSession(), secrets: InMemorySecretStore(),
            environment: ["MOKI_FIXTURES": "1"])
        await server.run()
        let output = await transport.collectedOutput()
        #expect(output.count == 3)
        // Responses may arrive out of order (`run()` answers each line in
        // its own task), so match by request id, never by position — the
        // mok-d5k flake's Notion twin of the Google suite's fixed test.
        var byID: [Int: String] = [:]
        for line in output {
            guard let data = line.data(using: .utf8),
                let json = try? JSONDecoder().decode(JSONValue.self, from: data),
                case .object(let envelope) = json,
                case .int(let id) = envelope["id"]
            else { continue }
            byID[id] = line
        }
        #expect(byID[1]?.contains("-32000") == true)
        #expect(byID[1]?.contains("unavailable in fixtures") == true)
        #expect(byID[2]?.contains("\"status\":\"error\"") == true)
        #expect(byID[3]?.contains("\"ok\":true") == true)
    }
}

// MARK: - Test-only helpers

private func mcpBodyMethod(_ request: URLRequest) -> String? {
    guard let json = try? JSONDecoder().decode(JSONValue.self, from: notionMCPStubBody(request)),
        case .object(let dict) = json,
        case .string(let method) = dict["method"]
    else { return nil }
    return method
}

/// Body bytes however URLSession delivered them: `httpBody` when set,
/// else the `httpBodyStream` URLProtocol stubs receive (same pattern as
/// the Google sign-in suite's stub).
private func notionMCPStubBody(_ request: URLRequest) -> Data {
    if let body = request.httpBody, !body.isEmpty { return body }
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open()
    defer { stream.close() }
    var body = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
        let read = stream.read(&buffer, maxLength: buffer.count)
        if read <= 0 { break }
        body.append(buffer, count: read)
    }
    return body
}
