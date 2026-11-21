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

    @Test("Documents map in space order, decoding both metadata shapes")
    func documentsMap() async {
        let json = """
            {"items":[
             {"id":"d1","title":"First","metadata":{"lastModifiedAt":"2026-11-20T10:00:00Z","clickableLink":"craftdocs://open?spaceId=s&documentId=d1"}},
             {"id":"","title":"No id drops"},
             {"id":"d2","title":"","lastModifiedAt":"2026-11-19T10:00:00Z","clickableLink":"craftdocs://open?spaceId=s&documentId=d2"},
             {"id":"d3","title":"  "},
             {"id":"d4"}
            ]}
            """
        CraftStubURLProtocol.setHandler { request in
            #expect(request.url?.path.hasSuffix("/documents") == true)
            #expect(request.url?.query?.contains("fetchMetadata=true") == true)
            return (craftHTTPResponse(url: request.url!, status: 200), craftJSONData(json))
        }
        defer { CraftStubURLProtocol.clear() }
        let result = await CraftClient(baseURL: craftBase, session: makeCraftStubSession())
            .listDocuments()
        switch result {
        case .success(let docs):
            // Space order preserved: sorting is the service's job.
            #expect(docs.map(\.id) == ["d1", "d2", "d3", "d4"])
            #expect(docs[0].title == "First")
            #expect(docs[1].title == "(Untitled)")
            #expect(docs[2].title == "(Untitled)")
            #expect(docs[3].title == "(Untitled)")
            // Nested metadata shape…
            #expect(docs[0].lastModifiedAt == "2026-11-20T10:00:00Z")
            #expect(docs[0].clickableLink == "craftdocs://open?spaceId=s&documentId=d1")
            // …and the top-level shape decode the same fields.
            #expect(docs[1].lastModifiedAt == "2026-11-19T10:00:00Z")
            #expect(docs[1].clickableLink == "craftdocs://open?spaceId=s&documentId=d2")
            #expect(docs[2].lastModifiedAt == nil)
            #expect(docs[3].clickableLink == nil)
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
        now: @escaping @Sendable () -> Date = { Date(timeIntervalSince1970: 1_769_000_000) },
        secrets: any SecretStoring = InMemorySecretStore()
    ) -> (CraftService, CraftLocations, URL) {
        let (locations, dir) = craftTempLocations()
        let svc = CraftService(
            store: CraftCredentialStore(locations: locations),
            session: makeCraftStubSession(), fixtures: fixtures, now: now,
            secrets: secrets)
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

    @Test("Listing sorts by lastModifiedAt, caps at 12, and carries the API's dates")
    func listingMapsRows() async throws {
        // Space order is scrambled on purpose: d-old … d-new arrive
        // interleaved, with ties (d-tie1/d-tie2), undated rows (d-nodate1/2),
        // and both metadata nestings. 14 rows so the cap bites. Every stub
        // doc carries a clickableLink (the normal live shape), so openUrls
        // come from the links' own values.
        let items = [
            #"{"id":"d-old","title":"Old","lastModifiedAt":"2026-11-10T10:00:00Z","clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-old"}"#,
            #"{"id":"d-tie1","title":"Tie 1","metadata":{"lastModifiedAt":"2026-11-19T10:00:00Z","clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-tie1"}}"#,
            #"{"id":"d-nodate1","title":"No date","clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-nodate1"}"#,
            #"{"id":"d-new","title":"New","metadata":{"lastModifiedAt":"2026-11-20T10:00:00Z","clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-new"}}"#,
            #"{"id":"d-mid","title":"Mid","lastModifiedAt":"2026-11-15T10:00:00Z","clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-mid"}"#,
            #"{"id":"d-tie2","title":"Tie 2","lastModifiedAt":"2026-11-19T10:00:00Z","clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-tie2"}"#,
            #"{"id":"d-nodate2","title":"No date 2","metadata":{"clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-nodate2"}}"#,
            #"{"id":"d-tie3","title":"Tie 3","metadata":{"lastModifiedAt":"2026-11-19T10:00:00Z","clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-tie3"}}"#,
            #"{"id":"d-08","title":"D8","lastModifiedAt":"2026-11-08T10:00:00Z","clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-08"}"#,
            #"{"id":"d-07","title":"D7","lastModifiedAt":"2026-11-07T10:00:00Z","clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-07"}"#,
            #"{"id":"d-06","title":"D6","lastModifiedAt":"2026-11-06T10:00:00Z","clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-06"}"#,
            #"{"id":"d-05","title":"D5","lastModifiedAt":"2026-11-05T10:00:00Z","clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-05"}"#,
            #"{"id":"d-04","title":"D4","lastModifiedAt":"2026-11-04T10:00:00Z","clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-04"}"#,
            #"{"id":"d-03","title":"D3","lastModifiedAt":"2026-11-03T10:00:00Z","clickableLink":"craftdocs://open?spaceId=space-1&documentId=d-03"}"#,
        ].joined(separator: ",")
        CraftStubURLProtocol.setHandler { request in
            if request.url?.path.hasSuffix("/connection") == true {
                return (craftHTTPResponse(url: request.url!, status: 200), craftJSONData(craftConnectionJSON))
            }
            #expect(request.url?.path.hasSuffix("/documents") == true)
            #expect(request.url?.query?.contains("fetchMetadata=true") == true)
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
        // Newest first; ties and undated rows keep their space order.
        #expect(
            result.items.map(\.id)
                == ["d-new", "d-tie1", "d-tie2", "d-tie3", "d-mid", "d-old",
                    "d-08", "d-07", "d-06", "d-05", "d-04", "d-03"],
            "lastModifiedAt-desc, stable among ties; the two undated rows sort last and fall off the 12-cap")
        let first = try #require(result.items.first)
        #expect(first.source == .craft)
        #expect(
            first.openUrl == "https://docs.craft.do/editor/d/space-1/d-new",
            "the preview URL comes from the clickableLink's values, not the row id")
        #expect(first.deepLink == "craftdocs://open?spaceId=space-1&documentId=d-new")
        #expect(first.updatedAt == "2026-11-20T10:00:00Z", "the API's date, not fetch time")
        #expect(result.items.allSatisfy {
            $0.openUrl.hasPrefix("https://docs.craft.do/editor/d/space-1/")
        })
        #expect(result.items.allSatisfy { ($0.deepLink ?? "").hasPrefix("craftdocs://open?") })
    }

    @Test("An unparseable date sorts undated and shows the fetch time")
    func unparseableDateFallsBackToFetchedAt() {
        let fetchedAt = "2026-11-21T09:00:00Z"
        // The sort's rule — unparseable reads as undated — must extend to
        // the row: a blank meta line never replaces a valid fallback.
        let garbage = craftDocItem(
            from: CraftDocument(id: "d-garbage", title: "Garbage", lastModifiedAt: "not-a-date")!,
            spaceId: nil, fetchedAt: fetchedAt)
        #expect(garbage.updatedAt == fetchedAt)
        let dated = craftDocItem(
            from: CraftDocument(id: "d-ok", title: "OK", lastModifiedAt: "2026-11-20T10:00:00Z")!,
            spaceId: nil, fetchedAt: fetchedAt)
        #expect(dated.updatedAt == "2026-11-20T10:00:00Z")
    }

    @Test("The API's clickableLink wins; anything else falls back to hand-built")
    func clickableLinkMapping() {
        let fetchedAt = "2026-11-21T00:00:00Z"
        // A craftdocs:// clickableLink is trusted verbatim, and the preview
        // URL is built from the LINK's values — not the credential space id.
        let api = craftDocItem(
            from: CraftDocument(
                id: "d1", title: "T",
                clickableLink: "craftdocs://open?spaceId=live&documentId=d1")!,
            spaceId: "space-1", fetchedAt: fetchedAt)
        #expect(api.deepLink == "craftdocs://open?spaceId=live&documentId=d1")
        #expect(api.openUrl == "https://docs.craft.do/editor/d/live/d1")
        // Observed-bug regression: the clickableLink's documentId is a
        // different id family than the row's API id for the same doc — the
        // editor URL must carry the link's id, never the row id (the old
        // root-block URL hangs the editor on its loading skeleton).
        let diverged = craftDocItem(
            from: CraftDocument(
                id: "7bd0a593-3f45-4664-b11c-35d54fa01665", title: "T",
                clickableLink:
                    "craftdocs://open?spaceId=f9127855-9d9a-f50c-8b9c-754a16c62d86&documentId=277fa729-cd4a-4645-ad15-f085b00495c4")!,
            spaceId: "space-1", fetchedAt: fetchedAt)
        #expect(
            diverged.openUrl
                == "https://docs.craft.do/editor/d/f9127855-9d9a-f50c-8b9c-754a16c62d86/277fa729-cd4a-4645-ad15-f085b00495c4")
        #expect(!diverged.openUrl.contains("7bd0a593"), "the row id never reaches the editor URL")
        // An https editor link is rejected — the deepLink must remain a
        // native `craftdocs://` target, and with no validated link the row
        // carries no web URL (native fallback).
        let https = craftDocItem(
            from: CraftDocument(
                id: "d2", title: "T",
                clickableLink: "https://docs.craft.do/editor/d/s/d2")!,
            spaceId: "space-1", fetchedAt: fetchedAt)
        #expect(https.deepLink == "craftdocs://open?spaceId=space-1&blockId=d2")
        #expect(https.openUrl == "")
        // Garbage never reaches the deepLink either, and yields no web URL.
        let garbage = craftDocItem(
            from: CraftDocument(id: "d3", title: "T", clickableLink: "not a url")!,
            spaceId: "space-1", fetchedAt: fetchedAt)
        #expect(garbage.deepLink == "craftdocs://open?spaceId=space-1&blockId=d3")
        #expect(garbage.openUrl == "")
        // No metadata at all: the hand-built link, the fetch time, and no
        // web URL (native fallback).
        let bare = craftDocItem(
            from: CraftDocument(id: "d4", title: "T")!,
            spaceId: "space-1", fetchedAt: fetchedAt)
        #expect(bare.deepLink == "craftdocs://open?spaceId=space-1&blockId=d4")
        #expect(bare.updatedAt == fetchedAt)
        #expect(bare.openUrl == "")
    }

    @Test("Web editor URLs need a space id and encode both segments")
    func webEditorURLs() {
        #expect(
            craftWebEditorURL(spaceId: "space-1", documentId: "d1")
                == "https://docs.craft.do/editor/d/space-1/d1")
        #expect(
            craftWebEditorURL(spaceId: "s 1", documentId: "s/x")
                == "https://docs.craft.do/editor/d/s%201/s%2Fx")
        #expect(craftWebEditorURL(spaceId: nil, documentId: "d1") == nil)
        #expect(craftWebEditorURL(spaceId: "", documentId: "d1") == nil)
        // The parser builds from the clickableLink's own values: a
        // validated link yields the editor URL, anything else yields nil —
        // never a substitution of the credential space id.
        #expect(
            craftWebEditorURL(fromClickableLink: "craftdocs://open?spaceId=live&documentId=d1")
                == "https://docs.craft.do/editor/d/live/d1")
        #expect(craftWebEditorURL(fromClickableLink: "craftdocs://open?spaceId=live") == nil)
        #expect(craftWebEditorURL(fromClickableLink: "craftdocs://open?documentId=d1") == nil)
        #expect(
            craftWebEditorURL(fromClickableLink: "https://docs.craft.do/editor/d/s/d1") == nil)
        #expect(craftWebEditorURL(fromClickableLink: "not a url") == nil)
        #expect(craftWebEditorURL(fromClickableLink: nil) == nil)
        // No validated link (a legacy credential): the row carries no web
        // URL and opens natively via its deepLink.
        let legacy = craftDocItem(
            from: CraftDocument(id: "d9", title: "T")!,
            spaceId: nil, fetchedAt: "2026-11-21T00:00:00Z")
        #expect(legacy.openUrl == "")
        #expect(legacy.deepLink == "craftdocs://open?blockId=d9")
        let legacyEmpty = craftDocItem(
            from: CraftDocument(id: "d9", title: "T")!,
            spaceId: "", fetchedAt: "2026-11-21T00:00:00Z")
        #expect(legacyEmpty.openUrl == "")
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
        // Rows preview at the web editor built from the clickableLink
        // values, with the craftdocs deep link secondary.
        #expect(result.items.allSatisfy {
            $0.openUrl.hasPrefix("https://docs.craft.do/editor/d/fixture-space/")
                && ($0.deepLink ?? "").hasPrefix("craftdocs://open?")
        })
        // Served path must emit the canonical `s/…` table row-for-row —
        // the same ids `DocsFixtures`, the renderer `DOC_FIXTURES`, and the
        // pin tests agree on — or ?mokiDoc breaks under MOKI_FIXTURES=1.
        #expect(result.items.map(\.id) == DocsFixtures.craftRecents().map(\.id))
        #expect(
            result.items.first?.openUrl
                == "https://docs.craft.do/editor/d/fixture-space/A7C5E2D4-93B1-4F0E-9F27-F1B2C3D4E5F6",
            "fixture openUrls carry the editor id, not the row id")
        #expect(
            result.items.first?.deepLink
                == "craftdocs://open?spaceId=fixture-space&documentId=A7C5E2D4-93B1-4F0E-9F27-F1B2C3D4E5F6",
            "fixture deepLinks carry the editor id — never URLComponents on the row id")
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

    @Test("Fixtures sign-out settles into signed-out; a fixture save restores rows")
    func fixturesSignOutAndRestore() async throws {
        await CraftFixtureAuthState.shared.reset()
        CraftStubURLProtocol.setHandler { _ in throw URLError(.badServerResponse) }
        defer { CraftStubURLProtocol.clear() }
        // Seed real-looking material: a fixtures sign-out must leave all
        // of it alone (hermetic — the whole point is a fixtures session
        // never touches the developer's real credentials).
        let secrets = InMemorySecretStore()
        try secrets.write(
            #"{"client_id":"old-client"}"#, service: CraftOAuthKeychain.service,
            account: CraftOAuthKeychain.clientAccount)
        try secrets.write(
            #"{"access_token":"old-token"}"#, service: CraftOAuthKeychain.service,
            account: CraftOAuthKeychain.tokenAccount)
        let (locations, dir) = craftTempLocations()
        defer { try? FileManager.default.removeItem(at: dir) }
        CraftCredentialStore(locations: locations).save(CraftCredential(
            url: craftBase.absoluteString, spaceId: "space-1"))
        let svc = CraftService(
            store: CraftCredentialStore(locations: locations),
            session: makeCraftStubSession(), fixtures: true,
            secrets: secrets)

        // Signed in by default: 12 rows, flags clear.
        let before = await svc.listRecents()
        #expect(before.items.count == 12)
        #expect(before.signedOut == false)

        _ = try await svc.signOut()
        #expect(CraftStubURLProtocol.requestCount() == 0, "no network leaves the process")
        #expect(
            CraftCredentialStore(locations: locations).load() != nil,
            "the credential file survives a fixtures sign-out")
        #expect(
            secrets.read(
                service: CraftOAuthKeychain.service, account: CraftOAuthKeychain.clientAccount)
                != nil,
            "the MCP-era client registration survives a fixtures sign-out")
        #expect(
            secrets.read(
                service: CraftOAuthKeychain.service, account: CraftOAuthKeychain.tokenAccount)
                != nil,
            "the MCP-era token survives a fixtures sign-out")
        let signedOut = await svc.listRecents()
        #expect(signedOut == DocsListRecentsResult(items: [], unreachable: false, signedOut: true))

        // A pasted URL restores rows and writes nothing to disk.
        _ = try await svc.save(url: craftBase.absoluteString)
        #expect(CraftStubURLProtocol.requestCount() == 0, "a fixtures save skips the network")
        let restored = await svc.listRecents()
        #expect(restored.items.count == 12)
        #expect(restored.signedOut == false)
        #expect(restored.items.map(\.id) == DocsFixtures.craftRecents().map(\.id))

        // Validate stays check-only: rows survive a failed shape check.
        _ = try await svc.validate(url: "garbage")
        #expect((await svc.listRecents()).signedOut == false)
        await CraftFixtureAuthState.shared.reset()
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

// MARK: - Sign-out sweep

extension CraftTests {

    @Test("Sign-out clears the legacy file and both MCP-era keychain accounts")
    func signOutSweepsBothCredentialKinds() async throws {
        CraftStubURLProtocol.setHandler { request in
            (craftHTTPResponse(url: request.url!, status: 200), craftJSONData(craftConnectionJSON))
        }
        defer { CraftStubURLProtocol.clear() }
        let secrets = InMemorySecretStore()
        try secrets.write(
            #"{"client_id":"old-client"}"#, service: CraftOAuthKeychain.service,
            account: CraftOAuthKeychain.clientAccount)
        try secrets.write(
            #"{"access_token":"old-token"}"#, service: CraftOAuthKeychain.service,
            account: CraftOAuthKeychain.tokenAccount)
        let (svc, locations, dir) = service(secrets: secrets)
        defer { try? FileManager.default.removeItem(at: dir) }
        _ = try await svc.save(url: craftBase.absoluteString)
        #expect(CraftCredentialStore(locations: locations).load() != nil)
        #expect(try await svc.signOut() == CraftOK())
        #expect(CraftCredentialStore(locations: locations).load() == nil)
        #expect(
            secrets.read(
                service: CraftOAuthKeychain.service, account: CraftOAuthKeychain.clientAccount)
                == nil,
            "the MCP-era client registration must not survive sign-out")
        #expect(
            secrets.read(
                service: CraftOAuthKeychain.service, account: CraftOAuthKeychain.tokenAccount)
                == nil,
            "the MCP-era token must not survive sign-out")
        // Missing everything still succeeds.
        #expect(try await svc.signOut() == CraftOK())
    }

    @Test("Registration exposes only the Connect methods")
    func registrationExposesOnlyConnect() async throws {
        let transport = InMemoryTransport(lines: [
            #"{"jsonrpc":"2.0","id":1,"method":"craftConnect.signOut"}"#,
            #"{"jsonrpc":"2.0","id":2,"method":"craft.signInStart"}"#,
        ])
        let server = RPCServer(transport: transport)
        let (locations, dir) = craftTempLocations()
        defer { try? FileManager.default.removeItem(at: dir) }
        await server.registerCraftMethods(
            session: makeCraftStubSession(), locations: locations,
            environment: [:], secrets: InMemorySecretStore())
        await server.run()
        let output = await transport.collectedOutput()
        #expect(output.count == 2)
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
        guard case .object(let signOut) = byID[1],
            case .object(let signOutResult) = signOut["result"],
            case .bool(let ok) = signOutResult["ok"]
        else {
            Issue.record("signOut response had unexpected shape: \(output)")
            return
        }
        #expect(ok == true)
        guard case .object(let signIn) = byID[2],
            case .object(let signInError) = signIn["error"],
            case .int(let code) = signInError["code"]
        else {
            Issue.record("signIn response had unexpected shape: \(output)")
            return
        }
        #expect(code == -32601, "craft.signInStart is gone: method not found")
    }
}
