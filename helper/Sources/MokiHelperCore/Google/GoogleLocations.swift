import Foundation

/// Injectable file locations for Google OAuth + token storage.
///
/// Production code uses `.production()` (real home directory plus the
/// `MOKI_PSYMAIL_SECRETS` override); tests build one rooted at a temp dir so
/// they never touch the real Library.
public struct GoogleLocations: Sendable, Equatable {
    public var homeDirectoryURL: URL
    public var mokiTokensURL: URL
    public var psymailSecretsURL: URL
    public var psymailContainersDirectoryURL: URL
    public var psymailUnsandboxedTokensURL: URL
    /// Exact sandboxed psymail-mini token file. Read this path only — never
    /// glob `~/Library/Containers/*` (statting every app's container can
    /// block on macOS's "access data from other apps" consent).
    public var psymailSandboxedTokensURL: URL

    public init(
        homeDirectoryURL: URL,
        mokiTokensURL: URL? = nil,
        psymailSecretsURL: URL? = nil,
        psymailContainersDirectoryURL: URL? = nil,
        psymailUnsandboxedTokensURL: URL? = nil,
        psymailSandboxedTokensURL: URL? = nil
    ) {
        self.homeDirectoryURL = homeDirectoryURL
        self.mokiTokensURL =
            mokiTokensURL
            ?? homeDirectoryURL.appendingPathComponent(
                "Library/Application Support/Moki/google-tokens.json")
        self.psymailSecretsURL =
            psymailSecretsURL
            ?? homeDirectoryURL.appendingPathComponent(
                "dev/psymail-mini/Config/Secrets.xcconfig")
        let containersDir =
            psymailContainersDirectoryURL
            ?? homeDirectoryURL.appendingPathComponent("Library/Containers")
        self.psymailContainersDirectoryURL = containersDir
        self.psymailUnsandboxedTokensURL =
            psymailUnsandboxedTokensURL
            ?? homeDirectoryURL.appendingPathComponent(
                "Library/Application Support/PsymailMini/tokens.json")
        self.psymailSandboxedTokensURL =
            psymailSandboxedTokensURL
            ?? containersDir
                .appendingPathComponent("com.psymail.mini")
                .appendingPathComponent(
                    "Data/Library/Application Support/PsymailMini/tokens.json")
    }

    /// Production locations. `MOKI_PSYMAIL_SECRETS` overrides the xcconfig path.
    public static func production(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> GoogleLocations {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let secretsOverride = environment["MOKI_PSYMAIL_SECRETS"].map {
            URL(fileURLWithPath: $0)
        }
        return GoogleLocations(
            homeDirectoryURL: home, psymailSecretsURL: secretsOverride)
    }
}
