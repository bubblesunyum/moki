import CryptoKit
import Foundation
import Security

#if canImport(AppKit)
import AppKit
#endif

// MARK: - Shared OAuth helpers
//
// Provider-independent primitives for the loopback sign-in flows (Notion
// and Craft). Both call the same function separately for their `state`
// CSRF value and PKCE verifier, and both send an S256 challenge. Nothing
// here knows about any one provider.

/// 32 random bytes, base64url without padding — a `state` or PKCE
/// verifier. Uses the same transform as RFC 7636 §B.
public func oauthRandomURLSafeString() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return oauthBase64URL(Data(bytes))
}

/// `S256` code challenge for a verifier.
public func oauthCodeChallenge(for verifier: String) -> String {
    oauthBase64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
}

/// Opens the provider consent page in the user's browser. No-op (beyond
/// touching the URL) where AppKit is unavailable, e.g. Linux tests.
public func openOAuthInSystemBrowser(_ url: URL) {
    #if canImport(AppKit)
    _ = NSWorkspace.shared.open(url)
    #else
    _ = url
    #endif
}

func oauthBase64URL(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}
