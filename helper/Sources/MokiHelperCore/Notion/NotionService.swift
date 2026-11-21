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
    private let mcpAuth: NotionMCPAuthService?

    public init(
        secrets: any SecretStoring = KeychainSecretStore(),
        session: URLSession = .shared,
        rateLimiter: NotionRateLimiter = NotionRateLimiter(),
        fixtures: Bool = ProcessInfo.processInfo.environment["MOKI_FIXTURES"] == "1",
        mcpAuth: NotionMCPAuthService? = nil
    ) {
        self.secrets = secrets
        self.session = session
        self.rateLimiter = rateLimiter
        self.fixtures = fixtures
        self.mcpAuth = mcpAuth
    }

    /// 12 recents, last-edited first. No credential → `signed_out` with no
    /// rows; a rejected credential → `auth_expired` with no rows; either
    /// way the token itself never appears in the result.
    ///
    /// Credential order: the hosted-MCP OAuth grant first (MCP listing),
    /// else the legacy internal integration token (REST search fallback).
    public func listRecents() async throws -> NotionRecentsResult {
        if fixtures {
            // Hermetic fixture auth: a fixtures sign-out flips the
            // in-memory flag (never the Keychain), and the signed-out
            // state travels as an envelope — same shape as live.
            if await NotionFixtureAuthState.shared.isSignedOut() {
                return NotionRecentsResult(status: .signedOut, items: [])
            }
            return NotionRecentsResult(status: .ok, items: notionFixtureRecents())
        }
        if let mcpAuth {
            do {
                if let token = try await mcpAuth.freshAccessToken() {
                    return try await mcpListRecents(accessToken: token)
                }
            } catch let error as AppError where error.code == "auth_expired" {
                return NotionRecentsResult(status: .authExpired, items: [])
            }
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

    /// Hosted-MCP OAuth listing: the `notion-list-recent-pages` tool
    /// (recency/frequency-ranked sidebar pages), mapped to `NotionRecent`s.
    /// Auth failures surface as the signed-out-shaped envelope; rate
    /// limits and transport failures throw for the partial path.
    private func mcpListRecents(accessToken: String) async throws -> NotionRecentsResult {
        try await rateLimiter.acquire()
        let client = RemoteMCPClient(
            endpoint: notionMCPMCPResourceURL, accessToken: accessToken, session: session)
        let result: MCPToolResult
        do {
            result = try await client.callTool(
                name: "notion-list-recent-pages",
                arguments: .object(["limit": .int(notionMCPRecentsLimit)]))
        } catch let error as AppError where error.code == "auth_expired" {
            return NotionRecentsResult(status: .authExpired, items: [])
        }
        if result.isError {
            throw AppError(code: "unreachable", message: "Notion request failed.")
        }
        return NotionRecentsResult(status: .ok, items: notionMCPRecents(from: result))
    }

    /// Store a pasted integration token. Blank input is a caller bug →
    /// `InvalidParamsError`, never a Keychain write. The token is never
    /// echoed back.
    public func setToken(_ token: String) async throws -> NotionOK {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw InvalidParamsError("Notion token must not be empty.")
        }
        if fixtures {
            // Hermetic: clear the in-memory signed-out flag without
            // writing the real Keychain — a token pasted in a fixtures
            // session restores rows and is forgotten with the process.
            await NotionFixtureAuthState.shared.setSignedOut(false)
            return NotionOK()
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

    /// Sign out: wipe the MCP grant and the legacy Keychain entry.
    /// Missing entries still succeed.
    /// Under fixtures, flip the in-memory flag instead — the real Keychain
    /// entry is never touched, so a fixtures sign-out cannot delete the
    /// developer's real token.
    public func signOut() async throws -> NotionOK {
        if fixtures {
            await NotionFixtureAuthState.shared.setSignedOut(true)
            return NotionOK()
        }
        await mcpAuth?.revokeStoredGrant()
        do {
            try secrets.delete(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionMCPGrantAccount)
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
    /// entry point; captures one service (one rate limiter) plus one MCP
    /// auth actor for the helper's lifetime. Tests build their own
    /// service with an in-memory store. Under `MOKI_FIXTURES=1` the
    /// sign-in methods answer unavailable stubs (no browser, no network).
    /// `openBrowser`/`makeServer` are injectable so tests never open a
    /// real browser or bind a real port.
    /// Returns the service it registered, so the Docs dispatcher can hold
    /// the exact same instance (and therefore the same MCP auth state) as
    /// `notion.listRecents` / `notion.signIn*`.
    @discardableResult
    public func registerNotionMethods(
        session: URLSession = .shared,
        secrets: any SecretStoring = KeychainSecretStore(),
        environment: [String: String] = ProcessInfo.processInfo.environment,
        openBrowser: (@Sendable (URL) -> Void)? = nil,
        makeServer: (@Sendable () -> any OAuthLoopbackServing)? = nil
    ) -> NotionService {
        let fixtures = environment["MOKI_FIXTURES"] == "1"
        if fixtures {
            let service = NotionService(
                secrets: secrets, session: session,
                rateLimiter: NotionRateLimiter(), fixtures: fixtures)
            register("notion.listRecents", handler: notionListRecentsHandler(service: service))
            register("notion.setToken", handler: notionSetTokenHandler(service: service))
            register("notion.signOut", handler: notionSignOutHandler(service: service))
            register("notion.signInStart", handler: notionSignInFixtureStartHandler())
            register("notion.signInPoll", handler: notionSignInFixturePollHandler())
            register("notion.signInCancel", handler: notionSignInFixtureCancelHandler())
            return service
        }
        let mcpAuth = NotionMCPAuthService(
            secrets: secrets,
            session: session,
            clock: Date.init,
            openBrowser: openBrowser ?? openOAuthInSystemBrowser,
            makeServer: makeServer ?? { OAuthLoopbackServer() })
        let service = NotionService(
            secrets: secrets, session: session,
            rateLimiter: NotionRateLimiter(), fixtures: fixtures,
            mcpAuth: mcpAuth)
        register("notion.listRecents", handler: notionListRecentsHandler(service: service))
        register("notion.setToken", handler: notionSetTokenHandler(service: service))
        register("notion.signOut", handler: notionSignOutHandler(service: service))
        register("notion.signInStart", handler: notionSignInStartHandler(service: mcpAuth))
        register("notion.signInPoll", handler: notionSignInPollHandler(service: mcpAuth))
        register("notion.signInCancel", handler: notionSignInCancelHandler(service: mcpAuth))
        return service
    }
}

// MARK: - Fixtures

/// Canned 12-row recents for `MOKI_FIXTURES=1` (UI work, screenshots): no
/// network, no Keychain touch.
///
/// Canonical mirror: ids/titles/URLs match the renderer's DOC_FIXTURES
/// notion section (lenses/docs/fixtures.ts) row-for-row — the two sides
/// cannot share one file across the TS/Swift boundary, so the contract tests
/// on both sides pin the same id lists. lastEditedTime is generated relative
/// to now with the same minutes-ago offsets, so recency holds at any
/// wall-clock time.
func notionFixtureRecents(now: Date = Date()) -> [NotionRecent] {
    let seeds: [(id: String, title: String, minutesAgo: Double)] = [
        ("Tansy-Roadmap-9f2c1a", "Tansy roadmap", 20),
        ("Weekly-Review-7d4b2e", "Weekly review", 65),
        ("Meeting-Notes-3a8f1c", "Meeting notes", 130),
        ("Product-Spec-5e6a9d", "Life OS spec", 200),
        ("Habit-Tracker-1b3d7f", "Habit tracker", 280),
        ("Book-Notes-8c2e4a", "Book notes", 360),
        ("Travel-Plans-6f1a3c", "Travel plans", 470),
        ("Gift-Ideas-2d9b5e", "Gift ideas", 590),
        ("Home-Renovation-4a7c1e", "Home renovation", 700),
        ("Side-Project-9e3f8b", "Side project log", 830),
        ("Recipes-5b8d2f", "Recipes", 960),
        ("Journal-7c1e6a", "Journal", 1200),
    ]
    return seeds.map { seed in
        NotionRecent(
            id: seed.id,
            title: seed.title,
            url: "https://www.notion.so/\(seed.id)",
            object: "page",
            lastEditedTime: iso8601String(now.addingTimeInterval(-seed.minutesAgo * 60)))
    }
}
