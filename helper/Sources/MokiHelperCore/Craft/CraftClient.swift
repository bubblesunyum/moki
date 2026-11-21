import Foundation

// MARK: - Craft Connect client
//
// Thin layer over the Craft Connect API (see
// control-center-pro/harness/reference/craft-connect-api.md, proven live
// there). The connection URL is the credential: no auth header, base
// `https://connect.craft.do/links/<token>/api/v1`. Validation and error
// mapping are copied from CCP's `CraftClient`, tightened with the hostile
// cases from its `CraftConnectionTests` (userinfo/@-tricks, backslashes,
// inner whitespace, exact path shape).

/// The space a connection URL was verified against. `serverTime` is Craft's
/// own clock from `utc.time` — conflict comparison uses it, never the Mac's.
/// Nil when the payload carried no parseable time; callers that need the
/// clock treat nil as unknown, not as now.
public struct CraftSpace: Sendable, Equatable {
    public var name: String
    public var serverTime: Date?
    /// The space id `GET /connection` carries beside the name. What the
    /// per-document deep link is addressed with — cached by the credential
    /// store, never shown.
    public var spaceID: String?

    public init(name: String, serverTime: Date? = nil, spaceID: String? = nil) {
        self.name = name
        self.serverTime = serverTime
        self.spaceID = spaceID
    }
}

public enum CraftClientError: Error, Equatable, Sendable {
    /// Anything that is not a verified space: network failure, non-2xx (a
    /// wrong token's exact behaviour is still unobserved), or a payload that
    /// does not decode. A failed check is "store unreachable", never a reason
    /// to touch local state.
    case unreachable(statusCode: Int?)
    /// The shared budget said slow down (100 req/60s per space, shared with
    /// every client in the space). Carries the server's Retry-After when it
    /// named one.
    case rateLimited(retryAfter: TimeInterval?)
}

/// The smallest useful Craft Connect client: validate a connection URL with
/// `GET /connection`, list documents with `GET /documents?fetchMetadata=true`
/// (per-item `lastModifiedAt` + `clickableLink`; sorting is the service's
/// job). Listing is one request and stays one request — no per-document
/// fan-out against the shared 100 req/60s budget.
public struct CraftClient: Sendable {
    let baseURL: URL
    let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    /// A pasted connection string, normalised to the API base URL. Trims
    /// outer whitespace, drops trailing slashes. Nil unless it is an https
    /// URL on exactly `connect.craft.do` with path
    /// `/links/<token>/api/v1` — anything else is not a Craft connection,
    /// including craft.co links (a different company entirely) and the bare
    /// host (which carries no credential).
    ///
    /// Strict rejections beyond CCP's prefix check, from the hostile-URL
    /// battery: userinfo (`user@host`), any `@` in the raw string, any
    /// backslash (URL parsers normalise `\` to `/`, so `host\…` tricks must
    /// die before parsing), any inner whitespace, an explicit port, and any
    /// query or fragment. The credential is never logged; on failure the
    /// caller reports the host only.
    public static func baseURL(from raw: String) -> URL? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        guard text.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return nil }
        guard !text.contains("\\") else { return nil }
        guard !text.contains("@") else { return nil }
        var normalized = text
        while normalized.hasSuffix("/") { normalized.removeLast() }
        guard !normalized.isEmpty,
            let url = URL(string: normalized),
            url.scheme == "https",
            url.user == nil,
            url.host?.lowercased() == "connect.craft.do",
            url.port == nil,
            url.query == nil,
            url.fragment == nil
        else { return nil }
        // Exact base shape: /links/<token>/api/v1 with a non-empty token.
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard parts.count == 4, parts[0] == "links", !parts[1].isEmpty,
            parts[2] == "api", parts[3] == "v1"
        else { return nil }
        return url
    }

    /// `GET /connection` — the space on success, `.unreachable` otherwise.
    /// Never throws anything else.
    public func checkConnection() async -> Result<CraftSpace, CraftClientError> {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: craftRequest(path: "connection"))
        } catch {
            return .failure(.unreachable(statusCode: nil))
        }
        guard let http = response as? HTTPURLResponse else {
            return .failure(.unreachable(statusCode: nil))
        }
        if http.statusCode == 429 {
            return .failure(.rateLimited(retryAfter: retryAfter(from: http)))
        }
        guard (200..<300).contains(http.statusCode) else {
            return .failure(.unreachable(statusCode: http.statusCode))
        }
        guard let space = Self.decodeSpace(from: data) else {
            return .failure(.unreachable(statusCode: http.statusCode))
        }
        return .success(space)
    }

    /// `GET /documents?fetchMetadata=true` — every document in space order
    /// with per-item metadata (`lastModifiedAt`, `clickableLink`). One
    /// request, no fan-out — the listing stays well inside the shared
    /// 50 req/10s, 100 req/60s-per-space budgets. Ordering happens in the
    /// service; the client preserves space order.
    public func listDocuments() async -> Result<[CraftDocument], CraftClientError> {
        let data: Data
        let response: URLResponse
        do {
            let request = craftRequest(
                path: "documents", queryItems: [URLQueryItem(name: "fetchMetadata", value: "true")])
            (data, response) = try await session.data(for: request)
        } catch {
            return .failure(.unreachable(statusCode: nil))
        }
        guard let http = response as? HTTPURLResponse else {
            return .failure(.unreachable(statusCode: nil))
        }
        if http.statusCode == 429 {
            return .failure(.rateLimited(retryAfter: retryAfter(from: http)))
        }
        guard (200..<300).contains(http.statusCode) else {
            return .failure(.unreachable(statusCode: http.statusCode))
        }
        guard let payload = try? JSONDecoder().decode(CraftDocumentsPayload.self, from: data),
            let items = payload.items
        else {
            return .failure(.unreachable(statusCode: http.statusCode))
        }
        return .success(items.compactMap { craftDocument(from: $0) })
    }

    private func craftRequest(path: String, queryItems: [URLQueryItem] = []) -> URLRequest {
        var url = baseURL.appending(path: path)
        if !queryItems.isEmpty {
            url.append(queryItems: queryItems)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = craftRequestTimeout
        return request
    }

    private struct ConnectionPayload: Decodable {
        struct Space: Decodable {
            var id: String?
            var name: String?
        }
        struct Clock: Decodable {
            var time: String?
        }
        var space: Space?
        var utc: Clock?
    }

    static func decodeSpace(from data: Data) -> CraftSpace? {
        guard let payload = try? JSONDecoder().decode(ConnectionPayload.self, from: data),
            let name = payload.space?.name, !name.isEmpty
        else { return nil }
        let time = payload.utc?.time.flatMap(parseServerTime)
        return CraftSpace(name: name, serverTime: time, spaceID: payload.space?.id)
    }

    /// Fresh formatters per call: `ISO8601DateFormatter` is not `Sendable`,
    /// so no shared static (this parses one clock per verification — cheap).
    static func parseServerTime(_ raw: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }
}

/// Per-request network timeout. A hung Craft endpoint must fail fast into
/// `unreachable`, never stall the Docs lens.
let craftRequestTimeout: TimeInterval = 15

/// One row of `GET /documents?fetchMetadata=true`. Titles may be empty
/// strings; id-less rows are dropped upstream (unlinkable). Empty titles
/// render as `(Untitled)`, matching the Notion mapping. `lastModifiedAt` is
/// the API's ISO8601 modified stamp passed through untouched (the renderer
/// formats it); nil when the item carried none. `clickableLink` is the API's
/// native-app open target (`craftdocs://open?spaceId&documentId`).
public struct CraftDocument: Sendable, Equatable {
    public var id: String
    public var title: String
    public var lastModifiedAt: String?
    public var clickableLink: String?

    public init?(id: String?, title: String?, lastModifiedAt: String? = nil, clickableLink: String? = nil) {
        guard let id, !id.isEmpty else { return nil }
        self.id = id
        let trimmed = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        self.title = trimmed.isEmpty ? "(Untitled)" : trimmed
        self.lastModifiedAt = lastModifiedAt.flatMap { $0.isEmpty ? nil : $0 }
        self.clickableLink = clickableLink.flatMap { $0.isEmpty ? nil : $0 }
    }
}

struct CraftDocumentMetadata: Decodable {
    var lastModifiedAt: String?
    var clickableLink: String?
}

struct CraftDocumentItem: Decodable {
    var id: String?
    var title: String?
    var lastModifiedAt: String?
    var clickableLink: String?
    var metadata: CraftDocumentMetadata?
}

/// Best-effort row: the docs pin per-item metadata under either a
/// `metadata` object or top-level keys, so read both — nested first, then
/// top-level. An unparseable row still renders, never drops (id-less rows
/// excepted, same as before).
func craftDocument(from item: CraftDocumentItem) -> CraftDocument? {
    CraftDocument(
        id: item.id,
        title: item.title,
        lastModifiedAt: item.metadata?.lastModifiedAt ?? item.lastModifiedAt,
        clickableLink: item.metadata?.clickableLink ?? item.clickableLink)
}

struct CraftDocumentsPayload: Decodable {
    var items: [CraftDocumentItem]?
}

private func retryAfter(from response: HTTPURLResponse) -> TimeInterval? {
    guard let raw = response.value(forHTTPHeaderField: "Retry-After")?.trimmingCharacters(
        in: .whitespacesAndNewlines),
        !raw.isEmpty
    else { return nil }
    return TimeInterval(raw)
}
