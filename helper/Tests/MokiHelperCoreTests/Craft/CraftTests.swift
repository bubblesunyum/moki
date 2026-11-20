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
            session: makeCraftStubSession(), fixtures: fixtures, now: now)
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
        #expect(first.openUrl == "", "Craft rows never load in the webview guest")
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
            session: makeCraftStubSession(), fixtures: true)
        let result = await svc.listRecents()
        #expect(CraftStubURLProtocol.requestCount() == 0)
        #expect(result.items.count == 12)
        #expect(result.unreachable == false)
        #expect(result.signedOut == false)
        #expect(result.items.allSatisfy { $0.openUrl == "" && ($0.deepLink ?? "").hasPrefix("craftdocs://open?") })
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
            session: makeCraftStubSession(), fixtures: true)
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
