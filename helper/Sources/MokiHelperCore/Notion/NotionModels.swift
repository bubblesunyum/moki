import Foundation

// MARK: - Notion domain models
//
// JSON shapes here must match `packages/protocol` exactly. The renderer only
// talks to the helper through `window.moki.call`, so change both sides
// together. The integration token itself never appears in any of these
// shapes — `listRecents` reports status only.

/// One Notion row for the Docs lens. `object` is `"page"` or `"database"`;
/// database mapping is out of scope for v1, so both surface as titled rows.
public struct NotionRecent: Codable, Sendable, Equatable {
    public var id: String
    public var title: String
    public var url: String?
    /// `"page"` or `"database"`.
    public var object: String
    /// ISO8601 `last_edited_time` straight from the API.
    public var lastEditedTime: String

    public init(id: String, title: String, url: String?, object: String, lastEditedTime: String) {
        self.id = id
        self.title = title
        self.url = url
        self.object = object
        self.lastEditedTime = lastEditedTime
    }
}

/// `notion.listRecents` never throws for auth states — they travel in the
/// envelope so the Docs lens can render its sign-in affordance. Only network
/// failures (`unreachable`/`rate_limited`) and malformed params throw.
public enum NotionRecentsStatus: String, Codable, Sendable {
    case ok
    /// No integration token in the Keychain.
    case signedOut = "signed_out"
    /// The stored token was rejected (HTTP 401). The entry is kept — the
    /// user re-pastes via `notion.setToken` or wipes it via `notion.signOut`.
    case authExpired = "auth_expired"
}

public struct NotionRecentsResult: Codable, Sendable, Equatable {
    public var status: NotionRecentsStatus
    public var items: [NotionRecent]

    public init(status: NotionRecentsStatus, items: [NotionRecent]) {
        self.status = status
        self.items = items
    }
}

public struct NotionSetTokenParams: Codable, Sendable {
    public var token: String

    public init(token: String) {
        self.token = token
    }
}

public struct NotionOK: Codable, Sendable, Equatable {
    public var ok: Bool

    public init(ok: Bool = true) {
        self.ok = ok
    }
}

// MARK: - Notion API wire shapes

let notionSearchURL = URL(string: "https://api.notion.com/v1/search")!
let notionAPIVersion = "2022-06-28"

/// Per-request network timeout. A hung Notion endpoint must fail fast into
/// `unreachable`, never stall the Docs lens.
let notionRequestTimeout: TimeInterval = 15

/// v1 asks for exactly the rows the view shows: 12 recents, last-edited
/// first. Bodies stay block-by-block later (out of scope).
let notionRecentsPageSize = 12

/// Build the `POST /v1/search` request (last-edited sort, 12 rows). The token
/// is placed on the header here and never logged or returned.
func notionSearchRequest(token: String) -> URLRequest {
    var request = URLRequest(url: notionSearchURL)
    request.httpMethod = "POST"
    request.timeoutInterval = notionRequestTimeout
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue(notionAPIVersion, forHTTPHeaderField: "Notion-Version")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let body: [String: Any] = [
        "sort": ["direction": "descending", "timestamp": "last_edited_time"],
        "page_size": notionRecentsPageSize,
    ]
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    return request
}

struct NotionRichText: Decodable {
    var plainText: String?

    enum CodingKeys: String, CodingKey {
        case plainText = "plain_text"
    }
}

struct NotionTitleProperty: Decodable {
    var type: String?
    var title: [NotionRichText]?
}

/// One `search` result. `title` at top level is the database form; pages
/// carry their title inside `properties` under a `type == "title"` entry.
struct NotionSearchItem: Decodable {
    var object: String?
    var id: String?
    var lastEditedTime: String?
    var url: String?
    var title: [NotionRichText]?
    var properties: [String: NotionTitleProperty]?

    enum CodingKeys: String, CodingKey {
        case object
        case id
        case lastEditedTime = "last_edited_time"
        case url
        case title
        case properties
    }
}

struct NotionSearchResponse: Decodable {
    var results: [NotionSearchItem]?
}

/// Best-effort title: database `title` array, else the `title`-typed
/// property (preferring the conventional `"title"` key for determinism),
/// else `"(Untitled)"` — an unparseable row still renders, never drops.
func notionTitle(for item: NotionSearchItem) -> String {
    if let title = item.title, !title.isEmpty {
        let text = title.compactMap(\.plainText).joined()
        if !text.isEmpty { return text }
    }
    if let properties = item.properties {
        let candidates: [NotionTitleProperty?] =
            [properties["title"]] + properties.keys.sorted().map { properties[$0] }
        for property in candidates {
            if property?.type == "title", let runs = property?.title, !runs.isEmpty {
                let text = runs.compactMap(\.plainText).joined()
                if !text.isEmpty { return text }
            }
        }
    }
    return "(Untitled)"
}

/// Map one search result to a `NotionRecent`. Nil for rows with no id —
/// the list skips those rather than handing the renderer an unlinkable row —
/// and nil for rows with no `last_edited_time`: parity with Drive, which
/// drops modifiedTime-less files rather than handing the renderer an empty
/// `updatedAt` that violates the ISO-8601 contract.
func notionRecent(from item: NotionSearchItem) -> NotionRecent? {
    guard let id = item.id, !id.isEmpty else { return nil }
    guard let lastEditedTime = item.lastEditedTime, !lastEditedTime.isEmpty else { return nil }
    return NotionRecent(
        id: id,
        title: notionTitle(for: item),
        url: item.url,
        object: item.object ?? "page",
        lastEditedTime: lastEditedTime)
}

/// Map a non-200 search status. 401 means the stored token died
/// (`auth_expired`); 429 is a distinct `rate_limited` so the lens can say
/// "try again" instead of "check your connection"; anything else is a
/// transient Notion failure (`unreachable`).
func notionStatusError(status: Int) -> Error {
    switch status {
    case 401:
        return AppError(
            code: "auth_expired",
            message: "Notion authorization expired. Sign in again to reconnect.")
    case 429:
        return AppError(
            code: "rate_limited",
            message: "Notion is rate-limiting requests. Try again in a moment.")
    default:
        return AppError(
            code: "unreachable",
            message: "Notion request failed (HTTP \(status)).")
    }
}
