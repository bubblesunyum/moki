import Foundation

// MARK: - Craft service
//
// `craftConnect.validate` / `craftConnect.save` / `craftConnect.signOut`
// plus the Craft section listing. The credential never leaves the helper:
// results carry rows + status, never the URL. No TaskGroup anywhere on this
// path (see swift-taskgroup-timeout trap): listing is one serial `GET
// /documents` behind no fan-out, capped at 12 rows for the section.

/// Section cap. `GET /documents` unfiltered returns everything (654 observed
/// in the live space) in space order — fetch on demand, cap here, and never
/// sort: the endpoint carries no recency, so section order is space order.
let craftRecentsPageSize = 12

public struct CraftService: Sendable {
    private let store: CraftCredentialStore
    private let session: URLSession
    private let fixtures: Bool
    private let now: @Sendable () -> Date

    public init(
        store: CraftCredentialStore = CraftCredentialStore(),
        session: URLSession = .shared,
        fixtures: Bool = ProcessInfo.processInfo.environment["MOKI_FIXTURES"] == "1",
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.store = store
        self.session = session
        self.fixtures = fixtures
        self.now = now
    }

    /// Check a pasted connection string. Malformed input returns
    /// `{ok:false}` without touching the network. A well-formed URL is
    /// verified with `GET /connection`: success returns
    /// `{ok:true, spaceName}`, and every verification failure throws —
    /// `unreachable` (dead network, wrong token, bad payload) or
    /// `rate_limited` — never an `ok:false` that reads as "bad paste".
    public func validate(url raw: String) async throws -> CraftConnectValidateResult {
        guard let baseURL = CraftClient.baseURL(from: raw) else {
            return CraftConnectValidateResult(ok: false)
        }
        if fixtures {
            // Hermetic: the shape check above is real (garbage still fails),
            // but no network leaves the process.
            return CraftConnectValidateResult(ok: true, spaceName: "Fixture Space")
        }
        switch await CraftClient(baseURL: baseURL, session: session).checkConnection() {
        case .success(let space):
            return CraftConnectValidateResult(ok: true, spaceName: space.name)
        case .failure(let error):
            throw craftAppError(for: error)
        }
    }

    /// Validate with `GET /connection`, then store `{url, spaceId}`. A
    /// failed check stores nothing — whatever was there stays. Returns
    /// `{ok:true}`; throws like `validate` on failure.
    public func save(url raw: String) async throws -> CraftOK {
        guard let baseURL = CraftClient.baseURL(from: raw) else {
            throw InvalidParamsError("Not a Craft connection URL.")
        }
        if fixtures {
            // Hermetic: shape-checked above, never written to disk — a URL
            // saved in a fixtures session is forgotten with the process.
            return CraftOK()
        }
        switch await CraftClient(baseURL: baseURL, session: session).checkConnection() {
        case .success(let space):
            store.save(CraftCredential(url: baseURL.absoluteString, spaceId: space.spaceID))
            return CraftOK()
        case .failure(let error):
            throw craftAppError(for: error)
        }
    }

    /// Sign out: wipe the credential file. A missing file still succeeds.
    public func signOut() async throws -> CraftOK {
        if !fixtures {
            store.remove()
        }
        return CraftOK()
    }

    /// Serve the Craft section. Never throws: no credential empties the
    /// section into its sign-in state (`signedOut`); every failure lands in
    /// `unreachable` — a dead network never reads as empty-ok.
    public func listRecents() async -> DocsListRecentsResult {
        if fixtures {
            return DocsListRecentsResult(
                items: craftFixtureRecents(now: now()), unreachable: false, signedOut: false)
        }
        guard let credential = store.load(),
            let baseURL = CraftClient.baseURL(from: credential.url)
        else {
            return DocsListRecentsResult(items: [], unreachable: false, signedOut: true)
        }
        switch await CraftClient(baseURL: baseURL, session: session).listDocuments() {
        case .success(let documents):
            let fetchedAt = iso8601String(now())
            let items = documents.prefix(craftRecentsPageSize).map {
                craftDocItem(from: $0, spaceId: credential.spaceId, fetchedAt: fetchedAt)
            }
            return DocsListRecentsResult(items: items, unreachable: false, signedOut: false)
        case .failure:
            // Rate limits included: the envelope has no rate-limited state,
            // so a 429 reads as a partial, same as any other failed list.
            return DocsListRecentsResult(items: [], unreachable: true, signedOut: false)
        }
    }
}

/// Map a client failure to the RPC error. Messages name the host only —
/// never the URL, which is the credential.
func craftAppError(for error: CraftClientError) -> Error {
    switch error {
    case .rateLimited:
        return AppError(
            code: "rate_limited",
            message: "Craft is rate-limiting requests. Try again in a moment.")
    case .unreachable(let status):
        if let status {
            return AppError(
                code: "unreachable",
                message: "Craft unreachable (connect.craft.do answered HTTP \(status)).")
        }
        return AppError(
            code: "unreachable",
            message: "Craft unreachable (connect.craft.do did not answer).")
    }
}

/// One space-ordered document as a shared Docs row. `updatedAt` is the
/// fetch time — the API exposes no modified dates, so callers must not
/// present rows as recent. `openUrl` stays empty: the row opens out-of-app
/// via `deepLink`.
func craftDocItem(from document: CraftDocument, spaceId: String?, fetchedAt: String) -> DocItem {
    DocItem(
        id: document.id, title: document.title, source: .craft, updatedAt: fetchedAt,
        openUrl: "", deepLink: craftDeepLink(spaceId: spaceId, blockId: document.id))
}

/// Native-app open target for one document. Built with URLComponents so ids
/// are encoded; the space param is omitted when the stored credential
/// predates space-id capture.
func craftDeepLink(spaceId: String?, blockId: String) -> String {
    var components = URLComponents()
    components.scheme = "craftdocs"
    components.host = "open"
    var query: [URLQueryItem] = []
    if let spaceId, !spaceId.isEmpty {
        query.append(URLQueryItem(name: "spaceId", value: spaceId))
    }
    query.append(URLQueryItem(name: "blockId", value: blockId))
    components.queryItems = query
    return components.string ?? "craftdocs://open?blockId=\(blockId)"
}

// MARK: - RPC handlers

public func craftConnectValidateHandler(service: CraftService) -> @Sendable (JSONValue) async throws
    -> CraftConnectValidateResult
{
    return { params in
        let request = try decodeRpcParams(params, as: CraftConnectParams.self)
        return try await service.validate(url: request.url)
    }
}

public func craftConnectSaveHandler(service: CraftService) -> @Sendable (JSONValue) async throws
    -> CraftOK
{
    return { params in
        let request = try decodeRpcParams(params, as: CraftConnectParams.self)
        return try await service.save(url: request.url)
    }
}

public func craftConnectSignOutHandler(service: CraftService) -> @Sendable (JSONValue) async throws
    -> CraftOK
{
    return { _ in try await service.signOut() }
}

extension RPCServer {
    /// Register every Craft method. Called once from `moki-helper`'s `@main`
    /// entry point; captures one service for the helper's lifetime. Tests
    /// build their own service with a temp-dir store and a stubbed session.
    public func registerCraftMethods(
        session: URLSession = .shared,
        locations: CraftLocations = .production(),
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) {
        let fixtures = environment["MOKI_FIXTURES"] == "1"
        let service = CraftService(
            store: CraftCredentialStore(locations: locations),
            session: session, fixtures: fixtures)
        register("craftConnect.validate", handler: craftConnectValidateHandler(service: service))
        register("craftConnect.save", handler: craftConnectSaveHandler(service: service))
        register("craftConnect.signOut", handler: craftConnectSignOutHandler(service: service))
    }
}

// MARK: - Fixtures

/// Canned 12-row listing for `MOKI_FIXTURES=1` (UI work, screenshots): no
/// network, no file access. Delegates to the canonical `DocsFixtures`
/// table so every served path — this one, the fixture handler, the
/// renderer `DOC_FIXTURES`, and the pin/byte-agreement tests — emits the
/// same `s/…` ids row-for-row. `updatedAt` stays fetch-relative and the
/// deepLink stays a literal interpolation (never URLComponents: fixture
/// ids carry `/`, which is legal unencoded in a query string, and both
/// sides must byte-agree).
func craftFixtureRecents(now: Date = Date()) -> [DocItem] {
    DocsFixtures.craftRecents(now: now)
}
