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

    // MARK: - Craft section (no API yet)

    @Test func craftReportsUnreachableWithoutSignIn() async throws {
        let (home, scratch) = try makeDocsTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }

        let result = await makeDocsService(home: home).listRecents(source: .craft)
        #expect(result.items.isEmpty)
        #expect(result.unreachable == true)
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

    @Test func fixtureHandlerServesTwelveHttpsRowsPerSource() async throws {
        let handler = fixtureDocsListRecentsHandler()
        for source in [DocSource.drive, .notion, .craft] as [DocSource] {
            let result = try await handler(.object(["source": .string(source.rawValue)]))
            #expect(result.items.count == 12, "expected 12 rows for \(source)")
            #expect(result.items.allSatisfy { $0.source == source }, "wrong source for \(source)")
            #expect(
                result.items.allSatisfy { $0.openUrl.hasPrefix("https://") },
                "non-https openUrl for \(source)")
            #expect(result.unreachable == false)
            #expect(result.signedOut == false)
        }
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
