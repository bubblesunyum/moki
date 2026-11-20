import Foundation
import Testing

@testable import MokiHelperCore

/// Stub-only coverage for the secret-store seam: the real Keychain
/// (`KeychainSecretStore`) is never touched in tests — every Notion test
/// injects `InMemorySecretStore`. These pin the double's contract (and the
/// Keychain item naming) so a leaky mock can't silently pass.
@Suite
struct NotionKeychainStubTests {
    @Test func keychainItemNaming() {
        #expect(MokiKeychainIDs.service == "com.moki.helper")
        #expect(MokiKeychainIDs.notionTokenAccount == "notion-integration-token")
    }

    @Test func writeReadDeleteRoundTrip() throws {
        let store = InMemorySecretStore()
        #expect(
            store.read(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionTokenAccount) == nil)
        try store.write(
            "ntn_abc", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        #expect(
            store.read(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionTokenAccount) == "ntn_abc")
        // Overwrite replaces (Keychain update path).
        try store.write(
            "ntn_xyz", service: MokiKeychainIDs.service,
            account: MokiKeychainIDs.notionTokenAccount)
        #expect(
            store.read(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionTokenAccount) == "ntn_xyz")
        try store.delete(
            service: MokiKeychainIDs.service, account: MokiKeychainIDs.notionTokenAccount)
        #expect(
            store.read(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionTokenAccount) == nil)
    }

    @Test func deleteMissingSucceeds() throws {
        // Sign-out with nothing stored is still a success.
        try InMemorySecretStore().delete(
            service: MokiKeychainIDs.service, account: MokiKeychainIDs.notionTokenAccount)
    }

    @Test func emptyWriteThrows() {
        do {
            try InMemorySecretStore().write(
                "", service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionTokenAccount)
            Issue.record("expected KeychainError")
        } catch is KeychainError {
        } catch {
            Issue.record("wrong error: \(error)")
        }
    }

    @Test func entriesIsolatedByServiceAndAccount() throws {
        let store = InMemorySecretStore()
        try store.write("a", service: "s1", account: "notion-integration-token")
        try store.write("b", service: MokiKeychainIDs.service, account: "other")
        #expect(store.read(service: "s1", account: "notion-integration-token") == "a")
        #expect(store.read(service: MokiKeychainIDs.service, account: "other") == "b")
        #expect(
            store.read(
                service: MokiKeychainIDs.service,
                account: MokiKeychainIDs.notionTokenAccount) == nil)
    }
}
