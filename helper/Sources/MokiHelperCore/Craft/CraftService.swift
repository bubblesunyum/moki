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
    private let secrets: any SecretStoring
    private let signIn: CraftSignInService?
    private let fixtures: Bool
    private let now: @Sendable () -> Date

    public init(
        store: CraftCredentialStore = CraftCredentialStore(),
        session: URLSession = .shared,
        fixtures: Bool = ProcessInfo.processInfo.environment["MOKI_FIXTURES"] == "1",
        now: @escaping @Sendable () -> Date = Date.init,
        secrets: any SecretStoring = KeychainSecretStore(),
        signIn: CraftSignInService? = nil
    ) {
        self.store = store
        self.session = session
        self.secrets = secrets
        self.signIn = signIn
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

    /// Sign out: revoke the OAuth grant best-effort, wipe the OAuth client
    /// + token material and the legacy credential file. Missing state still
    /// succeeds. The legacy `craftConnect.signOut` name stays for renderer
    /// compatibility; it now clears both credential kinds.
    public func signOut() async throws -> CraftOK {
        if !fixtures {
            if let material = craftLoadTokenMaterial(secrets: secrets) {
                let clientID = craftLoadClientMaterial(secrets: secrets)?.clientID ?? ""
                await craftRevokeToken(material: material, clientID: clientID, session: session)
            }
            craftClearOAuthMaterial(secrets: secrets)
            store.remove()
        }
        return CraftOK()
    }

    /// Serve the Craft section. Never throws: no credential empties the
    /// section into its sign-in state (`signedOut`); every failure lands in
    /// `unreachable` — a dead network never reads as empty-ok. OAuth MCP
    /// listing wins when an OAuth grant is stored; the legacy Connect URL
    /// remains as a fallback only.
    public func listRecents() async -> DocsListRecentsResult {
        if fixtures {
            return DocsListRecentsResult(
                items: craftFixtureRecents(now: now()), unreachable: false, signedOut: false)
        }
        if let oauth = await oauthListRecents() {
            return oauth
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

    /// OAuth MCP listing, or nil when no OAuth grant is stored (the caller
    /// falls through to the legacy Connect URL). A dead grant
    /// (`invalid_grant`, mid-session 401) signs out; anything else is a
    /// partial.
    private func oauthListRecents() async -> DocsListRecentsResult? {
        guard let signIn else { return nil }
        let token: String
        do {
            guard let fresh = try await signIn.freshAccessToken() else { return nil }
            token = fresh
        } catch let error as AppError where error.code == "auth_expired" {
            return DocsListRecentsResult(items: [], unreachable: false, signedOut: true)
        } catch {
            return DocsListRecentsResult(items: [], unreachable: true, signedOut: false)
        }
        do {
            return try await mcpListRecents(accessToken: token)
        } catch let error as AppError where error.code == "auth_expired" {
            // The cached token looked valid but the server rejected it:
            // one forced refresh, one retry, then give up the grant.
            do {
                guard let rotated = try await signIn.forceRefreshAccessToken() else {
                    return DocsListRecentsResult(items: [], unreachable: false, signedOut: true)
                }
                return try await mcpListRecents(accessToken: rotated)
            } catch let retry as AppError where retry.code == "auth_expired" {
                return DocsListRecentsResult(items: [], unreachable: false, signedOut: true)
            } catch {
                return DocsListRecentsResult(items: [], unreachable: true, signedOut: false)
            }
        } catch {
            return DocsListRecentsResult(items: [], unreachable: true, signedOut: false)
        }
    }

    /// One MCP fetch: `tools/list` → the advertised documents tool → rows,
    /// capped. Current servers advertise `craft_read` (`command:
    /// documents list`); older ones advertise a JSON `documents_list`.
    /// Throws `AppError` (transport errors pass through; a missing tool or
    /// tool-level error reads as unreachable).
    private func mcpListRecents(accessToken: String) async throws -> DocsListRecentsResult {
        let client = RemoteMCPClient(
            endpoint: craftMCPEndpoint, accessToken: accessToken, session: session)
        let tools = try await client.listTools()
        let spaceId =
            tools.contains(where: { $0.name == "craft_read" }) ? await mcpSpaceID(client) : nil
        let call: (name: String, arguments: JSONValue)
        if let documents = tools.first(where: { $0.name == "documents_list" }) {
            call = ("documents_list", craftDocumentsListArgs(schema: documents.inputSchema))
        } else if let read = tools.first(where: { $0.name == "craft_read" }) {
            call = ("craft_read", craftDocumentsReadArgs(schema: read.inputSchema))
        } else {
            throw AppError(
                code: "unreachable",
                message: "Craft returned an unexpected response. Please try again.")
        }
        let result = try await client.callTool(name: call.name, arguments: call.arguments)
        guard !result.isError else {
            throw AppError(
                code: "unreachable",
                message: "Craft could not list documents. Please try again.")
        }
        let items = craftMCPDocuments(from: result).prefix(craftOAuthRecentsPageSize).map {
            craftMCPDocItem(from: $0, spaceId: spaceId)
        }
        return DocsListRecentsResult(items: Array(items), unreachable: false, signedOut: false)
    }

    /// The space id behind the web editor links, from `connection info` on
    /// the advertised `craft_read`. Best-effort: any failure (including an
    /// expired token, which the documents call then reports and retries)
    /// reads as no space id, so the listing's outcome never depends on it.
    private func mcpSpaceID(_ client: RemoteMCPClient) async -> String? {
        guard
            let result = try? await client.callTool(
                name: "craft_read",
                arguments: .object(["command": .string("connection info --format json")])),
            !result.isError
        else { return nil }
        return craftSpaceID(from: result)
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
/// present rows as recent. `openUrl` is the web editor when the stored
/// credential carries a space id; otherwise the row opens out-of-app via
/// `deepLink`.
func craftDocItem(from document: CraftDocument, spaceId: String?, fetchedAt: String) -> DocItem {
    DocItem(
        id: document.id, title: document.title, source: .craft, updatedAt: fetchedAt,
        openUrl: craftWebEditorURL(spaceId: spaceId, documentId: document.id) ?? "",
        deepLink: craftDeepLink(spaceId: spaceId, blockId: document.id))
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
    /// entry point; captures one service (plus one sign-in flow) for the
    /// helper's lifetime. Tests build their own services with a temp-dir
    /// store, an in-memory secret store, and a stubbed session.
    /// Returns the service it registered, so the Docs dispatcher can hold
    /// the exact same instance (and therefore the same sign-in grant) as
    /// `craftConnect.signOut` / `craft.signIn*`.
    @discardableResult
    public func registerCraftMethods(
        session: URLSession = .shared,
        locations: CraftLocations = .production(),
        environment: [String: String] = ProcessInfo.processInfo.environment,
        secrets: any SecretStoring = KeychainSecretStore(),
        clock: @escaping @Sendable () -> Date = Date.init,
        openBrowser: @escaping @Sendable (URL) -> Void = openOAuthInSystemBrowser,
        makeServer: @escaping @Sendable () -> any OAuthLoopbackServing = { OAuthLoopbackServer() }
    ) -> CraftService {
        let fixtures = environment["MOKI_FIXTURES"] == "1"
        let signIn = CraftSignInService(
            secrets: secrets, session: session, clock: clock,
            openBrowser: openBrowser, makeServer: makeServer)
        let service = CraftService(
            store: CraftCredentialStore(locations: locations),
            session: session, fixtures: fixtures, secrets: secrets, signIn: signIn)
        register("craftConnect.validate", handler: craftConnectValidateHandler(service: service))
        register("craftConnect.save", handler: craftConnectSaveHandler(service: service))
        register("craftConnect.signOut", handler: craftConnectSignOutHandler(service: service))
        if fixtures {
            register("craft.signInStart", handler: craftSignInFixtureStartHandler())
            register("craft.signInPoll", handler: craftSignInFixturePollHandler())
            register("craft.signInCancel", handler: craftSignInFixtureCancelHandler())
        } else {
            register("craft.signInStart", handler: craftSignInStartHandler(service: signIn))
            register("craft.signInPoll", handler: craftSignInPollHandler(service: signIn))
            register("craft.signInCancel", handler: craftSignInCancelHandler(service: signIn))
        }
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
