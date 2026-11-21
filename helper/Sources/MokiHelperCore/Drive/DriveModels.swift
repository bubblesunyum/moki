import Foundation

// MARK: - Docs domain models
//
// JSON shapes here must match `packages/protocol` exactly (dates are
// ISO8601 strings straight from the source APIs). The renderer only talks
// to the helper through `window.moki.call`, so change both sides together.
//
// `DocItem` is the shared row shape across Drive/Notion/Craft (see the
// mok-8uu epic): `source` names the section; Drive rows always carry
// `"drive"`.

public enum DocSource: String, Codable, Sendable, Equatable {
    case drive
    case notion
    case craft
}

public struct DocItem: Codable, Sendable, Equatable {
    public var id: String
    public var title: String
    public var source: DocSource
    /// ISO8601 modified time straight from the source API.
    public var updatedAt: String
    /// URL opened in the shared Docs preview pane. For Craft this is the
    /// web editor built from the API's clickableLink values; empty when a
    /// row has no validated link (including legacy no-space credentials)
    /// and opens out-of-app via `deepLink` instead.
    public var openUrl: String
    /// Optional out-of-app open target (Craft `craftdocs://` deep link).
    /// A row with no openUrl opens in the native app via openExternal and
    /// never reaches the webview guest. Synthesized `deepLink` JSON key
    /// matches `packages/protocol` (`DocItem.deepLink?`).
    public var deepLink: String?

    public init(
        id: String, title: String, source: DocSource, updatedAt: String, openUrl: String,
        deepLink: String? = nil
    ) {
        self.id = id
        self.title = title
        self.source = source
        self.updatedAt = updatedAt
        self.openUrl = openUrl
        self.deepLink = deepLink
    }
}

/// Merged Drive recents across accounts (mirrors the mail/calendar page
/// shape): a failed account lands in `unreachable`/`authExpired`, never
/// silently as "no files".
public struct DriveFilesPage: Codable, Sendable, Equatable {
    public var items: [DocItem]
    public var unreachable: [String]
    public var authExpired: [String]

    public init(items: [DocItem], unreachable: [String], authExpired: [String]) {
        self.items = items
        self.unreachable = unreachable
        self.authExpired = authExpired
    }
}
