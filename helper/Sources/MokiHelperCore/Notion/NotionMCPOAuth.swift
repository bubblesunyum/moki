import Foundation

// MARK: - Notion hosted-MCP OAuth (Dynamic Client Registration + PKCE)
//
// Notion's hosted MCP endpoint (`https://mcp.notion.com/mcp`) is the
// OAuth path: no developer-portal app, no client secret. The helper
// registers a public client per sign-in (Dynamic Client Registration,
// `token_endpoint_auth_method: none`), opens the system browser on the
// provider page-picker/approval, and exchanges the loopback `code` with
// PKCE + `state` + `resource`. Registration and rotated refresh tokens
// persist atomically as one Keychain JSON entry; listing goes through
// the MCP `notion-list-recent-pages` tool. The legacy internal
// integration token stays as a REST fallback for `listRecents`.
//
// `MOKI_FIXTURES=1` registers unavailable stubs (no browser, no
// network). Tokens never cross into RPC results, errors, or logs.

// MARK: - Discovery (RFC 9728 + RFC 8414) + endpoints

let notionMCPResource = "https://mcp.notion.com/mcp"
let notionMCPMCPResourceURL = URL(string: notionMCPResource)!
let notionMCPProtectedResourceMetadataURL = URL(
    string: "https://mcp.notion.com/.well-known/oauth-protected-resource/mcp")!
let notionMCPScope = "default"

/// Discovered OAuth endpoints for one sign-in. Resolved live per `start()`
/// (and per refresh) — never hardcoded past the resource URL above.
struct NotionMCPOAuthEndpoints: Sendable, Equatable {
    var authorizationEndpoint: URL
    var tokenEndpoint: URL
    var registrationEndpoint: URL
    var revocationEndpoint: URL?
}

/// Insert `/.well-known/oauth-authorization-server` ahead of the server
/// path: `https://mcp.notion.com` →
/// `https://mcp.notion.com/.well-known/oauth-authorization-server`, and a
/// pathful `https://host/base` →
/// `https://host/.well-known/oauth-authorization-server/base`.
func notionMCPAuthorizationServerMetadataURL(for serverURL: URL) -> URL {
    var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
    let path = components.path
    components.path =
        "/.well-known/oauth-authorization-server" + (path.hasPrefix("/") ? path : "/\(path)")
    // A pathless server URL leaves a trailing-slash path ("/.../"); the
    // metadata document lives at the bare well-known path instead.
    if path.isEmpty || path == "/" {
        components.path = "/.well-known/oauth-authorization-server"
    }
    return components.url!
}

private struct NotionMCPProtectedResourceMetadata: Decodable {
    var resource: String?
    var authorizationServers: [String]?

    enum CodingKeys: String, CodingKey {
        case resource
        case authorizationServers = "authorization_servers"
    }
}

private struct NotionMCPServerMetadata: Decodable {
    var authorizationEndpoint: String?
    var tokenEndpoint: String?
    var registrationEndpoint: String?
    var revocationEndpoint: String?
    var codeChallengeMethods: [String]?

    enum CodingKeys: String, CodingKey {
        case authorizationEndpoint = "authorization_endpoint"
        case tokenEndpoint = "token_endpoint"
        case registrationEndpoint = "registration_endpoint"
        case revocationEndpoint = "revocation_endpoint"
        case codeChallengeMethods = "code_challenge_methods_supported"
    }
}

/// Resolve the authorization server's endpoints: protected-resource
/// metadata (RFC 9728) → authorization server → AS metadata (RFC 8414).
/// Requires the exact MCP `resource`, a non-empty `authorization_servers`
/// list (first entry wins), `https` authorize/token/register endpoints,
/// and `S256` in `code_challenge_methods_supported` when the field is
/// present. Throws token-free `AppError(unreachable)` naming the host
/// only — never bodies, tokens, or metadata contents.
func notionMCPDiscoverEndpoints(session: URLSession) async throws -> NotionMCPOAuthEndpoints {
    let discoveryFailed = AppError(
        code: "unreachable",
        message:
            "Notion sign-in failed (mcp.notion.com returned an unexpected response). Please try signing in again."
    )
    let resourceData = try await notionMCPDiscoveryGET(
        url: notionMCPProtectedResourceMetadataURL, session: session)
    guard
        let resourceMeta = try? JSONDecoder().decode(
            NotionMCPProtectedResourceMetadata.self, from: resourceData),
        resourceMeta.resource == notionMCPResource,
        let server = resourceMeta.authorizationServers?.first,
        let serverURL = URL(string: server), serverURL.scheme?.lowercased() == "https"
    else {
        throw discoveryFailed
    }
    let serverData = try await notionMCPDiscoveryGET(
        url: notionMCPAuthorizationServerMetadataURL(for: serverURL), session: session)
    guard
        let serverMeta = try? JSONDecoder().decode(NotionMCPServerMetadata.self, from: serverData),
        let authorize = serverMeta.authorizationEndpoint.flatMap(URL.init(string:)),
        authorize.scheme?.lowercased() == "https",
        let token = serverMeta.tokenEndpoint.flatMap(URL.init(string:)),
        token.scheme?.lowercased() == "https",
        let register = serverMeta.registrationEndpoint.flatMap(URL.init(string:)),
        register.scheme?.lowercased() == "https"
    else {
        throw discoveryFailed
    }
    if let methods = serverMeta.codeChallengeMethods,
        !methods.contains("S256")
    {
        throw discoveryFailed
    }
    let revocation: URL?
    if let raw = serverMeta.revocationEndpoint,
        let url = URL(string: raw), url.scheme?.lowercased() == "https"
    {
        revocation = url
    } else if serverMeta.revocationEndpoint != nil {
        throw discoveryFailed
    } else {
        revocation = nil
    }
    return NotionMCPOAuthEndpoints(
        authorizationEndpoint: authorize, tokenEndpoint: token,
        registrationEndpoint: register, revocationEndpoint: revocation)
}

private func notionMCPDiscoveryGET(url: URL, session: URLSession) async throws -> Data {
    var request = URLRequest(url: url)
    request.timeoutInterval = notionRequestTimeout
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await session.data(for: request)
    } catch {
        throw AppError(
            code: "unreachable",
            message: "Notion sign-in failed: network unavailable. Please try signing in again.")
    }
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        throw AppError(
            code: "unreachable",
            message: "Notion sign-in failed (HTTP \(status)). Please try signing in again.")
    }
    return data
}

/// How long a started sign-in waits for the browser redirect before
/// `notion.signInPoll` reports an error.
let notionSignInExpirySeconds: TimeInterval = 300

/// `notion-list-recent-pages` page size: the rows the view shows.
let notionMCPRecentsLimit = 12

// MARK: - Keychain grant

/// Persisted as one JSON entry so registration and refresh-token
/// rotation land atomically. Separate from the legacy
/// `notion-integration-token` entry. The access token rides along —
/// the Keychain is the secure store, and nothing in here ever crosses
/// RPC or logs.
struct NotionMCPGrant: Codable, Sendable, Equatable {
    var clientID: String
    var refreshToken: String
    var accessToken: String?
    var expiresAt: Date?

    init(clientID: String, refreshToken: String, accessToken: String? = nil, expiresAt: Date? = nil) {
        self.clientID = clientID
        self.refreshToken = refreshToken
        self.accessToken = accessToken
        self.expiresAt = expiresAt
    }
}

// MARK: - DCR + auth URL + token bodies

/// DCR body for a public client: `client_name` Moki, the current
/// loopback redirect URI, code flow with refresh, no client secret.
func notionMCPRegisterBody(redirectURI: String) -> JSONValue {
    .object([
        "client_name": .string("Moki"),
        "redirect_uris": .array([.string(redirectURI)]),
        "response_types": .array([.string("code")]),
        "grant_types": .array([.string("authorization_code"), .string("refresh_token")]),
        "token_endpoint_auth_method": .string("none"),
    ])
}

/// Provider approval URL: `state` CSRF plus PKCE `S256`, `scope=default`
/// and the MCP `resource` both here and at the token endpoint. The
/// authorize endpoint comes from live discovery.
func notionMCPAuthURL(
    authorizeEndpoint: URL, clientID: String, redirectURI: String, state: String, challenge: String
) -> URL {
    var components = URLComponents(url: authorizeEndpoint, resolvingAgainstBaseURL: false)!
    components.queryItems = [
        .init(name: "response_type", value: "code"),
        .init(name: "client_id", value: clientID),
        .init(name: "redirect_uri", value: redirectURI),
        .init(name: "scope", value: notionMCPScope),
        .init(name: "resource", value: notionMCPResource),
        .init(name: "state", value: state),
        .init(name: "code_challenge", value: challenge),
        .init(name: "code_challenge_method", value: "S256"),
    ]
    return components.url!
}

private func notionMCPFormBody(_ fields: [(String, String)]) -> Data {
    Data(
        fields.map { "\($0.0)=\($0.1.formURLEncoded())" }.joined(separator: "&").utf8)
}

func notionMCPExchangeBody(code: String, redirectURI: String, clientID: String, verifier: String) -> Data {
    notionMCPFormBody([
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirectURI),
        ("client_id", clientID),
        ("code_verifier", verifier),
        ("resource", notionMCPResource),
    ])
}

func notionMCPRefreshBody(refreshToken: String, clientID: String) -> Data {
    notionMCPFormBody([
        ("grant_type", "refresh_token"),
        ("refresh_token", refreshToken),
        ("client_id", clientID),
        ("resource", notionMCPResource),
    ])
}

// MARK: - Token wire shapes

private struct NotionMCPRegisterResponse: Decodable {
    var clientID: String

    enum CodingKeys: String, CodingKey {
        case clientID = "client_id"
    }
}

private struct NotionMCPTokenResponse: Decodable {
    var accessToken: String?
    var refreshToken: String?
    var expiresIn: Double?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}

private struct NotionMCPTokenErrorPayload: Decodable {
    var error: String?
}

// MARK: - Network layer (token endpoint + DCR)

/// Register the public client at the discovered registration endpoint.
/// Throws `AppError`; messages never include response bodies (they can
/// echo request material).
func notionMCPRegisterClient(
    redirectURI: String, registrationEndpoint: URL, session: URLSession
) async throws -> String {
    var request = URLRequest(url: registrationEndpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = notionRequestTimeout
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONEncoder().encode(notionMCPRegisterBody(redirectURI: redirectURI))
    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await session.data(for: request)
    } catch {
        throw AppError(
            code: "unreachable",
            message: "Notion sign-in failed: network unavailable. Please try signing in again.")
    }
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
        let decoded = try? JSONDecoder().decode(NotionMCPRegisterResponse.self, from: data),
        !decoded.clientID.isEmpty
    else {
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        throw AppError(
            code: "unreachable",
            message: "Notion sign-in failed (HTTP \(status)). Please try signing in again.")
    }
    return decoded.clientID
}

/// Exchange one authorization code for the grant tokens. `nil` refresh
/// means the provider minted an unrefreshable grant — an error naming
/// retry, never a silent persist.
func notionMCPExchange(
    code: String, redirectURI: String, clientID: String, verifier: String,
    tokenEndpoint: URL, session: URLSession, now: Date
) async throws -> NotionMCPGrant {
    let data = try await notionMCPTokenRequest(
        body: notionMCPExchangeBody(
            code: code, redirectURI: redirectURI, clientID: clientID, verifier: verifier),
        tokenEndpoint: tokenEndpoint, session: session,
        failureMessage: "Notion sign-in was rejected. Sign in again to reconnect.")
    guard let decoded = try? JSONDecoder().decode(NotionMCPTokenResponse.self, from: data),
        let accessToken = decoded.accessToken, !accessToken.isEmpty
    else {
        throw AppError(
            code: "unreachable",
            message: "Notion sign-in returned an unexpected response. Please try signing in again.")
    }
    guard let refreshToken = decoded.refreshToken, !refreshToken.isEmpty else {
        throw AppError(
            code: "auth_expired",
            message: "Notion sign-in did not return a refresh token. Please try signing in again.")
    }
    let lifetime = decoded.expiresIn ?? 3600
    return NotionMCPGrant(
        clientID: clientID, refreshToken: refreshToken,
        accessToken: accessToken, expiresAt: now.addingTimeInterval(lifetime))
}

/// POST one form to the token endpoint. Maps `invalid_grant` to
/// `auth_expired` (dead grant → reconnect) and everything else to
/// `unreachable`; messages never carry bodies.
func notionMCPTokenRequest(
    body: Data, tokenEndpoint: URL, session: URLSession, failureMessage: String
) async throws -> Data {
    var request = URLRequest(url: tokenEndpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = notionRequestTimeout
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = body
    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await session.data(for: request)
    } catch {
        throw AppError(
            code: "unreachable",
            message: "Notion sign-in failed: network unavailable. Please try signing in again.")
    }
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        if (try? JSONDecoder().decode(NotionMCPTokenErrorPayload.self, from: data))?.error?
            .range(of: "invalid_grant", options: .caseInsensitive) != nil
        {
            throw AppError(code: "auth_expired", message: failureMessage)
        }
        throw AppError(
            code: "unreachable",
            message: "Notion sign-in failed (HTTP \(status)). Please try signing in again.")
    }
    return data
}

/// Best-effort RFC 7009 revocation on sign-out. Failures are swallowed —
/// local Keychain material is cleared regardless.
func notionMCPRevokeToken(
    refreshToken: String, clientID: String, endpoint: URL, session: URLSession
) async {
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = notionRequestTimeout
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = notionMCPFormBody([
        ("token", refreshToken),
        ("token_type_hint", "refresh_token"),
        ("client_id", clientID),
    ])
    _ = try? await session.data(for: request)
}

// MARK: - Flow state

/// `notion.signIn*` flow state. One service lives for the helper's
/// lifetime (captured by the registered handlers); every method is an
/// actor boundary so start/poll/cancel/refresh race safely across RPC
/// lines. Refresh serialization lives here too: `freshAccessToken`
/// funnels concurrent listing refreshes through the one actor.
public actor NotionMCPAuthService {
    private struct Attempt {
        var id: UInt64
        var startedAt: Date
        var state: String
        var verifier: String
        var redirectURI: String
        var clientID: String
        var endpoints: NotionMCPOAuthEndpoints
        var server: any OAuthLoopbackServing
    }

    private enum Phase {
        case idle
        case pending(Attempt)
        case done(account: String)
        case failed(message: String)
    }

    private var phase: Phase = .idle
    private var generation: UInt64 = 0

    private let secrets: any SecretStoring
    private let session: URLSession
    private let clock: @Sendable () -> Date
    private let openBrowser: @Sendable (URL) -> Void
    private let makeServer: @Sendable () -> any OAuthLoopbackServing

    public init(
        secrets: any SecretStoring,
        session: URLSession,
        clock: @escaping @Sendable () -> Date,
        openBrowser: @escaping @Sendable (URL) -> Void,
        makeServer: @escaping @Sendable () -> any OAuthLoopbackServing
    ) {
        self.secrets = secrets
        self.session = session
        self.clock = clock
        self.openBrowser = openBrowser
        self.makeServer = makeServer
    }

    /// Begin (or restart) the flow: bind an ephemeral loopback port,
    /// discover the OAuth endpoints (RFC 9728 + RFC 8414), register the
    /// public client for its redirect URI, open the system browser on the
    /// provider approval, and return at once. The redirect → exchange runs
    /// in a background task; `poll()` reports it. A discovery failure
    /// reports the token-free error and never opens the browser.
    public func start() async throws -> DocsSignInOK {
        // Restart semantics: drop whatever is in flight first. The
        // orphaned completion task still finishes but its generation no
        // longer matches, so it can no longer write the phase.
        if case .pending(let previous) = phase {
            previous.server.stop()
        }
        generation += 1
        let mine = generation

        let server = makeServer()
        let port: Int
        do {
            port = try await server.start(port: nil)
        } catch {
            if generation == mine {
                phase = .failed(
                    message: "Could not start the local sign-in listener. Please try signing in again.")
            }
            throw AppError(
                code: "unreachable",
                message: "Could not start the local sign-in listener. Please try signing in again.")
        }
        let redirectURI = "http://127.0.0.1:\(port)/oauth/notion"
        // Discover first, then register: either failing reports the
        // token-free error below and never opens the browser.
        let endpoints: NotionMCPOAuthEndpoints
        let clientID: String
        do {
            endpoints = try await notionMCPDiscoverEndpoints(session: session)
            clientID = try await notionMCPRegisterClient(
                redirectURI: redirectURI,
                registrationEndpoint: endpoints.registrationEndpoint, session: session)
        } catch {
            server.stop()
            if generation == mine {
                generation += 1
                phase = .failed(message: notionSignInErrorMessage(error))
            }
            throw error
        }

        // A cancel or a newer start landed while discovery/registration was
        // in flight: this attempt is dead. Stop its listener and never open
        // a browser tab the UI already stopped waiting for.
        guard generation == mine else {
            server.stop()
            throw AppError(code: "unreachable", message: "Notion sign-in was cancelled.")
        }

        let state = oauthRandomURLSafeString()
        let verifier = oauthRandomURLSafeString()
        openBrowser(
            notionMCPAuthURL(
                authorizeEndpoint: endpoints.authorizationEndpoint,
                clientID: clientID, redirectURI: redirectURI,
                state: state, challenge: oauthCodeChallenge(for: verifier)))

        let attempt = Attempt(
            id: mine, startedAt: clock(), state: state, verifier: verifier,
            redirectURI: redirectURI, clientID: clientID, endpoints: endpoints,
            server: server)
        phase = .pending(attempt)
        Task { await self.complete(attempt) }
        return DocsSignInOK()
    }

    /// Current flow state. Applies the 5-minute expiry to a pending
    /// attempt before answering, so an abandoned browser tab reads as an
    /// error, not a hang.
    public func poll() -> DocsSignInPollResult {
        switch phase {
        case .idle:
            return DocsSignInPollResult(status: .error, message: "No Notion sign-in in progress.")
        case .pending(let attempt):
            if clock().timeIntervalSince(attempt.startedAt) >= notionSignInExpirySeconds {
                attempt.server.stop()
                generation += 1
                let message = "Notion sign-in timed out after 5 minutes. Please try signing in again."
                phase = .failed(message: message)
                return DocsSignInPollResult(status: .error, message: message)
            }
            return DocsSignInPollResult(status: .pending)
        case .done(let account):
            return DocsSignInPollResult(status: .done, account: account)
        case .failed(let message):
            return DocsSignInPollResult(status: .error, message: message)
        }
    }

    /// Stop the wait. The orphaned completion task (if any) is
    /// generation-stale and cannot overwrite this; a later `start()`
    /// begins clean.
    public func cancel() -> DocsSignInOK {
        if case .pending(let attempt) = phase {
            attempt.server.stop()
        }
        generation += 1
        phase = .failed(message: "Notion sign-in was cancelled.")
        return DocsSignInOK()
    }

    /// Revoke the stored grant at the provider when discovery advertises a
    /// revocation endpoint. Best-effort: sign-out proceeds locally on any
    /// failure (offline, dead grant, no endpoint).
    public func revokeStoredGrant() async {
        guard let grant = readGrant() else { return }
        guard let endpoints = try? await notionMCPDiscoverEndpoints(session: session),
            let revocation = endpoints.revocationEndpoint
        else { return }
        await notionMCPRevokeToken(
            refreshToken: grant.refreshToken, clientID: grant.clientID,
            endpoint: revocation, session: session)
    }

    // MARK: - Token resolution for listing

    /// Fresh MCP access token, or `nil` when no grant is stored (the
    /// caller falls back to the legacy token). Refreshes an expired
    /// token and persists the rotation; a dead grant (`invalid_grant`)
    /// is cleared and surfaces as `auth_expired` so the lens prompts a
    /// reconnect. Serialized by the actor: concurrent listings share one
    /// refresh.
    public func freshAccessToken() async throws -> String? {
        guard var grant = readGrant() else { return nil }
        if let token = grant.accessToken, let expiresAt = grant.expiresAt,
            clock().addingTimeInterval(60) < expiresAt
        {
            return token
        }
        let attemptedRefresh = grant.refreshToken
        // Refresh goes through live discovery like the sign-in flow; a
        // discovery failure reads as a transient listing failure, never a
        // grant problem.
        let tokenEndpoint = try await notionMCPDiscoverEndpoints(session: session).tokenEndpoint
        do {
            let data = try await notionMCPTokenRequest(
                body: notionMCPRefreshBody(refreshToken: attemptedRefresh, clientID: grant.clientID),
                tokenEndpoint: tokenEndpoint, session: session,
                failureMessage: "Notion authorization expired. Sign in again to reconnect.")
            guard let decoded = try? JSONDecoder().decode(NotionMCPTokenResponse.self, from: data),
                let accessToken = decoded.accessToken, !accessToken.isEmpty
            else {
                throw AppError(
                    code: "unreachable",
                    message: "Notion authorization refresh returned an unexpected response.")
            }
            grant.accessToken = accessToken
            if let rotated = decoded.refreshToken, !rotated.isEmpty {
                grant.refreshToken = rotated
            }
            grant.expiresAt = clock().addingTimeInterval(decoded.expiresIn ?? 3600)
            try writeGrant(grant)
            return accessToken
        } catch let error as AppError where error.code == "auth_expired" {
            // Another listing may have already rotated since we read:
            // retry once with the stored token before clearing.
            if let current = readGrant(), current.refreshToken != attemptedRefresh {
                grant = current
                do {
                    let data = try await notionMCPTokenRequest(
                        body: notionMCPRefreshBody(
                            refreshToken: grant.refreshToken, clientID: grant.clientID),
                        tokenEndpoint: tokenEndpoint, session: session,
                        failureMessage: "Notion authorization expired. Sign in again to reconnect.")
                    guard let decoded = try? JSONDecoder().decode(
                        NotionMCPTokenResponse.self, from: data),
                        let accessToken = decoded.accessToken, !accessToken.isEmpty
                    else {
                        throw AppError(
                            code: "unreachable",
                            message: "Notion authorization refresh returned an unexpected response.")
                    }
                    grant.accessToken = accessToken
                    if let rotated = decoded.refreshToken, !rotated.isEmpty {
                        grant.refreshToken = rotated
                    }
                    grant.expiresAt = clock().addingTimeInterval(decoded.expiresIn ?? 3600)
                    try writeGrant(grant)
                    return accessToken
                } catch let retry as AppError where retry.code == "auth_expired" {
                    // The rotated token is dead too: clear once, terminal.
                    clearGrant()
                    throw retry
                }
            }
            clearGrant()
            throw error
        }
    }

    // MARK: - Background completion

    private func complete(_ attempt: Attempt) async {
        defer { attempt.server.stop() }
        do {
            let callback = try await attempt.server.waitForCallback()
            // Superseded before the redirect arrived: never touch the
            // network for a dead attempt, let alone persist for it.
            guard case .pending(let current) = phase, current.id == attempt.id else { return }
            if let detail = callback.providerError, !detail.isEmpty {
                throw NotionSignInError.providerDenied(detail)
            }
            guard let code = callback.code, !code.isEmpty,
                let state = callback.state, state == attempt.state
            else {
                throw NotionSignInError.stateMismatch
            }
            let grant = try await notionMCPExchange(
                code: code, redirectURI: attempt.redirectURI, clientID: attempt.clientID,
                verifier: attempt.verifier, tokenEndpoint: attempt.endpoints.tokenEndpoint,
                session: session, now: clock())
            // Cancelled/restarted/expired during the exchange above: the
            // grant may be valid, but it belongs to a dead attempt — a
            // save here would resurrect a flow the UI already closed.
            guard case .pending(let latest) = phase, latest.id == attempt.id else { return }
            // A grant that cannot be persisted is a failed sign-in, not a
            // done one: the next listing would find nothing stored.
            do {
                try writeGrant(grant)
                phase = .done(account: "Notion")
            } catch {
                phase = .failed(message: notionSignInErrorMessage(error))
            }
        } catch {
            guard case .pending(let current) = phase, current.id == attempt.id else { return }
            phase = .failed(message: notionSignInErrorMessage(error))
        }
    }

    // MARK: - Grant store

    func readGrant() -> NotionMCPGrant? {
        guard
            let raw = secrets.read(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionMCPGrantAccount),
            let data = raw.data(using: .utf8),
            let grant = try? JSONDecoder().decode(NotionMCPGrant.self, from: data),
            !grant.clientID.isEmpty, !grant.refreshToken.isEmpty
        else { return nil }
        return grant
    }

    /// Persist the grant. Throws a token-free `AppError` when the
    /// encoding or Keychain write fails, so callers never report success
    /// for a grant that is not stored.
    private func writeGrant(_ grant: NotionMCPGrant) throws {
        guard let data = try? JSONEncoder().encode(grant),
            let raw = String(data: data, encoding: .utf8)
        else {
            throw AppError(
                code: "unreachable",
                message: "Could not save the Notion sign-in. Please try signing in again.")
        }
        do {
            try secrets.write(
                raw, service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionMCPGrantAccount)
        } catch {
            throw AppError(
                code: "unreachable",
                message: "Could not save the Notion sign-in. Please try signing in again.")
        }
    }

    private func clearGrant() {
        try? secrets.delete(
            service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionMCPGrantAccount)
    }
}

/// Production service: ephemeral loopback server, system browser, wall clock.
public func makeNotionMCPAuthService(
    secrets: any SecretStoring = KeychainSecretStore(),
    session: URLSession = .shared
) -> NotionMCPAuthService {
    NotionMCPAuthService(
        secrets: secrets,
        session: session,
        clock: Date.init,
        openBrowser: openOAuthInSystemBrowser,
        makeServer: { OAuthLoopbackServer() })
}

/// Internal sign-in plumbing errors. Never surfaced verbatim except via
/// `signInErrorMessage`, which keeps the provider detail to its short code.
enum NotionSignInError: Error, Sendable {
    case providerDenied(String)
    case stateMismatch
}

// MARK: - Error mapping (no token material, ever)

/// One-line poll/start message for a completion failure. `AppError`
/// messages are already token-free by construction; anything else
/// (network, loopback bind, provider `error` param, state mismatch) maps
/// to a generic line.
func notionSignInErrorMessage(_ error: Error) -> String {
    if let appError = error as? AppError {
        return appError.message
    }
    if let signInError = error as? NotionSignInError {
        switch signInError {
        case .providerDenied(let detail):
            return "Notion sign-in was declined (\(detail)). Please try signing in again."
        case .stateMismatch:
            return "Notion sign-in did not match this attempt. Please try signing in again."
        }
    }
    if error is OAuthLoopbackError {
        return "Notion sign-in was cancelled."
    }
    return "Notion sign-in failed. Please try signing in again."
}

// MARK: - MCP listing payload

/// Map a `notion-list-recent-pages` result to `NotionRecent`s. Accepts
/// the structured content or the text JSON, unwrapping `pages`/`results`
/// wrappers or a bare array. Notion's documented row shape is
/// `{ type, title, url, icon }` — it does not promise an id — so the id
/// falls back to the page UUID in the URL. Uses a last-edited field when
/// the tool returns one, else an empty stamp: the list reflects views, so
/// a fetch time would be an invented modified date. Truly unlinkable rows
/// are skipped.
func notionMCPRecents(from result: MCPToolResult) -> [NotionRecent] {
    let payload: JSONValue? = {
        if let structured = result.structuredContent { return structured }
        guard let text = result.text, let data = text.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(JSONValue.self, from: data)
    }()
    let items: [JSONValue] = {
        guard let payload else { return [] }
        if case .array(let array) = payload { return array }
        if case .object(let dict) = payload {
            for key in ["pages", "results", "items", "data"] {
                if case .array(let array) = dict[key] { return array }
            }
        }
        return []
    }()
    return items.prefix(notionMCPRecentsLimit).compactMap { item in
        guard case .object(let dict) = item,
            let id = notionMCPRowID(from: dict)
        else { return nil }
        let title: String = {
            for key in ["title", "name"] {
                if case .string(let text) = dict[key], !text.isEmpty { return text }
            }
            return "(Untitled)"
        }()
        let url: String? = {
            if case .string(let raw) = dict["url"], !raw.isEmpty { return raw }
            return nil
        }()
        let object: String = {
            for key in ["type", "object"] {
                if case .string(let kind) = dict[key], kind == "page" || kind == "database" {
                    return kind
                }
            }
            return "page"
        }()
        let lastEdited: String = {
            for key in ["last_edited_time", "lastEditedTime", "edited_time", "last_edited"] {
                if case .string(let stamp) = dict[key], !stamp.isEmpty { return stamp }
            }
            return ""
        }()
        return NotionRecent(
            id: id, title: title, url: url, object: object, lastEditedTime: lastEdited)
    }
}

/// Row identity: explicit ids when the tool provides one, else the Notion
/// UUID embedded in its URL (`…/Page-Title-<32 hex>` or a bare id path).
/// The UUID is not a credential; it only keys the row and builds the
/// fallback URL.
private func notionMCPRowID(from dict: [String: JSONValue]) -> String? {
    for key in ["id", "page_id", "pageId", "database_id", "databaseId"] {
        if case .string(let value) = dict[key], !value.isEmpty { return value }
    }
    guard case .string(let rawURL) = dict["url"],
        let regex = try? NSRegularExpression(
            pattern: "[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}"),
        let match = regex.firstMatch(
            in: rawURL, range: NSRange(rawURL.startIndex..., in: rawURL)),
        let range = Range(match.range, in: rawURL)
    else { return nil }
    return rawURL[range].replacingOccurrences(of: "-", with: "").lowercased()
}

// MARK: - RPC handlers

public func notionSignInStartHandler(service: NotionMCPAuthService) -> @Sendable (JSONValue) async throws
    -> DocsSignInOK
{
    { _ in try await service.start() }
}

public func notionSignInPollHandler(service: NotionMCPAuthService) -> @Sendable (JSONValue) async throws
    -> DocsSignInPollResult
{
    { _ in await service.poll() }
}

public func notionSignInCancelHandler(service: NotionMCPAuthService) -> @Sendable (JSONValue) async throws
    -> DocsSignInOK
{
    { _ in await service.cancel() }
}

func notionSignInFixtureStartHandler() -> @Sendable (JSONValue) async throws -> DocsSignInOK {
    { _ in throw AppError(code: "unavailable", message: "Notion sign-in is unavailable in fixtures.") }
}

func notionSignInFixturePollHandler() -> @Sendable (JSONValue) async throws -> DocsSignInPollResult {
    { _ in DocsSignInPollResult(status: .error, message: "Notion sign-in is unavailable in fixtures.") }
}

func notionSignInFixtureCancelHandler() -> @Sendable (JSONValue) async throws -> DocsSignInOK {
    { _ in DocsSignInOK() }
}
