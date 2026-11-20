import CryptoKit
import Foundation

#if canImport(AppKit)
import AppKit
#endif

// MARK: - Google sign-in (Desktop OAuth, PKCE + loopback)
//
// Port of psymail-mini's proven `GoogleAuth` + `LoopbackAuthServer` flow,
// narrowed to what the Docs lens needs. The RPC timeout is 15s but a user
// consent wait is unbounded, so `signInStart` binds an ephemeral loopback
// port, opens the system browser, and returns at once; the renderer polls
// `signInPoll` (pending/done/error) and `signInCancel` stops the wait.
// Pending/error/done state lives in `GoogleSignInService` (a Swift actor)
// across calls, with a 5-minute expiry. A `signInStart` while one is active
// restarts the flow.
//
// Scopes: `drive.readonly` (least privilege covering `files.list` metadata
// reads) plus `userinfo.email` — the minimum identity scope that makes the
// userinfo endpoint yield an address. `GoogleAccountsService` reads identity
// from `https://www.googleapis.com/oauth2/v2/userinfo`, which returns `email`
// only for grants carrying an email-bearing scope; imported grants carry
// `userinfo.profile` (name/picture, no address), so profile alone cannot key
// the token-map merge and `userinfo.email` is required, not optional.
//
// Stale-grant lesson (copied from psymail): a 401/403 from userinfo or Drive
// on the fresh token means the grant is dead or too narrow — surface an
// error naming reconnect, never a silent empty. Secrets never leave the
// helper: no tokens in errors, logs, or poll results (poll returns the
// address only).

/// Least-privilege scopes for the Docs sign-in: Drive metadata reads plus
/// the minimum identity scope that yields the account address.
public let googleSignInScopes = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
].joined(separator: " ")

let googleOAuthAuthEndpoint = URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!

/// How long a started sign-in waits for the browser redirect before
/// `signInPoll` reports an error.
let googleSignInExpirySeconds: TimeInterval = 300

// MARK: - Wire shapes (mirror packages/protocol `GoogleSignInPollResult`)

public enum GoogleSignInStatus: String, Codable, Sendable, Equatable {
    case pending
    case done
    case error
}

public struct GoogleSignInPollResult: Codable, Sendable, Equatable {
    public var status: GoogleSignInStatus
    /// Present when done: the address that was signed in. Never a token.
    public var account: String?
    /// Present when error: one-line cause. Never token material.
    public var message: String?

    public init(status: GoogleSignInStatus, account: String? = nil, message: String? = nil) {
        self.status = status
        self.account = account
        self.message = message
    }
}

public struct GoogleSignInOK: Codable, Sendable, Equatable {
    public var ok: Bool

    public init(ok: Bool = true) {
        self.ok = ok
    }
}

// MARK: - Loopback abstraction (real server vs. test stub)

/// One-shot loopback listener contract. Production uses
/// `LoopbackSignInServer` (an ephemeral `127.0.0.1` port); tests inject a
/// stub — except the redirect-capture test, which binds a real ephemeral
/// port exactly like psymail-mini's `LoopbackAuthServerTests` does.
public protocol GoogleSignInLoopbackServer: Sendable {
    func start() async throws -> Int
    func waitForCode() async throws -> String
    func stop()
}

// MARK: - PKCE + auth URL (ported from psymail's `GoogleAuth`)

func googleSignInVerifier() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return googleSignInBase64URL(Data(bytes))
}

func googleSignInChallenge(for verifier: String) -> String {
    googleSignInBase64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
}

private func googleSignInBase64URL(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

func googleSignInAuthURL(
    redirectURI: String, codeChallenge: String, clientID: String
) -> URL {
    var components = URLComponents(url: googleOAuthAuthEndpoint, resolvingAgainstBaseURL: false)!
    components.queryItems = [
        .init(name: "client_id", value: clientID),
        .init(name: "redirect_uri", value: redirectURI),
        .init(name: "response_type", value: "code"),
        .init(name: "scope", value: googleSignInScopes),
        .init(name: "code_challenge", value: codeChallenge),
        .init(name: "code_challenge_method", value: "S256"),
        .init(name: "access_type", value: "offline"),
        .init(name: "prompt", value: "consent"),
    ]
    return components.url!
}

private func openURLInSystemBrowser(_ url: URL) {
    #if canImport(AppKit)
    _ = NSWorkspace.shared.open(url)
    #else
    _ = url
    #endif
}

// MARK: - Token exchange + identity (network layer)

private struct SignInTokenResponse: Decodable {
    var accessToken: String
    var refreshToken: String?
    var expiresIn: Int?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}

private struct SignInTokenErrorPayload: Decodable {
    var error: String?
}

/// Identity from the same userinfo endpoint `GoogleAccountsService` reads.
/// Only `email` matters here: it keys the token-map merge.
private struct SignInUserinfoPayload: Decodable {
    var email: String?
}

/// Exchange the loopback `code` for tokens (PKCE flow). Throws `AppError`;
/// messages never include response bodies (they can echo request material).
private func googleSignInExchange(
    code: String, verifier: String, redirectURI: String,
    config: OAuthClientConfig, session: URLSession
) async throws -> SignInTokenResponse {
    var request = URLRequest(url: googleTokenURL)
    request.httpMethod = "POST"
    request.timeoutInterval = googleRequestTimeout
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    let fields = [
        ("client_id", config.clientID),
        ("client_secret", config.clientSecret),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", redirectURI),
        ("grant_type", "authorization_code"),
    ]
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
            message: "Google sign-in failed: network unavailable. Please try signing in again.")
    }
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        let errorCode = (try? JSONDecoder().decode(SignInTokenErrorPayload.self, from: data))?.error
        if errorCode?.range(of: "invalid_grant", options: .caseInsensitive) != nil {
            throw AppError(
                code: "auth_expired",
                message: "Google sign-in was rejected. Sign in again to reconnect.")
        }
        throw AppError(
            code: "unreachable",
            message: "Google sign-in failed (HTTP \(status)). Please try signing in again.")
    }
    guard let decoded = try? JSONDecoder().decode(SignInTokenResponse.self, from: data),
        !decoded.accessToken.isEmpty
    else {
        throw AppError(
            code: "unreachable",
            message: "Google sign-in returned an unexpected response. Please try signing in again.")
    }
    return decoded
}

/// Fetch the address for a fresh access token. A 401/403 here means the
/// grant is dead or lacks the identity scope (psymail's `staleGrant`): an
/// error naming reconnect, never a silent empty account.
private func googleSignInFetchAddress(
    accessToken: String, session: URLSession
) async throws -> String {
    var request = URLRequest(url: googleUserinfoURL)
    request.timeoutInterval = googleRequestTimeout
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await session.data(for: request)
    } catch {
        throw AppError(
            code: "unreachable",
            message: "Google sign-in failed: network unavailable. Please try signing in again.")
    }
    guard let http = response as? HTTPURLResponse else {
        throw AppError(
            code: "unreachable",
            message: "Google sign-in failed. Please try signing in again.")
    }
    if http.statusCode == 401 || http.statusCode == 403 {
        throw AppError(
            code: "auth_expired",
            message: "Google sign-in completed but the grant was rejected. Sign in again to reconnect.")
    }
    guard http.statusCode == 200,
        let payload = try? JSONDecoder().decode(SignInUserinfoPayload.self, from: data),
        let email = payload.email, !email.isEmpty
    else {
        throw AppError(
            code: "auth_expired",
            message:
                "Google sign-in completed but returned no email address. Sign in again to reconnect.")
    }
    return email
}

/// Minimal Drive probe on the fresh token: confirms the new grant actually
/// carries the Drive scope before reporting done. A 401/403 is a dead or
/// too-narrow grant (error naming reconnect); anything else degrades — the
/// sign-in still completes and `DriveService` reports per-account status.
private func googleSignInProbeDrive(accessToken: String, session: URLSession) async throws {
    var components = URLComponents()
    components.scheme = "https"
    components.host = "www.googleapis.com"
    components.percentEncodedPath = "/drive/v3/files"
    components.queryItems = [
        URLQueryItem(name: "pageSize", value: "1"),
        URLQueryItem(name: "fields", value: "files(id)"),
        URLQueryItem(name: "q", value: "trashed = false"),
    ]
    var request = URLRequest(url: components.url!)
    request.timeoutInterval = googleRequestTimeout
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    let (_, response) = (try? await session.data(for: request)) ?? (Data(), URLResponse())
    if let http = response as? HTTPURLResponse, http.statusCode == 401 || http.statusCode == 403 {
        throw AppError(
            code: "auth_expired",
            message:
                "Google sign-in completed but Drive rejected the new grant. Sign in again to reconnect.")
    }
}

// MARK: - Flow state

/// `google.signIn*` flow state. One service lives for the helper's lifetime
/// (captured by the registered handlers); every method is an actor boundary
/// so start/poll/cancel race safely across RPC lines.
public actor GoogleSignInService {
    private struct Attempt {
        var id: UInt64
        var startedAt: Date
        var verifier: String
        var redirectURI: String
        var server: any GoogleSignInLoopbackServer
    }

    private enum Phase {
        case idle
        case pending(Attempt)
        case done(address: String)
        case failed(message: String)
    }

    private var phase: Phase = .idle
    private var generation: UInt64 = 0

    private let locations: GoogleLocations
    private let environment: [String: String]
    private let session: URLSession
    private let clock: @Sendable () -> Date
    private let openBrowser: @Sendable (URL) -> Void
    private let makeServer: @Sendable () -> any GoogleSignInLoopbackServer

    public init(
        locations: GoogleLocations,
        environment: [String: String],
        session: URLSession,
        clock: @escaping @Sendable () -> Date,
        openBrowser: @escaping @Sendable (URL) -> Void,
        makeServer: @escaping @Sendable () -> any GoogleSignInLoopbackServer
    ) {
        self.locations = locations
        self.environment = environment
        self.session = session
        self.clock = clock
        self.openBrowser = openBrowser
        self.makeServer = makeServer
    }

    /// Begin (or restart) the flow: bind loopback, open the system browser,
    /// return at once. The redirect → exchange → merge runs in a background
    /// task; `poll()` reports it.
    public func start() async throws -> GoogleSignInOK {
        if environment["MOKI_FIXTURES"] == "1" {
            throw AppError(
                code: "unavailable", message: "Google sign-in is unavailable in fixtures.")
        }
        let config = try OAuthClientConfig.load(locations: locations, environment: environment)

        // Restart semantics: drop whatever is in flight first. The orphaned
        // completion task still finishes but its generation no longer matches,
        // so it can no longer write the phase.
        if case .pending(let previous) = phase {
            previous.server.stop()
        }
        generation += 1

        let server = makeServer()
        let port: Int
        do {
            port = try await server.start()
        } catch {
            phase = .failed(message: "Could not start the local sign-in listener. Please try signing in again.")
            throw AppError(
                code: "unreachable",
                message: "Could not start the local sign-in listener. Please try signing in again.")
        }
        let verifier = googleSignInVerifier()
        let redirectURI = "http://127.0.0.1:\(port)"
        openBrowser(
            googleSignInAuthURL(
                redirectURI: redirectURI, codeChallenge: googleSignInChallenge(for: verifier),
                clientID: config.clientID))

        let attempt = Attempt(
            id: generation, startedAt: clock(), verifier: verifier,
            redirectURI: redirectURI, server: server)
        phase = .pending(attempt)
        Task { await self.complete(attempt) }
        return GoogleSignInOK()
    }

    /// Current flow state. Applies the 5-minute expiry to a pending attempt
    /// before answering, so an abandoned browser tab reads as an error, not
    /// a hang.
    public func poll() -> GoogleSignInPollResult {
        switch phase {
        case .idle:
            return GoogleSignInPollResult(status: .error, message: "No Google sign-in in progress.")
        case .pending(let attempt):
            if clock().timeIntervalSince(attempt.startedAt) >= googleSignInExpirySeconds {
                attempt.server.stop()
                generation += 1
                let message = "Google sign-in timed out after 5 minutes. Please try signing in again."
                phase = .failed(message: message)
                return GoogleSignInPollResult(status: .error, message: message)
            }
            return GoogleSignInPollResult(status: .pending)
        case .done(let address):
            return GoogleSignInPollResult(status: .done, account: address)
        case .failed(let message):
            return GoogleSignInPollResult(status: .error, message: message)
        }
    }

    /// Stop the wait. The orphaned completion task (if any) is generation-
    /// stale and cannot overwrite this; a later `start()` begins clean.
    public func cancel() -> GoogleSignInOK {
        if case .pending(let attempt) = phase {
            attempt.server.stop()
        }
        generation += 1
        phase = .failed(message: "Google sign-in was cancelled.")
        return GoogleSignInOK()
    }

    // MARK: - Background completion

    private func complete(_ attempt: Attempt) async {
        defer { attempt.server.stop() }
        do {
            let code = try await attempt.server.waitForCode()
            // Superseded before the redirect arrived: never touch the
            // network for a dead attempt, let alone persist for it.
            guard case .pending(let current) = phase, current.id == attempt.id else { return }
            let config = try OAuthClientConfig.load(locations: locations, environment: environment)
            let tokens = try await googleSignInExchange(
                code: code, verifier: attempt.verifier, redirectURI: attempt.redirectURI,
                config: config, session: session)
            guard let refreshToken = tokens.refreshToken, !refreshToken.isEmpty else {
                throw AppError(
                    code: "auth_expired",
                    message:
                        "Google sign-in did not return a refresh token. Please try signing in again.")
            }
            let address = try await googleSignInFetchAddress(
                accessToken: tokens.accessToken, session: session)
            try await googleSignInProbeDrive(accessToken: tokens.accessToken, session: session)
            // Cancelled/restarted/expired during the exchange above: the
            // grant may be valid, but it belongs to a dead attempt — a save
            // here would resurrect a flow the UI already closed.
            guard case .pending(let latest) = phase, latest.id == attempt.id else { return }
            // Fresh consent replaces any existing grant for the address (a
            // re-auth must actually widen scopes) — unlike the psymail import
            // merge, which never overwrites.
            GoogleTokenStore(locations: locations).saveRefreshToken(refreshToken, for: address)
            phase = .done(address: address)
        } catch {
            guard case .pending(let current) = phase, current.id == attempt.id else { return }
            phase = .failed(message: signInErrorMessage(error))
        }
    }
}

/// Production service: real loopback server, system browser, wall clock.
public func makeGoogleSignInService(
    locations: GoogleLocations = .production(),
    environment: [String: String] = ProcessInfo.processInfo.environment,
    session: URLSession = .shared
) -> GoogleSignInService {
    GoogleSignInService(
        locations: locations,
        environment: environment,
        session: session,
        clock: Date.init,
        openBrowser: openURLInSystemBrowser,
        makeServer: { LoopbackSignInServer() })
}

// MARK: - Error mapping (no token material, ever)

/// One-line poll/start message for a completion failure. `AppError` messages
/// are already token-free by construction; anything else (network, decode,
/// loopback bind, provider `error` param) maps to a generic line.
private func signInErrorMessage(_ error: Error) -> String {
    if let appError = error as? AppError {
        return appError.message
    }
    if let signInError = error as? GoogleSignInError {
        switch signInError {
        case .cancelled:
            return "Google sign-in was cancelled."
        case .providerDenied(let detail):
            return "Google sign-in was declined (\(detail)). Please try signing in again."
        }
    }
    return "Google sign-in failed. Please try signing in again."
}

/// Internal loopback plumbing errors. Never surfaced verbatim except via
/// `signInErrorMessage`, which keeps the provider detail to its short code.
enum GoogleSignInError: Error, Sendable {
    case cancelled
    case providerDenied(String)
}

// MARK: - RPC handlers

public func googleSignInStartHandler(service: GoogleSignInService) -> @Sendable (JSONValue) async throws -> GoogleSignInOK
{
    { _ in try await service.start() }
}

public func googleSignInPollHandler(service: GoogleSignInService) -> @Sendable (JSONValue) async throws -> GoogleSignInPollResult
{
    { _ in await service.poll() }
}

public func googleSignInCancelHandler(service: GoogleSignInService) -> @Sendable (JSONValue) async throws -> GoogleSignInOK
{
    { _ in await service.cancel() }
}

private func googleSignInFixtureStartHandler() -> @Sendable (JSONValue) async throws -> GoogleSignInOK {
    { _ in throw AppError(code: "unavailable", message: "Google sign-in is unavailable in fixtures.") }
}

private func googleSignInFixturePollHandler() -> @Sendable (JSONValue) async throws -> GoogleSignInPollResult {
    { _ in GoogleSignInPollResult(status: .error, message: "Google sign-in is unavailable in fixtures.") }
}

private func googleSignInFixtureCancelHandler() -> @Sendable (JSONValue) async throws -> GoogleSignInOK {
    { _ in GoogleSignInOK() }
}

extension RPCServer {
    /// Register `google.signIn{Start,Poll,Cancel}`. Self-gates on
    /// `MOKI_FIXTURES=1` (unavailable stubs, no browser, no network) so the
    /// call site is one line outside the fixtures branch.
    public func registerGoogleSignInMethods(
        locations: GoogleLocations = .production(),
        environment: [String: String] = ProcessInfo.processInfo.environment,
        session: URLSession = .shared
    ) {
        if environment["MOKI_FIXTURES"] == "1" {
            register("google.signInStart", handler: googleSignInFixtureStartHandler())
            register("google.signInPoll", handler: googleSignInFixturePollHandler())
            register("google.signInCancel", handler: googleSignInFixtureCancelHandler())
        } else {
            let service = makeGoogleSignInService(
                locations: locations, environment: environment, session: session)
            register("google.signInStart", handler: googleSignInStartHandler(service: service))
            register("google.signInPoll", handler: googleSignInPollHandler(service: service))
            register("google.signInCancel", handler: googleSignInCancelHandler(service: service))
        }
    }
}
