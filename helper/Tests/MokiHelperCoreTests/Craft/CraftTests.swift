import Foundation
import Testing

@testable import MokiHelperCore

// MARK: - Stubs

/// Serves canned responses. Private to this file. Static handler state is
/// lock-guarded; every test sets then clears it.
private final class CraftStubURLProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler:
        (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?
    nonisolated(unsafe) private static var requests: Int = 0

    static func setHandler(
        _ handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
    ) {
        lock.withLock {
            self.handler = handler
            self.requests = 0
        }
    }

    static func requestCount() -> Int {
        lock.withLock { requests }
    }

    static func clear() {
        lock.withLock {
            self.handler = nil
            self.requests = 0
        }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let handler = Self.lock.withLock { () -> (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))? in
            Self.requests += 1
            return Self.handler
        }
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

private func makeCraftStubSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [CraftStubURLProtocol.self]
    return URLSession(configuration: config)
}

private func craftHTTPResponse(url: URL, status: Int, headers: [String: String]? = nil) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: headers)!
}

private func craftJSONData(_ string: String) -> Data {
    Data(string.utf8)
}

private let craftConnectionJSON = """
    {"space":{"id":"space-1","name":"My Space","timezone":"Europe/Berlin"},
     "utc":{"time":"2026-09-05T10:00:00Z"}}
    """

private let craftBase = URL(string: "https://connect.craft.do/links/tok123/api/v1")!

private func craftTempLocations() -> (CraftLocations, URL) {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("moki.test.craft.\(UUID().uuidString)", isDirectory: true)
    return (CraftLocations(credentialURL: dir.appendingPathComponent("craft-connection.json")), dir)
}

// MARK: - URL validation

@Suite("Craft", .serialized)
struct CraftTests {
    @Test("Accepts a connection URL with surrounding whitespace and trailing slash")
    func acceptsWhitespaceAndTrailingSlash() {
        let url = CraftClient.baseURL(
            from: "  https://connect.craft.do/links/abc123/api/v1/ \n")
        #expect(url?.absoluteString == "https://connect.craft.do/links/abc123/api/v1")
    }

    @Test("Rejects non-Craft hosts including the other Craft company")
    func rejectsNonCraftHosts() {
        #expect(CraftClient.baseURL(from: "https://api.craft.co/v1") == nil)
        #expect(CraftClient.baseURL(from: "https://example.com/links/x/api/v1") == nil)
    }

    @Test("Rejects non-HTTPS and non-URLs")
    func rejectsNonHTTPSAndNonURLs() {
        #expect(CraftClient.baseURL(from: "http://connect.craft.do/links/x/api/v1") == nil)
        #expect(CraftClient.baseURL(from: "not a url") == nil)
        #expect(CraftClient.baseURL(from: "") == nil)
        #expect(CraftClient.baseURL(from: "   ") == nil)
    }

    @Test("Rejects the bare host and lookalike hosts")
    func rejectsBareAndLookalikeHosts() {
        #expect(
            CraftClient.baseURL(from: "https://connect.craft.do") == nil,
            "the bare host carries no credential")
        #expect(CraftClient.baseURL(from: "https://connect.craft.do.evil.com/links/x/api/v1") == nil)
        #expect(CraftClient.baseURL(from: "https://connect.craft.do@evil.com/links/x/api/v1") == nil)
    }

    @Test("Rejects userinfo, @-tricks, backslashes, and inner whitespace")
    func rejectsHostileURLs() {
        // Userinfo on the real host still carries an attacker prefix.
        #expect(CraftClient.baseURL(from: "https://user@connect.craft.do/links/x/api/v1") == nil)
        #expect(CraftClient.baseURL(from: "https://user:pass@connect.craft.do/links/x/api/v1") == nil)
        // Backslash normalises to slash in URL parsers — never let one in.
        #expect(CraftClient.baseURL(from: "https://connect.craft.do\\@evil.com/links/x/api/v1") == nil)
        #expect(CraftClient.baseURL(from: "https://connect.craft.do/links\\x/api/v1") == nil)
        // Inner whitespace is never part of a pasted URL.
        #expect(CraftClient.baseURL(from: "https://connect.craft.do/links/x/api/v1 extra") == nil)
        #expect(CraftClient.baseURL(from: "https://connect.craft.do/links/x/api/v1\tevil") == nil)
    }

    @Test("Rejects wrong path shapes, ports, queries, and fragments")
    func rejectsWrongShapes() {
        #expect(CraftClient.baseURL(from: "https://connect.craft.do/links/x") == nil)
        #expect(CraftClient.baseURL(from: "https://connect.craft.do/links//api/v1") == nil)
        #expect(CraftClient.baseURL(from: "https://connect.craft.do/links/x/api/v2") == nil)
        #expect(CraftClient.baseURL(from: "https://connect.craft.do/other/x/api/v1") == nil)
        #expect(CraftClient.baseURL(from: "https://connect.craft.do/links/x/api/v1/extra") == nil)
        #expect(CraftClient.baseURL(from: "https://connect.craft.do:443/links/x/api/v1") == nil)
        #expect(CraftClient.baseURL(from: "https://connect.craft.do/links/x/api/v1?next=evil") == nil)
        #expect(CraftClient.baseURL(from: "https://connect.craft.do/links/x/api/v1#frag") == nil)
    }

    @Test("Host match is case-insensitive")
    func hostCaseInsensitive() {
        #expect(
            CraftClient.baseURL(from: "https://CONNECT.CRAFT.DO/links/x/api/v1")?.host?
                .lowercased() == "connect.craft.do")
    }

// MARK: - Payload decoding
    @Test("Decodes the space name, id, and server clock")
    func decodesSpace() {
        let space = CraftClient.decodeSpace(from: craftJSONData(craftConnectionJSON))
        #expect(space?.name == "My Space")
        #expect(space?.spaceID == "space-1")
        #expect(space?.serverTime != nil)
    }

    @Test("Decodes a fractional-second clock")
    func decodesFractionalClock() {
        let json = #"{"space":{"name":"S"},"utc":{"time":"2026-09-05T10:00:00.123Z"}}"#
        #expect(CraftClient.decodeSpace(from: craftJSONData(json))?.serverTime != nil)
    }

    @Test("An unparseable clock keeps the name with an unknown time")
    func unknownClockIsNil() {
        let json = #"{"space":{"name":"S"},"utc":{"time":"sometime"}}"#
        let space = CraftClient.decodeSpace(from: craftJSONData(json))
        #expect(space?.name == "S")
        #expect(space?.serverTime == nil)
    }

    @Test("Rejects payloads with no space name")
    func rejectsNamelessPayload() {
        #expect(CraftClient.decodeSpace(from: craftJSONData(#"{"space":{}}"#)) == nil)
        #expect(CraftClient.decodeSpace(from: craftJSONData("not json")) == nil)
        #expect(CraftClient.decodeSpace(from: craftJSONData(#"{"space":{"name":""}}"#)) == nil)
    }

// MARK: - Client error mapping
    @Test("A 200 with a space verifies")
    func verifies() async {
        CraftStubURLProtocol.setHandler { request in
            #expect(request.url?.absoluteString.hasSuffix("/connection") == true)
            return (craftHTTPResponse(url: request.url!, status: 200), craftJSONData(craftConnectionJSON))
        }
        defer { CraftStubURLProtocol.clear() }
        let result = await CraftClient(baseURL: craftBase, session: makeCraftStubSession())
            .checkConnection()
        switch result {
        case .success(let space):
            #expect(space.name == "My Space")
            #expect(space.spaceID == "space-1")
            #expect(space.serverTime != nil)
        case .failure:
            Issue.record("a 200 with a space must verify")
        }
    }

    @Test("Non-2xx is unreachable with its status")
    func non2xxIsUnreachable() async {
        CraftStubURLProtocol.setHandler { request in
            (craftHTTPResponse(url: request.url!, status: 401), craftJSONData("{}"))
        }
        defer { CraftStubURLProtocol.clear() }
        let result = await CraftClient(baseURL: craftBase, session: makeCraftStubSession())
            .checkConnection()
        #expect(result == .failure(.unreachable(statusCode: 401)))
    }

    @Test("A network failure is unreachable without a status")
    func networkFailureIsUnreachable() async {
        CraftStubURLProtocol.setHandler { _ in throw URLError(.notConnectedToInternet) }
        defer { CraftStubURLProtocol.clear() }
        let result = await CraftClient(baseURL: craftBase, session: makeCraftStubSession())
            .checkConnection()
        #expect(result == .failure(.unreachable(statusCode: nil)))
    }

    @Test("A 429 is rate-limited, carrying Retry-After")
    func rateLimited() async {
        CraftStubURLProtocol.setHandler { request in
            (craftHTTPResponse(url: request.url!, status: 429, headers: ["Retry-After": "7"]),
             craftJSONData("{}"))
        }
        defer { CraftStubURLProtocol.clear() }
        let result = await CraftClient(baseURL: craftBase, session: makeCraftStubSession())
            .checkConnection()
        #expect(result == .failure(.rateLimited(retryAfter: 7)))
    }

    @Test("An undecodable 200 is unreachable, not a space")
    func badPayloadIsUnreachable() async {
        CraftStubURLProtocol.setHandler { request in
            (craftHTTPResponse(url: request.url!, status: 200), craftJSONData("garbage"))
        }
        defer { CraftStubURLProtocol.clear() }
        let result = await CraftClient(baseURL: craftBase, session: makeCraftStubSession())
            .checkConnection()
        #expect(result == .failure(.unreachable(statusCode: 200)))
    }

    @Test("Documents map in space order, capped by the caller")
    func documentsMap() async {
        let json = """
            {"items":[
             {"id":"d1","title":"First"},
             {"id":"","title":"No id drops"},
             {"id":"d2","title":""},
             {"id":"d3","title":"  "},
             {"id":"d4"}
            ]}
            """
        CraftStubURLProtocol.setHandler { request in
            #expect(request.url?.absoluteString.hasSuffix("/documents") == true)
            return (craftHTTPResponse(url: request.url!, status: 200), craftJSONData(json))
        }
        defer { CraftStubURLProtocol.clear() }
        let result = await CraftClient(baseURL: craftBase, session: makeCraftStubSession())
            .listDocuments()
        switch result {
        case .success(let docs):
            // Space order preserved: no sorting, no recency.
            #expect(docs.map(\.id) == ["d1", "d2", "d3", "d4"])
            #expect(docs[0].title == "First")
            #expect(docs[1].title == "(Untitled)")
            #expect(docs[2].title == "(Untitled)")
            #expect(docs[3].title == "(Untitled)")
        case .failure:
            Issue.record("documents should decode")
        }
    }

    @Test("A failed documents fetch is unreachable")
    func documentsFailureIsUnreachable() async {
        CraftStubURLProtocol.setHandler { request in
            (craftHTTPResponse(url: request.url!, status: 500), craftJSONData("{}"))
        }
        defer { CraftStubURLProtocol.clear() }
        let result = await CraftClient(baseURL: craftBase, session: makeCraftStubSession())
            .listDocuments()
        #expect(result == .failure(.unreachable(statusCode: 500)))
    }

// MARK: - Credential store
    @Test("Round-trips, overwrites, and deletes")
    func roundTrip() {
        let (locations, dir) = craftTempLocations()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CraftCredentialStore(locations: locations)
        #expect(store.load() == nil)
        store.save(CraftCredential(url: "https://connect.craft.do/links/a/api/v1", spaceId: "s1"))
        #expect(store.load() == CraftCredential(url: "https://connect.craft.do/links/a/api/v1", spaceId: "s1"))
        store.save(CraftCredential(url: "https://connect.craft.do/links/b/api/v1", spaceId: "s2"))
        #expect(store.load()?.url == "https://connect.craft.do/links/b/api/v1")
        store.remove()
        #expect(store.load() == nil)
        store.remove()
    }

    @Test("The file is owner-only")
    func ownerOnly() throws {
        let (locations, dir) = craftTempLocations()
        defer { try? FileManager.default.removeItem(at: dir) }
        CraftCredentialStore(locations: locations).save(CraftCredential(url: "https://connect.craft.do/links/x/api/v1"))
        let permissions = try FileManager.default.attributesOfItem(atPath: locations.credentialURL.path)[
            .posixPermissions] as? Int
        #expect(permissions == 0o600)
    }

    @Test("Blank and corrupt files read as missing")
    func blankReadsAsMissing() throws {
        let (locations, dir) = craftTempLocations()
        defer { try? FileManager.default.removeItem(at: dir) }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("  \n".utf8).write(to: locations.credentialURL)
        #expect(CraftCredentialStore(locations: locations).load() == nil)
        try Data("not json".utf8).write(to: locations.credentialURL, options: .atomic)
        #expect(CraftCredentialStore(locations: locations).load() == nil)
    }

// MARK: - Service

    private func service(
        fixtures: Bool = false,
        now: @escaping @Sendable () -> Date = { Date(timeIntervalSince1970: 1_769_000_000) }
    ) -> (CraftService, CraftLocations, URL) {
        let (locations, dir) = craftTempLocations()
        let svc = CraftService(
            store: CraftCredentialStore(locations: locations),
            session: makeCraftStubSession(), fixtures: fixtures, now: now,
            secrets: InMemorySecretStore())
        return (svc, locations, dir)
    }

    @Test("Malformed URLs fail closed without touching the network")
    func malformedFailsClosed() async throws {
        CraftStubURLProtocol.setHandler { _ in throw URLError(.badServerResponse) }
        defer { CraftStubURLProtocol.clear() }
        let (svc, _, dir) = service()
        defer { try? FileManager.default.removeItem(at: dir) }
        let result = try await svc.validate(url: "https://api.craft.co/v1")
        #expect(result == CraftConnectValidateResult(ok: false))
        #expect(CraftStubURLProtocol.requestCount() == 0)
    }

    @Test("Validate verifies and names the space")
    func validateNamesSpace() async throws {
        CraftStubURLProtocol.setHandler { request in
            (craftHTTPResponse(url: request.url!, status: 200), craftJSONData(craftConnectionJSON))
        }
        defer { CraftStubURLProtocol.clear() }
        let (svc, _, dir) = service()
        defer { try? FileManager.default.removeItem(at: dir) }
        let result = try await svc.validate(url: craftBase.absoluteString)
        #expect(result == CraftConnectValidateResult(ok: true, spaceName: "My Space"))
    }

    @Test("A dead network on validate throws unreachable, never ok:false")
    func validateNetworkFailureThrows() async {
        CraftStubURLProtocol.setHandler { _ in throw URLError(.notConnectedToInternet) }
        defer { CraftStubURLProtocol.clear() }
        let (svc, _, dir) = service()
        defer { try? FileManager.default.removeItem(at: dir) }
        do {
            _ = try await svc.validate(url: craftBase.absoluteString)
            Issue.record("a dead network must throw")
        } catch let error as AppError {
            #expect(error.code == "unreachable")
            #expect(!error.message.contains("tok123"), "the credential must not appear in errors")
        } catch {
            Issue.record("wrong error: \(error)")
        }
    }

    @Test("Save stores the normalised URL and space id")
    func saveStores() async throws {
        CraftStubURLProtocol.setHandler { request in
            (craftHTTPResponse(url: request.url!, status: 200), craftJSONData(craftConnectionJSON))
        }
        defer { CraftStubURLProtocol.clear() }
        let (svc, locations, dir) = service()
        defer { try? FileManager.default.removeItem(at: dir) }
        let result = try await svc.save(url: craftBase.absoluteString + "/")
        #expect(result == CraftOK())
        #expect(CraftCredentialStore(locations: locations).load() == CraftCredential(
            url: craftBase.absoluteString, spaceId: "space-1"))
    }

    @Test("A failed save stores nothing")
    func failedSaveStoresNothing() async {
        CraftStubURLProtocol.setHandler { request in
            (craftHTTPResponse(url: request.url!, status: 401), craftJSONData("{}"))
        }
        defer { CraftStubURLProtocol.clear() }
        let (svc, locations, dir) = service()
        defer { try? FileManager.default.removeItem(at: dir) }
        do {
            _ = try await svc.save(url: craftBase.absoluteString)
            Issue.record("a failed check must throw")
        } catch let error as AppError {
            #expect(error.code == "unreachable")
        } catch {
            Issue.record("wrong error: \(error)")
        }
        #expect(CraftCredentialStore(locations: locations).load() == nil)
    }

    @Test("A failed save keeps the previous credential")
    func failedSaveKeepsPrevious() async throws {
        // First validation (save #1) succeeds; every later one fails. Routed
        // on the stub's request count — no captured mutable state.
        CraftStubURLProtocol.setHandler { request in
            if CraftStubURLProtocol.requestCount() == 1 {
                return (craftHTTPResponse(url: request.url!, status: 200), craftJSONData(craftConnectionJSON))
            }
            return (craftHTTPResponse(url: request.url!, status: 401), craftJSONData("{}"))
        }
        defer { CraftStubURLProtocol.clear() }
        let (svc, locations, dir) = service()
        defer { try? FileManager.default.removeItem(at: dir) }
        _ = try await svc.save(url: craftBase.absoluteString)
        do {
            _ = try await svc.save(url: "https://connect.craft.do/links/other/api/v1")
            Issue.record("the second save must throw")
        } catch {}
        #expect(CraftCredentialStore(locations: locations).load()?.url == craftBase.absoluteString)
    }

    @Test("Sign-out clears the credential and still succeeds when empty")
    func signOut() async throws {
        CraftStubURLProtocol.setHandler { request in
            (craftHTTPResponse(url: request.url!, status: 200), craftJSONData(craftConnectionJSON))
        }
        defer { CraftStubURLProtocol.clear() }
        let (svc, locations, dir) = service()
        defer { try? FileManager.default.removeItem(at: dir) }
        _ = try await svc.save(url: craftBase.absoluteString)
        #expect(try await svc.signOut() == CraftOK())
        #expect(CraftCredentialStore(locations: locations).load() == nil)
        #expect(try await svc.signOut() == CraftOK())
    }

    @Test("No credential lists as signed out, not unreachable")
    func noCredentialIsSignedOut() async {
        let (svc, _, dir) = service()
        defer { try? FileManager.default.removeItem(at: dir) }
        let result = await svc.listRecents()
        #expect(result == DocsListRecentsResult(items: [], unreachable: false, signedOut: true))
    }

    @Test("Listing maps rows, caps at 12, and never claims recency")
    func listingMapsRows() async throws {
        let items = (1...20).map { #"{"id":"d\#($0)","title":"Doc \#($0)"}"# }.joined(separator: ",")
        CraftStubURLProtocol.setHandler { request in
            if request.url?.absoluteString.hasSuffix("/connection") == true {
                return (craftHTTPResponse(url: request.url!, status: 200), craftJSONData(craftConnectionJSON))
            }
            return (craftHTTPResponse(url: request.url!, status: 200), craftJSONData(#"{"items":[\#(items)]}"#))
        }
        defer { CraftStubURLProtocol.clear() }
        let (svc, _, dir) = service()
        defer { try? FileManager.default.removeItem(at: dir) }
        _ = try await svc.save(url: craftBase.absoluteString)
        #expect(CraftStubURLProtocol.requestCount() == 1, "save validates: one request")
        let result = await svc.listRecents()
        #expect(CraftStubURLProtocol.requestCount() == 2, "list is one request — no fan-out")
        #expect(result.unreachable == false)
        #expect(result.signedOut == false)
        #expect(result.items.count == 12, "the section caps at 12")
        #expect(result.items.map(\.id) == (1...12).map { "d\($0)" }, "space order, unsorted")
        let first = try #require(result.items.first)
        #expect(first.source == .craft)
        #expect(
            first.openUrl == "https://docs.craft.do/editor/d/space-1/d1",
            "a known space id makes the row preview in the webview guest")
        #expect(first.deepLink == "craftdocs://open?spaceId=space-1&blockId=d1")
        #expect(first.updatedAt == iso8601String(Date(timeIntervalSince1970: 1_769_000_000)),
            "fetch-time ISO, not a modified date")
    }

    @Test("A dead network lists as unreachable, never empty-ok")
    func deadNetworkIsUnreachable() async throws {
        // Save's validation succeeds; the later list fetch dies.
        CraftStubURLProtocol.setHandler { request in
            if CraftStubURLProtocol.requestCount() == 1 {
                return (craftHTTPResponse(url: request.url!, status: 200), craftJSONData(craftConnectionJSON))
            }
            throw URLError(.notConnectedToInternet)
        }
        defer { CraftStubURLProtocol.clear() }
        let (svc, _, dir) = service()
        defer { try? FileManager.default.removeItem(at: dir) }
        _ = try await svc.save(url: craftBase.absoluteString)
        let result = await svc.listRecents()
        #expect(result == DocsListRecentsResult(items: [], unreachable: true, signedOut: false))
    }

    @Test("Fixtures list 12 canonical rows with no network or files")
    func fixturesList() async {
        CraftStubURLProtocol.setHandler { _ in throw URLError(.badServerResponse) }
        defer { CraftStubURLProtocol.clear() }
        let (locations, _) = craftTempLocations()
        let svc = CraftService(
            store: CraftCredentialStore(locations: locations),
            session: makeCraftStubSession(), fixtures: true,
            secrets: InMemorySecretStore())
        let result = await svc.listRecents()
        #expect(CraftStubURLProtocol.requestCount() == 0)
        #expect(result.items.count == 12)
        #expect(result.unreachable == false)
        #expect(result.signedOut == false)
        #expect(result.items.allSatisfy {
            $0.openUrl.hasPrefix("https://docs.craft.do/editor/d/fixture-space/")
                && ($0.deepLink ?? "").hasPrefix("craftdocs://open?")
        })
        // Served path must emit the canonical `s/…` table row-for-row —
        // the same ids `DocsFixtures`, the renderer `DOC_FIXTURES`, and the
        // pin tests agree on — or ?mokiDoc breaks under MOKI_FIXTURES=1.
        #expect(result.items.map(\.id) == DocsFixtures.craftRecents().map(\.id))
        #expect(
            result.items.first?.deepLink
                == "craftdocs://open?spaceId=fixture-space&blockId=s/launch-checklist-a1b2c3",
            "fixture ids carry `/` unencoded — URLComponents would emit %2F and break byte-agreement")
    }

    @Test("Fixtures validate the shape but skip the network")
    func fixturesValidate() async throws {
        defer { CraftStubURLProtocol.clear() }
        let (locations, _) = craftTempLocations()
        let svc = CraftService(
            store: CraftCredentialStore(locations: locations),
            session: makeCraftStubSession(), fixtures: true,
            secrets: InMemorySecretStore())
        #expect(try await svc.validate(url: "garbage") == CraftConnectValidateResult(ok: false))
        #expect(try await svc.validate(url: craftBase.absoluteString).ok == true)
        #expect(CraftStubURLProtocol.requestCount() == 0)
    }

    @Test("The list envelope encodes the exact contract wire shape")
    func wireShape() throws {
        let result = DocsListRecentsResult(
            items: [DocItem(
                id: "d1", title: "T", source: .craft, updatedAt: "2026-11-20T09:33:20Z",
                openUrl: "",
                deepLink: "craftdocs://open?spaceId=s&blockId=d1")],
            unreachable: false, signedOut: false)
        let data = try JSONEncoder().encode(result)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let item = try #require((json?["items"] as? [[String: Any]])?.first)
        #expect(Set(item.keys) == ["id", "title", "source", "updatedAt", "openUrl", "deepLink"])
        #expect(item["deepLink"] as? String == "craftdocs://open?spaceId=s&blockId=d1")
        #expect(item["openUrl"] as? String == "")
    }

    @Test("Deep links encode ids and omit a missing space id")
    func deepLinks() {
        #expect(craftDeepLink(spaceId: "s 1", blockId: "d2") == "craftdocs://open?spaceId=s%201&blockId=d2")
        #expect(craftDeepLink(spaceId: nil, blockId: "d1") == "craftdocs://open?blockId=d1")
    }
}

// MARK: - Hosted-MCP OAuth scaffolding

/// Controllable loopback stand-in delivering full callbacks by hand.
/// Mirrors the Notion worker's `StubOAuthLoopback` (same shared contract).
private final class CraftStubLoopback: OAuthLoopbackServing, @unchecked Sendable {
    private let lock = NSLock()
    private var waiter: CheckedContinuation<OAuthLoopbackCallback, Error>?
    private var delivered: Result<OAuthLoopbackCallback, Error>?
    private var stopped = false
    private(set) var startCount = 0
    private(set) var stopCount = 0
    let requestedPorts = CraftBox<[Int?]>([])
    let boundPort: Int

    init(boundPort: Int) {
        self.boundPort = boundPort
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
}

private final class CraftBox<Value>: @unchecked Sendable {
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

private final class CraftOpenedURLs: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var urls: [URL] = []

    func record(_ url: URL) {
        lock.withLock { urls.append(url) }
    }
}

private let craftProtectedResourceJSON = """
    {"resource":"https://mcp.craft.do/my/mcp",\
    "authorization_servers":["https://mcp.craft.do/my/auth"]}
    """

private let craftAuthServerJSON = """
    {"issuer":"https://mcp.craft.do/my/auth",\
    "authorization_endpoint":"https://mcp.craft.do/my/auth/authorize",\
    "token_endpoint":"https://mcp.craft.do/my/auth/token",\
    "registration_endpoint":"https://mcp.craft.do/my/auth/register",\
    "revocation_endpoint":"https://mcp.craft.do/my/auth/revoke",\
    "code_challenge_methods_supported":["S256"]}
    """

private func craftStubBody(_ request: URLRequest) -> Data? {
    if let body = request.httpBody { return body }
    // URLSession may hand a POST body to the protocol as a stream rather
    // than `httpBody` (observed on form posts; the bytes still travel —
    // Content-Length proves it). Drain it so stub assertions see the same
    // bytes either way.
    guard let stream = request.httpBodyStream else { return nil }
    stream.open()
    defer { stream.close() }
    var data = Data()
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
    defer { buffer.deallocate() }
    while stream.hasBytesAvailable {
        let count = stream.read(buffer, maxLength: 4096)
        if count <= 0 { break }
        data.append(buffer, count: count)
    }
    return data
}

private func craftFormField(_ request: URLRequest, name: String) -> String? {
    guard let body = craftStubBody(request), let text = String(data: body, encoding: .utf8)
    else { return nil }
    return text.split(separator: "&").compactMap { pair -> String? in
        let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
        guard parts.count == 2, parts[0] == name else { return nil }
        return parts[1].removingPercentEncoding
    }.first
}

private func craftMCPMethod(from request: URLRequest) -> String? {
    guard let body = craftStubBody(request),
        let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
    else { return nil }
    return json["method"] as? String
}

private func craftTokenJSON(access: String, refresh: String?) -> Data {
    var dict: [String: Any] = ["access_token": access, "expires_in": 3600, "token_type": "Bearer"]
    if let refresh { dict["refresh_token"] = refresh }
    return try! JSONSerialization.data(withJSONObject: dict)
}

private func craftTokenErrorJSON(code: String) -> Data {
    try! JSONSerialization.data(withJSONObject: ["error": code])
}

private func craftMCPDocsStructured(_ rows: [[String: String]]) -> Data {
    craftJSONData(
        #"{"jsonrpc":"2.0","id":1,"result":{"structuredContent":{"documents":"# + String(
            data: try! JSONSerialization.data(withJSONObject: rows), encoding: .utf8)!
            + #"},"content":[{"type":"text","text":"[]"}]}}"#)
}

private func craftMCPTextResult(_ text: String) -> Data {
    try! JSONSerialization.data(withJSONObject: [
        "jsonrpc": "2.0", "id": 1,
        "result": [
            "content": [["type": "text", "text": text]],
            "isError": false,
        ] as [String: Any],
    ])
}

private func craftMCPInitialize() -> Data {
    craftJSONData(
        #"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"craft"}}}"#)
}

/// Full OAuth + MCP script behind one handler. Every parameter defaults to
/// the happy path; tests override what they break.
private func stubCraftOAuthMCP(
    dcrStatus: Int = 200,
    clientID: String = "craft-client-1",
    exchangeStatus: Int = 200,
    exchangeError: String? = nil,
    refreshAccess: String = "craft-access-2",
    refreshRotate: String? = "craft-refresh-2",
    refreshStatus: Int = 200,
    refreshError: String? = nil,
    rows: [[String: String]]? = [
        ["id": "d1", "title": "Doc one", "lastModifiedAt": "2026-11-01T10:00:00Z"],
        ["id": "d2", "title": "", "updatedAt": "2026-11-02T10:00:00Z"],
        ["id": "space/x", "title": "Spaced"],
    ],
    callPayload: ((Data, String?))? = nil,
    callStatuses: CraftBox<[Int]>? = nil,
    toolError: Bool = false,
    advertisedTools: [String]? = ["documents_list"],
    schemaProperties: [String]? = ["limit", "fetchMetadata"],
    recordedAuth: CraftBox<[String]>? = nil,
    recordedArgs: CraftBox<[String]>? = nil,
    recordedDCR: CraftBox<Int>? = nil,
    recordedRefresh: CraftBox<Int>? = nil,
    recordedRevoke: CraftBox<[[String: String]]>? = nil,
    connectionText: String? = nil,
    sessionID: String? = "craft-sess-1"
) {
    CraftStubURLProtocol.setHandler { request in
        let url = request.url!
        switch url.path {
        case "/.well-known/oauth-protected-resource/my/mcp":
            return (craftHTTPResponse(url: url, status: 200), craftJSONData(craftProtectedResourceJSON))
        case "/.well-known/oauth-authorization-server/my/auth":
            return (craftHTTPResponse(url: url, status: 200), craftJSONData(craftAuthServerJSON))
        case "/my/auth/register":
            recordedDCR?.modify { $0 += 1 }
            guard dcrStatus == 200 else {
                return (craftHTTPResponse(url: url, status: dcrStatus), craftJSONData("{}"))
            }
            if let body = craftStubBody(request),
                let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
            {
                #expect(json["client_name"] as? String == "Moki")
                #expect(json["token_endpoint_auth_method"] as? String == "none")
                #expect((json["response_types"] as? [String]) == ["code"])
            }
            return (
                craftHTTPResponse(url: url, status: 200), craftJSONData(#"{"client_id":"\#(clientID)"}"#)
            )
        case "/my/auth/token":
            let grant = craftFormField(request, name: "grant_type")
            #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
            #expect(craftFormField(request, name: "resource") == craftOAuthResource)
            if grant == "refresh_token" {
                recordedRefresh?.modify { $0 += 1 }
                guard refreshStatus == 200 else {
                    return (
                        craftHTTPResponse(url: url, status: refreshStatus),
                        craftTokenErrorJSON(code: refreshError ?? "invalid_grant"))
                }
                return (
                    craftHTTPResponse(url: url, status: 200),
                    craftTokenJSON(access: refreshAccess, refresh: refreshRotate))
            }
            guard exchangeStatus == 200 else {
                return (
                    craftHTTPResponse(url: url, status: exchangeStatus),
                    craftTokenErrorJSON(code: exchangeError ?? "invalid_grant"))
            }
            #expect((craftFormField(request, name: "code_verifier") ?? "").isEmpty == false)
            return (
                craftHTTPResponse(url: url, status: 200),
                craftTokenJSON(access: "craft-access-1", refresh: "craft-refresh-1"))
        case "/my/auth/revoke":
            var fields: [String: String] = [:]
            if let body = craftStubBody(request), let text = String(data: body, encoding: .utf8) {
                for pair in text.split(separator: "&") {
                    let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
                    if parts.count == 2 { fields[parts[0]] = parts[1].removingPercentEncoding }
                }
            }
            recordedRevoke?.modify { $0.append(fields) }
            return (craftHTTPResponse(url: url, status: 200), Data())
        case "/my/mcp":
            if let auth = request.value(forHTTPHeaderField: "Authorization") {
                recordedAuth?.modify { $0.append(auth) }
            }
            switch craftMCPMethod(from: request) {
            case "initialize":
                var headers: [String: String]? = nil
                if let sessionID { headers = ["Mcp-Session-Id": sessionID] }
                return (craftHTTPResponse(url: url, status: 200, headers: headers), craftMCPInitialize())
            case "notifications/initialized":
                return (craftHTTPResponse(url: url, status: 202), Data())
            case "tools/list":
                var tools: [[String: Any]] = []
                for name in advertisedTools ?? [] {
                    var tool: [String: Any] = ["name": name]
                    if let schemaProperties {
                        tool["inputSchema"] = [
                            "type": "object",
                            "properties": Dictionary(
                                uniqueKeysWithValues: schemaProperties.map { ($0, ["type": "string"]) }),
                        ]
                    }
                    tools.append(tool)
                }
                return (
                    craftHTTPResponse(url: url, status: 200),
                    try! JSONSerialization.data(
                        withJSONObject: ["jsonrpc": "2.0", "id": 1, "result": ["tools": tools]]))
            case "tools/call":
                if let body = craftStubBody(request), let text = String(data: body, encoding: .utf8) {
                    recordedArgs?.modify { $0.append(text) }
                    if let connectionText, text.contains("connection info") {
                        return (
                            craftHTTPResponse(url: url, status: 200),
                            craftMCPTextResult(connectionText))
                    }
                }
                if let statuses = callStatuses, !statuses.read().isEmpty {
                    var next = 0
                    statuses.modify { next = $0.removeFirst() }
                    if next != 200 {
                        return (craftHTTPResponse(url: url, status: next), craftJSONData("{}"))
                    }
                }
                if toolError {
                    return (
                        craftHTTPResponse(url: url, status: 200),
                        craftJSONData(
                            #"{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"nope"}],"isError":true}}"#)
                    )
                }
                if let (payload, contentType) = callPayload {
                    let headers: [String: String]? = contentType.map { ["Content-Type": $0] }
                    return (craftHTTPResponse(url: url, status: 200, headers: headers), payload)
                }
                return (
                    craftHTTPResponse(url: url, status: 200),
                    craftMCPDocsStructured(rows ?? []))
            default:
                return (craftHTTPResponse(url: url, status: 400), craftJSONData("{}"))
            }
        default:
            return (craftHTTPResponse(url: url, status: 404), craftJSONData("{}"))
        }
    }
}

private func seedCraftOAuth(
    _ secrets: InMemorySecretStore,
    access: String = "craft-access-1",
    refresh: String? = "craft-refresh-1",
    expiresAt: Date? = Date(timeIntervalSince1970: 1_769_003_600),
    clientID: String = "craft-client-1"
) throws {
    try craftSaveClientMaterial(
        CraftOAuthClientMaterial(clientID: clientID), secrets: secrets)
    try craftSaveTokenMaterial(
        CraftOAuthTokenMaterial(
            accessToken: access, refreshToken: refresh, expiresAt: expiresAt,
            tokenEndpoint: "https://mcp.craft.do/my/auth/token",
            revocationEndpoint: "https://mcp.craft.do/my/auth/revoke"),
        secrets: secrets)
}

private func readCraftToken(_ secrets: InMemorySecretStore) -> CraftOAuthTokenMaterial? {
    craftLoadTokenMaterial(secrets: secrets)
}

/// Poll until the flow leaves `pending` (or the budget runs out).
private func awaitCraftSettled(_ service: CraftSignInService) async -> DocsSignInPollResult {
    let deadline = Date().addingTimeInterval(5)
    while Date() < deadline {
        let result = await service.poll()
        if result.status != .pending { return result }
        try? await Task.sleep(for: .milliseconds(20))
    }
    return await service.poll()
}

private func craftOAuthHarness(
    secrets: InMemorySecretStore = InMemorySecretStore(),
    now: Date = Date(timeIntervalSince1970: 1_769_000_000),
    nowBox: CraftBox<Date>? = nil,
    loopback: CraftStubLoopback = CraftStubLoopback(boundPort: 51234),
    environment: [String: String] = [:]
) -> (CraftSignInService, CraftService, CraftLocations, URL, CraftOpenedURLs) {
    let box = nowBox ?? CraftBox(now)
    let opened = CraftOpenedURLs()
    let (locations, dir) = craftTempLocations()
    let signIn = CraftSignInService(
        secrets: secrets, session: makeCraftStubSession(), environment: environment,
        clock: { box.read() }, openBrowser: { opened.record($0) }, makeServer: { loopback })
    let service = CraftService(
        store: CraftCredentialStore(locations: locations), session: makeCraftStubSession(),
        fixtures: false, now: { box.read() }, secrets: secrets, signIn: signIn)
    return (signIn, service, locations, dir, opened)
}

private func craftQueryItems(_ url: URL) -> [String: String] {
    Dictionary(
        uniqueKeysWithValues: (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [])
            .map { ($0.name, $0.value ?? "") })
}

// MARK: - Hosted-MCP OAuth tests

extension CraftTests {
// MARK: - Discovery + auth URL + args + parsing

    @Test("Authorization-server metadata URL inserts the well-known prefix")
    func metadataURLDerivation() {
        #expect(
            craftAuthorizationServerMetadataURL(for: URL(string: "https://mcp.craft.do/my/auth")!)
                == URL(string: "https://mcp.craft.do/.well-known/oauth-authorization-server/my/auth")!)
    }

    @Test("Approval URL carries state, PKCE S256, and resource — no scope")
    func approvalURLShape() {
        let url = craftOAuthAuthorizationURL(
            endpoints: CraftOAuthEndpoints(
                authorizationEndpoint: URL(string: "https://mcp.craft.do/my/auth/authorize")!,
                tokenEndpoint: URL(string: "https://mcp.craft.do/my/auth/token")!,
                registrationEndpoint: URL(string: "https://mcp.craft.do/my/auth/register")!,
                revocationEndpoint: nil),
            clientID: "client-1", redirectURI: "http://127.0.0.1:51234",
            state: "csrf-state", codeChallenge: "challenge")
        let query = craftQueryItems(url)
        #expect(url.host == "mcp.craft.do")
        #expect(query["response_type"] == "code")
        #expect(query["client_id"] == "client-1")
        #expect(query["redirect_uri"] == "http://127.0.0.1:51234")
        #expect(query["state"] == "csrf-state")
        #expect(query["code_challenge"] == "challenge")
        #expect(query["code_challenge_method"] == "S256")
        #expect(query["resource"] == "https://mcp.craft.do/my/mcp")
        #expect(query["scope"] == nil)
    }

    @Test("documents_list args follow the advertised schema")
    func documentsListArgs() throws {
        func args(_ schema: JSONValue?) -> [String: Any] {
            let data = try! JSONEncoder().encode(craftDocumentsListArgs(schema: schema))
            return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
        }
        // No schema (unknown shape): pagination exists, so limit stays.
        #expect(args(nil) as NSDictionary == ["limit": 12])
        // Full schema: limit + fetchMetadata.
        #expect(
            args(.object(["properties": .object([
                "limit": .object(["type": .string("integer")]),
                "fetchMetadata": .object(["type": .string("boolean")]),
            ])])) as NSDictionary == ["limit": 12, "fetchMetadata": true])
        // Limit-only schema: fetchMetadata is never sent unsolicited.
        #expect(
            args(.object(["properties": .object(["limit": .object([:])])])) as NSDictionary
                == ["limit": 12])
        // Schema with no properties: nothing is assumed.
        #expect(args(.object(["type": .object([:])])) as NSDictionary == [:])
    }

    @Test("Parsing accepts structured, wrapped, text, and single-row payloads")
    func mcpDocumentsParsing() throws {
        func parse(_ result: MCPToolResult) -> [CraftMCPDocument] {
            craftMCPDocuments(from: result)
        }
        // Bare structured array.
        let bare = parse(MCPToolResult(structuredContent: .array([
            .object(["id": .string("a"), "title": .string("A")])
        ])))
        #expect(bare == [CraftMCPDocument(id: "a", title: "A", modifiedAt: nil, deepLink: nil)])
        // Wrapped object under `documents`.
        let wrapped = parse(MCPToolResult(structuredContent: .object([
            "documents": .array([.object(["id": .string("b"), "name": .string("B")])])
        ])))
        #expect(wrapped.map(\.id) == ["b"])
        #expect(wrapped.map(\.title) == ["B"])
        // Text JSON under `results`.
        let text = parse(MCPToolResult(text: #"{"results":[{"id":"c","title":"C"}]}"#))
        #expect(text.map(\.id) == ["c"])
        // Invalid text decodes to nothing, never throws.
        #expect(parse(MCPToolResult(text: "not json")).isEmpty)
        // Current `craft_read` returns a text list: `<id> Title` per line.
        let readText = parse(MCPToolResult(text: """
            50 document(s) (showing 50 of 701) — format: <rootBlockId> Title

              <A1> First doc
              <B2>
              <C3> Third

            Next page: documents list --cursor 50:250630
            """))
        #expect(readText.map(\.id) == ["A1", "B2", "C3"])
        #expect(readText.map(\.title) == ["First doc", "(Untitled)", "Third"])
        // A single row object (unwrapped) parses.
        let single = parse(MCPToolResult(structuredContent: .object([
            "blockId": .string("solo"), "last_modified_at": .string("2026-10-01T00:00:00Z"),
        ])))
        #expect(single == [
            CraftMCPDocument(
                id: "solo", title: "(Untitled)", modifiedAt: "2026-10-01T00:00:00Z", deepLink: nil)
        ])
        // Id-less rows drop; a row deep link wins when it is craftdocs.
        let mixedData = try! JSONSerialization.data(withJSONObject: [
            ["title": "No id"],
            ["id": "d", "title": "", "deepLink": "craftdocs://open?blockId=d"],
            ["id": "e", "deepLink": "https://example.com/x"],
        ])
        let mixed = parse(MCPToolResult(text: String(data: mixedData, encoding: .utf8)))
        #expect(mixed.map(\.id) == ["d", "e"])
        #expect(mixed[0].title == "(Untitled)")
        #expect(mixed[0].deepLink == "craftdocs://open?blockId=d")
        #expect(mixed[1].deepLink == nil)
    }

    @Test("MCP rows map to DocItems without inventing dates")
    func mcpDocItemMapping() {
        let dated = craftMCPDocItem(
            from: CraftMCPDocument(
                id: "d1", title: "T", modifiedAt: "2026-11-01T10:00:00Z", deepLink: nil))
        #expect(dated.source == .craft)
        #expect(dated.openUrl == "")
        #expect(dated.updatedAt == "2026-11-01T10:00:00Z")
        #expect(dated.deepLink == "craftdocs://open?blockId=d1")
        let undated = craftMCPDocItem(
            from: CraftMCPDocument(id: "s/x", title: "T", modifiedAt: nil, deepLink: nil))
        #expect(undated.updatedAt.isEmpty)
        #expect(undated.deepLink == "craftdocs://open?blockId=s/x")
    }

    @Test("Space ids parse from structured or JSON-text connection info")
    func spaceIDParsing() {
        #expect(craftSpaceID(from: MCPToolResult(
            structuredContent: .object(["space": .object(["id": .string("sp-1"), "name": .string("N")])])))
            == "sp-1")
        #expect(craftSpaceID(from: MCPToolResult(text: #"{"space":{"id":"sp-2"}}"#)) == "sp-2")
        #expect(craftSpaceID(from: MCPToolResult(text: #"{"space":{"name":"N"}}"#)) == nil)
        #expect(craftSpaceID(from: MCPToolResult(text: #"{"space":{"id":""}}"#)) == nil)
        #expect(craftSpaceID(from: MCPToolResult(text: "Space: N (id: sp-3)")) == nil)
        #expect(craftSpaceID(from: MCPToolResult(text: nil)) == nil)
    }

    @Test("Web editor URLs need a space id and encode both segments")
    func webEditorURLs() {
        #expect(craftWebEditorURL(spaceId: "space-1", documentId: "d1")
            == "https://docs.craft.do/editor/d/space-1/d1")
        #expect(craftWebEditorURL(spaceId: "s 1", documentId: "s/x")
            == "https://docs.craft.do/editor/d/s%201/s%2Fx")
        #expect(craftWebEditorURL(spaceId: nil, documentId: "d1") == nil)
        #expect(craftWebEditorURL(spaceId: "", documentId: "d1") == nil)
        let linked = craftMCPDocItem(
            from: CraftMCPDocument(id: "d1", title: "T", modifiedAt: nil, deepLink: nil),
            spaceId: "space-1")
        #expect(linked.openUrl == "https://docs.craft.do/editor/d/space-1/d1")
        #expect(linked.deepLink == "craftdocs://open?spaceId=space-1&blockId=d1")
    }

// MARK: - Sign-in flow

    @Test("Full OAuth flow persists client and tokens, reports done")
    func oauthFullFlow() async throws {
        defer { CraftStubURLProtocol.clear() }
        stubCraftOAuthMCP()
        let secrets = InMemorySecretStore()
        let loopback = CraftStubLoopback(boundPort: 51234)
        let (signIn, _, _, dir, opened) = craftOAuthHarness(secrets: secrets, loopback: loopback)
        defer { try? FileManager.default.removeItem(at: dir) }

        let started = try await signIn.start()
        #expect(started == DocsSignInOK())
        #expect(await signIn.poll().status == .pending)
        #expect(loopback.requestedPorts.read() == [nil], "ephemeral loopback, no fixed port")

        let browserURL = try #require(opened.urls.first)
        #expect(browserURL.host == "mcp.craft.do")
        #expect(browserURL.path == "/my/auth/authorize")
        let query = craftQueryItems(browserURL)
        #expect(query["redirect_uri"] == "http://127.0.0.1:51234")
        #expect((query["state"] ?? "").isEmpty == false)
        #expect((query["code_challenge"] ?? "").isEmpty == false)
        let state = try #require(query["state"])

        loopback.deliver(OAuthLoopbackCallback(code: "auth-code", state: state))
        let settled = await awaitCraftSettled(signIn)
        #expect(settled == DocsSignInPollResult(status: .done))
        #expect(settled.account == nil, "no identity endpoint — nothing to name")
        #expect(settled.message == nil)

        #expect(craftLoadClientMaterial(secrets: secrets)?.clientID == "craft-client-1")
        let material = try #require(readCraftToken(secrets))
        #expect(material.accessToken == "craft-access-1")
        #expect(material.refreshToken == "craft-refresh-1")
        #expect((material.expiresAt ?? .distantPast) > Date(timeIntervalSince1970: 1_769_000_000))

        // No token material in the poll result.
        let encoded = String(data: try JSONEncoder().encode(settled), encoding: .utf8)!
        #expect(!encoded.contains("craft-access"))
        #expect(!encoded.contains("craft-refresh"))
    }

    @Test("A stored client registration is reused, not re-registered")
    func oauthReusesStoredClient() async throws {
        defer { CraftStubURLProtocol.clear() }
        let dcrCount = CraftBox(0)
        stubCraftOAuthMCP(recordedDCR: dcrCount)
        let secrets = InMemorySecretStore()
        try craftSaveClientMaterial(
            CraftOAuthClientMaterial(clientID: "stored-client", redirectURI: "http://127.0.0.1:51235"),
            secrets: secrets)
        let loopback = CraftStubLoopback(boundPort: 51235)
        let (signIn, _, _, dir, opened) = craftOAuthHarness(secrets: secrets, loopback: loopback)
        defer { try? FileManager.default.removeItem(at: dir) }

        _ = try await signIn.start()
        #expect(dcrCount.read() == 0, "stored registration wins — no DCR call")
        let query = craftQueryItems(try #require(opened.urls.first))
        #expect(query["client_id"] == "stored-client")
        loopback.deliver(OAuthLoopbackCallback(code: "auth-code", state: query["state"]))
        #expect(await awaitCraftSettled(signIn).status == .done)
        // The reused registration stays.
        #expect(craftLoadClientMaterial(secrets: secrets)?.clientID == "stored-client")
    }

    @Test("A stale redirect triggers a fresh DCR and saves the new redirect")
    func oauthStaleRedirectReregisters() async throws {
        defer { CraftStubURLProtocol.clear() }
        let dcrCount = CraftBox(0)
        stubCraftOAuthMCP(recordedDCR: dcrCount)
        let secrets = InMemorySecretStore()
        // Registration minted for a previous ephemeral port — the current
        // loopback binds a different one.
        try craftSaveClientMaterial(
            CraftOAuthClientMaterial(clientID: "stale-client", redirectURI: "http://127.0.0.1:9999"),
            secrets: secrets)
        let loopback = CraftStubLoopback(boundPort: 51236)
        let (signIn, _, _, dir, opened) = craftOAuthHarness(secrets: secrets, loopback: loopback)
        defer { try? FileManager.default.removeItem(at: dir) }

        _ = try await signIn.start()
        #expect(dcrCount.read() == 1, "redirect mismatch — must re-register")
        let query = craftQueryItems(try #require(opened.urls.first))
        #expect(query["redirect_uri"] == "http://127.0.0.1:51236")
        #expect(query["client_id"] == "craft-client-1", "fresh registration is used")
        loopback.deliver(OAuthLoopbackCallback(code: "auth-code", state: query["state"]))
        #expect(await awaitCraftSettled(signIn).status == .done)
        // The new redirect persists with the fresh registration.
        let stored = try #require(craftLoadClientMaterial(secrets: secrets))
        #expect(stored.clientID == "craft-client-1")
        #expect(stored.redirectURI == "http://127.0.0.1:51236")
    }

    @Test("A legacy client entry without a redirect re-registers, not crashes")
    func oauthLegacyClientReregisters() async throws {
        defer { CraftStubURLProtocol.clear() }
        let dcrCount = CraftBox(0)
        stubCraftOAuthMCP(recordedDCR: dcrCount)
        let secrets = InMemorySecretStore()
        // Entry written before redirect capture: decodes (no crash) but
        // never matches, so the flow re-registers.
        try secrets.write(
            #"{"client_id":"legacy-client"}"#, service: CraftOAuthKeychain.service,
            account: CraftOAuthKeychain.clientAccount)
        #expect(craftLoadClientMaterial(secrets: secrets)?.clientID == "legacy-client")
        let loopback = CraftStubLoopback(boundPort: 51237)
        let (signIn, _, _, dir, opened) = craftOAuthHarness(secrets: secrets, loopback: loopback)
        defer { try? FileManager.default.removeItem(at: dir) }

        _ = try await signIn.start()
        #expect(dcrCount.read() == 1, "legacy entry without redirect — must re-register")
        let query = craftQueryItems(try #require(opened.urls.first))
        loopback.deliver(OAuthLoopbackCallback(code: "auth-code", state: query["state"]))
        #expect(await awaitCraftSettled(signIn).status == .done)
        let stored = try #require(craftLoadClientMaterial(secrets: secrets))
        #expect(stored.redirectURI == "http://127.0.0.1:51237")
    }

    @Test("State mismatch reads as an error")
    func oauthStateMismatch() async throws {
        defer { CraftStubURLProtocol.clear() }
        stubCraftOAuthMCP()
        let secrets = InMemorySecretStore()
        let server = CraftStubLoopback(boundPort: 52345)
        let (signIn, _, _, dir, _) = craftOAuthHarness(secrets: secrets, loopback: server)
        defer { try? FileManager.default.removeItem(at: dir) }

        _ = try await signIn.start()
        server.deliver(OAuthLoopbackCallback(code: "auth-code", state: "wrong-state"))
        let settled = await awaitCraftSettled(signIn)
        #expect(settled.status == .error)
        #expect((settled.message ?? "").contains("match"))
        #expect(readCraftToken(secrets) == nil, "a mismatched callback persists nothing")
    }

    @Test("Provider denial reads as declined")
    func oauthProviderDenial() async throws {
        defer { CraftStubURLProtocol.clear() }
        stubCraftOAuthMCP()
        let secrets = InMemorySecretStore()
        let server = CraftStubLoopback(boundPort: 53345)
        let (signIn, _, _, dir, _) = craftOAuthHarness(secrets: secrets, loopback: server)
        defer { try? FileManager.default.removeItem(at: dir) }

        _ = try await signIn.start()
        server.deliver(OAuthLoopbackCallback(providerError: "access_denied"))
        let settled = await awaitCraftSettled(signIn)
        #expect(settled.status == .error)
        #expect((settled.message ?? "").contains("declined"))
        #expect(!(settled.message ?? "").contains("refresh"))
        #expect(readCraftToken(secrets) == nil)
    }

    @Test("Restart supersedes the in-flight attempt")
    func oauthRestart() async throws {
        defer { CraftStubURLProtocol.clear() }
        stubCraftOAuthMCP()
        let first = CraftStubLoopback(boundPort: 51111)
        let second = CraftStubLoopback(boundPort: 52222)
        let servers = CraftBox([first, second])
        let secrets = InMemorySecretStore()
        let opened = CraftOpenedURLs()
        let now = CraftBox(Date(timeIntervalSince1970: 1_769_000_000))
        let signIn = CraftSignInService(
            secrets: secrets, session: makeCraftStubSession(),
            clock: { now.read() }, openBrowser: { opened.record($0) },
            makeServer: {
                var next: CraftStubLoopback!
                servers.modify { next = $0.removeFirst() }
                return next
            })

        _ = try await signIn.start()
        _ = try await signIn.start()
        #expect(first.stopCount >= 1, "restart stops the superseded server")
        #expect(opened.urls.count == 2)

        first.deliver(OAuthLoopbackCallback(code: "stale-code", state: "stale"))
        try? await Task.sleep(for: .milliseconds(100))
        #expect(await signIn.poll().status == .pending)

        let state = craftQueryItems(opened.urls[1])["state"]
        second.deliver(OAuthLoopbackCallback(code: "fresh-code", state: state))
        #expect(await awaitCraftSettled(signIn).status == .done)
    }

    @Test("Cancel during start never opens a browser")
    func oauthCancelDuringStart() async throws {
        defer { CraftStubURLProtocol.clear() }
        let registrationGate = DispatchSemaphore(value: 0)
        CraftStubURLProtocol.setHandler { request in
            let url = request.url!
            switch url.path {
            case "/.well-known/oauth-protected-resource/my/mcp":
                return (craftHTTPResponse(url: url, status: 200), craftJSONData(craftProtectedResourceJSON))
            case "/.well-known/oauth-authorization-server/my/auth":
                return (craftHTTPResponse(url: url, status: 200), craftJSONData(craftAuthServerJSON))
            case "/my/auth/register":
                registrationGate.wait()
                return (
                    craftHTTPResponse(url: url, status: 200),
                    craftJSONData(#"{"client_id":"client-1"}"#))
            default:
                return (craftHTTPResponse(url: url, status: 404), craftJSONData("{}"))
            }
        }
        let server = CraftStubLoopback(boundPort: 51112)
        let (signIn, _, _, dir, opened) = craftOAuthHarness(loopback: server)
        defer { try? FileManager.default.removeItem(at: dir) }

        let starting = Task { try await signIn.start() }
        try? await Task.sleep(for: .milliseconds(100))
        _ = await signIn.cancel()
        registrationGate.signal()
        do {
            _ = try await starting.value
            Issue.record("a cancelled start must throw")
        } catch {}

        #expect(opened.urls.isEmpty, "no browser tab for a flow the UI already cancelled")
        #expect(server.stopCount >= 1)
        let polled = await signIn.poll()
        #expect(polled.status == .error)
        #expect((polled.message ?? "").contains("cancelled"))
    }

    @Test("Cancel stops the server and sticks")
    func oauthCancel() async throws {
        defer { CraftStubURLProtocol.clear() }
        stubCraftOAuthMCP()
        let secrets = InMemorySecretStore()
        let server = CraftStubLoopback(boundPort: 53333)
        let (signIn, _, _, dir, _) = craftOAuthHarness(secrets: secrets, loopback: server)
        defer { try? FileManager.default.removeItem(at: dir) }

        _ = try await signIn.start()
        #expect(await signIn.cancel() == DocsSignInOK())
        #expect(server.stopCount >= 1)
        let polled = await signIn.poll()
        #expect(polled.status == .error)
        #expect((polled.message ?? "").contains("cancelled"))

        server.deliver(OAuthLoopbackCallback(code: "late-code", state: "late"))
        try? await Task.sleep(for: .milliseconds(100))
        #expect(await signIn.poll().status == .error)
        #expect(readCraftToken(secrets) == nil)
    }

    @Test("A pending attempt expires after five minutes")
    func oauthExpiry() async throws {
        defer { CraftStubURLProtocol.clear() }
        stubCraftOAuthMCP()
        let now = CraftBox(Date(timeIntervalSince1970: 1_769_000_000))
        let server = CraftStubLoopback(boundPort: 54444)
        let (signIn, _, _, dir, _) = craftOAuthHarness(nowBox: now, loopback: server)
        defer { try? FileManager.default.removeItem(at: dir) }

        _ = try await signIn.start()
        #expect(await signIn.poll().status == .pending)
        now.write(Date(timeIntervalSince1970: 1_769_000_000 + 301))
        let expired = await signIn.poll()
        #expect(expired.status == .error)
        #expect((expired.message ?? "").contains("timed out"))
        #expect(server.stopCount >= 1)
    }

    @Test("Discovery failure reads as unreachable before any browser opens")
    func oauthDiscoveryFailure() async throws {
        CraftStubURLProtocol.setHandler { request in
            (craftHTTPResponse(url: request.url!, status: 500), craftJSONData("{}"))
        }
        defer { CraftStubURLProtocol.clear() }
        let opened = CraftOpenedURLs()
        let (signIn, _, _, dir, _) = craftOAuthHarness(loopback: CraftStubLoopback(boundPort: 1))
        defer { try? FileManager.default.removeItem(at: dir) }
        _ = opened

        do {
            _ = try await signIn.start()
            Issue.record("dead discovery must throw")
        } catch let error as AppError {
            #expect(error.code == "unreachable")
        }
        #expect((await signIn.poll().message ?? "").contains("did not answer"))
    }

    @Test("DCR failure reads as unreachable and stops the loopback")
    func oauthDCRFailure() async throws {
        defer { CraftStubURLProtocol.clear() }
        stubCraftOAuthMCP(dcrStatus: 500)
        let server = CraftStubLoopback(boundPort: 55555)
        let (signIn, _, _, dir, opened) = craftOAuthHarness(loopback: server)
        defer { try? FileManager.default.removeItem(at: dir) }

        do {
            _ = try await signIn.start()
            Issue.record("failed DCR must throw")
        } catch let error as AppError {
            #expect(error.code == "unreachable")
        }
        #expect(opened.urls.isEmpty, "no approval without a client")
        #expect(server.stopCount >= 1)
        #expect(await signIn.poll().status == .error)
    }

    @Test("A rejected code drops the registration so the next start re-registers")
    func oauthExchangeRejectionDropsClient() async throws {
        defer { CraftStubURLProtocol.clear() }
        let dcrCount = CraftBox(0)
        stubCraftOAuthMCP(dcrStatus: 200, exchangeStatus: 400, exchangeError: "invalid_grant",
            recordedDCR: dcrCount)
        let secrets = InMemorySecretStore()
        let server = CraftStubLoopback(boundPort: 56666)
        let (signIn, _, _, dir, opened) = craftOAuthHarness(secrets: secrets, loopback: server)
        defer { try? FileManager.default.removeItem(at: dir) }

        _ = try await signIn.start()
        let state = craftQueryItems(try #require(opened.urls.first))["state"]
        server.deliver(OAuthLoopbackCallback(code: "dead-code", state: state))
        let settled = await awaitCraftSettled(signIn)
        #expect(settled.status == .error)
        #expect((settled.message ?? "").contains("rejected"))
        #expect(craftLoadClientMaterial(secrets: secrets) == nil)
        #expect(readCraftToken(secrets) == nil)
        #expect(dcrCount.read() == 1)
    }

    @Test("Fixtures sign-in start is unavailable with no browser or network")
    func oauthFixturesStartUnavailable() async throws {
        defer { CraftStubURLProtocol.clear() }
        CraftStubURLProtocol.setHandler { _ in throw URLError(.badServerResponse) }
        let secrets = InMemorySecretStore()
        let signIn = CraftSignInService(
            secrets: secrets, session: makeCraftStubSession(),
            environment: ["MOKI_FIXTURES": "1"],
            clock: Date.init, openBrowser: { _ in Issue.record("browser must not open in fixtures") },
            makeServer: {
                Issue.record("loopback must not bind in fixtures")
                return CraftStubLoopback(boundPort: 1)
            })
        do {
            _ = try await signIn.start()
            Issue.record("expected unavailable, got ok")
        } catch let error as AppError {
            #expect(error.code == "unavailable")
        }
        #expect(CraftStubURLProtocol.requestCount() == 0)
    }

// MARK: - OAuth listing

    @Test("OAuth listing maps rows in server order with native deep links")
    func oauthListingMapsRows() async throws {
        defer { CraftStubURLProtocol.clear() }
        let authSeen = CraftBox<[String]>([])
        stubCraftOAuthMCP(recordedAuth: authSeen)
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        let result = await service.listRecents()
        #expect(result.unreachable == false)
        #expect(result.signedOut == false)
        #expect(result.items.count == 3)
        #expect(result.items.map(\.id) == ["d1", "d2", "space/x"])
        #expect(result.items[0].title == "Doc one")
        #expect(result.items[0].updatedAt == "2026-11-01T10:00:00Z")
        #expect(result.items[1].title == "(Untitled)")
        #expect(result.items.allSatisfy { $0.source == .craft && $0.openUrl == "" })
        #expect(result.items[0].deepLink == "craftdocs://open?blockId=d1")
        #expect(result.items[2].deepLink == "craftdocs://open?blockId=space/x")
        #expect(authSeen.read().allSatisfy { $0 == "Bearer craft-access-1" })
        #expect(!authSeen.read().isEmpty)
    }

    @Test("OAuth listing caps at 12 rows")
    func oauthListingCaps() async throws {
        defer { CraftStubURLProtocol.clear() }
        let rows = (1...20).map { ["id": "d\($0)", "title": "Doc \($0)"] }
        stubCraftOAuthMCP(rows: rows)
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        let result = await service.listRecents()
        #expect(result.items.count == 12)
        #expect(result.items.map(\.id) == (1...12).map { "d\($0)" })
    }

    @Test("OAuth listing reads the text JSON when structured content is absent")
    func oauthListingTextJSON() async throws {
        defer { CraftStubURLProtocol.clear() }
        let inner = try! JSONSerialization.data(withJSONObject: [
            "items": [["id": "t1", "title": "Text row", "updatedAt": "2026-11-03T10:00:00Z"]]
        ])
        let envelope = try! JSONSerialization.data(withJSONObject: [
            "jsonrpc": "2.0", "id": 1,
            "result": ["content": [["type": "text", "text": String(data: inner, encoding: .utf8)!]]],
        ])
        stubCraftOAuthMCP(callPayload: (envelope, nil))
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        let result = await service.listRecents()
        #expect(result.signedOut == false)
        #expect(result.items.map(\.id) == ["t1"])
        #expect(result.items.first?.updatedAt == "2026-11-03T10:00:00Z")
    }

    @Test("OAuth listing reads SSE responses")
    func oauthListingSSE() async throws {
        defer { CraftStubURLProtocol.clear() }
        let payload = try! JSONSerialization.data(withJSONObject: [
            "jsonrpc": "2.0", "id": 1,
            "result": ["structuredContent": ["documents": [["id": "s1", "title": "SSE row"]]]],
        ])
        var lines = "event: message\n"
        lines += "data: " + String(data: payload, encoding: .utf8)! + "\n\n"
        stubCraftOAuthMCP(callPayload: (Data(lines.utf8), "text/event-stream"))
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        let result = await service.listRecents()
        #expect(result.items.map(\.id) == ["s1"])
        #expect(result.items.first?.title == "SSE row")
    }

    @Test("Schema without fetchMetadata sends limit only")
    func oauthSchemaLimitsArgs() async throws {
        defer { CraftStubURLProtocol.clear() }
        let argsSeen = CraftBox<[String]>([])
        stubCraftOAuthMCP(schemaProperties: ["limit"], recordedArgs: argsSeen)
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        _ = await service.listRecents()
        let body = try #require(argsSeen.read().last)
        let json = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any]
        let params = try #require(json?["params"] as? [String: Any])
        #expect((params["name"] as? String) == "documents_list")
        let arguments = try #require(params["arguments"] as? [String: Any])
        #expect(arguments["limit"] as? Int == 12)
        #expect(arguments["fetchMetadata"] == nil)
    }

    @Test("A craft_read server lists documents from its text form")
    func oauthCraftReadText() async throws {
        defer { CraftStubURLProtocol.clear() }
        let argsSeen = CraftBox<[String]>([])
        let text = """
            50 document(s) (showing 50 of 701) — format: <rootBlockId> Title

              <F8C9E06C-FD4D-4CF9-A210-8069EAC76E27> bubblefi
              <5A82BB27-ED8C-4CA9-BC49-87321EB2A722>
              <A6C8F818-7897-413F-A895-AA30D9CBE8D1> trader joe’s prices

            Next page: documents list --cursor 50:250630
            """
        let payload = try! JSONSerialization.data(withJSONObject: [
            "jsonrpc": "2.0", "id": 1,
            "result": [
                "content": [["type": "text", "text": text]],
                "isError": false,
            ] as [String: Any],
        ])
        stubCraftOAuthMCP(
            callPayload: (payload, "application/json"),
            advertisedTools: ["craft_read"], schemaProperties: ["command"],
            recordedArgs: argsSeen)
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        let result = await service.listRecents()
        #expect(result.unreachable == false)
        #expect(result.items.map(\.id) == [
            "F8C9E06C-FD4D-4CF9-A210-8069EAC76E27",
            "5A82BB27-ED8C-4CA9-BC49-87321EB2A722",
            "A6C8F818-7897-413F-A895-AA30D9CBE8D1",
        ])
        #expect(result.items.map(\.title) == ["bubblefi", "(Untitled)", "trader joe’s prices"])
        let body = try #require(argsSeen.read().last)
        let json = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any]
        let params = try #require(json?["params"] as? [String: Any])
        #expect((params["name"] as? String) == "craft_read")
        let arguments = try #require(params["arguments"] as? [String: Any])
        #expect((arguments["command"] as? String) == "documents list")
    }

    @Test("craft_read rows preview at the web editor once connection info names the space")
    func oauthCraftReadLinksWebEditor() async throws {
        defer { CraftStubURLProtocol.clear() }
        let argsSeen = CraftBox<[String]>([])
        stubCraftOAuthMCP(
            advertisedTools: ["craft_read"], schemaProperties: ["command"],
            recordedArgs: argsSeen,
            connectionText: #"{"space":{"id":"space-1","name":"My Space"}}"#)
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        let result = await service.listRecents()
        #expect(result.unreachable == false)
        #expect(result.items.map(\.openUrl) == [
            "https://docs.craft.do/editor/d/space-1/d1",
            "https://docs.craft.do/editor/d/space-1/d2",
            "https://docs.craft.do/editor/d/space-1/space%2Fx",
        ])
        #expect(result.items[0].deepLink == "craftdocs://open?spaceId=space-1&blockId=d1")
        let commands = argsSeen.read().compactMap { body -> String? in
            guard let json = try? JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any],
                let params = json["params"] as? [String: Any],
                let arguments = params["arguments"] as? [String: Any]
            else { return nil }
            return arguments["command"] as? String
        }
        #expect(commands.contains("connection info --format json"))
        #expect(commands.last == "documents list", "the listing call still goes last")
    }

    @Test("Unreadable connection info keeps rows listing, native-open only")
    func oauthCraftReadWithoutSpaceID() async throws {
        defer { CraftStubURLProtocol.clear() }
        stubCraftOAuthMCP(
            advertisedTools: ["craft_read"], schemaProperties: ["command"],
            connectionText: "Space: My Space")
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        let result = await service.listRecents()
        #expect(result.unreachable == false)
        #expect(result.signedOut == false)
        #expect(result.items.count == 3)
        #expect(result.items.allSatisfy { $0.openUrl == "" })
        #expect(result.items[0].deepLink == "craftdocs://open?blockId=d1")
    }

    @Test("An expired token refreshes and the rotation persists")
    func oauthExpiredRefreshes() async throws {
        defer { CraftStubURLProtocol.clear() }
        let authSeen = CraftBox<[String]>([])
        let refreshCount = CraftBox(0)
        stubCraftOAuthMCP(recordedAuth: authSeen, recordedRefresh: refreshCount)
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets, expiresAt: Date(timeIntervalSince1970: 1_769_000_000 - 60))
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        let result = await service.listRecents()
        #expect(result.signedOut == false)
        #expect(result.items.count == 3)
        #expect(refreshCount.read() == 1)
        #expect(authSeen.read().allSatisfy { $0 == "Bearer craft-access-2" })
        let material = try #require(readCraftToken(secrets))
        #expect(material.accessToken == "craft-access-2")
        #expect(material.refreshToken == "craft-refresh-2", "rotation persists")
    }

    @Test("A refresh loser adopts the rotated winner instead of clearing")
    func oauthRefreshLoserAdoptsWinner() async throws {
        defer { CraftStubURLProtocol.clear() }
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(
            secrets, expiresAt: Date(timeIntervalSince1970: 1_769_000_000 - 60))
        CraftStubURLProtocol.setHandler { request in
            let url = request.url!
            if url.path == "/my/auth/token",
                craftFormField(request, name: "refresh_token") == "craft-refresh-1"
            {
                // The other listing rotated and persisted while this one
                // awaited the token endpoint.
                try? craftSaveTokenMaterial(
                    CraftOAuthTokenMaterial(
                        accessToken: "craft-access-2", refreshToken: "craft-refresh-2",
                        expiresAt: Date(timeIntervalSince1970: 1_769_003_600),
                        tokenEndpoint: "https://mcp.craft.do/my/auth/token",
                        revocationEndpoint: "https://mcp.craft.do/my/auth/revoke"),
                    secrets: secrets)
                return (
                    craftHTTPResponse(url: url, status: 400),
                    craftTokenErrorJSON(code: "invalid_grant"))
            }
            return (craftHTTPResponse(url: url, status: 500), craftJSONData("{}"))
        }
        let (signIn, _, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        #expect(try await signIn.freshAccessToken() == "craft-access-2")
        #expect(readCraftToken(secrets)?.refreshToken == "craft-refresh-2")
    }

    @Test("A refresh without rotation keeps the old refresh token")
    func oauthRefreshKeepsOld() async throws {
        defer { CraftStubURLProtocol.clear() }
        stubCraftOAuthMCP(refreshRotate: nil)
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets, expiresAt: Date(timeIntervalSince1970: 1_769_000_000 - 60))
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        #expect(await service.listRecents().signedOut == false)
        #expect(readCraftToken(secrets)?.refreshToken == "craft-refresh-1")
    }

    @Test("A dead refresh grant signs out and clears the material")
    func oauthDeadGrantSignsOut() async throws {
        defer { CraftStubURLProtocol.clear() }
        stubCraftOAuthMCP(refreshStatus: 400, refreshError: "invalid_grant")
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets, expiresAt: Date(timeIntervalSince1970: 1_769_000_000 - 60))
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        let result = await service.listRecents()
        #expect(result == DocsListRecentsResult(items: [], unreachable: false, signedOut: true))
        #expect(readCraftToken(secrets) == nil)
        #expect(craftLoadClientMaterial(secrets: secrets) == nil)
    }

    @Test("A mid-session 401 refreshes once and retries")
    func oauthMidSession401() async throws {
        defer { CraftStubURLProtocol.clear() }
        let statuses = CraftBox([401])
        let authSeen = CraftBox<[String]>([])
        let refreshCount = CraftBox(0)
        stubCraftOAuthMCP(callStatuses: statuses, recordedAuth: authSeen, recordedRefresh: refreshCount)
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        let result = await service.listRecents()
        #expect(result.signedOut == false)
        #expect(result.items.count == 3)
        #expect(refreshCount.read() == 1, "one forced refresh, then the retry succeeds")
        #expect(authSeen.read().last == "Bearer craft-access-2")
    }

    @Test("A tool-level error is unreachable, never signed-out")
    func oauthToolError() async throws {
        defer { CraftStubURLProtocol.clear() }
        stubCraftOAuthMCP(toolError: true)
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        let result = await service.listRecents()
        #expect(result == DocsListRecentsResult(items: [], unreachable: true, signedOut: false))
        #expect(readCraftToken(secrets) != nil, "a tool error is not a dead grant")
    }

    @Test("A missing documents_list tool is unreachable")
    func oauthMissingTool() async throws {
        defer { CraftStubURLProtocol.clear() }
        stubCraftOAuthMCP(advertisedTools: ["other_tool"])
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        #expect(await service.listRecents() == DocsListRecentsResult(
            items: [], unreachable: true, signedOut: false))
    }

    @Test("A dead MCP network is unreachable and keeps the grant")
    func oauthNetworkUnreachable() async throws {
        CraftStubURLProtocol.setHandler { request in
            if request.url?.path == "/my/mcp" { throw URLError(.notConnectedToInternet) }
            switch request.url?.path {
            case "/.well-known/oauth-protected-resource/my/mcp":
                return (
                    craftHTTPResponse(url: request.url!, status: 200),
                    craftJSONData(craftProtectedResourceJSON))
            case "/.well-known/oauth-authorization-server/my/auth":
                return (
                    craftHTTPResponse(url: request.url!, status: 200), craftJSONData(craftAuthServerJSON))
            default:
                return (craftHTTPResponse(url: request.url!, status: 404), craftJSONData("{}"))
            }
        }
        defer { CraftStubURLProtocol.clear() }
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        #expect(await service.listRecents() == DocsListRecentsResult(
            items: [], unreachable: true, signedOut: false))
        #expect(readCraftToken(secrets) != nil)
    }

    @Test("No OAuth grant falls back to the legacy Connect URL")
    func oauthFallsBackToLegacy() async throws {
        CraftStubURLProtocol.setHandler { request in
            if request.url?.absoluteString.hasSuffix("/connection") == true {
                return (craftHTTPResponse(url: request.url!, status: 200), craftJSONData(craftConnectionJSON))
            }
            if request.url?.absoluteString.hasSuffix("/documents") == true {
                return (
                    craftHTTPResponse(url: request.url!, status: 200),
                    craftJSONData(#"{"items":[{"id":"legacy-1","title":"Legacy"}]}"#))
            }
            return (craftHTTPResponse(url: request.url!, status: 404), craftJSONData("{}"))
        }
        defer { CraftStubURLProtocol.clear() }
        let secrets = InMemorySecretStore()
        let (_, service, locations, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }
        CraftCredentialStore(locations: locations).save(
            CraftCredential(url: craftBase.absoluteString, spaceId: "space-1"))

        let result = await service.listRecents()
        #expect(result.signedOut == false)
        #expect(result.items.map(\.id) == ["legacy-1"])
        #expect(result.items.first?.deepLink == "craftdocs://open?spaceId=space-1&blockId=legacy-1")
    }

    @Test("Sign-out revokes, clears OAuth material and the legacy file")
    func oauthSignOutClearsAll() async throws {
        defer { CraftStubURLProtocol.clear() }
        let revocations = CraftBox<[[String: String]]>([])
        stubCraftOAuthMCP(recordedRevoke: revocations)
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        let (_, service, locations, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }
        CraftCredentialStore(locations: locations).save(
            CraftCredential(url: craftBase.absoluteString, spaceId: "space-1"))

        #expect(try await service.signOut() == CraftOK())
        #expect(revocations.read().count == 1)
        #expect(revocations.read().first?["token"] == "craft-refresh-1")
        #expect(readCraftToken(secrets) == nil)
        #expect(craftLoadClientMaterial(secrets: secrets) == nil)
        #expect(CraftCredentialStore(locations: locations).load() == nil)
        // Missing everything still succeeds.
        #expect(try await service.signOut() == CraftOK())
    }

    @Test("Sign-out with no revocation endpoint still clears")
    func oauthSignOutWithoutRevocation() async throws {
        defer { CraftStubURLProtocol.clear() }
        stubCraftOAuthMCP()
        let secrets = InMemorySecretStore()
        try seedCraftOAuth(secrets)
        // Drop the revocation endpoint from the stored material.
        var material = try #require(readCraftToken(secrets))
        material.revocationEndpoint = nil
        try craftSaveTokenMaterial(material, secrets: secrets)
        let (_, service, _, dir, _) = craftOAuthHarness(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }

        #expect(try await service.signOut() == CraftOK())
        #expect(readCraftToken(secrets) == nil)
    }

    @Test("Craft sign-in RPCs register under fixtures as unavailable")
    func oauthFixturesRegistration() async throws {
        let transport = InMemoryTransport(lines: [
            #"{"jsonrpc":"2.0","id":1,"method":"craft.signInStart"}"#,
            #"{"jsonrpc":"2.0","id":2,"method":"craft.signInPoll"}"#,
            #"{"jsonrpc":"2.0","id":3,"method":"craft.signInCancel"}"#,
        ])
        let server = RPCServer(transport: transport)
        let (locations, dir) = craftTempLocations()
        defer { try? FileManager.default.removeItem(at: dir) }
        await server.registerCraftMethods(
            session: makeCraftStubSession(), locations: locations,
            environment: ["MOKI_FIXTURES": "1"], secrets: InMemorySecretStore())
        await server.run()
        let output = await transport.collectedOutput()
        #expect(output.count == 3)
        let decoded = try output.map {
            try JSONDecoder().decode(JSONValue.self, from: Data($0.utf8))
        }
        // Responses may arrive out of order (`run()` answers each line in
        // its own task), so match by request id, never by position.
        var byID: [Int: JSONValue] = [:]
        for value in decoded {
            guard case .object(let envelope) = value,
                case .int(let id) = envelope["id"]
            else {
                continue
            }
            byID[id] = value
        }
        guard case .object(let start) = byID[1],
            case .object(let startError) = start["error"],
            case .object(let startData) = startError["data"],
            case .string(let appCode) = startData["code"]
        else {
            Issue.record("start response had unexpected shape: \(output)")
            return
        }
        #expect(appCode == "unavailable")
        guard case .object(let poll) = byID[2],
            case .object(let pollResult) = poll["result"],
            case .string(let status) = pollResult["status"]
        else {
            Issue.record("poll response had unexpected shape: \(output)")
            return
        }
        #expect(status == "error")
        guard case .object(let cancel) = byID[3],
            case .object(let cancelResult) = cancel["result"],
            case .bool(let ok) = cancelResult["ok"]
        else {
            Issue.record("cancel response had unexpected shape: \(output)")
            return
        }
        #expect(ok == true)
    }
}
