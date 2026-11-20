import Foundation

// MARK: - Craft credential store
//
// Owner-only JSON file in Application Support holding `{url, spaceId}`
// (the space id comes from `GET /connection` validation and addresses the
// per-document deep links). Same pattern as the Google token file — and
// deliberately not the Keychain: CCP moved off the Keychain in ccp-1be9
// because dev-signed rebuilds re-prompt on every launch. The raw URL is the
// credential: it is never logged (save failures log one generic line) and
// never echoed in any error.

/// Injectable file locations for the Craft credential.
///
/// Production code uses `.production()` (real home directory); tests build
/// one rooted at a temp dir so they never touch the real Library.
public struct CraftLocations: Sendable, Equatable {
    public var credentialURL: URL

    public init(credentialURL: URL) {
        self.credentialURL = credentialURL
    }

    /// Production location: `~/Library/Application Support/Moki/`.
    public static func production(
        homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> CraftLocations {
        CraftLocations(credentialURL: homeDirectoryURL.appendingPathComponent(
            "Library/Application Support/Moki/craft-connection.json"))
    }
}

/// What the owner-only file holds. `spaceId` is optional for forward
/// compatibility (a file written before the id was captured still
/// authenticates); deep links omit the space param when it is missing.
public struct CraftCredential: Codable, Sendable, Equatable {
    public var url: String
    public var spaceId: String?

    public init(url: String, spaceId: String? = nil) {
        self.url = url
        self.spaceId = spaceId
    }
}

public struct CraftCredentialStore: Sendable {
    public var locations: CraftLocations

    public init(locations: CraftLocations = .production()) {
        self.locations = locations
    }

    /// The stored credential, or nil when there is none. Missing, blank, or
    /// corrupt files all read as missing — a corrupt file heals on the next
    /// successful save.
    public func load() -> CraftCredential? {
        guard let data = try? Data(contentsOf: locations.credentialURL),
            !data.isEmpty
        else { return nil }
        guard let credential = try? JSONDecoder().decode(CraftCredential.self, from: data),
            !credential.url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return credential
    }

    /// Persist the credential (creating parent dirs), mode 0600. Best
    /// effort: a failure only logs a generic message — the URL stays in
    /// memory for the current request either way.
    public func save(_ credential: CraftCredential) {
        let manager = FileManager.default
        do {
            try manager.createDirectory(
                at: locations.credentialURL.deletingLastPathComponent(),
                withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(credential)
            try data.write(to: locations.credentialURL, options: .atomic)
            try manager.setAttributes(
                [.posixPermissions: 0o600], ofItemAtPath: locations.credentialURL.path)
        } catch {
            logToStderr("moki-helper: could not save craft credential file")
        }
    }

    /// Remove the credential. A missing file still succeeds.
    public func remove() {
        do {
            try FileManager.default.removeItem(at: locations.credentialURL)
        } catch let error as NSError
        where error.domain == NSCocoaErrorDomain && error.code == NSFileNoSuchFileError {
            // Already gone — still a success.
        } catch {
            logToStderr("moki-helper: could not remove craft credential file")
        }
    }
}
