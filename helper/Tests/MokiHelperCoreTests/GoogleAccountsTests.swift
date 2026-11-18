import Foundation
import Testing

@testable import MokiHelperCore

// MARK: - Stubs

/// Records requests and serves canned responses. Handler state is
/// lock-guarded because the tests around it run in a serialized suite, not
/// because parallel use is expected.
private final class StubURLProtocol: URLProtocol {
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

private final class RequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []

    func append(_ request: URLRequest) {
        lock.withLock { requests.append(request) }
    }

    var all: [URLRequest] {
        lock.withLock { requests }
    }
}

private func makeStubSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubURLProtocol.self]
    return URLSession(configuration: config)
}

private func httpBodyData(of request: URLRequest) -> Data? {
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

private func httpResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func jsonData(_ object: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
}

/// A fresh home directory under a temp dir, cleaned up by the caller.
private func makeTempHome() throws -> (home: URL, scratch: URL) {
    let scratch = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString)
    let home = scratch.appendingPathComponent("home")
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    return (home, scratch)
}

private func writeTokens(_ map: [String: String], to url: URL) throws {
    try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(map).write(to: url)
}

@Suite(.serialized)
struct GoogleAccountsTests {
    // MARK: - xcconfig parsing

    @Test func xcconfigParsing() {
        let text = """
            // psymail secrets
            GOOGLE_CLIENT_ID = 1234-abc.apps.googleusercontent.com
              GOOGLE_CLIENT_SECRET=GOCSPX-xyz  ;
            #include "Other.xcconfig"
            EMPTY =
            NO_EQUALS_HERE
            // trailing comment
            GOOGLE_CLIENT_ID = override.apps.googleusercontent.com // dupe wins
            """
        let parsed = parseXCConfig(text)
        #expect(parsed["GOOGLE_CLIENT_ID"] == "override.apps.googleusercontent.com")
        #expect(parsed["GOOGLE_CLIENT_SECRET"] == "GOCSPX-xyz")
        #expect(parsed["EMPTY"] == nil)
        #expect(parsed["NO_EQUALS_HERE"] == nil)
    }

    @Test func clientConfigPrefersEnvironment() throws {
        let (home, scratch) = try makeTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let secretsURL = home.appendingPathComponent("Secrets.xcconfig")
        try "GOOGLE_CLIENT_ID = file-id\nGOOGLE_CLIENT_SECRET = file-secret\n"
            .write(to: secretsURL, atomically: true, encoding: .utf8)
        let locations = GoogleLocations(
            homeDirectoryURL: home, psymailSecretsURL: secretsURL)

        let fromFile = try OAuthClientConfig.load(locations: locations, environment: [:])
        #expect(fromFile == OAuthClientConfig(clientID: "file-id", clientSecret: "file-secret"))

        let fromEnv = try OAuthClientConfig.load(
            locations: locations,
            environment: [
                "MOKI_GOOGLE_CLIENT_ID": "env-id",
                "MOKI_GOOGLE_CLIENT_SECRET": "env-secret",
            ])
        #expect(fromEnv == OAuthClientConfig(clientID: "env-id", clientSecret: "env-secret"))
    }

    @Test func clientConfigMissingThrowsUnconfigured() throws {
        let (home, scratch) = try makeTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        do {
            _ = try OAuthClientConfig.load(locations: locations, environment: [:])
            Issue.record("expected auth_unconfigured, got a config")
        } catch let error as AppError {
            #expect(error.code == "auth_unconfigured")
        }
    }

    // MARK: - Token file import/merge

    @Test func tokenImportMergesAndPersists() throws {
        let (home, scratch) = try makeTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        let store = GoogleTokenStore(locations: locations)

        // Moki already knows one address.
        try writeTokens(["kept@example.com": "moki-refresh"], to: locations.mokiTokensURL)

        // psymail-mini: the EXACT sandboxed path plus the unsandboxed file.
        try writeTokens(
            ["kept@example.com": "psymail-refresh", "new@example.com": "new-refresh"],
            to: locations.psymailSandboxedTokensURL)
        try writeTokens(
            ["other@example.com": "other-refresh"],
            to: locations.psymailUnsandboxedTokensURL)
        let sandboxBefore = try Data(contentsOf: locations.psymailSandboxedTokensURL)
        let unsandboxedBefore = try Data(contentsOf: locations.psymailUnsandboxedTokensURL)

        // A decoy container must be ignored: no globbing ~/Library/Containers/*.
        let decoy = locations.psymailContainersDirectoryURL
            .appendingPathComponent("com.evil.other")
            .appendingPathComponent(
                "Data/Library/Application Support/PsymailMini/tokens.json")
        try writeTokens(["decoy@example.com": "decoy-refresh"], to: decoy)

        let merged = store.loadRefreshTokens()
        #expect(merged["kept@example.com"] == "moki-refresh")
        #expect(merged["new@example.com"] == "new-refresh")
        #expect(merged["other@example.com"] == "other-refresh")
        #expect(merged["decoy@example.com"] == nil)

        // Exact paths only — the decoy never even gets a candidate URL.
        #expect(
            store.psymailTokenURLs() == [
                locations.psymailSandboxedTokensURL,
                locations.psymailUnsandboxedTokensURL,
            ])

        // Moki's file now holds the merged map, mode 0600 …
        let saved = try JSONDecoder().decode(
            [String: String].self, from: Data(contentsOf: locations.mokiTokensURL))
        #expect(saved == merged)
        let attributes = try FileManager.default.attributesOfItem(
            atPath: locations.mokiTokensURL.path)
        let permissions = (attributes[.posixPermissions] as? Int) ?? 0
        #expect(permissions & 0o777 == 0o600)

        // … and psymail-mini's files are byte-identical.
        #expect(try Data(contentsOf: locations.psymailSandboxedTokensURL) == sandboxBefore)
        #expect(
            try Data(contentsOf: locations.psymailUnsandboxedTokensURL) == unsandboxedBefore)

        // Second load imports nothing new and keeps Moki's values.
        let again = store.loadRefreshTokens()
        #expect(again == merged)
    }

    @Test func tokenLoadEmptyWhenNothingPresent() {
        let (home, scratch) = (try? makeTempHome()) ?? (URL(fileURLWithPath: "/nonexistent"), URL(fileURLWithPath: "/nonexistent"))
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        #expect(GoogleTokenStore(locations: locations).loadRefreshTokens().isEmpty)
        #expect(!FileManager.default.fileExists(atPath: locations.mokiTokensURL.path))
    }

    // MARK: - Refresh request + cache

    @Test func refreshBuildsFormPostAndCaches() async throws {
        let log = RequestLog()
        StubURLProtocol.setHandler { request in
            log.append(request)
            return (
                httpResponse(url: request.url!, status: 200),
                jsonData(["access_token": "ya29.live", "expires_in": 3600])
            )
        }
        defer { StubURLProtocol.clear() }
        let session = makeStubSession()

        let config = OAuthClientConfig(clientID: "cid", clientSecret: "sek ret+")
        let cache = GoogleAccessTokenCache(config: config, session: session)
        let first = try await cache.accessToken(
            for: "a@example.com", refreshToken: "rt/1+2")
        let second = try await cache.accessToken(
            for: "a@example.com", refreshToken: "rt/1+2")
        #expect(first == "ya29.live")
        #expect(second == "ya29.live")
        // Second call served from cache: exactly one HTTP request.
        #expect(log.all.count == 1)

        let request = try #require(log.all.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://oauth2.googleapis.com/token")
        #expect(request.timeoutInterval == 15)
        #expect(
            request.value(forHTTPHeaderField: "Content-Type")
                == "application/x-www-form-urlencoded")
        let body = try #require(httpBodyData(of: request).flatMap { String(data: $0, encoding: .utf8) })
        #expect(body.contains("grant_type=refresh_token"))
        #expect(body.contains("client_id=cid"))
        #expect(body.contains("client_secret=sek%20ret%2B"))
        #expect(body.contains("refresh_token=rt%2F1%2B"))
    }

    @Test func refreshInvalidGrantThrowsAuthExpired() async throws {
        StubURLProtocol.setHandler { request in
            (
                httpResponse(url: request.url!, status: 400),
                jsonData(["error": "invalid_grant", "error_description": "Token revoked"])
            )
        }
        defer { StubURLProtocol.clear() }
        let cache = GoogleAccessTokenCache(
            config: OAuthClientConfig(clientID: "cid", clientSecret: "s"),
            session: makeStubSession())
        do {
            _ = try await cache.accessToken(for: "a@example.com", refreshToken: "dead")
            Issue.record("expected auth_expired")
        } catch let error as AppError {
            #expect(error.code == "auth_expired")
        }
    }

    // MARK: - accounts.list

    @Test func accountsListEndToEnd() async throws {
        let (home, scratch) = try makeTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        try writeTokens(
            ["ok@example.com": "good-refresh", "gone@example.com": "dead-refresh"],
            to: locations.mokiTokensURL)

        StubURLProtocol.setHandler { request in
            let url = request.url!.absoluteString
            if url == "https://oauth2.googleapis.com/token" {
                let body = httpBodyData(of: request).flatMap { String(data: $0, encoding: .utf8) } ?? ""
                if body.contains("refresh_token=dead-refresh") {
                    return (
                        httpResponse(url: request.url!, status: 400),
                        jsonData(["error": "invalid_grant"])
                    )
                }
                return (
                    httpResponse(url: request.url!, status: 200),
                    jsonData(["access_token": "ya29.ok", "expires_in": 3600])
                )
            }
            #expect(url == "https://www.googleapis.com/oauth2/v2/userinfo")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer ya29.ok")
            return (
                httpResponse(url: request.url!, status: 200),
                jsonData(["name": "Test User", "picture": "https://example.com/p.png"])
            )
        }
        defer { StubURLProtocol.clear() }

        let service = GoogleAccountsService(
            locations: locations,
            environment: [
                "MOKI_GOOGLE_CLIENT_ID": "cid", "MOKI_GOOGLE_CLIENT_SECRET": "s",
            ],
            session: makeStubSession())
        let result = try await service.listAccounts()
        #expect(result.psymailImport == .unavailable)
        #expect(
            result.accounts == [
                GoogleAccount(
                    address: "gone@example.com", status: .authExpired),
                GoogleAccount(
                    address: "ok@example.com", name: "Test User",
                    photoURL: "https://example.com/p.png", status: .ok),
            ])
    }

    @Test func accountsListIsolatesRefreshServerError() async throws {
        let (home, scratch) = try makeTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        try writeTokens(
            ["bad@example.com": "bad-refresh", "ok@example.com": "good-refresh"],
            to: locations.mokiTokensURL)

        StubURLProtocol.setHandler { request in
            let url = request.url!.absoluteString
            if url == "https://oauth2.googleapis.com/token" {
                let body = httpBodyData(of: request).flatMap { String(data: $0, encoding: .utf8) } ?? ""
                if body.contains("refresh_token=bad-refresh") {
                    return (
                        httpResponse(url: request.url!, status: 500),
                        jsonData(["error": "internal"])
                    )
                }
                return (
                    httpResponse(url: request.url!, status: 200),
                    jsonData(["access_token": "ya29.ok", "expires_in": 3600])
                )
            }
            return (
                httpResponse(url: request.url!, status: 200),
                jsonData(["name": "Good User"])
            )
        }
        defer { StubURLProtocol.clear() }

        let service = GoogleAccountsService(
            locations: locations,
            environment: [
                "MOKI_GOOGLE_CLIENT_ID": "cid", "MOKI_GOOGLE_CLIENT_SECRET": "s",
            ],
            session: makeStubSession())
        // Must not throw: the 500 account resolves as unreachable.
        let result = try await service.listAccounts()
        #expect(
            result.accounts == [
                GoogleAccount(address: "bad@example.com", status: .unreachable),
                GoogleAccount(
                    address: "ok@example.com", name: "Good User", status: .ok),
            ])
    }

    @Test func accountsListReusesCacheAcrossCalls() async throws {
        let (home, scratch) = try makeTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        try writeTokens(["ok@example.com": "good-refresh"], to: locations.mokiTokensURL)

        let log = RequestLog()
        StubURLProtocol.setHandler { request in
            log.append(request)
            if request.url?.absoluteString == "https://oauth2.googleapis.com/token" {
                return (
                    httpResponse(url: request.url!, status: 200),
                    jsonData(["access_token": "ya29.ok", "expires_in": 3600])
                )
            }
            return (
                httpResponse(url: request.url!, status: 200),
                jsonData(["name": "Cached User"])
            )
        }
        defer { StubURLProtocol.clear() }

        let service = GoogleAccountsService(
            locations: locations,
            environment: [
                "MOKI_GOOGLE_CLIENT_ID": "cid", "MOKI_GOOGLE_CLIENT_SECRET": "s",
            ],
            session: makeStubSession())
        let first = try await service.listAccounts()
        let second = try await service.listAccounts()
        #expect(first.accounts == second.accounts)
        #expect(first.accounts == [
            GoogleAccount(address: "ok@example.com", name: "Cached User", status: .ok)
        ])
        // One shared cache for the service's lifetime: a single refresh POST
        // across both calls (userinfo still refetches per call).
        let refreshCount = log.all.filter {
            $0.url?.absoluteString == "https://oauth2.googleapis.com/token"
        }.count
        #expect(refreshCount == 1)
    }

    @Test func accountsListEmptyWithNoTokens() async throws {
        let (home, scratch) = try makeTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let service = GoogleAccountsService(
            locations: GoogleLocations(homeDirectoryURL: home),
            environment: [:],
            session: makeStubSession())
        let result = try await service.listAccounts()
        #expect(result.accounts.isEmpty)
        #expect(result.psymailImport == .unavailable)
    }

    @Test func accountsListOverRPC() async throws {
        let (home, scratch) = try makeTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        try writeTokens(["ok@example.com": "good-refresh"], to: locations.mokiTokensURL)

        StubURLProtocol.setHandler { request in
            if request.url?.absoluteString == "https://oauth2.googleapis.com/token" {
                return (
                    httpResponse(url: request.url!, status: 200),
                    jsonData(["access_token": "ya29.ok", "expires_in": 3600])
                )
            }
            return (
                httpResponse(url: request.url!, status: 200),
                jsonData(["name": "RPC User"])
            )
        }
        defer { StubURLProtocol.clear() }

        let transport = InMemoryTransport(
            lines: [#"{"jsonrpc":"2.0","id":1,"method":"accounts.list"}"#])
        let server = RPCServer(transport: transport)
        await server.register(
            "accounts.list",
            handler: googleAccountsListHandler(
                locations: locations,
                environment: [
                    "MOKI_GOOGLE_CLIENT_ID": "cid", "MOKI_GOOGLE_CLIENT_SECRET": "s",
                ],
                session: makeStubSession()))
        await server.run()
        let output = await transport.collectedOutput()
        #expect(output.count == 1)
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(output[0].utf8))
        guard case .object(let envelope) = value,
            case .object(let result) = envelope["result"],
            case .array(let accounts) = result["accounts"]
        else {
            Issue.record("accounts.list response had unexpected shape: \(output)")
            return
        }
        #expect(result["psymailImport"] == .string("unavailable"))
        #expect(accounts.count == 1)
        guard case .object(let account) = accounts[0] else {
            Issue.record("account had unexpected shape: \(accounts)")
            return
        }
        #expect(account["address"] == .string("ok@example.com"))
        #expect(account["name"] == .string("RPC User"))
        #expect(account["status"] == .string("ok"))
    }

    @Test func userinfoFailureKeepsOkStatus() async throws {
        let (home, scratch) = try makeTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        try writeTokens(["ok@example.com": "good-refresh"], to: locations.mokiTokensURL)

        StubURLProtocol.setHandler { request in
            if request.url?.absoluteString == "https://oauth2.googleapis.com/token" {
                return (
                    httpResponse(url: request.url!, status: 200),
                    jsonData(["access_token": "ya29.ok", "expires_in": 3600])
                )
            }
            return (httpResponse(url: request.url!, status: 500), Data())
        }
        defer { StubURLProtocol.clear() }

        let service = GoogleAccountsService(
            locations: locations,
            environment: [
                "MOKI_GOOGLE_CLIENT_ID": "cid", "MOKI_GOOGLE_CLIENT_SECRET": "s",
            ],
            session: makeStubSession())
        let result = try await service.listAccounts()
        #expect(
            result.accounts == [
                GoogleAccount(address: "ok@example.com", status: .ok)
            ])
    }

    // MARK: - psymail import deadline

    @Test func psymailImportSlowReaderReportsPendingThenMerges() async throws {
        let (home, scratch) = try makeTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        try writeTokens(["moki@example.com": "moki-refresh"], to: locations.mokiTokensURL)
        try writeTokens(
            ["mini@example.com": "mini-refresh"],
            to: locations.psymailSandboxedTokensURL)

        // Container read slower than the deadline.
        let slowReader: PsymailFileReader = { url in
            try? await Task.sleep(for: .milliseconds(400))
            return try? Data(contentsOf: url)
        }

        StubURLProtocol.setHandler { request in
            if request.url?.absoluteString == "https://oauth2.googleapis.com/token" {
                let body = httpBodyData(of: request).flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let token = body.contains("mini-refresh") ? "ya29.mini" : "ya29.moki"
                return (
                    httpResponse(url: request.url!, status: 200),
                    jsonData(["access_token": token, "expires_in": 3600])
                )
            }
            return (
                httpResponse(url: request.url!, status: 200),
                jsonData([:])
            )
        }
        defer { StubURLProtocol.clear() }

        let service = GoogleAccountsService(
            locations: locations,
            environment: [
                "MOKI_GOOGLE_CLIENT_ID": "cid", "MOKI_GOOGLE_CLIENT_SECRET": "s",
            ],
            session: makeStubSession(),
            psymailImportTimeout: .milliseconds(50),
            psymailReader: slowReader)

        // First call times out: answers from Moki's file only.
        let first = try await service.listAccounts()
        #expect(first.psymailImport == .pending)
        #expect(first.accounts.map(\.address) == ["moki@example.com"])

        // Let the background import finish (it still merges + persists).
        // Import reads two URLs at ~400ms each; wait well past that.
        try? await Task.sleep(for: .milliseconds(1000))

        // Next call sees the imported token without re-reading the container.
        let second = try await service.listAccounts()
        #expect(second.psymailImport == .done)
        #expect(second.accounts.map(\.address) == ["mini@example.com", "moki@example.com"])
        let saved = try JSONDecoder().decode(
            [String: String].self, from: Data(contentsOf: locations.mokiTokensURL))
        #expect(saved["mini@example.com"] == "mini-refresh")
    }

    @Test func psymailImportFastReaderMergesWithinDeadline() async throws {
        let (home, scratch) = try makeTempHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        try writeTokens(
            ["mini@example.com": "mini-refresh"],
            to: locations.psymailSandboxedTokensURL)

        StubURLProtocol.setHandler { request in
            if request.url?.absoluteString == "https://oauth2.googleapis.com/token" {
                return (
                    httpResponse(url: request.url!, status: 200),
                    jsonData(["access_token": "ya29.mini", "expires_in": 3600])
                )
            }
            return (httpResponse(url: request.url!, status: 200), jsonData([:]))
        }
        defer { StubURLProtocol.clear() }

        let service = GoogleAccountsService(
            locations: locations,
            environment: [
                "MOKI_GOOGLE_CLIENT_ID": "cid", "MOKI_GOOGLE_CLIENT_SECRET": "s",
            ],
            session: makeStubSession())
        let result = try await service.listAccounts()
        #expect(result.psymailImport == .done)
        #expect(result.accounts.map(\.address) == ["mini@example.com"])
    }
}
