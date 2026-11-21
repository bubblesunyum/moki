import Foundation

// MARK: - Craft hosted MCP OAuth (DCR + PKCE loopback)
//
// Live discovery (verified, no further research needed):
// - MCP POST https://mcp.craft.do/my/mcp answers 401 with resource metadata.
// - Protected resource metadata
//   https://mcp.craft.do/.well-known/oauth-protected-resource/my/mcp ->
//   resource https://mcp.craft.do/my/mcp,
//   authorization server https://mcp.craft.do/my/auth.
// - AS metadata
//   https://mcp.craft.do/.well-known/oauth-authorization-server/my/auth ->
//   authorize …/my/auth/authorize, token …/my/auth/token,
//   register …/my/auth/register, revoke …/my/auth/revoke.
//   S256, `code`, authorization_code + refresh_token, client auth
//   client_secret_post / client_secret_basic / none.
//
// The flow is RFC 9728 discovery → RFC 8414 AS metadata → RFC 7591 dynamic
// client registration (public client `Moki`, the current loopback redirect,
// `token_endpoint_auth_method: none`) → system-browser approval (state +
// PKCE S256, `resource` on auth/token/refresh) → Keychain-held tokens.
// A successful approval requires the user to have created/enabled their
// Craft MCP connection and then pick a space/Approve.
//
// Secrets never leave the helper: the client registration and token material
// live as JSON strings in the Keychain behind `SecretStoring` (production:
// `KeychainSecretStore`; tests: `InMemorySecretStore`). No token, secret,
// or response body ever reaches an error, log, or RPC result — messages name
// hosts only.

/// How long a started sign-in waits for the browser approval before
/// `craft.signInPoll` reports an error.
let craftSignInExpirySeconds: TimeInterval = 300

/// Cap for the OAuth-backed Docs section (same as the legacy Connect cap).
let craftOAuthRecentsPageSize = 12

// MARK: - Endpoints

let craftMCPEndpoint = URL(string: "https://mcp.craft.do/my/mcp")!
let craftOAuthResource = "https://mcp.craft.do/my/mcp"

private let craftProtectedResourceMetadataURL = URL(
    string: "https://mcp.craft.do/.well-known/oauth-protected-resource/my/mcp")!

/// The MCP OAuth endpoints for one authorization server, resolved via
/// discovery (never hardcoded past the metadata entry points above).
struct CraftOAuthEndpoints: Sendable, Equatable {
    var authorizationEndpoint: URL
    var tokenEndpoint: URL
    var registrationEndpoint: URL
    var revocationEndpoint: URL?
}

/// Resolve the authorization server's endpoints: protected-resource metadata
/// → authorization server → AS metadata. Throws `AppError(unreachable)`;
/// messages name hosts only.
func craftDiscoverOAuthEndpoints(session: URLSession) async throws -> CraftOAuthEndpoints {
    struct ProtectedResource: Decodable {
        var resource: String?
        var authorizationServers: [String]?

        enum CodingKeys: String, CodingKey {
            case resource
            case authorizationServers = "authorization_servers"
        }
    }
    struct AuthorizationServer: Decodable {
        var authorizationEndpoint: String?
        var tokenEndpoint: String?
        var registrationEndpoint: String?
        var revocationEndpoint: String?

        enum CodingKeys: String, CodingKey {
            case authorizationEndpoint = "authorization_endpoint"
            case tokenEndpoint = "token_endpoint"
            case registrationEndpoint = "registration_endpoint"
            case revocationEndpoint = "revocation_endpoint"
        }
    }
    let resourceData = try await craftOAuthGET(url: craftProtectedResourceMetadataURL, session: session)
    guard let resourceMeta = try? JSONDecoder().decode(ProtectedResource.self, from: resourceData),
        let server = resourceMeta.authorizationServers?.first,
        let serverURL = URL(string: server)
    else {
        throw AppError(
            code: "unreachable",
            message: "Craft sign-in failed (mcp.craft.do returned an unexpected response).")
    }
    let metadataURL = craftAuthorizationServerMetadataURL(for: serverURL)
    let serverData = try await craftOAuthGET(url: metadataURL, session: session)
    guard let asMeta = try? JSONDecoder().decode(AuthorizationServer.self, from: serverData),
        let authorize = asMeta.authorizationEndpoint.flatMap(URL.init(string:)),
        let token = asMeta.tokenEndpoint.flatMap(URL.init(string:)),
        let register = asMeta.registrationEndpoint.flatMap(URL.init(string:))
    else {
        throw AppError(
            code: "unreachable",
            message: "Craft sign-in failed (mcp.craft.do returned an unexpected response).")
    }
    return CraftOAuthEndpoints(
        authorizationEndpoint: authorize, tokenEndpoint: token,
        registrationEndpoint: register,
        revocationEndpoint: asMeta.revocationEndpoint.flatMap(URL.init(string:)))
}

/// Insert `/.well-known/oauth-authorization-server` ahead of the server path:
/// `https://mcp.craft.do/my/auth` →
/// `https://mcp.craft.do/.well-known/oauth-authorization-server/my/auth`.
func craftAuthorizationServerMetadataURL(for serverURL: URL) -> URL {
    var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
    let path = components.path
    components.path = "/.well-known/oauth-authorization-server" + (path.hasPrefix("/") ? path : "/\(path)")
    return components.url!
}

private func craftOAuthGET(url: URL, session: URLSession) async throws -> Data {
    var request = URLRequest(url: url)
    request.timeoutInterval = craftRequestTimeout
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await session.data(for: request)
    } catch {
        throw AppError(
            code: "unreachable",
            message: "Craft sign-in failed: network unavailable. Please try signing in again.")
    }
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
        throw AppError(
            code: "unreachable",
            message: "Craft sign-in failed (mcp.craft.do did not answer). Please try signing in again.")
    }
    return data
}

// MARK: - Dynamic client registration

/// What the Keychain holds for the registered public client. `clientSecret`
/// is nil for `token_endpoint_auth_method: none` — kept for servers that
/// return one anyway. `redirectURI` is the loopback redirect the
/// registration was minted for: registrations are redirect-bound, so reuse
/// requires an exact match. Optional so entries written before it was
/// captured still decode — a missing redirect never matches, so legacy
/// entries re-register instead of crashing.
struct CraftOAuthClientMaterial: Codable, Sendable, Equatable {
    var clientID: String
    var clientSecret: String?
    var redirectURI: String?

    init(clientID: String, clientSecret: String? = nil, redirectURI: String? = nil) {
        self.clientID = clientID
        self.clientSecret = clientSecret
        self.redirectURI = redirectURI
    }

    enum CodingKeys: String, CodingKey {
        case clientID = "client_id"
        case clientSecret = "client_secret"
        case redirectURI = "redirect_uri"
    }
}

/// Register the public `Moki` client against the current loopback redirect.
/// Throws `AppError(unreachable)`; the payload is never echoed.
func craftRegisterOAuthClient(
    endpoints: CraftOAuthEndpoints, redirectURI: String, session: URLSession
) async throws -> CraftOAuthClientMaterial {
    struct RegistrationRequest: Encodable {
        var clientName: String
        var redirectUris: [String]
        var responseTypes: [String]
        var grantTypes: [String]
        var tokenEndpointAuthMethod: String

        enum CodingKeys: String, CodingKey {
            case clientName = "client_name"
            case redirectUris = "redirect_uris"
            case responseTypes = "response_types"
            case grantTypes = "grant_types"
            case tokenEndpointAuthMethod = "token_endpoint_auth_method"
        }
    }
    var request = URLRequest(url: endpoints.registrationEndpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = craftRequestTimeout
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.httpBody = try JSONEncoder().encode(RegistrationRequest(
        clientName: "Moki", redirectUris: [redirectURI],
        responseTypes: ["code"], grantTypes: ["authorization_code", "refresh_token"],
        tokenEndpointAuthMethod: "none"))
    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await session.data(for: request)
    } catch {
        throw AppError(
            code: "unreachable",
            message: "Craft sign-in failed: network unavailable. Please try signing in again.")
    }
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
        let material = try? JSONDecoder().decode(CraftOAuthClientMaterial.self, from: data),
        !material.clientID.isEmpty
    else {
        throw AppError(
            code: "unreachable",
            message: "Craft sign-in failed (mcp.craft.do did not answer). Please try signing in again.")
    }
    return material
}

// MARK: - Authorization URL (system-browser approval)

/// Approval URL for the system browser: `code` + state + PKCE S256 +
/// `resource`. No scope — the hosted MCP server is scopeless.
func craftOAuthAuthorizationURL(
    endpoints: CraftOAuthEndpoints, clientID: String, redirectURI: String,
    state: String, codeChallenge: String
) -> URL {
    var components = URLComponents(url: endpoints.authorizationEndpoint, resolvingAgainstBaseURL: false)!
    components.queryItems = [
        .init(name: "response_type", value: "code"),
        .init(name: "client_id", value: clientID),
        .init(name: "redirect_uri", value: redirectURI),
        .init(name: "state", value: state),
        .init(name: "code_challenge", value: codeChallenge),
        .init(name: "code_challenge_method", value: "S256"),
        .init(name: "resource", value: craftOAuthResource),
    ]
    return components.url!
}

// MARK: - Token lifecycle

/// What the Keychain holds for the grant. `expiresAt` is computed from
/// `expires_in` at exchange/refresh time (3600s when the server omits it);
/// the endpoints travel along so refresh/revoke never re-runs discovery.
struct CraftOAuthTokenMaterial: Codable, Sendable, Equatable {
    var accessToken: String
    var refreshToken: String?
    var expiresAt: Date?
    var tokenEndpoint: String
    var revocationEndpoint: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresAt = "expires_at"
        case tokenEndpoint = "token_endpoint"
        case revocationEndpoint = "revocation_endpoint"
    }
}

private struct CraftTokenResponse: Decodable {
    var accessToken: String?
    var refreshToken: String?
    var expiresIn: Double?
    var error: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case error
    }
}

private func craftTokenPOST(
    endpoint: URL, fields: [(String, String)], session: URLSession
) async throws -> CraftTokenResponse {
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = craftRequestTimeout
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.httpBody = fields
        .map { "\($0.0)=\($0.1.formURLEncoded())" }
        .joined(separator: "&")
        .data(using: .utf8)
    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await session.data(for: request)
    } catch {
        throw AppError(
            code: "unreachable",
            message: "Craft sign-in failed: network unavailable. Please try signing in again.")
    }
    guard let http = response as? HTTPURLResponse else {
        throw AppError(
            code: "unreachable",
            message: "Craft sign-in failed (mcp.craft.do did not answer). Please try signing in again.")
    }
    guard (200..<300).contains(http.statusCode),
        let decoded = try? JSONDecoder().decode(CraftTokenResponse.self, from: data)
    else {
        let code = (try? JSONDecoder().decode(CraftTokenResponse.self, from: data))?.error
        throw craftTokenError(errorCode: code, status: http.statusCode)
    }
    return decoded
}

/// A token-endpoint rejection: `invalid_grant` (dead code, rotated-out or
/// revoked grant) reads as `auth_expired` so the UI signs out; anything
/// else is a transient failure. Never echoes the payload.
func craftTokenError(errorCode: String?, status: Int) -> AppError {
    if errorCode?.range(of: "invalid_grant", options: .caseInsensitive) != nil {
        return AppError(
            code: "auth_expired",
            message: "Craft sign-in was rejected. Sign in again to reconnect.")
    }
    return AppError(
        code: "unreachable",
        message: "Craft sign-in failed (HTTP \(status)). Please try signing in again.")
}

/// Exchange the loopback `code` for tokens (PKCE, public client — no secret).
/// Throws `AppError`; never includes response material.
func craftExchangeCode(
    code: String, verifier: String, redirectURI: String,
    client: CraftOAuthClientMaterial, endpoints: CraftOAuthEndpoints,
    now: Date, session: URLSession
) async throws -> CraftOAuthTokenMaterial {
    let decoded = try await craftTokenPOST(
        endpoint: endpoints.tokenEndpoint,
        fields: [
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirectURI),
            ("client_id", client.clientID),
            ("code_verifier", verifier),
            ("resource", craftOAuthResource),
        ], session: session)
    guard let accessToken = decoded.accessToken, !accessToken.isEmpty else {
        throw AppError(
            code: "unreachable",
            message: "Craft sign-in returned an unexpected response. Please try signing in again.")
    }
    return CraftOAuthTokenMaterial(
        accessToken: accessToken, refreshToken: decoded.refreshToken,
        expiresAt: now.addingTimeInterval(decoded.expiresIn ?? 3600),
        tokenEndpoint: endpoints.tokenEndpoint.absoluteString,
        revocationEndpoint: endpoints.revocationEndpoint?.absoluteString)
}

/// Refresh an expired access token, rotating the refresh token when the
/// server returns a new one. `invalid_grant` clears the grant upstream
/// (callers delete the stored material and sign out).
func craftRefreshAccessToken(
    material: CraftOAuthTokenMaterial, clientID: String,
    now: Date, session: URLSession
) async throws -> CraftOAuthTokenMaterial {
    guard let refreshToken = material.refreshToken, !refreshToken.isEmpty,
        let endpoint = URL(string: material.tokenEndpoint)
    else {
        throw AppError(
            code: "auth_expired",
            message: "The Craft grant expired. Sign in again to reconnect.")
    }
    let decoded = try await craftTokenPOST(
        endpoint: endpoint,
        fields: [
            ("grant_type", "refresh_token"),
            ("refresh_token", refreshToken),
            ("client_id", clientID),
            ("resource", craftOAuthResource),
        ], session: session)
    guard let accessToken = decoded.accessToken, !accessToken.isEmpty else {
        throw AppError(
            code: "unreachable",
            message: "Craft sign-in returned an unexpected response. Please try signing in again.")
    }
    return CraftOAuthTokenMaterial(
        accessToken: accessToken,
        refreshToken: decoded.refreshToken ?? refreshToken,
        expiresAt: now.addingTimeInterval(decoded.expiresIn ?? 3600),
        tokenEndpoint: material.tokenEndpoint,
        revocationEndpoint: material.revocationEndpoint)
}

/// Best-effort revocation on sign-out: failures are swallowed — the stored
/// material is cleared regardless by the caller.
func craftRevokeToken(material: CraftOAuthTokenMaterial, clientID: String, session: URLSession) async {
    guard let endpointString = material.revocationEndpoint,
        let endpoint = URL(string: endpointString)
    else { return }
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = craftRequestTimeout
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    let token = material.refreshToken?.isEmpty == false ? material.refreshToken! : material.accessToken
    request.httpBody = [
        ("token", token),
        ("token_type_hint", material.refreshToken?.isEmpty == false ? "refresh_token" : "access_token"),
        ("client_id", clientID),
    ].map { "\($0.0)=\($0.1.formURLEncoded())" }
        .joined(separator: "&")
        .data(using: .utf8)
    _ = try? await session.data(for: request)
}

// MARK: - Keychain persistence

/// Craft OAuth Keychain identity. The client registration and token material
/// are JSON strings under Moki's own service — one generic-password item
/// each, so sign-out is two deletes. Defined here (never in the shared
/// SecretStore, which this area cannot edit).
enum CraftOAuthKeychain {
    static let service = MokiKeychainIDs.service
    static let clientAccount = "craft-mcp-oauth-client"
    static let tokenAccount = "craft-mcp-oauth-token"
}

func craftLoadClientMaterial(secrets: any SecretStoring) -> CraftOAuthClientMaterial? {
    guard let raw = secrets.read(
        service: CraftOAuthKeychain.service, account: CraftOAuthKeychain.clientAccount),
        let data = raw.data(using: .utf8),
        let material = try? JSONDecoder().decode(CraftOAuthClientMaterial.self, from: data),
        !material.clientID.isEmpty
    else { return nil }
    return material
}

func craftSaveClientMaterial(_ material: CraftOAuthClientMaterial, secrets: any SecretStoring) throws {
    let data = try JSONEncoder().encode(material)
    try secrets.write(
        String(data: data, encoding: .utf8) ?? "", service: CraftOAuthKeychain.service,
        account: CraftOAuthKeychain.clientAccount)
}

func craftLoadTokenMaterial(secrets: any SecretStoring) -> CraftOAuthTokenMaterial? {
    guard let raw = secrets.read(
        service: CraftOAuthKeychain.service, account: CraftOAuthKeychain.tokenAccount),
        let data = raw.data(using: .utf8),
        let material = try? JSONDecoder().decode(CraftOAuthTokenMaterial.self, from: data),
        !material.accessToken.isEmpty
    else { return nil }
    return material
}

func craftSaveTokenMaterial(_ material: CraftOAuthTokenMaterial, secrets: any SecretStoring) throws {
    let data = try JSONEncoder().encode(material)
    try secrets.write(
        String(data: data, encoding: .utf8) ?? "", service: CraftOAuthKeychain.service,
        account: CraftOAuthKeychain.tokenAccount)
}

func craftClearOAuthMaterial(secrets: any SecretStoring) {
    try? secrets.delete(service: CraftOAuthKeychain.service, account: CraftOAuthKeychain.tokenAccount)
    try? secrets.delete(service: CraftOAuthKeychain.service, account: CraftOAuthKeychain.clientAccount)
}
