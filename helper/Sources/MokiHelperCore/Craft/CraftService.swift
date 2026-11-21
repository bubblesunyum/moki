import Foundation

// MARK: - Craft service
//
// `craftConnect.validate` / `craftConnect.save` / `craftConnect.signOut`
// plus the Craft section listing. The credential never leaves the helper:
// results carry rows + status, never the URL. No TaskGroup anywhere on this
// path (see swift-taskgroup-timeout trap): listing is one serial `GET
// /documents?fetchMetadata=true` behind no fan-out, capped at 12 rows for
// the section.
//
// Craft rows preview in the pane like Notion: rows carry the web editor
// URL built from the API's `clickableLink` values (`spaceId` + `documentId`
// query params). A row with no validated link (absent, non-craftdocs, or
// missing params — including legacy credentials that predate space-id
// capture) carries an empty openUrl and opens in the native app via
// `deepLink`: the API's `clickableLink` when it validates as `craftdocs://`,
// else the hand-built deep link. A row with no web URL never mounts in the
// preview pane.

/// Section cap. `GET /documents?fetchMetadata=true` unfiltered returns
/// everything (654 observed in the live space) — fetch on demand, sort by
/// the API's `lastModifiedAt`, cap here.
let craftRecentsPageSize = 12

public struct CraftService: Sendable {
    private let store: CraftCredentialStore
    private let session: URLSession
    private let secrets: any SecretStoring
    private let fixtures: Bool
    private let now: @Sendable () -> Date

    public init(
        store: CraftCredentialStore = CraftCredentialStore(),
        session: URLSession = .shared,
        fixtures: Bool = ProcessInfo.processInfo.environment["MOKI_FIXTURES"] == "1",
        now: @escaping @Sendable () -> Date = Date.init,
        secrets: any SecretStoring = KeychainSecretStore()
    ) {
        self.store = store
        self.session = session
        self.secrets = secrets
        self.fixtures = fixtures
        self.now = now
    }

    /// Check a pasted connection string. Malformed input returns
    /// `{ok:false}` without touching the network. A well-formed URL is
    /// verified with `GET /connection`: success returns
    /// `{ok:true, spaceName}`, and every verification failure throws —
    /// `unreachable` (dead network, wrong token, bad payload) or
    /// `rate_limited` — never an `ok:false` that reads as "bad paste".
    /// Check-only: never changes fixture auth state.
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
    /// Under fixtures, flip the in-memory signed-out flag back to
    /// signed-in instead — nothing is written to disk, so a URL saved in
    /// a fixtures session restores rows and is forgotten with the
    /// process.
    public func save(url raw: String) async throws -> CraftOK {
        guard let baseURL = CraftClient.baseURL(from: raw) else {
            throw InvalidParamsError("Not a Craft connection URL.")
        }
        if fixtures {
            // Hermetic: shape-checked above, never written to disk — a URL
            // saved in a fixtures session is forgotten with the process.
            await CraftFixtureAuthState.shared.setSignedOut(false)
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

    /// Sign out: wipe the MCP-era OAuth keychain accounts (a no-op when
    /// nothing was ever granted) and the legacy credential file. Missing
    /// state still succeeds. The legacy `craftConnect.signOut` name stays
    /// for renderer compatibility; it now clears both credential kinds.
    /// Under fixtures, flip the in-memory flag instead — the real
    /// credential file and Keychain entries are never touched, so a
    /// fixtures sign-out cannot delete the developer's real credentials.
    public func signOut() async throws -> CraftOK {
        if fixtures {
            await CraftFixtureAuthState.shared.setSignedOut(true)
            return CraftOK()
        }
        craftClearOAuthMaterial(secrets: secrets)
        store.remove()
        return CraftOK()
    }

    /// Serve the Craft section. Never throws: no credential empties the
    /// section into its sign-in state (`signedOut`); every failure lands in
    /// `unreachable` — a dead network never reads as empty-ok. Listing is
    /// the Connect URL only: one serial `GET /documents?fetchMetadata=true`,
    /// sorted by the API's `lastModifiedAt` (newest first, stable — undated
    /// rows keep their space order after the dated ones), capped at 12.
    /// Under fixtures, consult the in-memory fixture auth state: a
    /// fixtures sign-out empties the section into its sign-in state
    /// instead of snapping back to rows.
    public func listRecents() async -> DocsListRecentsResult {
        if fixtures {
            if await CraftFixtureAuthState.shared.isSignedOut() {
                return DocsListRecentsResult(items: [], unreachable: false, signedOut: true)
            }
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
            let items = craftSortByModified(documents).prefix(craftRecentsPageSize).map {
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

/// The MCP-era OAuth Keychain identity. The hosted-MCP OAuth stack is gone
/// (listing is Connect-URL only), but sign-out still deletes the two items
/// that flow wrote — one generic-password item each under Moki's own
/// service — so a stale grant can never linger. Defined here (never in the
/// shared SecretStore, which this area cannot edit).
enum CraftOAuthKeychain {
    static let service = MokiKeychainIDs.service
    static let clientAccount = "craft-mcp-oauth-client"
    static let tokenAccount = "craft-mcp-oauth-token"
}

/// Delete both MCP-era Keychain items. Best-effort: missing items still
/// succeed — deleting what is not there is a no-op.
func craftClearOAuthMaterial(secrets: any SecretStoring) {
    try? secrets.delete(service: CraftOAuthKeychain.service, account: CraftOAuthKeychain.tokenAccount)
    try? secrets.delete(service: CraftOAuthKeychain.service, account: CraftOAuthKeychain.clientAccount)
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

/// Stable newest-first ordering by the API's `lastModifiedAt`. Decorated
/// with the space-order index so the sort never shuffles equals: dated rows
/// lead (parsed newest first), undated rows keep their original order after
/// them. Unparseable stamps read as undated rather than dropping the row.
func craftSortByModified(_ documents: [CraftDocument]) -> [CraftDocument] {
    documents.enumerated().sorted { lhs, rhs in
        switch (CraftClient.parseServerTime(lhs.element.lastModifiedAt ?? ""),
            CraftClient.parseServerTime(rhs.element.lastModifiedAt ?? ""))
        {
        case let (l, r) where l == nil && r == nil:
            return lhs.offset < rhs.offset
        case (nil, _):
            return false
        case (_, nil):
            return true
        case let (l?, r?):
            if l != r { return l > r }
            return lhs.offset < rhs.offset
        }
    }.map(\.element)
}

/// One document as a shared Docs row. `updatedAt` is the API's
/// `lastModifiedAt` when the stamp parses (the sort's own rule: anything
/// unparseable reads as undated), else the fetch time — a row never shows
/// a blank date line while a valid fallback exists. `openUrl` is the web
/// editor built from the API's `clickableLink` values (never from the row
/// id: the link's `documentId` is a different id family than the row's API
/// id for the same doc), else empty — a row with no web URL opens in the
/// native app via `deepLink` (the legacy no-space fallback), never in the
/// preview pane. `deepLink` prefers the API's `clickableLink` (only when
/// it validates as a `craftdocs://` URL) over the hand-built deep link.
func craftDocItem(from document: CraftDocument, spaceId: String?, fetchedAt: String) -> DocItem {
    let updatedAt =
        document.lastModifiedAt.flatMap {
            CraftClient.parseServerTime($0) == nil ? nil : $0
        } ?? fetchedAt
    return DocItem(
        id: document.id, title: document.title, source: .craft,
        updatedAt: updatedAt,
        openUrl: craftWebEditorURL(fromClickableLink: document.clickableLink) ?? "",
        deepLink: craftNativeDeepLink(for: document, spaceId: spaceId))
}

/// The API's `clickableLink` wins when it is a `craftdocs://` URL;
/// anything else (https editor links, garbage) is rejected in favor of the
/// hand-built deep link, so the deepLink stays a native `craftdocs://` target.
func craftNativeDeepLink(for document: CraftDocument, spaceId: String?) -> String {
    if let link = document.clickableLink, link.hasPrefix("craftdocs://") {
        return link
    }
    return craftDeepLink(spaceId: spaceId, blockId: document.id)
}

/// Craft's web editor for one document (Craft Link Formats):
/// `https://docs.craft.do/editor/d/<spaceId>/<documentId>`. Both segments
/// percent-encode to the unreserved set, so fixture ids such as `s/…`
/// encode the same way as the renderer's `encodeURIComponent`.
///
/// Live evidence: the `clickableLink`'s `documentId` is NOT the row's API
/// id — the two id families differ for the same doc (a row id of
/// `7bd0a593-…` carries a link with `documentId=277fa729-…`), so the
/// editor URL must come from the link's own values. Building it from
/// `spaceId + document.id` hangs the editor on its loading skeleton.
func craftWebEditorURL(fromClickableLink link: String?) -> String? {
    guard let link, link.hasPrefix("craftdocs://"),
        let components = URLComponents(string: link),
        let query = components.queryItems,
        let spaceId = query.first(where: { $0.name == "spaceId" })?.value,
        !spaceId.isEmpty,
        let documentId = query.first(where: { $0.name == "documentId" })?.value,
        !documentId.isEmpty
    else { return nil }
    // URLComponents percent-decodes the query values; the low-level
    // builder re-encodes them for the editor path.
    return craftWebEditorURL(spaceId: spaceId, documentId: documentId)
}

/// Craft's web editor for one document (Craft Link Formats):
/// `https://docs.craft.do/editor/d/<spaceId>/<documentId>`. Nil without a
/// space id. Both segments percent-encode to the unreserved set, so fixture
/// ids such as `s/…` encode the same way as the renderer's `encodeURIComponent`.
func craftWebEditorURL(spaceId: String?, documentId: String) -> String? {
    guard let spaceId, !spaceId.isEmpty else { return nil }
    let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
    guard let space = spaceId.addingPercentEncoding(withAllowedCharacters: unreserved),
        let document = documentId.addingPercentEncoding(withAllowedCharacters: unreserved)
    else { return nil }
    return "https://docs.craft.do/editor/d/\(space)/\(document)"
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
    /// build their own services with a temp-dir store, an in-memory secret
    /// store, and a stubbed session.
    /// Returns the service it registered, so the Docs dispatcher can hold
    /// the exact same instance as `craftConnect.signOut`.
    @discardableResult
    public func registerCraftMethods(
        session: URLSession = .shared,
        locations: CraftLocations = .production(),
        environment: [String: String] = ProcessInfo.processInfo.environment,
        secrets: any SecretStoring = KeychainSecretStore()
    ) -> CraftService {
        let fixtures = environment["MOKI_FIXTURES"] == "1"
        let service = CraftService(
            store: CraftCredentialStore(locations: locations),
            session: session, fixtures: fixtures, secrets: secrets)
        register("craftConnect.validate", handler: craftConnectValidateHandler(service: service))
        register("craftConnect.save", handler: craftConnectSaveHandler(service: service))
        register("craftConnect.signOut", handler: craftConnectSignOutHandler(service: service))
        return service
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
