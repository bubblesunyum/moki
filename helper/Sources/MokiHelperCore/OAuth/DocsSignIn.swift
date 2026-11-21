import Foundation

// MARK: - Shared Docs sign-in poll shape
//
// Wire shape mirrors `packages/protocol` `DocsSignInPollResult`: the
// Notion and Craft hosted-OAuth flows report pending/done/error across
// the start/poll/cancel RPCs. Google keeps its own identical shape
// (`GoogleSignInPollResult`) for history; new flows share this one.

public enum DocsSignInPollStatus: String, Codable, Sendable, Equatable {
    case pending
    case done
    case error
}

public struct DocsSignInPollResult: Codable, Sendable, Equatable {
    /// Present when done: the workspace/account that was signed in.
    /// Never a token.
    public var status: DocsSignInPollStatus
    public var account: String?
    /// Present when error: one-line cause. Never token material.
    public var message: String?

    public init(status: DocsSignInPollStatus, account: String? = nil, message: String? = nil) {
        self.status = status
        self.account = account
        self.message = message
    }
}

/// `{ok:true}` answer for sign-in start/cancel RPCs.
public struct DocsSignInOK: Codable, Sendable, Equatable {
    public var ok: Bool

    public init(ok: Bool = true) {
        self.ok = ok
    }
}
