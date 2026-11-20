import Foundation
import Testing

@testable import MokiHelperCore

// MARK: - Stubs

/// Records requests and serves canned responses. Private to this file (the
/// Google suite carries its own stub type with separate static state).
private final class NotionStubURLProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler:
        (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    static func setHandler(
        _ handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
    ) {
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

private final class NotionRequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []

    func append(_ request: URLRequest) {
        lock.withLock { requests.append(request) }
    }

    var all: [URLRequest] {
        lock.withLock { requests }
    }
}

private func makeNotionStubSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [NotionStubURLProtocol.self]
    return URLSession(configuration: config)
}

private func notionHTTPResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func notionJSONData(_ object: Any) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
}

private func makeNotionService(
    secrets: any SecretStoring = InMemorySecretStore(),
    session: URLSession? = nil
) -> NotionService {
    NotionService(
        secrets: secrets,
        session: session ?? makeNotionStubSession(),
        rateLimiter: NotionRateLimiter(minInterval: 0),
        fixtures: false)
}

private func notionSearchPayload(_ results: [[String: Any]]) -> [String: Any] {
    ["object": "list", "results": results, "has_more": false]
}

private func notionPageResult(
    id: String = "11111111-1111-4111-8111-111111111111",
    title: String = "Roadmap",
    lastEdited: String = "2026-11-20T10:00:00.000Z"
) -> [String: Any] {
    [
        "object": "page",
        "id": id,
        "last_edited_time": lastEdited,
        "url": "https://www.notion.so/roadmap-\(id)",
        "properties": [
            "title": [
                "id": "title",
                "type": "title",
                "title": [["plain_text": title]],
            ]
        ],
    ]
}

@Suite(.serialized)
struct NotionServiceTests {
    // MARK: - Request shape

    @Test func searchRequestShape() throws {
        let request = notionSearchRequest(token: "ntn_test")
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://api.notion.com/v1/search")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer ntn_test")
        #expect(request.value(forHTTPHeaderField: "Notion-Version") == "2022-06-28")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        let body = try #require(request.httpBody.flatMap {
            try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
        })
        #expect(body["page_size"] as? Int == 12)
        let sort = try #require(body["sort"] as? [String: String])
        #expect(sort["timestamp"] == "last_edited_time")
        #expect(sort["direction"] == "descending")
    }

    // MARK: - Signed-out state

    @Test func listRecentsSignedOutWithNoToken() async throws {
        let log = NotionRequestLog()
        NotionStubURLProtocol.setHandler { request in
            log.append(request)
            return (notionHTTPResponse(url: request.url!, status: 200), notionJSONData([:]))
        }
        defer { NotionStubURLProtocol.clear() }
        let result = try await makeNotionService().listRecents()
        #expect(result.status == .signedOut)
        #expect(result.items.isEmpty)
        // No token, no network.
        #expect(log.all.isEmpty)
    }

    // MARK: - Token lifecycle

    @Test func setTokenSignOutRoundTrip() async throws {
        let store = InMemorySecretStore()
        let service = makeNotionService(secrets: store)
        let set = try await service.setToken("  ntn_live  ")
        #expect(set == NotionOK())
        #expect(
            store.read(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionTokenAccount) == "ntn_live")

        let out = try await service.signOut()
        #expect(out == NotionOK())
        #expect(
            store.read(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionTokenAccount) == nil)
        // Sign-out is idempotent: wiping twice still succeeds.
        _ = try await service.signOut()
        let after = try await service.listRecents()
        #expect(after.status == .signedOut)
    }

    @Test func setTokenBlankThrowsInvalidParams() async {
        let service = makeNotionService()
        do {
            _ = try await service.setToken("   ")
            Issue.record("expected InvalidParamsError")
        } catch is InvalidParamsError {
        } catch {
            Issue.record("wrong error: \(error)")
        }
    }

    @Test func setTokenViaRPCRejectsBlank() async throws {
        let service = makeNotionService()
        let handler = notionSetTokenHandler(service: service)
        do {
            _ = try await handler(.string("not-an-object"))
            Issue.record("expected InvalidParamsError")
        } catch is InvalidParamsError {
        } catch {
            Issue.record("wrong error: \(error)")
        }
    }

    // MARK: - Search mapping

    @Test func listRecentsMapsPagesAndDatabases() async throws {
        let store = InMemorySecretStore()
        try store.write(
            "ntn_live", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        NotionStubURLProtocol.setHandler { request in
            #expect(request.value(forHTTPHeaderField: "Notion-Version") == "2022-06-28")
            #expect(
                request.value(forHTTPHeaderField: "Authorization") == "Bearer ntn_live")
            return (
                notionHTTPResponse(url: request.url!, status: 200),
                notionJSONData(
                    notionSearchPayload([
                        notionPageResult(),
                        [
                            "object": "database",
                            "id": "22222222-2222-4222-8222-222222222222",
                            "last_edited_time": "2026-11-19T10:00:00.000Z",
                            "url": "https://www.notion.so/tasks-222",
                            "title": [["plain_text": "Tasks"]],
                        ],
                        [
                            // No title anywhere → "(Untitled)", still listed.
                            "object": "page",
                            "id": "33333333-3333-4333-8333-333333333333",
                            "last_edited_time": "2026-11-18T10:00:00.000Z",
                            "properties": [:],
                        ],
                        [
                            // No id → skipped, never handed to the renderer.
                            "object": "page",
                            "last_edited_time": "2026-11-17T10:00:00.000Z",
                            "properties": [:],
                        ],
                    ]))
            )
        }
        defer { NotionStubURLProtocol.clear() }

        let result = try await makeNotionService(secrets: store).listRecents()
        #expect(result.status == .ok)
        #expect(result.items.count == 3)
        #expect(result.items[0].title == "Roadmap")
        #expect(result.items[0].object == "page")
        #expect(result.items[1].title == "Tasks")
        #expect(result.items[1].object == "database")
        #expect(result.items[2].title == "(Untitled)")
    }

    @Test func datelessResultsAreSkipped() async throws {
        let store = InMemorySecretStore()
        try store.write(
            "ntn_live", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        NotionStubURLProtocol.setHandler { request in
            (
                notionHTTPResponse(url: request.url!, status: 200),
                notionJSONData(
                    notionSearchPayload([
                        notionPageResult(),
                        [
                            // No last_edited_time → dropped, never handed to
                            // the renderer with an empty updatedAt.
                            "object": "page",
                            "id": "99999999-9999-4999-8999-999999999999",
                            "url": "https://www.notion.so/undated-999",
                            "properties": [
                                "title": [
                                    "id": "title",
                                    "type": "title",
                                    "title": [["plain_text": "Undated"]],
                                ]
                            ],
                        ],
                    ]))
            )
        }
        defer { NotionStubURLProtocol.clear() }

        let result = try await makeNotionService(secrets: store).listRecents()
        #expect(result.status == .ok)
        #expect(result.items.count == 1)
        #expect(result.items[0].title == "Roadmap")
        #expect(result.items[0].lastEditedTime == "2026-11-20T10:00:00.000Z")
    }

    @Test func tokenNeverAppearsInResult() async throws {
        let token = "ntn_super_secret_token"
        let store = InMemorySecretStore()
        try store.write(
            token, service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        NotionStubURLProtocol.setHandler { request in
            (
                notionHTTPResponse(url: request.url!, status: 200),
                notionJSONData(notionSearchPayload([notionPageResult()]))
            )
        }
        defer { NotionStubURLProtocol.clear() }

        let result = try await makeNotionService(secrets: store).listRecents()
        let encoded = String(data: try JSONEncoder().encode(result), encoding: .utf8) ?? ""
        #expect(!encoded.contains(token))
    }

    // MARK: - Error mapping

    @Test func unauthorizedReturnsAuthExpiredEnvelope() async throws {
        let store = InMemorySecretStore()
        try store.write(
            "ntn_dead", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        NotionStubURLProtocol.setHandler { request in
            (
                notionHTTPResponse(url: request.url!, status: 401),
                notionJSONData(["message": "API token is invalid."])
            )
        }
        defer { NotionStubURLProtocol.clear() }

        // A dead token is a state, not a throw: the lens renders sign-in.
        let result = try await makeNotionService(secrets: store).listRecents()
        #expect(result.status == .authExpired)
        #expect(result.items.isEmpty)
    }

    @Test func rateLimitedThrows() async {
        let store = InMemorySecretStore()
        try? store.write(
            "ntn_live", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        NotionStubURLProtocol.setHandler { request in
            (notionHTTPResponse(url: request.url!, status: 429), Data())
        }
        defer { NotionStubURLProtocol.clear() }

        do {
            _ = try await makeNotionService(secrets: store).listRecents()
            Issue.record("expected rate_limited")
        } catch let error as AppError {
            #expect(error.code == "rate_limited")
        } catch {
            Issue.record("wrong error: \(error)")
        }
    }

    @Test func serverErrorThrowsUnreachable() async {
        let store = InMemorySecretStore()
        try? store.write(
            "ntn_live", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        NotionStubURLProtocol.setHandler { request in
            (notionHTTPResponse(url: request.url!, status: 500), Data())
        }
        defer { NotionStubURLProtocol.clear() }

        do {
            _ = try await makeNotionService(secrets: store).listRecents()
            Issue.record("expected unreachable")
        } catch let error as AppError {
            #expect(error.code == "unreachable")
        } catch {
            Issue.record("wrong error: \(error)")
        }
    }

    @Test func networkFailureThrowsUnreachable() async {
        let store = InMemorySecretStore()
        try? store.write(
            "ntn_live", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        NotionStubURLProtocol.setHandler { _ in throw URLError(.notConnectedToInternet) }
        defer { NotionStubURLProtocol.clear() }

        do {
            _ = try await makeNotionService(secrets: store).listRecents()
            Issue.record("expected unreachable")
        } catch let error as AppError {
            #expect(error.code == "unreachable")
        } catch {
            Issue.record("wrong error: \(error)")
        }
    }

    @Test func malformedPayloadThrowsUnreachable() async {
        let store = InMemorySecretStore()
        try? store.write(
            "ntn_live", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        NotionStubURLProtocol.setHandler { request in
            (notionHTTPResponse(url: request.url!, status: 200), Data("not json".utf8))
        }
        defer { NotionStubURLProtocol.clear() }

        do {
            _ = try await makeNotionService(secrets: store).listRecents()
            Issue.record("expected unreachable")
        } catch let error as AppError {
            #expect(error.code == "unreachable")
        } catch {
            Issue.record("wrong error: \(error)")
        }
    }

    // MARK: - Fixtures

    @Test func fixturesReturnTwelveWithoutTokenOrNetwork() async throws {
        await NotionFixtureAuthState.shared.reset()
        let log = NotionRequestLog()
        NotionStubURLProtocol.setHandler { request in
            log.append(request)
            throw URLError(.notConnectedToInternet)
        }
        defer { NotionStubURLProtocol.clear() }

        let service = NotionService(
            secrets: InMemorySecretStore(),
            session: makeNotionStubSession(),
            rateLimiter: NotionRateLimiter(minInterval: 0),
            fixtures: true)
        let result = try await service.listRecents()
        #expect(result.status == .ok)
        #expect(result.items.count == 12)
        #expect(log.all.isEmpty)
    }

    // MARK: - Fixture auth (hermetic: never touches the Keychain)

    private func makeFixtureNotionService(
        secrets: any SecretStoring = InMemorySecretStore()
    ) -> NotionService {
        NotionService(
            secrets: secrets,
            session: makeNotionStubSession(),
            rateLimiter: NotionRateLimiter(minInterval: 0),
            fixtures: true)
    }

    @Test func fixtureSignOutListsSignedOutWithoutTouchingSecrets() async throws {
        await NotionFixtureAuthState.shared.reset()
        let store = InMemorySecretStore()
        try store.write(
            "ntn_real", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        let service = makeFixtureNotionService(secrets: store)

        let out = try await service.signOut()
        #expect(out == NotionOK())
        // The real entry survives a fixtures sign-out.
        #expect(
            store.read(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionTokenAccount) == "ntn_real")

        let result = try await service.listRecents()
        #expect(result.status == .signedOut)
        #expect(result.items.isEmpty)
        await NotionFixtureAuthState.shared.reset()
    }

    @Test func fixtureSetTokenRestoresRowsWithoutTouchingSecrets() async throws {
        await NotionFixtureAuthState.shared.reset()
        let store = InMemorySecretStore()
        let service = makeFixtureNotionService(secrets: store)

        _ = try await service.signOut()
        let signedOut = try await service.listRecents()
        #expect(signedOut.status == .signedOut)
        #expect(signedOut.items.isEmpty)

        let set = try await service.setToken("  ntn_fixture  ")
        #expect(set == NotionOK())
        // Nothing written anywhere: the token lives only in the process.
        #expect(
            store.read(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionTokenAccount) == nil)

        let result = try await service.listRecents()
        #expect(result.status == .ok)
        #expect(result.items.count == 12)
        await NotionFixtureAuthState.shared.reset()
    }

    @Test func fixtureSetTokenBlankStillThrowsWithoutChangingState() async throws {
        await NotionFixtureAuthState.shared.reset()
        let service = makeFixtureNotionService()
        do {
            _ = try await service.setToken("   ")
            Issue.record("expected InvalidParamsError")
        } catch is InvalidParamsError {
        } catch {
            Issue.record("wrong error: \(error)")
        }
        // Still signed in: rows keep flowing.
        let result = try await service.listRecents()
        #expect(result.status == .ok)
        #expect(result.items.count == 12)
        await NotionFixtureAuthState.shared.reset()
    }

    // MARK: - RPC wiring

    @Test func notionMethodsOverRPC() async throws {
        NotionStubURLProtocol.setHandler { request in
            (
                notionHTTPResponse(url: request.url!, status: 200),
                notionJSONData(notionSearchPayload([notionPageResult()]))
            )
        }
        defer { NotionStubURLProtocol.clear() }

        let store = InMemorySecretStore()
        let transport = InMemoryTransport()
        let server = RPCServer(transport: transport)
        await server.registerNotionMethods(
            session: makeNotionStubSession(), secrets: store, environment: [:])
        // Sequential handleLine calls (not run(), which dispatches each
        // request in its own task): setToken must land before listRecents.
        var output: [String] = []
        for line in [
            #"{"jsonrpc":"2.0","id":1,"method":"notion.listRecents"}"#,
            #"{"jsonrpc":"2.0","id":2,"method":"notion.setToken","params":{"token":"ntn_rpc"}}"#,
            #"{"jsonrpc":"2.0","id":3,"method":"notion.listRecents"}"#,
            #"{"jsonrpc":"2.0","id":4,"method":"notion.signOut"}"#,
            #"{"jsonrpc":"2.0","id":5,"method":"notion.listRecents"}"#,
        ] {
            let reply = await server.handleLine(line)
            output.append(try #require(reply))
        }
        #expect(output.count == 5)

        func resultStatus(_ line: String) throws -> (id: Int, status: String?, ok: Bool?) {
            let value = try JSONDecoder().decode(JSONValue.self, from: Data(line.utf8))
            guard case .object(let envelope) = value,
                case .int(let id) = envelope["id"],
                case .object(let result) = envelope["result"]
            else {
                throw InvalidParamsError("unexpected envelope: \(line)")
            }
            let status: String? = {
                if case .string(let s) = result["status"] { return s }
                return nil
            }()
            let ok: Bool? = {
                if case .bool(let b) = result["ok"] { return b }
                return nil
            }()
            return (id, status, ok)
        }

        // Replies may arrive out of order (each request runs in its own
        // task), so index by id rather than position.
        var byID: [Int: (status: String?, ok: Bool?)] = [:]
        for line in output {
            let parsed = try resultStatus(line)
            byID[parsed.id] = (parsed.status, parsed.ok)
        }
        #expect(byID[1]?.status == "signed_out")
        #expect(byID[2]?.ok == true)
        #expect(byID[3]?.status == "ok")
        #expect(byID[4]?.ok == true)
        #expect(byID[5]?.status == "signed_out")
    }
}

@Suite(.serialized)
struct NotionRateLimiterTests {
    @Test func enforcesMinimumInterval() async throws {
        let limiter = NotionRateLimiter(minInterval: 0.2)
        try await limiter.acquire()
        let start = Date()
        try await limiter.acquire()
        #expect(Date().timeIntervalSince(start) >= 0.15)
    }

    @Test func concurrentWaitersSerialize() async throws {
        let limiter = NotionRateLimiter(minInterval: 0.05)
        let start = Date()
        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<5 {
                group.addTask { try await limiter.acquire() }
            }
            try await group.waitForAll()
        }
        // Five serialized slots at 50ms: at least four gaps elapsed.
        #expect(Date().timeIntervalSince(start) >= 0.15)
    }

    @Test func zeroIntervalNeverWaits() async throws {
        let limiter = NotionRateLimiter(minInterval: 0)
        let start = Date()
        for _ in 0..<10 {
            try await limiter.acquire()
        }
        #expect(Date().timeIntervalSince(start) < 0.5)
    }

    @Test func cancelledAcquireThrowsInsteadOfFiring() async throws {
        let limiter = NotionRateLimiter(minInterval: 60)
        try await limiter.acquire()
        let waiter = Task { try await limiter.acquire() }
        waiter.cancel()
        await #expect(throws: CancellationError.self) {
            try await waiter.value
        }
    }
}
