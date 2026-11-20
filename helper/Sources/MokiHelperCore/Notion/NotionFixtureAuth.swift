import Foundation

// MARK: - Fixture-only Notion auth state
//
// Under `MOKI_FIXTURES=1` the helper serves canned rows with no network —
// and must also be hermetic for auth: `notion.setToken` / `notion.signOut`
// in fixtures mode flip this in-memory flag instead of touching the real
// Keychain. Both fixture list paths consult it (`NotionService.listRecents`
// and the fixture `docs.listRecents` notion section), so a fixtures
// sign-out settles into signed-out and a fixtures set-token restores rows.
// Live paths never consult this state.
//
// An actor (not a global Bool) so concurrent RPC handlers queue on it, per
// the codebase's actors-for-shared-state rule. Tests reset it to the
// signed-in default before each fixture-auth test — it is process-global,
// so every fixture-mode test must establish its precondition first.

public actor NotionFixtureAuthState {
    public static let shared = NotionFixtureAuthState()

    private var signedOut = false

    public func isSignedOut() -> Bool {
        signedOut
    }

    public func setSignedOut(_ signedOut: Bool) {
        self.signedOut = signedOut
    }

    /// Test hook: restore the signed-in default between fixture-auth tests.
    public func reset() {
        signedOut = false
    }
}
