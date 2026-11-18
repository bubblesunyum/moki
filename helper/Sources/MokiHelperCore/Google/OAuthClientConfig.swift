import Foundation

/// Google Desktop OAuth client, shared with psymail-mini so the user never
/// signs in twice. Refresh tokens minted against these scopes keep working
/// because both apps use the same client identity.
public struct OAuthClientConfig: Sendable, Equatable {
    public var clientID: String
    public var clientSecret: String

    public init(clientID: String, clientSecret: String) {
        self.clientID = clientID
        self.clientSecret = clientSecret
    }

    /// Load the client, per key, from (1) `MOKI_GOOGLE_CLIENT_ID` /
    /// `MOKI_GOOGLE_CLIENT_SECRET` and (2) psymail-mini's `Secrets.xcconfig`.
    /// Throws `AppError(code: "auth_unconfigured")` when either value is
    /// missing from both sources.
    public static func load(
        locations: GoogleLocations = .production(),
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> OAuthClientConfig {
        let fileValues =
            (try? String(contentsOf: locations.psymailSecretsURL, encoding: .utf8))
            .map(parseXCConfig(_:)) ?? [:]
        let clientID =
            environment["MOKI_GOOGLE_CLIENT_ID"] ?? fileValues["GOOGLE_CLIENT_ID"]
        let clientSecret =
            environment["MOKI_GOOGLE_CLIENT_SECRET"]
            ?? fileValues["GOOGLE_CLIENT_SECRET"]
        guard let clientID, !clientID.isEmpty,
            let clientSecret, !clientSecret.isEmpty
        else {
            throw AppError(
                code: "auth_unconfigured",
                message:
                    "Google OAuth client is not configured (set MOKI_GOOGLE_CLIENT_ID/SECRET or check psymail-mini Secrets.xcconfig)."
            )
        }
        return OAuthClientConfig(clientID: clientID, clientSecret: clientSecret)
    }
}

/// Parse an xcconfig file's `KEY = value` lines. `//` starts a comment
/// (values never contain `//`), `#` directive lines are skipped, blank lines
/// are skipped, surrounding whitespace is trimmed, and a trailing `;` is
/// stripped.
public func parseXCConfig(_ text: String) -> [String: String] {
    var result: [String: String] = [:]
    for rawLine in text.components(separatedBy: .newlines) {
        var line = rawLine.trimmingCharacters(in: .whitespaces)
        guard !line.isEmpty, !line.hasPrefix("//"), !line.hasPrefix("#") else {
            continue
        }
        // Values never contain `//`, so anything from it on is a comment.
        if let comment = line.range(of: "//") {
            line = String(line[..<comment.lowerBound]).trimmingCharacters(
                in: .whitespaces)
        }
        guard let equals = line.firstIndex(of: "=") else { continue }
        let key = String(line[..<equals]).trimmingCharacters(in: .whitespaces)
        var value = String(line[line.index(after: equals)...]).trimmingCharacters(
            in: .whitespaces)
        if value.hasSuffix(";") {
            value = String(value.dropLast()).trimmingCharacters(
                in: .whitespaces)
        }
        guard !key.isEmpty, !value.isEmpty else { continue }
        result[key] = value
    }
    return result
}
