import Foundation

#if canImport(AppKit)
import AppKit
#endif

// MARK: - Craft hosted-MCP OAuth sign-in (DCR + PKCE loopback)
//
// `craft.signInStart` binds an ephemeral loopback port, resolves the hosted
// MCP authorization server via discovery, reuses the Keychain-held client
// registration (registering `Moki` fresh only when none is stored), opens
// the system browser on the space approval, and returns at once; the
// redirect → PKCE exchange runs in a background task and `craft.signInPoll`
// reports pending/done/error. `craft.signInCancel` stops the wait. A
// `signInStart` while one is active restarts the flow. Pending/done/error
// state lives in `CraftSignInService` (a Swift actor) across calls, with a
// 5-minute expiry.
//
// The renderer shows one quiet line (`Choose a space in Craft`): approval
// requires the user to have created/enabled their Craft MCP connection and
// then pick a space/Approve. Secrets never leave the helper: poll returns
// no account (nothing to name) and no token material, ever. Fixtures stay
// hermetic (unavailable stubs, no browser, no network, no Keychain touch).

public actor CraftSignInService {
    private struct Attempt {
        var id: UInt64
        var startedAt: Date
        var state: String
        var verifier: String
        var redirectURI: String
        var client: CraftOAuthClientMaterial
        var endpoints: CraftOAuthEndpoints
        var server: any OAuthLoopbackServing
    }

    private enum Phase {
        case idle
        case pending(Attempt)
        case done
        case failed(message: String)
    }

    private var phase: Phase = .idle
    private var generation: UInt64 = 0

    private let secrets: any SecretStoring
    private let session: URLSession
    private let environment: [String: String]
    private let clock: @Sendable () -> Date
    private let openBrowser: @Sendable (URL) -> Void
    private let makeServer: @Sendable () -> any OAuthLoopbackServing

    public init(
        secrets: any SecretStoring,
        session: URLSession,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        clock: @escaping @Sendable () -> Date,
        openBrowser: @escaping @Sendable (URL) -> Void,
        makeServer: @escaping @Sendable () -> any OAuthLoopbackServing
    ) {
        self.secrets = secrets
        self.session = session
        self.environment = environment
        self.clock = clock
        self.openBrowser = openBrowser
        self.makeServer = makeServer
    }

    /// Begin (or restart) the flow: discovery, client reuse-or-register,
    /// loopback bind, system-browser approval — then return at once.
    public func start() async throws -> DocsSignInOK {
        if environment["MOKI_FIXTURES"] == "1" {
            throw AppError(
                code: "unavailable", message: "Craft sign-in is unavailable in fixtures.")
        }
        // Restart semantics: drop whatever is in flight first. The orphaned
        // completion task still finishes but its generation no longer
        // matches, so it can no longer write the phase.
        if case .pending(let previous) = phase {
            previous.server.stop()
        }
        generation += 1
        let mine = generation

        let endpoints: CraftOAuthEndpoints
        do {
            endpoints = try await craftDiscoverOAuthEndpoints(session: session)
        } catch {
            if generation == mine { phase = .failed(message: craftSignInErrorMessage(error)) }
            throw error
        }

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
        let redirectURI = "http://127.0.0.1:\(port)"

        // Reuse the stored registration only when it was minted for this
        // exact redirect: every start binds a new ephemeral loopback port,
        // and the AS rejects a redirect_uri it never registered (approval
        // or exchange fails). Otherwise register the current redirect and
        // persist it. A rejected exchange drops the entry (next start
        // re-registers).
        var client = craftLoadClientMaterial(secrets: secrets)
        if client?.redirectURI != redirectURI {
            do {
                var registered = try await craftRegisterOAuthClient(
                    endpoints: endpoints, redirectURI: redirectURI, session: session)
                registered.redirectURI = redirectURI
                try craftSaveClientMaterial(registered, secrets: secrets)
                client = registered
            } catch {
                server.stop()
                if generation == mine {
                    generation += 1
                    phase = .failed(message: craftSignInErrorMessage(error))
                }
                throw error
            }
        }

        // A cancel or a newer start landed while discovery/registration was
        // in flight: this attempt is dead. Stop its listener and never open
        // a browser tab the UI already stopped waiting for.
        guard generation == mine else {
            server.stop()
            throw AppError(code: "unreachable", message: "Craft sign-in was cancelled.")
        }

        // Separate random values for state and verifier (never one value
        // doing both jobs).
        let state = oauthRandomURLSafeString()
        let verifier = oauthRandomURLSafeString()
        openBrowser(
            craftOAuthAuthorizationURL(
                endpoints: endpoints, clientID: client!.clientID,
                redirectURI: redirectURI, state: state,
                codeChallenge: oauthCodeChallenge(for: verifier)))

        let attempt = Attempt(
            id: mine, startedAt: clock(), state: state, verifier: verifier,
            redirectURI: redirectURI, client: client!, endpoints: endpoints, server: server)
        phase = .pending(attempt)
        Task { await self.complete(attempt) }
        return DocsSignInOK()
    }

    /// Current flow state. Applies the 5-minute expiry to a pending attempt
    /// before answering, so an abandoned browser tab reads as an error, not
    /// a hang.
    public func poll() -> DocsSignInPollResult {
        switch phase {
        case .idle:
            return DocsSignInPollResult(status: .error, message: "No Craft sign-in in progress.")
        case .pending(let attempt):
            if clock().timeIntervalSince(attempt.startedAt) >= craftSignInExpirySeconds {
                attempt.server.stop()
                generation += 1
                let message = "Craft sign-in timed out after 5 minutes. Please try signing in again."
                phase = .failed(message: message)
                return DocsSignInPollResult(status: .error, message: message)
            }
            return DocsSignInPollResult(status: .pending)
        case .done:
            return DocsSignInPollResult(status: .done)
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
        phase = .failed(message: "Craft sign-in was cancelled.")
        return DocsSignInOK()
    }

    // MARK: - Token resolution for listing

    /// A usable MCP access token, or `nil` when no OAuth grant is stored
    /// (the caller falls back to the legacy Connect URL). Refreshes an
    /// expired token and persists the rotation; a dead grant
    /// (`invalid_grant`) is cleared and surfaces as `auth_expired` so the
    /// lens prompts a reconnect. Serialized by the actor: concurrent
    /// listings share one refresh.
    public func freshAccessToken() async throws -> String? {
        guard var material = craftLoadTokenMaterial(secrets: secrets),
            let client = craftLoadClientMaterial(secrets: secrets)
        else { return nil }
        if let expiresAt = material.expiresAt, clock().addingTimeInterval(60) < expiresAt {
            return material.accessToken
        }
        if material.expiresAt == nil {
            return material.accessToken
        }
        let attemptedRefresh = material.refreshToken
        do {
            material = try await craftRefreshAccessToken(
                material: material, clientID: client.clientID, now: clock(), session: session)
            try craftSaveTokenMaterial(material, secrets: secrets)
            return material.accessToken
        } catch let error as AppError where error.code == "auth_expired" {
            // Another listing may have rotated while this one awaited:
            // use the stored winner (access token still valid) or retry
            // once with its rotated refresh token before clearing.
            if var current = craftLoadTokenMaterial(secrets: secrets),
                current.refreshToken != attemptedRefresh
            {
                if let expiresAt = current.expiresAt,
                    clock().addingTimeInterval(60) < expiresAt
                {
                    return current.accessToken
                }
                do {
                    current = try await craftRefreshAccessToken(
                        material: current, clientID: client.clientID, now: clock(),
                        session: session)
                    try craftSaveTokenMaterial(current, secrets: secrets)
                    return current.accessToken
                } catch let retry as AppError where retry.code == "auth_expired" {
                    craftClearOAuthMaterial(secrets: secrets)
                    throw retry
                }
            }
            craftClearOAuthMaterial(secrets: secrets)
            throw error
        }
    }

    /// Forced refresh after a mid-session 401: the cached token looked
    /// valid but the server rejected it. `nil` when no grant is stored.
    /// `invalid_grant` clears the material and throws `auth_expired`.
    public func forceRefreshAccessToken() async throws -> String? {
        guard var material = craftLoadTokenMaterial(secrets: secrets),
            let client = craftLoadClientMaterial(secrets: secrets)
        else { return nil }
        guard material.refreshToken?.isEmpty == false else {
            craftClearOAuthMaterial(secrets: secrets)
            throw AppError(
                code: "auth_expired",
                message: "The Craft grant expired. Sign in again to reconnect.")
        }
        do {
            material = try await craftRefreshAccessToken(
                material: material, clientID: client.clientID, now: clock(), session: session)
            try craftSaveTokenMaterial(material, secrets: secrets)
            return material.accessToken
        } catch let error as AppError where error.code == "auth_expired" {
            craftClearOAuthMaterial(secrets: secrets)
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
                throw CraftSignInError.providerDenied(detail)
            }
            guard let code = callback.code, !code.isEmpty,
                let state = callback.state, state == attempt.state
            else {
                throw CraftSignInError.stateMismatch
            }
            let material = try await craftExchangeCode(
                code: code, verifier: attempt.verifier, redirectURI: attempt.redirectURI,
                client: attempt.client, endpoints: attempt.endpoints,
                now: clock(), session: session)
            // Cancelled/restarted/expired during the exchange above: the
            // grant may be valid, but it belongs to a dead attempt — a save
            // here would resurrect a flow the UI already closed.
            guard case .pending(let latest) = phase, latest.id == attempt.id else { return }
            try craftSaveTokenMaterial(material, secrets: secrets)
            phase = .done
        } catch {
            guard case .pending(let current) = phase, current.id == attempt.id else { return }
            if error is AppError, (error as? AppError)?.code == "auth_expired" {
                // The code was rejected against this registration
                // (rotated-out DCR): drop it so the next start re-registers
                // instead of failing the same way forever.
                try? secrets.delete(
                    service: CraftOAuthKeychain.service, account: CraftOAuthKeychain.clientAccount)
            }
            phase = .failed(message: craftSignInErrorMessage(error))
        }
    }
}

/// Production service: ephemeral loopback server, system browser, wall clock.
public func makeCraftSignInService(
    secrets: any SecretStoring = KeychainSecretStore(),
    session: URLSession = .shared
) -> CraftSignInService {
    CraftSignInService(
        secrets: secrets,
        session: session,
        clock: Date.init,
        openBrowser: openOAuthInSystemBrowser,
        makeServer: { OAuthLoopbackServer() })
}

/// Internal sign-in plumbing errors. Never surfaced verbatim except via
/// `craftSignInErrorMessage`, which keeps the provider detail to its short
/// code.
enum CraftSignInError: Error, Sendable {
    case providerDenied(String)
    case stateMismatch
}

/// One-line poll/start message for a completion failure. `AppError`
/// messages are already token-free by construction; anything else
/// (network, loopback bind, provider `error` param, state mismatch) maps
/// to a generic line.
func craftSignInErrorMessage(_ error: Error) -> String {
    if let appError = error as? AppError {
        return appError.message
    }
    if let signInError = error as? CraftSignInError {
        switch signInError {
        case .providerDenied(let detail):
            return "Craft sign-in was declined (\(detail)). Please try signing in again."
        case .stateMismatch:
            return "Craft sign-in did not match this attempt. Please try signing in again."
        }
    }
    if error is OAuthLoopbackError {
        return "Craft sign-in was cancelled."
    }
    return "Craft sign-in failed. Please try signing in again."
}

// MARK: - RPC handlers

public func craftSignInStartHandler(service: CraftSignInService) -> @Sendable (JSONValue) async throws
    -> DocsSignInOK
{
    { _ in try await service.start() }
}

public func craftSignInPollHandler(service: CraftSignInService) -> @Sendable (JSONValue) async throws
    -> DocsSignInPollResult
{
    { _ in await service.poll() }
}

public func craftSignInCancelHandler(service: CraftSignInService) -> @Sendable (JSONValue) async throws
    -> DocsSignInOK
{
    { _ in await service.cancel() }
}

func craftSignInFixtureStartHandler() -> @Sendable (JSONValue) async throws -> DocsSignInOK {
    { _ in throw AppError(code: "unavailable", message: "Craft sign-in is unavailable in fixtures.") }
}

func craftSignInFixturePollHandler() -> @Sendable (JSONValue) async throws -> DocsSignInPollResult {
    { _ in DocsSignInPollResult(status: .error, message: "Craft sign-in is unavailable in fixtures.") }
}

func craftSignInFixtureCancelHandler() -> @Sendable (JSONValue) async throws -> DocsSignInOK {
    { _ in DocsSignInOK() }
}
