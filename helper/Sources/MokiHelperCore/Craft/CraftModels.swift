import Foundation

// MARK: - Craft Connect RPC shapes
//
// JSON shapes here must match `packages/protocol` exactly. The renderer only
// talks to the helper through `window.moki.call`, so change both sides
// together.
//
// Craft rows are the shared `DocItem` (`source == .craft`, `openUrl` the web
// editor built from the API's `clickableLink` values — empty when a row
// has no validated link — `deepLink` the native-app target); the
// Craft section envelope is the shared `DocsListRecentsResult` (`items`,
// `unreachable`, `signedOut`). This area owns only `Craft/**` shapes below.

/// `craftConnect.validate` / `craftConnect.save` params: the pasted
/// connection string. The URL *is* the credential — it is never echoed back
/// in any result, error, or log.
public struct CraftConnectParams: Codable, Sendable {
    public var url: String

    public init(url: String) {
        self.url = url
    }
}

/// `craftConnect.validate` result. `ok:false` means the string is not a
/// Craft connection URL (no network touched). Verification failures throw
/// `AppError(code: "unreachable")` instead — a wrong token or dead network
/// is not a shape problem, and the caller must not read it as one.
public struct CraftConnectValidateResult: Codable, Sendable, Equatable {
    public var ok: Bool
    public var spaceName: String?

    public init(ok: Bool, spaceName: String? = nil) {
        self.ok = ok
        self.spaceName = spaceName
    }
}

public struct CraftOK: Codable, Sendable, Equatable {
    public var ok: Bool

    public init(ok: Bool = true) {
        self.ok = ok
    }
}
