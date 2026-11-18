import Foundation

// MARK: - Endpoints

let googleTokenURL = URL(string: "https://oauth2.googleapis.com/token")!
let googleUserinfoURL = URL(string: "https://www.googleapis.com/oauth2/v2/userinfo")!

/// Per-request network timeout. Keeps a hung Google endpoint from stalling
/// `accounts.list` past the psymail-import deadline budget.
let googleRequestTimeout: TimeInterval = 15

// MARK: - Models

public enum GoogleAccountStatus: String, Codable, Sendable {
    case ok
    case authExpired = "auth_expired"
    case unreachable
}

/// One signed-in Gmail account. Never carries tokens.
public struct GoogleAccount: Codable, Sendable, Equatable {
    public var address: String
    public var name: String?
    public var photoURL: String?
    public var status: GoogleAccountStatus

    public init(
        address: String, name: String? = nil, photoURL: String? = nil,
        status: GoogleAccountStatus
    ) {
        self.address = address
        self.name = name
        self.photoURL = photoURL
        self.status = status
    }
}

/// How the one-time psymail-mini import stands for this response:
/// - `done`: the import finished in time (merged tokens are in this answer).
/// - `pending`: the import didn't finish within the deadline; this answer
///   comes from Moki's own token file and the late-finishing import still
///   merges/persists for the next call.
/// - `unavailable`: the import finished but neither psymail-mini source
///   existed, so there was nothing to import.
public enum PsymailImportStatus: String, Codable, Sendable {
    case done
    case pending
    case unavailable
}

/// `accounts.list` result. Object (not a bare array) so the top-level
/// `psymailImport` signal can travel with the accounts — the TS protocol
/// mirror must change with it (`Account[]` → `{accounts, psymailImport}`).
public struct GoogleAccountsListResult: Codable, Sendable, Equatable {
    public var accounts: [GoogleAccount]
    public var psymailImport: PsymailImportStatus

    public init(accounts: [GoogleAccount], psymailImport: PsymailImportStatus) {
        self.accounts = accounts
        self.psymailImport = psymailImport
    }
}

// MARK: - Token refresh

struct TokenRefreshResult: Sendable {
    var accessToken: String
    var expiresIn: Int
}

private struct TokenSuccessPayload: Decodable {
    var accessToken: String
    var expiresIn: Int?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case expiresIn = "expires_in"
    }
}

private struct TokenErrorPayload: Decodable {
    var error: String?

    enum CodingKeys: String, CodingKey {
        case error
    }
}

/// Build the `POST /token` refresh request (`grant_type=refresh_token`,
/// form-encoded). Kept separate so tests can assert on the exact bytes via
/// a stubbed `URLProtocol`.
func googleRefreshRequest(
    config: OAuthClientConfig, refreshToken: String
) -> URLRequest {
    var request = URLRequest(url: googleTokenURL)
    request.httpMethod = "POST"
    request.timeoutInterval = googleRequestTimeout
    request.setValue(
        "application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    let fields = [
        ("client_id", config.clientID),
        ("client_secret", config.clientSecret),
        ("refresh_token", refreshToken),
        ("grant_type", "refresh_token"),
    ]
    request.httpBody = fields
        .map { "\($0.0)=\($0.1.formURLEncoded())" }
        .joined(separator: "&")
        .data(using: .utf8)
    return request
}

func performGoogleRefresh(
    config: OAuthClientConfig, refreshToken: String, session: URLSession
) async throws -> TokenRefreshResult {
    let request = googleRefreshRequest(config: config, refreshToken: refreshToken)
    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await session.data(for: request)
    } catch {
        throw AppError(
            code: "unreachable", message: "Google token refresh failed: network unavailable.")
    }
    guard let http = response as? HTTPURLResponse else {
        throw AppError(
            code: "unreachable", message: "Google token refresh failed.")
    }
    if http.statusCode == 200 {
        guard let payload = try? JSONDecoder().decode(TokenSuccessPayload.self, from: data),
            !payload.accessToken.isEmpty
        else {
            throw AppError(
                code: "unreachable",
                message: "Google token refresh returned an unexpected response.")
        }
        return TokenRefreshResult(
            accessToken: payload.accessToken, expiresIn: payload.expiresIn ?? 3600)
    }
    let errorCode = (try? JSONDecoder().decode(TokenErrorPayload.self, from: data))?.error
    // Never include the payload in the message: error descriptions can echo
    // request parameters.
    switch errorCode {
    case "invalid_grant":
        throw AppError(
            code: "auth_expired",
            message: "Google authorization expired. Sign in again to reconnect.")
    case "invalid_client":
        throw AppError(
            code: "auth_unconfigured",
            message: "Google OAuth client was rejected. Check the client configuration.")
    default:
        throw AppError(
            code: "unreachable",
            message:
                "Google token refresh failed (HTTP \(http.statusCode)).")
    }
}

// MARK: - Profile

struct UserinfoPayload: Decodable, Sendable {
    var name: String?
    var picture: String?
}

/// Fetch the public profile for a live access token. Only a 401/403 throws
/// (`auth_expired`); anything else degrades to an unnamed account so one
/// flaky profile never breaks the whole list.
func fetchGoogleProfile(
    accessToken: String, session: URLSession
) async throws -> UserinfoPayload {
    var request = URLRequest(url: googleUserinfoURL)
    request.timeoutInterval = googleRequestTimeout
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await session.data(for: request)
    } catch {
        return UserinfoPayload(name: nil, picture: nil)
    }
    guard let http = response as? HTTPURLResponse else {
        return UserinfoPayload(name: nil, picture: nil)
    }
    switch http.statusCode {
    case 200:
        return (try? JSONDecoder().decode(UserinfoPayload.self, from: data))
            ?? UserinfoPayload(name: nil, picture: nil)
    case 401, 403:
        throw AppError(
            code: "auth_expired",
            message: "Google authorization expired. Sign in again to reconnect.")
    default:
        return UserinfoPayload(name: nil, picture: nil)
    }
}

// MARK: - Access-token cache

/// Mints access tokens from refresh tokens and caches them until
/// `expires_in - 60s`. `invalid_grant` surfaces as
/// `AppError(code: "auth_expired")` and is never cached.
public actor GoogleAccessTokenCache {
    private struct Entry: Sendable {
        var token: String
        var expiresAt: Date
    }

    private var entries: [String: Entry] = [:]
    private let config: OAuthClientConfig
    private let session: URLSession
    private let now: @Sendable () -> Date

    public init(
        config: OAuthClientConfig, session: URLSession = .shared,
        now: @Sendable @escaping () -> Date = Date.init
    ) {
        self.config = config
        self.session = session
        self.now = now
    }

    public func accessToken(for address: String, refreshToken: String) async throws -> String {
        if let entry = entries[address], entry.expiresAt > now() {
            return entry.token
        }
        let result = try await performGoogleRefresh(
            config: config, refreshToken: refreshToken, session: session)
        let ttl = max(0, result.expiresIn - 60)
        entries[address] = Entry(
            token: result.accessToken,
            expiresAt: now().addingTimeInterval(TimeInterval(ttl)))
        return result.accessToken
    }

    public func invalidate(address: String) {
        entries[address] = nil
    }
}

// MARK: - accounts.list

/// Reference box so struct copies of the service share one cache and one
/// psymail import for the helper's lifetime. The first successful config
/// wins; the OAuth client is stable per helper process, and the session is
/// the service's own session captured at first use.
final class SharedGoogleServiceState: @unchecked Sendable {
    private let lock = NSLock()
    private var cached: (config: OAuthClientConfig, cache: GoogleAccessTokenCache)?
    let importer: PsymailTokenImporter

    init(locations: GoogleLocations, reader: PsymailFileReader?) {
        importer = PsymailTokenImporter(locations: locations, reader: reader)
    }

    func tokenCache(config: OAuthClientConfig, session: URLSession) -> GoogleAccessTokenCache {
        lock.withLock {
            if let cached, cached.config == config {
                return cached.cache
            }
            let cache = GoogleAccessTokenCache(config: config, session: session)
            cached = (config, cache)
            return cache
        }
    }
}

/// Dependencies for `accounts.list`, injectable so tests can root locations
/// at a temp dir and stub the network.
public struct GoogleAccountsService: Sendable {
    public var locations: GoogleLocations
    public var environment: [String: String]
    public var session: URLSession
    public var psymailImportTimeout: Duration
    private let shared: SharedGoogleServiceState

    public init(
        locations: GoogleLocations = .production(),
        environment: [String: String] = ProcessInfo.processInfo.environment,
        session: URLSession = .shared,
        psymailImportTimeout: Duration = .seconds(3),
        psymailReader: PsymailFileReader? = nil
    ) {
        self.locations = locations
        self.environment = environment
        self.session = session
        self.psymailImportTimeout = psymailImportTimeout
        self.shared = SharedGoogleServiceState(locations: locations, reader: psymailReader)
    }

    /// Give the one-time psymail import its chance to merge before a direct
    /// token mint (e.g. `MailService.getThread`, which never calls
    /// `listAccounts`). Runs the same wait `listAccounts()` uses; later
    /// calls reuse the single import's outcome.
    public func ensureTokens() async {
        _ = await shared.importer.wait(timeout: psymailImportTimeout)
    }

    /// Mint (or reuse a cached) access token for one account. Call
    /// `listAccounts()` first so a pending psymail import has merged into
    /// Moki's file; this reads only Moki's own token file and never touches
    /// psymail paths. Unknown addresses surface as `auth_expired`.
    public func accessToken(for address: String) async throws -> String {
        guard
            let refreshToken = GoogleTokenStore(locations: locations)
                .readMokiTokens()[address]
        else {
            throw AppError(
                code: "auth_expired",
                message: "Google authorization expired. Sign in again to reconnect.")
        }
        let config = try OAuthClientConfig.load(
            locations: locations, environment: environment)
        return try await shared.tokenCache(config: config, session: session)
            .accessToken(for: address, refreshToken: refreshToken)
    }

    /// Every known Gmail account with its profile, plus the psymail-import
    /// signal. Answers from Moki's own token file when the one-time import
    /// is still pending; a late import merges/persists for the next call.
    /// Per-account failures never fail the list: `invalid_grant` (and a
    /// 401/403 profile) becomes `auth_expired`, while any other refresh,
    /// network, or unexpected per-account failure becomes `unreachable` —
    /// other accounts still resolve. Only a missing OAuth client
    /// (`auth_unconfigured`) throws.
    public func listAccounts() async throws -> GoogleAccountsListResult {
        let store = GoogleTokenStore(locations: locations)
        let mokiSnapshot = store.readMokiTokens()

        let outcome = await shared.importer.wait(timeout: psymailImportTimeout)
        let importStatus: PsymailImportStatus
        let refreshTokens: RefreshTokenMap
        if let outcome {
            if outcome.hadSources {
                importStatus = .done
                // The importer already merged+persisted; re-read so this
                // answer includes the imported tokens.
                refreshTokens = store.readMokiTokens()
            } else {
                importStatus = .unavailable
                refreshTokens = mokiSnapshot
            }
        } else {
            importStatus = .pending
            refreshTokens = mokiSnapshot
        }

        guard !refreshTokens.isEmpty else {
            return GoogleAccountsListResult(accounts: [], psymailImport: importStatus)
        }
        let config = try OAuthClientConfig.load(
            locations: locations, environment: environment)
        let cache = shared.tokenCache(config: config, session: session)
        var accounts: [GoogleAccount] = []
        for address in refreshTokens.keys.sorted() {
            guard let refreshToken = refreshTokens[address] else { continue }
            do {
                let accessToken = try await cache.accessToken(
                    for: address, refreshToken: refreshToken)
                let profile = try await fetchGoogleProfile(
                    accessToken: accessToken, session: session)
                accounts.append(
                    GoogleAccount(
                        address: address, name: profile.name,
                        photoURL: profile.picture, status: .ok))
            } catch let error as AppError where error.code == "auth_expired" {
                accounts.append(GoogleAccount(address: address, status: .authExpired))
            } catch {
                accounts.append(GoogleAccount(address: address, status: .unreachable))
            }
        }
        return GoogleAccountsListResult(accounts: accounts, psymailImport: importStatus)
    }
}

/// Production `accounts.list` handler — the single registration line in
/// `MokiHelper.swift` references this. Captures one service (one cache, one
/// psymail import) so both live as long as the handler, i.e. the helper's
/// lifetime.
public func googleAccountsListHandler(
    locations: GoogleLocations = .production(),
    environment: [String: String] = ProcessInfo.processInfo.environment,
    session: URLSession = .shared,
    psymailImportTimeout: Duration = .seconds(3),
    psymailReader: PsymailFileReader? = nil
) -> @Sendable (JSONValue) async throws -> GoogleAccountsListResult {
    let service = GoogleAccountsService(
        locations: locations,
        environment: environment,
        session: session,
        psymailImportTimeout: psymailImportTimeout,
        psymailReader: psymailReader
    )
    return { _ in
        try await service.listAccounts()
    }
}

// MARK: - Encoding

extension String {
    /// Percent-encode for `application/x-www-form-urlencoded` bodies.
    func formURLEncoded() -> String {
        let allowed = CharacterSet.alphanumerics.union(
            CharacterSet(charactersIn: "-._~"))
        return addingPercentEncoding(withAllowedCharacters: allowed) ?? self
    }
}
