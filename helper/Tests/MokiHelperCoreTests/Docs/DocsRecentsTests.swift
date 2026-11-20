import Foundation
import Testing

@testable import MokiHelperCore

// MARK: - Stubs

/// Serves canned responses for Google (token refresh, userinfo, Drive
/// files) and Notion search. Private to this file — the Drive and Notion
/// suites carry their own stub types with separate static state.
private final class DocsStubURLProtocol: URLProtocol {
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

private func makeDocsStubSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [DocsStubURLProtocol.self]
    return URLSession(configuration: config)
}

private func docsHTTPResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func docsJSONData(_ object: Any) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
}

/// URLSession moves POST bodies into `httpBodyStream`, so stubs must read
/// the stream (same pattern as the Google suite's `httpBodyData`).
private func docsHTTPBodyData(of request: URLRequest) -> Data? {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return nil }
    stream.open()
    defer { stream.close() }
    var data = Data()
    let chunk = 4096
    var buffer = [UInt8](repeating: 0, count: chunk)
    while stream.hasBytesAvailable {
        let read = stream.read(&buffer, maxLength: chunk)
        if read <= 0 { break }
        data.append(buffer, count: read)
    }
    return data
}

private let docsClientEnv = [
    "MOKI_GOOGLE_CLIENT_ID": "cid",
    "MOKI_GOOGLE_CLIENT_SECRET": "s",
]

private func makeDocsTempHome() throws -> (home: URL, scratch: URL) {
    let scratch = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString)
    let home = scratch.appendingPathComponent("home")
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    return (home, scratch)
}

private func writeDocsTokens(_ map: [String: String], to url: URL) throws {
    try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(map).write(to: url)
}

private func makeDocsDriveService(home: URL) -> DriveService {
    let locations = GoogleLocations(homeDirectoryURL: home)
    return DriveService(
        accounts: GoogleAccountsService(
            locations: locations, environment: docsClientEnv,
            session: makeDocsStubSession()),
        session: makeDocsStubSession())
}

private func makeDocsNotionService(
    secrets: any SecretStoring = InMemorySecretStore()
) -> NotionService {
    NotionService(
        secrets: secrets,
        session: makeDocsStubSession(),
        rateLimiter: NotionRateLimiter(minInterval: 0),
        fixtures: false)
}

private func makeDocsService(
    home: URL, secrets: any SecretStoring = InMemorySecretStore()
) -> DocsRecentsService {
    DocsRecentsService(drive: makeDocsDriveService(home: home), notion: makeDocsNotionService(secrets: secrets))
}

/// Healthy Google legs (refresh + userinfo); Drive files go to `filesHandler`.
private func installDocsGoogleStubs(
    filesHandler: @escaping @Sendable (URLRequest) -> (HTTPURLResponse, Data)
) {
    DocsStubURLProtocol.setHandler { request in
        let url = request.url!.absoluteString
        if url == "https://oauth2.googleapis.com/token" {
            return (
                docsHTTPResponse(url: request.url!, status: 200),
                docsJSONData(["access_token": "ya29.docs", "expires_in": 3600])
            )
        }
        if url == "https://www.googleapis.com/oauth2/v2/userinfo" {
            return (
                docsHTTPResponse(url: request.url!, status: 200),
                docsJSONData(["name": "Docs User"])
            )
        }
        return filesHandler(request)
    }
}

private func docsDriveFile(id: String, name: String, modifiedTime: String) -> [String: Any] {
    [
        "id": id, "name": name, "modifiedTime": modifiedTime, "mimeType": "text/plain",
        "webViewLink": "https://drive.google.com/file/d/\(id)/view",
    ]
}

private func docsNotionPage(
    id: String = "11111111-1111-4111-8111-111111111111",
    title: String = "Roadmap",
    lastEdited: String = "2026-11-20T10:00:00.000Z",
    url: String? = "https://www.notion.so/roadmap-111"
) -> [String: Any] {
    var page: [String: Any] = [
        "object": "page",
        "id": id,
        "last_edited_time": lastEdited,
        "properties": [
            "title": [
                "id": "title",
                "type": "title",
                "title": [["plain_text": title]],
            ]
        ],
    ]
    if let url {
        page["url"] = url
    }
    return page
}

@Suite(.serialized)
struct DocsRecentsTests {
    // MARK: - Drive section

    @Test func drivePassesRowsThroughWithFlagsClear() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeDocsTokens(
            ["a@example.com": "ra"],
            to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)

        installDocsGoogleStubs { request in
            (
                docsHTTPResponse(url: request.url!, status: 200),
                docsJSONData([
                    "files": [
                        docsDriveFile(
                            id: "f1", name: "Q3 planning doc",
                            modifiedTime: "2026-11-20T16:05:00.000Z"),
                        docsDriveFile(
                            id: "f2", name: "Garden budget",
                            modifiedTime: "2026-11-20T14:12:00.000Z"),
                    ]
                ]))
        }
        defer { DocsStubURLProtocol.clear() }

        let result = await makeDocsService(home: home).listRecents(source: .drive)
        #expect(result.items.map(\.id) == ["f1", "f2"])
        #expect(result.items.allSatisfy { $0.source == .drive })
        #expect(result.items.allSatisfy { $0.openUrl.hasPrefix("https://") })
        #expect(result.unreachable == false)
        #expect(result.signedOut == false)
    }

    @Test func driveAuthExpiredSetsSignedOutAndUnreachable() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeDocsTokens(
            ["a@example.com": "ra"],
            to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)

        // Grant lacks the Drive scope: the API 403s even though refresh +
        // userinfo succeeded (psymail-mini imports predate the scope).
        installDocsGoogleStubs { request in
            (docsHTTPResponse(url: request.url!, status: 403), Data())
        }
        defer { DocsStubURLProtocol.clear() }

        let result = await makeDocsService(home: home).listRecents(source: .drive)
        #expect(result.items.isEmpty)
        #expect(result.unreachable == true)
        #expect(result.signedOut == true)
    }

    @Test func driveMixedExpiredAndHealthyIsPartialNotSignedOut() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeDocsTokens(
            ["a@example.com": "ra", "b@example.com": "rb"],
            to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)

        // b's grant is dead at refresh (`invalid_grant` → `auth_expired` in
        // `listAccounts`); a stays healthy and serves one row. Branch on the
        // form-encoded refresh token so the two accounts diverge.
        DocsStubURLProtocol.setHandler { request in
            let url = request.url!.absoluteString
            if url == "https://oauth2.googleapis.com/token" {
                let body =
                    docsHTTPBodyData(of: request).flatMap { String(data: $0, encoding: .utf8) } ?? ""
                if body.contains("refresh_token=rb") {
                    return (
                        docsHTTPResponse(url: request.url!, status: 400),
                        docsJSONData(["error": "invalid_grant"])
                    )
                }
                return (
                    docsHTTPResponse(url: request.url!, status: 200),
                    docsJSONData(["access_token": "ya29.a", "expires_in": 3600])
                )
            }
            if url == "https://www.googleapis.com/oauth2/v2/userinfo" {
                return (
                    docsHTTPResponse(url: request.url!, status: 200),
                    docsJSONData(["name": "Docs User"])
                )
            }
            return (
                docsHTTPResponse(url: request.url!, status: 200),
                docsJSONData([
                    "files": [
                        docsDriveFile(
                            id: "f1", name: "Healthy row",
                            modifiedTime: "2026-11-20T16:05:00.000Z")
                    ]
                ]))
        }
        defer { DocsStubURLProtocol.clear() }

        // Healthy rows survive next to the expired grant: rows + partial,
        // never the sign-in state.
        let result = await makeDocsService(home: home).listRecents(source: .drive)
        #expect(result.items.map(\.id) == ["f1"])
        #expect(result.signedOut == false)
        #expect(result.unreachable == true)
    }

    @Test func driveAllExpiredAndEmptySignsOut() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeDocsTokens(
            ["a@example.com": "ra"],
            to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)

        // Dead at refresh: no account ever reaches files, so the page is
        // empty with an expired grant — the sign-in state.
        DocsStubURLProtocol.setHandler { request in
            let url = request.url!.absoluteString
            if url == "https://oauth2.googleapis.com/token" {
                return (
                    docsHTTPResponse(url: request.url!, status: 400),
                    docsJSONData(["error": "invalid_grant"])
                )
            }
            return (docsHTTPResponse(url: request.url!, status: 500), Data())
        }
        defer { DocsStubURLProtocol.clear() }

        let result = await makeDocsService(home: home).listRecents(source: .drive)
        #expect(result.items.isEmpty)
        #expect(result.signedOut == true)
        #expect(result.unreachable == true)
    }

    @Test func driveServerErrorIsUnreachableWithoutSignOut() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeDocsTokens(
            ["a@example.com": "ra"],
            to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)

        installDocsGoogleStubs { request in
            (docsHTTPResponse(url: request.url!, status: 500), Data())
        }
        defer { DocsStubURLProtocol.clear() }

        let result = await makeDocsService(home: home).listRecents(source: .drive)
        #expect(result.items.isEmpty)
        #expect(result.unreachable == true)
        #expect(result.signedOut == false)
    }

    // MARK: - Notion section

    @Test func notionOkMapsRowsToDocItems() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let store = InMemorySecretStore()
        try store.write(
            "ntn_live", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)

        DocsStubURLProtocol.setHandler { request in
            #expect(
                request.value(forHTTPHeaderField: "Authorization") == "Bearer ntn_live")
            return (
                docsHTTPResponse(url: request.url!, status: 200),
                docsJSONData([
                    "object": "list",
                    "results": [
                        docsNotionPage(),
                        [
                            "object": "database",
                            "id": "22222222-2222-4222-8222-222222222222",
                            "last_edited_time": "2026-11-19T10:00:00.000Z",
                            "url": "https://www.notion.so/tasks-222",
                            "title": [["plain_text": "Tasks"]],
                        ],
                    ],
                    "has_more": false,
                ]))
        }
        defer { DocsStubURLProtocol.clear() }

        let result = await makeDocsService(home: home, secrets: store).listRecents(source: .notion)
        #expect(result.items.count == 2)
        #expect(result.items.allSatisfy { $0.source == .notion })
        #expect(result.items[0].title == "Roadmap")
        #expect(result.items[0].updatedAt == "2026-11-20T10:00:00.000Z")
        #expect(result.items[0].openUrl == "https://www.notion.so/roadmap-111")
        #expect(result.items[1].title == "Tasks")
        #expect(result.unreachable == false)
        #expect(result.signedOut == false)
    }

    @Test func notionFallsBackToNotionSoUrl() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let store = InMemorySecretStore()
        try store.write(
            "ntn_live", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)

        DocsStubURLProtocol.setHandler { request in
            (
                docsHTTPResponse(url: request.url!, status: 200),
                docsJSONData([
                    "object": "list",
                    "results": [docsNotionPage(url: nil)],
                    "has_more": false,
                ]))
        }
        defer { DocsStubURLProtocol.clear() }

        let result = await makeDocsService(home: home, secrets: store).listRecents(source: .notion)
        #expect(result.items.count == 1)
        #expect(result.items[0].openUrl == "https://www.notion.so/11111111-1111-4111-8111-111111111111")
        #expect(result.unreachable == false)
        #expect(result.signedOut == false)
    }

    @Test func notionSignedOutWithNoToken() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }

        DocsStubURLProtocol.setHandler { _ in throw URLError(.notConnectedToInternet) }
        defer { DocsStubURLProtocol.clear() }

        // No token: no network, signed-out envelope with no rows.
        let result = await makeDocsService(home: home).listRecents(source: .notion)
        #expect(result.items.isEmpty)
        #expect(result.unreachable == false)
        #expect(result.signedOut == true)
    }

    @Test func notionDeadTokenSignsOut() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let store = InMemorySecretStore()
        try store.write(
            "ntn_dead", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)

        DocsStubURLProtocol.setHandler { request in
            (docsHTTPResponse(url: request.url!, status: 401), Data())
        }
        defer { DocsStubURLProtocol.clear() }

        let result = await makeDocsService(home: home, secrets: store).listRecents(source: .notion)
        #expect(result.items.isEmpty)
        #expect(result.unreachable == false)
        #expect(result.signedOut == true)
    }

    @Test func notionServerErrorIsUnreachable() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let store = InMemorySecretStore()
        try store.write(
            "ntn_live", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)

        DocsStubURLProtocol.setHandler { request in
            (docsHTTPResponse(url: request.url!, status: 500), Data())
        }
        defer { DocsStubURLProtocol.clear() }

        let result = await makeDocsService(home: home, secrets: store).listRecents(source: .notion)
        #expect(result.items.isEmpty)
        #expect(result.unreachable == true)
        #expect(result.signedOut == false)
    }

    @Test func notionRateLimitIsUnreachable() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let store = InMemorySecretStore()
        try store.write(
            "ntn_live", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)

        DocsStubURLProtocol.setHandler { request in
            (docsHTTPResponse(url: request.url!, status: 429), Data())
        }
        defer { DocsStubURLProtocol.clear() }

        // `rate_limited` is a throw upstream; the dispatcher folds it into
        // the partial state, never a blank error.
        let result = await makeDocsService(home: home, secrets: store).listRecents(source: .notion)
        #expect(result.items.isEmpty)
        #expect(result.unreachable == true)
        #expect(result.signedOut == false)
    }

    // MARK: - Craft section (unwired: no service, partial state)

    @Test func craftReportsUnreachableWithoutSignIn() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }

        let result = await makeDocsService(home: home).listRecents(source: .craft)
        #expect(result.items.isEmpty)
        #expect(result.unreachable == true)
        #expect(result.signedOut == false)
    }

    @Test func craftUsesWiredServiceWhenPresent() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let craft = CraftService(
            store: CraftCredentialStore(
                locations: CraftLocations(
                    credentialURL: home.appendingPathComponent("craft-connection.json"))),
            session: makeDocsStubSession(), fixtures: true)
        let service = DocsRecentsService(
            drive: makeDocsDriveService(home: home), notion: makeDocsNotionService(), craft: craft)

        // Identity mapping: the service's contract rows pass through.
        let result = await service.listRecents(source: .craft)
        #expect(result.items.count == 12)
        #expect(result.items.allSatisfy { $0.source == .craft && $0.openUrl == "" })
        #expect(result.items.allSatisfy { ($0.deepLink ?? "").hasPrefix("craftdocs://open?") })
        #expect(result.unreachable == false)
        #expect(result.signedOut == false)
    }

    // MARK: - Handler + fixtures

    @Test func handlerRejectsUnknownSource() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }

        let handler = docsListRecentsHandler(service: makeDocsService(home: home))
        do {
            _ = try await handler(.object(["source": .string("carrier-pigeon")]))
            Issue.record("expected InvalidParamsError")
        } catch is InvalidParamsError {
        } catch {
            Issue.record("wrong error: \(error)")
        }
    }

    @Test func docsListRecentsOverRPC() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let store = InMemorySecretStore()
        try store.write(
            "ntn_live", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)

        DocsStubURLProtocol.setHandler { request in
            (
                docsHTTPResponse(url: request.url!, status: 200),
                docsJSONData([
                    "object": "list",
                    "results": [docsNotionPage()],
                    "has_more": false,
                ]))
        }
        defer { DocsStubURLProtocol.clear() }

        let transport = InMemoryTransport()
        let server = RPCServer(transport: transport)
        await server.register(
            "docs.listRecents",
            handler: docsListRecentsHandler(service: makeDocsService(home: home, secrets: store)))
        let reply = try #require(
            await server.handleLine(
                #"{"jsonrpc":"2.0","id":1,"method":"docs.listRecents","params":{"source":"notion"}}"#))
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(reply.utf8))
        guard case .object(let envelope) = value,
            case .object(let result) = envelope["result"],
            case .array(let items) = result["items"],
            case .bool(let unreachable) = result["unreachable"],
            case .bool(let signedOut) = result["signedOut"],
            case .object(let first) = items.first,
            case .string(let source) = first["source"]
        else {
            Issue.record("docs.listRecents response had unexpected shape: \(reply)")
            return
        }
        #expect(items.count == 1)
        #expect(source == "notion")
        #expect(unreachable == false)
        #expect(signedOut == false)
    }

    @Test func fixtureRowsMirrorCanonicalContract() async throws {
        // Checked-in mirror of the renderer's DOC_FIXTURES
        // (lenses/docs/fixtures.ts header): TS and Swift cannot share one
        // fixture file, so a fixture change on either side without the other
        // fails here or in the renderer's "mirrors the canonical contract"
        // test. Change rows here AND there together.
        let canonicalDrive: [(id: String, title: String)] = [
            ("1a2b3c4d5e6f7g8h9i0j", "Launch plan v3"),
            ("2b3c4d5e6f7g8h9i0j1k", "Board deck — November"),
            ("3c4d5e6f7g8h9i0j1k2l", "Hiring rubric"),
            ("4d5e6f7g8h9i0j1k2l3m", "Pricing experiments"),
            ("5e6f7g8h9i0j1k2l3m4n", "Offsite notes"),
            ("6f7g8h9i0j1k2l3m4n5o", "Q4 budget"),
            ("7g8h9i0j1k2l3m4n5o6p", "Design critique thread"),
            ("8h9i0j1k2l3m4n5o6p7q", "API migration checklist"),
            ("9i0j1k2l3m4n5o6p7q8r", "Customer visit notes"),
            ("0j1k2l3m4n5o6p7q8r9s", "Brand refresh brief"),
            ("1k2l3m4n5o6p7q8r9s0t", "All-hands agenda"),
            ("2l3m4n5o6p7q8r9s0t1u", "Reading list"),
        ]
        let canonicalNotion: [(id: String, title: String)] = [
            ("Tansy-Roadmap-9f2c1a", "Tansy roadmap"),
            ("Weekly-Review-7d4b2e", "Weekly review"),
            ("Meeting-Notes-3a8f1c", "Meeting notes"),
            ("Product-Spec-5e6a9d", "Life OS spec"),
            ("Habit-Tracker-1b3d7f", "Habit tracker"),
            ("Book-Notes-8c2e4a", "Book notes"),
            ("Travel-Plans-6f1a3c", "Travel plans"),
            ("Gift-Ideas-2d9b5e", "Gift ideas"),
            ("Home-Renovation-4a7c1e", "Home renovation"),
            ("Side-Project-9e3f8b", "Side project log"),
            ("Recipes-5b8d2f", "Recipes"),
            ("Journal-7c1e6a", "Journal"),
        ]
        let canonicalCraft: [(id: String, title: String)] = [
            ("s/launch-checklist-a1b2c3", "Launch checklist"),
            ("s/essay-draft-d4e5f6", "Essay draft"),
            ("s/trip-itinerary-g7h8i9", "Trip itinerary"),
            ("s/reading-notes-j0k1l2", "Reading notes"),
            ("s/garden-plan-m3n4o5", "Garden plan"),
            ("s/talk-outline-p6q7r8", "Talk outline"),
            ("s/budget-review-s9t0u1", "Budget review"),
            ("s/book-club-v2w3x4", "Book club picks"),
            ("s/workout-log-y5z6a7", "Workout log"),
            ("s/gift-list-b8c9d0", "Gift list"),
            ("s/home-inventory-e1f2g3", "Home inventory"),
            ("s/ideas-inbox-h4i5j6", "Ideas inbox"),
        ]
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime]
        await NotionFixtureAuthState.shared.reset()
        let handler = fixtureDocsListRecentsHandler()
        for (source, canonical) in [
            (DocSource.drive, canonicalDrive),
            (DocSource.notion, canonicalNotion),
            (DocSource.craft, canonicalCraft),
        ] as [(DocSource, [(id: String, title: String)])] {
            let result = try await handler(.object(["source": .string(source.rawValue)]))
            #expect(result.items.count == 12, "expected 12 rows for \(source)")
            #expect(result.items.map(\.id) == canonical.map(\.id), "id drift for \(source)")
            #expect(result.items.map(\.title) == canonical.map(\.title), "title drift for \(source)")
            for item in result.items {
                switch source {
                case .drive:
                    #expect(
                        item.openUrl == "https://drive.google.com/file/d/\(item.id)/view",
                        "openUrl drift for \(item.id)")
                case .notion:
                    #expect(
                        item.openUrl == "https://www.notion.so/\(item.id)",
                        "openUrl drift for \(item.id)")
                case .craft:
                    #expect(item.openUrl == "", "Craft never loads in the preview guest")
                    #expect(
                        item.deepLink
                            == "craftdocs://open?spaceId=fixture-space&blockId=\(item.id)",
                        "deepLink drift for \(item.id)")
                }
            }
            // Within the last day, newest first — so ?mokiDoc pins and any
            // recency filter hold under MOKI_FIXTURES=1 at any wall-clock time.
            var previous = Date.distantFuture
            for item in result.items {
                let date = try #require(
                    parser.date(from: item.updatedAt), "unparseable updatedAt for \(item.id)")
                let age = Date().timeIntervalSince(date)
                #expect(age >= 0 && age < 24 * 60 * 60, "stale updatedAt for \(item.id)")
                #expect(date < previous, "not newest-first at \(item.id)")
                previous = date
            }
        }
    }

    @Test func fixtureHandlerServesTwelveContractRowsPerSource() async throws {
        await NotionFixtureAuthState.shared.reset()
        let handler = fixtureDocsListRecentsHandler()
        for source in [DocSource.drive, .notion, .craft] as [DocSource] {
            let result = try await handler(.object(["source": .string(source.rawValue)]))
            #expect(result.items.count == 12, "expected 12 rows for \(source)")
            #expect(result.items.allSatisfy { $0.source == source }, "wrong source for \(source)")
            if source == .craft {
                // Craft opens out-of-app: empty openUrl plus a native-app
                // deepLink on every row.
                #expect(
                    result.items.allSatisfy { $0.openUrl == "" },
                    "Craft rows never load in the preview guest")
                #expect(
                    result.items.allSatisfy { ($0.deepLink ?? "").hasPrefix("craftdocs://open?") },
                    "non-craftdocs deepLink for \(source)")
            } else {
                #expect(
                    result.items.allSatisfy { $0.openUrl.hasPrefix("https://") },
                    "non-https openUrl for \(source)")
            }
            #expect(result.unreachable == false)
            #expect(result.signedOut == false)
        }
    }

    @Test func fixtureDocsHandlerHonorsFixtureSignOut() async throws {
        await NotionFixtureAuthState.shared.reset()
        let handler = fixtureDocsListRecentsHandler()
        let notionParams = JSONValue.object(["source": .string(DocSource.notion.rawValue)])
        // Signed in by default: 12 rows, flags clear.
        let before = try await handler(notionParams)
        #expect(before.items.count == 12)
        #expect(before.signedOut == false)

        // Sign out through the fixture NotionService — the same path the
        // renderer calls — and the section settles into sign-in state.
        let notion = NotionService(
            secrets: InMemorySecretStore(),
            session: makeDocsStubSession(),
            rateLimiter: NotionRateLimiter(minInterval: 0),
            fixtures: true)
        _ = try await notion.signOut()
        let signedOut = try await handler(notionParams)
        #expect(signedOut.items.isEmpty)
        #expect(signedOut.unreachable == false)
        #expect(signedOut.signedOut == true)

        // A pasted token restores rows with no renderer change.
        _ = try await notion.setToken("ntn_fixture")
        let restored = try await handler(notionParams)
        #expect(restored.items.count == 12)
        #expect(restored.signedOut == false)
        await NotionFixtureAuthState.shared.reset()
    }

    // MARK: - Mapping unit
    @Test func notionDocItemMapping() {
        let withURL = notionDocItem(
            from: NotionRecent(
                id: "abc", title: "T", url: "https://www.notion.so/x",
                object: "page", lastEditedTime: "2026-11-20T10:00:00.000Z"))
        #expect(withURL == DocItem(
            id: "abc", title: "T", source: .notion,
            updatedAt: "2026-11-20T10:00:00.000Z", openUrl: "https://www.notion.so/x"))
        let withoutURL = notionDocItem(
            from: NotionRecent(
                id: "abc", title: "T", url: nil,
                object: "database", lastEditedTime: "2026-11-20T10:00:00.000Z"))
        #expect(withoutURL.openUrl == "https://www.notion.so/abc")
    }
}
