import Foundation

// MARK: - Mail domain models
//
// JSON shapes here must match `packages/protocol` exactly (dates are
// ISO8601 strings). The renderer only talks to the helper through
// `window.moki.call`, so change both sides together.

public struct EmailAddress: Codable, Sendable, Equatable {
    /// Display name. Falls back to the address itself when the header
    /// carries no display name, so the shape is always `{name, address}`.
    public var name: String
    public var address: String

    public init(name: String, address: String) {
        self.name = name
        self.address = address
    }
}

public struct ThreadSummary: Codable, Sendable, Equatable {
    public var id: String
    public var account: String
    public var from: EmailAddress
    public var subject: String
    public var snippet: String
    /// ISO8601 date string (newest message in the thread).
    public var date: String
    public var unread: Bool
    public var messageCount: Int
    public var labelIds: [String]

    public init(
        id: String, account: String, from: EmailAddress, subject: String,
        snippet: String, date: String, unread: Bool, messageCount: Int,
        labelIds: [String]
    ) {
        self.id = id
        self.account = account
        self.from = from
        self.subject = subject
        self.snippet = snippet
        self.date = date
        self.unread = unread
        self.messageCount = messageCount
        self.labelIds = labelIds
    }
}

public struct MailMessage: Codable, Sendable, Equatable {
    public var id: String
    public var from: EmailAddress
    public var to: [EmailAddress]
    public var cc: [EmailAddress]
    /// ISO8601 date string.
    public var date: String
    public var html: String?
    public var text: String?
    public var isFromMe: Bool

    public init(
        id: String, from: EmailAddress, to: [EmailAddress], cc: [EmailAddress],
        date: String, html: String?, text: String?, isFromMe: Bool
    ) {
        self.id = id
        self.from = from
        self.to = to
        self.cc = cc
        self.date = date
        self.html = html
        self.text = text
        self.isFromMe = isFromMe
    }
}

public struct ThreadDetail: Codable, Sendable, Equatable {
    public var id: String
    public var account: String
    public var subject: String
    public var messages: [MailMessage]

    public init(id: String, account: String, subject: String, messages: [MailMessage]) {
        self.id = id
        self.account = account
        self.subject = subject
        self.messages = messages
    }
}

/// One merged page across accounts (mirrors the psymail-mini MailPage
/// shape): `next` maps account -> pageToken and omits exhausted accounts;
/// a failed account lands in `unreachable`/`authExpired`, never silently
/// as "no mail".
public struct MailPage: Codable, Sendable, Equatable {
    public var threads: [ThreadSummary]
    public var next: [String: String]?
    public var unreachable: [String]
    public var authExpired: [String]

    public init(
        threads: [ThreadSummary], next: [String: String]?,
        unreachable: [String], authExpired: [String]
    ) {
        self.threads = threads
        self.next = next
        self.unreachable = unreachable
        self.authExpired = authExpired
    }
}

// MARK: - RPC params

public struct ListThreadsParams: Codable, Sendable {
    /// `INBOX` for the inbox, `psymail/<name>` for bundles.
    public var label: String
    /// Opaque per-account page tokens from the previous page's `next`.
    public var cursor: [String: String]?

    public init(label: String, cursor: [String: String]? = nil) {
        self.label = label
        self.cursor = cursor
    }
}

public struct GetThreadParams: Codable, Sendable {
    public var account: String
    public var id: String

    public init(account: String, id: String) {
        self.account = account
        self.id = id
    }
}
