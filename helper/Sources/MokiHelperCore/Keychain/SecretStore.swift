import Foundation
import Security

// MARK: - Secret storage seam
//
// The Notion integration token lives in the Keychain (first Keychain secret
// in the helper). It never crosses into renderer params, RPC results, or
// logs — handlers only ever report status. Tests inject
// `InMemorySecretStore`, never the real Keychain.

/// Keychain identity for helper-held secrets. One generic-password item per
/// account under Moki's own service so sign-out is a single delete.
public enum MokiKeychainIDs {
    public static let service = "com.moki.helper"
    public static let notionTokenAccount = "notion-integration-token"
    /// Hosted-MCP OAuth grant (DCR client id + refresh/access tokens as one
    /// JSON entry), separate from the legacy integration token.
    public static let notionMCPGrantAccount = "notion-mcp-grant"
}

/// Minimal secret-store surface: read/write/delete one string secret.
/// `service` + `account` identify the generic-password item.
public protocol SecretStoring: Sendable {
    func read(service: String, account: String) -> String?
    func write(_ secret: String, service: String, account: String) throws
    func delete(service: String, account: String) throws
}

public struct KeychainError: Error, Sendable {
    public let message: String

    public init(_ message: String) {
        self.message = message
    }
}

/// Production store backed by the login Keychain (`kSecClassGenericPassword`).
/// Failures surface as `KeychainError` with a generic message — never the
/// secret, never the OSStatus detail beyond the code.
public struct KeychainSecretStore: SecretStoring {
    public init() {}

    public func read(service: String, account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
            let data = item as? Data,
            let secret = String(data: data, encoding: .utf8),
            !secret.isEmpty
        else {
            return nil
        }
        return secret
    }

    public func write(_ secret: String, service: String, account: String) throws {
        guard let data = secret.data(using: .utf8), !secret.isEmpty else {
            throw KeychainError("Cannot store an empty secret.")
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            break
        default:
            throw KeychainError("Could not save secret (OSStatus \(updateStatus)).")
        }
        var addQuery = query
        addQuery[kSecValueData as String] = data
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainError("Could not save secret (OSStatus \(addStatus)).")
        }
    }

    public func delete(service: String, account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        // Deleting a missing item is a successful sign-out, not an error.
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError("Could not remove secret (OSStatus \(status)).")
        }
    }
}

/// Test/preview double. Lock-guarded; never touches the real Keychain.
public final class InMemorySecretStore: SecretStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var secrets: [String: String] = [:]

    public init(secrets: [String: String] = [:]) {
        self.secrets = secrets
    }

    private func key(service: String, account: String) -> String {
        "\(service)\n\(account)"
    }

    public func read(service: String, account: String) -> String? {
        lock.withLock { secrets[key(service: service, account: account)] }
    }

    public func write(_ secret: String, service: String, account: String) throws {
        guard !secret.isEmpty else {
            throw KeychainError("Cannot store an empty secret.")
        }
        lock.withLock { secrets[key(service: service, account: account)] = secret }
    }

    public func delete(service: String, account: String) throws {
        lock.withLock { secrets.removeValue(forKey: key(service: service, account: account)) }
    }
}
