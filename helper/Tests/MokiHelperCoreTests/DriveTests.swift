import Foundation
import Testing

@testable import MokiHelperCore

// MARK: - Stubs

private final class DriveStubURLProtocol: URLProtocol {
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

private func makeDriveStubSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [DriveStubURLProtocol.self]
    return URLSession(configuration: config)
}

private func driveHTTPResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func driveJSONData(_ object: Any) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
}

private let driveClientEnv = [
    "MOKI_GOOGLE_CLIENT_ID": "cid",
    "MOKI_GOOGLE_CLIENT_SECRET": "s",
]

private func makeTempDriveHome() throws -> (home: URL, scratch: URL) {
    let scratch = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString)
    let home = scratch.appendingPathComponent("home")
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    return (home, scratch)
}

private func writeDriveTokens(_ map: [String: String], to url: URL) throws {
    try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(map).write(to: url)
}

private func driveBodyData(of request: URLRequest) -> Data? {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return nil }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
        let read = stream.read(&buffer, maxLength: buffer.count)
        if read <= 0 { break }
        data.append(buffer, count: read)
    }
    return data
}

private func driveFile(
    id: String, name: String, modifiedTime: String, mimeType: String = "text/plain",
    webViewLink: String? = nil
) -> [String: Any] {
    var file: [String: Any] = [
        "id": id, "name": name, "modifiedTime": modifiedTime, "mimeType": mimeType,
    ]
    file["webViewLink"] = webViewLink ?? "https://drive.google.com/file/d/\(id)/view"
    return file
}

private func driveListJSON(_ files: [[String: Any]]) -> Data {
    driveJSONData(["files": files])
}

/// Stub token refresh + userinfo (200/ok), then route Drive API calls to
/// `driveHandler`.
private func installDriveStub(
    driveHandler: @escaping @Sendable (URLRequest) -> (HTTPURLResponse, Data)
) {
    DriveStubURLProtocol.setHandler { request in
        let url = request.url!.absoluteString
        if url == "https://oauth2.googleapis.com/token" {
            return (
                driveHTTPResponse(url: request.url!, status: 200),
                driveJSONData(["access_token": "ya29.drive", "expires_in": 3600])
            )
        }
        if url == "https://www.googleapis.com/oauth2/v2/userinfo" {
            return (
                driveHTTPResponse(url: request.url!, status: 200),
                driveJSONData(["name": "Drive User"])
            )
        }
        return driveHandler(request)
    }
}

@Suite(.serialized)
struct DriveTests {
    // MARK: - URL building

    @Test func listURLHitsFilesWithRecentsParams() {
        let absolute = driveFilesURL.absoluteString
        #expect(absolute.hasPrefix("https://www.googleapis.com/drive/v3/files?"))
        #expect(absolute.contains("pageSize=12"))
        #expect(absolute.contains("orderBy=modifiedTime%20desc"))
        #expect(absolute.contains("trashed"))
        #expect(absolute.contains("fields="))
        #expect(absolute.contains("modifiedTime"))
        #expect(absolute.contains("webViewLink"))
    }

    // MARK: - Mapping

    @Test func mapsFileToDocItem() {
        let item = docItem(
            from: DriveFileItem(
                id: "f1", name: "Q3 planning doc",
                modifiedTime: "2026-11-20T16:05:00.000Z",
                mimeType: "application/vnd.google-apps.document",
                webViewLink: "https://docs.google.com/document/d/f1/edit"))
        #expect(
            item
                == DocItem(
                    id: "f1", title: "Q3 planning doc", source: .drive,
                    updatedAt: "2026-11-20T16:05:00.000Z",
                    openUrl: "https://docs.google.com/document/d/f1/edit"))
    }

    @Test func fallsBackOnMissingNameAndLink() {
        let item = docItem(
            from: DriveFileItem(
                id: "f2", name: nil, modifiedTime: "2026-11-20T16:05:00.000Z",
                mimeType: nil, webViewLink: nil))
        #expect(item?.title == "(Untitled)")
        #expect(item?.openUrl == "https://drive.google.com/file/d/f2/view")
        #expect(item?.source == .drive)
    }

    @Test func skipsIdLessAndDatelessFiles() {
        #expect(
            docItem(
                from: DriveFileItem(
                    id: nil, name: "No id", modifiedTime: "2026-11-20T16:05:00.000Z",
                    mimeType: nil, webViewLink: nil)) == nil)
        #expect(
            docItem(
                from: DriveFileItem(
                    id: "f3", name: "No date", modifiedTime: nil,
                    mimeType: nil, webViewLink: nil)) == nil)
        #expect(
            docItem(
                from: DriveFileItem(
                    id: "", name: "Empty id", modifiedTime: "2026-11-20T16:05:00.000Z",
                    mimeType: nil, webViewLink: nil)) == nil)
    }

    @Test func statusMapping() {
        #expect((driveStatusError(status: 401, account: "a") as? AppError)?.code == "auth_expired")
        // 403 covers both a dead grant and an imported grant minted
        // without the Drive scope.
        #expect((driveStatusError(status: 403, account: "a") as? AppError)?.code == "auth_expired")
        #expect((driveStatusError(status: 500, account: "a") as? AppError)?.code == "unreachable")
    }

    // MARK: - Live listing over stubbed HTTP

    private func makeService(home: URL) -> DriveService {
        let locations = GoogleLocations(homeDirectoryURL: home)
        return DriveService(
            accounts: GoogleAccountsService(
                locations: locations, environment: driveClientEnv,
                session: makeDriveStubSession()),
            session: makeDriveStubSession())
    }

    @Test func listsAcrossAccountsMergedNewestFirstCappedAtTwelve() async throws {
        let (home, scratch) = try makeTempDriveHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeDriveTokens(
            ["a@example.com": "ra", "b@example.com": "rb"],
            to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)

        DriveStubURLProtocol.setHandler { request in
            let url = request.url!.absoluteString
            if url == "https://oauth2.googleapis.com/token" {
                let body = driveBodyData(of: request).flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let token = body.contains("refresh_token=rb") ? "ya29.b" : "ya29.a"
                return (
                    driveHTTPResponse(url: request.url!, status: 200),
                    driveJSONData(["access_token": token, "expires_in": 3600])
                )
            }
            if url == "https://www.googleapis.com/oauth2/v2/userinfo" {
                return (
                    driveHTTPResponse(url: request.url!, status: 200),
                    driveJSONData(["name": "Drive User"])
                )
            }
            let auth = request.value(forHTTPHeaderField: "Authorization") ?? ""
            #expect(auth == "Bearer ya29.a" || auth == "Bearer ya29.b")
            if auth == "Bearer ya29.a" {
                // 12 files from a@example.com, minutes apart.
                let files = (0..<12).map { i in
                    driveFile(
                        id: "a\(i)", name: "A \(i)",
                        modifiedTime: String(format: "2026-11-20T16:%02d:00.000Z", 59 - i))
                }
                return (driveHTTPResponse(url: request.url!, status: 200), driveListJSON(files))
            }
            // b@example.com is newer across the board — its rows win the merge.
            let files = (0..<12).map { i in
                driveFile(
                    id: "b\(i)", name: "B \(i)",
                    modifiedTime: String(format: "2026-11-20T17:%02d:00.000Z", 59 - i))
            }
            return (driveHTTPResponse(url: request.url!, status: 200), driveListJSON(files))
        }
        defer { DriveStubURLProtocol.clear() }

        let page = try await makeService(home: home).listFiles()
        #expect(page.items.count == 12)
        #expect(page.items.allSatisfy { $0.source == .drive })
        // Newest first: all of b's rows (17:xx) precede all of a's (16:xx).
        #expect(page.items.map(\.id) == (0..<12).map { "b\($0)" })
        #expect(page.unreachable.isEmpty)
        #expect(page.authExpired.isEmpty)
    }

    @Test func perAccountFailuresAreReportedNotSilent() async throws {
        let (home, scratch) = try makeTempDriveHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeDriveTokens(
            ["a@example.com": "ra", "gone@example.com": "rgone", "bad@example.com": "rbad"],
            to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)

        DriveStubURLProtocol.setHandler { request in
            let url = request.url!.absoluteString
            if url == "https://oauth2.googleapis.com/token" {
                let body = driveBodyData(of: request).flatMap { String(data: $0, encoding: .utf8) } ?? ""
                if body.contains("refresh_token=rgone") {
                    return (
                        driveHTTPResponse(url: request.url!, status: 400),
                        driveJSONData(["error": "invalid_grant"])
                    )
                }
                if body.contains("refresh_token=rbad") {
                    return (driveHTTPResponse(url: request.url!, status: 500), Data())
                }
                return (
                    driveHTTPResponse(url: request.url!, status: 200),
                    driveJSONData(["access_token": "ya29.drive", "expires_in": 3600])
                )
            }
            if url == "https://www.googleapis.com/oauth2/v2/userinfo" {
                return (
                    driveHTTPResponse(url: request.url!, status: 200),
                    driveJSONData([:])
                )
            }
            // a@example.com's grant lacks the Drive scope: the API 403s
            // even though refresh + userinfo succeeded.
            return (driveHTTPResponse(url: request.url!, status: 403), Data())
        }
        defer { DriveStubURLProtocol.clear() }

        let page = try await makeService(home: home).listFiles()
        #expect(page.items.isEmpty)
        #expect(page.unreachable == ["bad@example.com"])
        #expect(page.authExpired == ["a@example.com", "gone@example.com"])
    }

    @Test func garbageListBodyIsUnreachable() async throws {
        let (home, scratch) = try makeTempDriveHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeDriveTokens(
            ["a@example.com": "ra"],
            to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)

        installDriveStub { request in
            (driveHTTPResponse(url: request.url!, status: 200), Data("not json".utf8))
        }
        defer { DriveStubURLProtocol.clear() }

        let page = try await makeService(home: home).listFiles()
        #expect(page.items.isEmpty)
        #expect(page.unreachable == ["a@example.com"])
        #expect(page.authExpired.isEmpty)
    }

    // MARK: - Handler + fixtures

    @Test func handlerServesLivePageOverStubbedHTTP() async throws {
        let (home, scratch) = try makeTempDriveHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeDriveTokens(
            ["a@example.com": "ra"],
            to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)

        installDriveStub { request in
            (
                driveHTTPResponse(url: request.url!, status: 200),
                driveListJSON([
                    driveFile(
                        id: "f1", name: "Q3 planning doc",
                        modifiedTime: "2026-11-20T16:05:00.000Z")
                ]))
        }
        defer { DriveStubURLProtocol.clear() }

        let service = makeService(home: home)
        let handler = driveListFilesHandler(service: service)
        let page = try await handler(.null)
        #expect(page.items.map(\.title) == ["Q3 planning doc"])
        #expect(page.unreachable.isEmpty)
        #expect(page.authExpired.isEmpty)
    }

    @Test func fixtureReturnsTwelveDriveRowsWithOpenUrls() async throws {
        let handler = fixtureDriveListFilesHandler()
        let page = try await handler(.null)
        #expect(page.items.count == 12)
        #expect(page.items.allSatisfy { $0.source == .drive })
        #expect(page.items.allSatisfy { !$0.openUrl.isEmpty })
        #expect(page.unreachable.isEmpty)
        #expect(page.authExpired.isEmpty)
    }
}
