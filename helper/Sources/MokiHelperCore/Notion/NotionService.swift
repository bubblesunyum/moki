import Foundation

// MARK: - Notion proxy service
//
// Thin rate-limited proxy over Notion's `search` API, sorted by last-edited,
// 12 rows. The integration token lives in the Keychain and never leaves
// this service: results carry rows + status, never the token. Calls go out
// strictly one at a time (no TaskGroup — see swift-taskgroup-timeout trap).

public struct NotionService: Sendable {
    private let secrets: any SecretStoring
    private let session: URLSession
    private let rateLimiter: NotionRateLimiter
    private let fixtures: Bool

    public init(
        secrets: any SecretStoring = KeychainSecretStore(),
        session: URLSession = .shared,
        rateLimiter: NotionRateLimiter = NotionRateLimiter(),
        fixtures: Bool = ProcessInfo.processInfo.environment["MOKI_FIXTURES"] == "1"
    ) {
        self.secrets = secrets
        self.session = session
        self.rateLimiter = rateLimiter
        self.fixtures = fixtures
    }

    /// 12 recents, last-edited first. No token → `signed_out` with no rows;
    /// a rejected token → `auth_expired` with no rows; either way the token
    /// itself never appears in the result.
    public func listRecents() async throws -> NotionRecentsResult {
        if fixtures {
            return NotionRecentsResult(status: .ok, items: notionFixtureRecents())
        }
        guard let token = secrets.read(
            service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        else {
            return NotionRecentsResult(status: .signedOut, items: [])
        }
        try await rateLimiter.acquire()
        let request = notionSearchRequest(token: token)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AppError(
                code: "unreachable",
                message: "Notion request failed: network unavailable.")
        }
        guard let http = response as? HTTPURLResponse else {
            throw AppError(code: "unreachable", message: "Notion request failed.")
        }
        guard http.statusCode == 200 else {
            let mapped = notionStatusError(status: http.statusCode)
            // A dead token surfaces as a signed-out-shaped envelope, not a
            // throw, so the lens renders its sign-in affordance in place.
            if let app = mapped as? AppError, app.code == "auth_expired" {
                return NotionRecentsResult(status: .authExpired, items: [])
            }
            throw mapped
        }
        guard let payload = try? JSONDecoder().decode(NotionSearchResponse.self, from: data),
            let results = payload.results
        else {
            throw AppError(
                code: "unreachable", message: "Notion returned an unexpected response.")
        }
        let items = results.compactMap(notionRecent(from:)).prefix(notionRecentsPageSize)
        return NotionRecentsResult(status: .ok, items: Array(items))
    }

    /// Store a pasted integration token. Blank input is a caller bug →
    /// `InvalidParamsError`, never a Keychain write. The token is never
    /// echoed back.
    public func setToken(_ token: String) async throws -> NotionOK {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw InvalidParamsError("Notion token must not be empty.")
        }
        do {
            try secrets.write(
                trimmed, service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionTokenAccount)
        } catch {
            throw AppError(code: "unreachable", message: "Could not save the Notion token.")
        }
        return NotionOK()
    }

    /// Sign out: wipe the Keychain entry. Missing entry still succeeds.
    public func signOut() async throws -> NotionOK {
        do {
            try secrets.delete(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionTokenAccount)
        } catch {
            throw AppError(code: "unreachable", message: "Could not remove the Notion token.")
        }
        return NotionOK()
    }
}

// MARK: - RPC handlers

public func notionListRecentsHandler(service: NotionService) -> @Sendable (JSONValue) async throws
    -> NotionRecentsResult
{
    return { _ in try await service.listRecents() }
}

public func notionSetTokenHandler(service: NotionService) -> @Sendable (JSONValue) async throws -> NotionOK {
    return { params in
        let request = try decodeRpcParams(params, as: NotionSetTokenParams.self)
        return try await service.setToken(request.token)
    }
}

public func notionSignOutHandler(service: NotionService) -> @Sendable (JSONValue) async throws -> NotionOK {
    return { _ in try await service.signOut() }
}

extension RPCServer {
    /// Register every Notion method. Called once from `moki-helper`'s `@main`
    /// entry point; captures one service (one rate limiter) for the helper's
    /// lifetime. Tests build their own service with an in-memory store.
    public func registerNotionMethods(
        session: URLSession = .shared,
        secrets: any SecretStoring = KeychainSecretStore(),
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) {
        let fixtures = environment["MOKI_FIXTURES"] == "1"
        let service = NotionService(
            secrets: secrets, session: session,
            rateLimiter: NotionRateLimiter(), fixtures: fixtures)
        register("notion.listRecents", handler: notionListRecentsHandler(service: service))
        register("notion.setToken", handler: notionSetTokenHandler(service: service))
        register("notion.signOut", handler: notionSignOutHandler(service: service))
    }
}

// MARK: - Fixtures

/// Canned 12-row recents for `MOKI_FIXTURES=1` (UI work, screenshots): no
/// network, no Keychain touch.
func notionFixtureRecents() -> [NotionRecent] {
    (1...notionRecentsPageSize).map { index in
        NotionRecent(
            id: String(format: "00000000-0000-4000-8000-%012d", index),
            title: "Fixture page \(index)",
            url: "https://www.notion.so/fixture-\(index)",
            object: index % 3 == 0 ? "database" : "page",
            lastEditedTime: String(format: "2026-11-2%dT10:00:00.000Z", index % 10))
    }
}
